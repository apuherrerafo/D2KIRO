import { describe, expect, test } from "bun:test";
import { applyProtocolCommand, computeEligibilityContentHash, createProtocolState } from "../draft-protocol";
import type { CmHeroEligibilitySnapshot, DraftProtocolState } from "../draft-protocol/types";
import type { OpponentModelResult, OpponentValueBaselineResult } from "./opponent-model";
import { evaluateSteal } from "./steal";
import type { RecommendationSlot } from "./types";

// R1 S6 BLOCKER REPAIR -- these fixtures deliberately use REAL protocol states (via
// applyProtocolCommand), never a single shared `state` reused as both "before" and "after" the
// way the pre-repair version of this file did. MATERIALIZATION is now a PROTOCOL-AVAILABILITY
// fact (see steal.ts/protocol-availability.ts), so a test proving it must show a REAL
// banned/confirmed transition between two distinct states -- reusing one `state` object for both
// arguments can only ever prove the OLD (ranking-membership) semantics, which is exactly the bug
// this repair removes.

function eligibilitySnapshot(heroIds: number[]): CmHeroEligibilitySnapshot {
  const base = {
    schema: "cm-hero-eligibility/v1" as const,
    appId: 570 as const,
    patch: "7.41e",
    buildId: "b",
    depotManifests: { "570": "fixture-manifest" },
    sourceHashes: { npc_heroes: "fixture" },
    provenance: {
      kind: "OFFICIAL_DEPOT" as const,
      appId: 570 as const,
      buildId: "b",
      depotId: "fixture-depot",
      manifestId: "fixture-manifest",
      sourcePath: "scripts/npc/npc_heroes.txt",
      sourceHash: "fixture",
    },
    heroIds,
  };
  return { ...base, contentHash: computeEligibilityContentHash(base) };
}

function apStateWithBans(sessionId: string, bannedHeroes: number[]): DraftProtocolState {
  const created = createProtocolState(sessionId, "dota2/ranked-all-pick");
  if (!created.ok) throw new Error("fixture setup failed");
  const banned =
    bannedHeroes.length > 0 ? applyProtocolCommand(created.state, { type: "RECORD_RESOLVED_BANS", heroes: bannedHeroes }).state : created.state;
  return applyProtocolCommand(banned, { type: "BAN_RESOLUTION_COMPLETE" }).state;
}

function cmReadyState(sessionId: string, heroIds: number[]): DraftProtocolState {
  const created = createProtocolState(sessionId, "dota2/captains-mode");
  if (!created.ok) throw new Error("fixture setup failed");
  const confirmed = applyProtocolCommand(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }).state;
  return applyProtocolCommand(confirmed, { type: "LOAD_CM_ELIGIBILITY", snapshot: eligibilitySnapshot(heroIds) }).state;
}

function suggestionSetFrom(heroes: readonly { hero: number; score: number }[]) {
  if (heroes.length === 0) return null;
  return {
    schema: "suggestions/v1" as const,
    sessionId: "s",
    basedOnSeq: 0,
    decisionContext: "team_opening" as const,
    suggestions: heroes.map((h, index) => ({
      hero: h.hero,
      rank: (Math.min(index + 1, 6) as 1 | 2 | 3 | 4 | 5 | 6),
      score: h.score,
      signals: [],
      reason: "fixture",
      confidence: "alta" as const,
      evidenceCoverage: 1,
      guessingIndex: 0,
    })),
    comparison: null,
    degraded: [],
    computedInMs: 1,
  };
}

/** OPPONENT VALUE BASELINE fixture -- deliberately has NO `decision`/`shortlist`: a baseline never
 * claims a legal action exists (see opponent-model.ts's computeOpponentValueBaseline doc). */
function baselineModel(heroes: readonly { hero: number; score: number }[]): OpponentValueBaselineResult {
  return { eligibleHeroIds: null, suggestionSet: suggestionSetFrom(heroes), failed: false };
}

const FAILED_BASELINE: OpponentValueBaselineResult = { eligibleHeroIds: null, suggestionSet: null, failed: true };

/** Legal-response model fixture (the "after" side) -- DOES carry a `decision`, because it is only
 * ever used where a real counterfactual observation point was reached. */
function afterModel(heroes: readonly { hero: number; score: number }[], controlledSlot: RecommendationSlot): OpponentModelResult {
  const suggestionSet = suggestionSetFrom(heroes);
  return {
    decision: { actor: controlledSlot.side, actionKind: "PICK", phase: null, round: null, step: null, controlledSlots: [controlledSlot], actionCount: 1 },
    eligibleHeroIds: null,
    suggestionSet,
    shortlist: heroes.map((h) => ({ hero: h.hero, suggestion: suggestionSet!.suggestions.find((s) => s.hero === h.hero)! })),
    failed: false,
  };
}

const FAILED_AFTER: OpponentModelResult = {
  decision: { actor: "dire", actionKind: null, phase: null, round: null, step: null, controlledSlots: [], actionCount: 0 },
  eligibleHeroIds: null,
  suggestionSet: null,
  shortlist: [],
  failed: true,
};

const DIRE_SLOT_0: RecommendationSlot = { side: "dire", slotIndex: 0 };

describe("evaluateSteal -- disponibilidad protocolar, nunca membresía en un ranking acotado", () => {
  test("Case A -- el héroe sigue disponible para el rival (sin tocar) -> STILL_CONTESTABLE", () => {
    const before = apStateWithBans("steal-still-contestable-2", []);
    const baseline = baselineModel([{ hero: 1, score: 90 }]);
    const after = afterModel([{ hero: 1, score: 90 }], DIRE_SLOT_0);
    const result = evaluateSteal(before, baseline, after, before, [1]);
    expect(result.status).toBe("STILL_CONTESTABLE");
    expect(result.heroId).toBe(1);
    expect(result.opponentBaselineValue).toBe(90);
    expect(result.afterOurActionValue).toBe(90);
    expect(result.displacedResponse).toBeNull();
  });

  test("REAL CM BAN -> STEAL: nuestro propio CM_ACTION de ban aplicado por el kernel retira un héroe codiciado del universo del rival -> MATERIALIZED", () => {
    const ready = cmReadyState("steal-real-cm-ban", [1, 2, 3, 4, 5]);
    // Steps 1-2 (BAN_1) both belong to actor "first"=radiant -- advance to step 2 (still OUR turn,
    // dire has no legal action yet) so the SAME state doubles as "CM PRE-ACTION BASELINE" fixture.
    const beforeOurAction = applyProtocolCommand(ready, { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 5 }).state;
    expect(beforeOurAction.captainsMode!.currentStep).toBe(2);

    // Hero 1 is available and, per the opponent's own baseline valuation, meaningfully coveted.
    const baseline = baselineModel([{ hero: 1, score: 90 }, { hero: 2, score: 70 }]);

    // OUR real action: ban hero 1, applied through the SAME ProtocolKernel (never a hand-rolled
    // state) -- this is step 2, whose actor is STILL "first"=radiant, so applying it advances the
    // sequence into step 3 ("second"=dire), the opponent's real next legal decision point.
    const afterOurBan = applyProtocolCommand(beforeOurAction, { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 1 }).state;
    expect(afterOurBan.captainsMode!.currentStep).toBe(3);
    expect(afterOurBan.captainsMode!.bannedHeroes).toContain(1);

    // Hero 1 is genuinely gone now -- bounded to the remaining eligible universe, V6 can no longer
    // rank it; dire's real next response settles for hero 2.
    const after = afterModel([{ hero: 2, score: 70 }], { side: "dire", slotIndex: 3 });

    const result = evaluateSteal(beforeOurAction, baseline, after, afterOurBan, [1]);
    expect(result.status).toBe("MATERIALIZED");
    expect(result.heroId).toBe(1);
    expect(result.opponentBaselineValue).toBe(90);
    expect(result.afterOurActionValue).toBeNull();
    expect(result.displacedResponse).toEqual({ slot: { side: "dire", slotIndex: 3 }, hero: 2 });
  });

  test("RANKING-DROP FALSE POSITIVE -- el héroe sigue siendo protocolarmente disponible, sólo desaparece del top acotado del rival -> STEAL != MATERIALIZED", () => {
    const state = apStateWithBans("steal-ranking-drop", []); // hero 5 never banned/picked, before OR after
    const baseline = baselineModel([{ hero: 5, score: 80 }]);
    // `after` simulates a bounded/reordered shortlist that no longer includes hero 5 -- e.g. top-8
    // truncation or a scoring reshuffle -- with NOTHING protocol-wise having changed.
    const after = afterModel([], DIRE_SLOT_0);
    const result = evaluateSteal(state, baseline, after, state, [5]);
    expect(result.status).not.toBe("MATERIALIZED");
    expect(result.status).toBe("STILL_CONTESTABLE");
    expect(result.heroId).toBe(5);
    expect(result.opponentBaselineValue).toBe(80);
    expect(result.afterOurActionValue).toBeNull(); // absent from the ranking is still reported informationally...
    expect(result.displacedResponse).toBeNull(); // ...but never treated as a materialized steal
  });

  test("AP SEALED FALSE STEAL -- nuestro héroe queda SELLADO (nunca confirmado/revelado) -> el rival podría seguir eligiéndolo -> STEAL != MATERIALIZED", () => {
    const state = apStateWithBans("steal-ap-sealed", []);
    // Our own hypothetical action: seal hero 1 in OUR slot. The round has 4 total slots; 3 remain
    // open, so this never closes the round -- hero 1 is never CONFIRMED.
    const afterOurSeal = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 1 }).state;
    expect(afterOurSeal.rankedAp!.round!.openSlots.length).toBeGreaterThan(0);
    const baseline = baselineModel([{ hero: 1, score: 90 }]);
    const after = afterModel([{ hero: 1, score: 90 }], DIRE_SLOT_0);
    const result = evaluateSteal(state, baseline, after, afterOurSeal, [1]);
    expect(result.status).toBe("STILL_CONTESTABLE");
    expect(result.displacedResponse).toBeNull();
  });

  test("ALREADY UNAVAILABLE -- el héroe ya estaba baneado ANTES de nuestra acción -> nunca se reclama como robado por nosotros", () => {
    const state = apStateWithBans("steal-already-unavailable", [9]);
    // Defense-in-depth: aunque la fixture del baseline (incorrectamente) reporte un valor para el
    // héroe 9, evaluateSteal debe re-chequear disponibilidad real de forma independiente (mismo
    // principio que postValidateAction/legality.ts) y descartarlo igual.
    const baseline = baselineModel([{ hero: 9, score: 50 }]);
    const after = afterModel([], DIRE_SLOT_0);
    const result = evaluateSteal(state, baseline, after, state, [9]);
    expect(result.status).toBe("NOT_APPLICABLE");
    expect(result.heroId).toBeNull();
  });

  test("CM ELIGIBILITY -- un héroe fuera del snapshot certificado nunca entra al universo del baseline, incluso si una fixture (incorrectamente) le asigna valor", () => {
    const ready = cmReadyState("steal-cm-eligibility", [1, 2, 3]); // hero 99 is NOT in the certified snapshot
    const baseline = baselineModel([{ hero: 99, score: 80 }]);
    const after = afterModel([], { side: "dire", slotIndex: 3 });
    const result = evaluateSteal(ready, baseline, after, ready, [99]);
    expect(result.status).toBe("NOT_APPLICABLE");
    expect(result.heroId).toBeNull();
  });

  test("ninguno de nuestros héroes candidatos aparecía en el ranking del rival -> NOT_APPLICABLE, nunca un umbral inventado", () => {
    const state = apStateWithBans("steal-not-applicable", []);
    const baseline = baselineModel([{ hero: 9, score: 50 }]);
    const after = afterModel([{ hero: 9, score: 50 }], DIRE_SLOT_0);
    const result = evaluateSteal(state, baseline, after, state, [1, 2]);
    expect(result.status).toBe("NOT_APPLICABLE");
    expect(result.heroId).toBeNull();
    expect(result.opponentBaselineValue).toBeNull();
    expect(result.afterOurActionValue).toBeNull();
  });

  test("baseline o after fallidos -> SIMULATION_UNAVAILABLE, nunca lanza ni inventa valores", () => {
    const state = apStateWithBans("steal-unavailable", []);
    const okBaseline = baselineModel([{ hero: 1, score: 90 }]);
    const okAfter = afterModel([{ hero: 1, score: 90 }], DIRE_SLOT_0);
    expect(evaluateSteal(state, FAILED_BASELINE, okAfter, state, [1]).status).toBe("SIMULATION_UNAVAILABLE");
    expect(evaluateSteal(state, okBaseline, FAILED_AFTER, state, [1]).status).toBe("SIMULATION_UNAVAILABLE");
  });

  test("compound -- de dos héroes candidatos, se reporta el de mayor valor base para el rival, y una acción real que sólo retira ESE lo materializa", () => {
    const before = apStateWithBans("steal-compound-before", []);
    const afterState = apStateWithBans("steal-compound-after", [2]); // only hero 2 (the stronger baseline candidate) is genuinely gone
    const baseline = baselineModel([{ hero: 2, score: 95 }, { hero: 1, score: 60 }]);
    const after = afterModel([{ hero: 1, score: 60 }], DIRE_SLOT_0);
    const result = evaluateSteal(before, baseline, after, afterState, [1, 2]);
    expect(result.heroId).toBe(2);
    expect(result.status).toBe("MATERIALIZED");
  });

  test("desempate determinista: valores base iguales -> gana el heroId más bajo", () => {
    const state = apStateWithBans("steal-tiebreak", []);
    const baseline = baselineModel([{ hero: 5, score: 80 }, { hero: 3, score: 80 }]);
    const after = afterModel([{ hero: 5, score: 80 }, { hero: 3, score: 80 }], DIRE_SLOT_0);
    const result = evaluateSteal(state, baseline, after, state, [5, 3]);
    expect(result.heroId).toBe(3);
    expect(result.status).toBe("STILL_CONTESTABLE");
  });
});
