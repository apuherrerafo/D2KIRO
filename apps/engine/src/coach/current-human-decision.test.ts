import { describe, expect, test } from "bun:test";
import type { TeamSide } from "../draft-protocol/types";
import type { FunctionalRecommendationEvidence } from "../recommendation/evidence";
import type { DegradationFlag, Suggestion, SuggestionSet } from "../signals/mix";
import type { HeroPositions } from "../signals/hero-positions";
import type { CuratedCounter } from "../signals/hero-counters";
import type { SignalContribution } from "../signals/types";
import { heroPoolFitScorer } from "../signals/hero-pool-fit";
import { ProtocolSessionStore } from "../server/protocol-session";
import { createProtocolSessionRoutes, type ComputeSuggestionsForDraftState } from "../server/routes/protocol-sessions";
import { RANKING_INVALIDATING_REASONS, deriveCandidateResult } from "./current-human-decision";
import type { CurrentHumanDecision, RecommendationOutputV4 } from "./recommendation-output-v4";

// Product Semantics Recovery WP2 -- CurrentHumanDecision over the REAL store + REAL routes + REAL
// perspective-safe builders. Only V6 is a deterministic fixture; hero positions are an inline fixture
// (S10: never the curated file). Heroes are `position * 100 + k`, credible at exactly one position.

type Position = 1 | 2 | 3 | 4 | 5;
const POSITIONS: readonly Position[] = [1, 2, 3, 4, 5];
const HERO_POSITIONS: HeroPositions = {};
for (const position of POSITIONS) for (let k = 0; k < 8; k += 1) HERO_POSITIONS[position * 100 + k] = [{ position, matches: 1000 }];
const ALL_HEROES = Object.keys(HERO_POSITIONS).map(Number);
const heroPosition = (hero: number): Position => Math.floor(hero / 100) as Position;

interface FixtureOptions {
  /** Team-level V6 order: heroes of these positions lead, in this order. */
  leadOrder?: readonly Position[];
  degraded?: DegradationFlag[];
  throws?: boolean;
  /** Heroes the account's pool overlay marks "En tu pool" (only when an accountId reaches V6). */
  pool?: readonly number[];
  /**
   * Per-account configured Hero Pool, scored by the REAL `heroPoolFitScorer` (absent/empty pool ->
   * `applicable: false`, exactly like an account overlay without pool rows). No accountId -> no pool.
   */
  accountPools?: ReadonlyMap<number, readonly number[]>;
  calls?: { accountId: number | null; targetPosition?: Position }[];
}

function fixtureCompute(options: FixtureOptions = {}): ComputeSuggestionsForDraftState {
  return async (state, accountId, computeOptions) => {
    options.calls?.push({ accountId, targetPosition: computeOptions?.targetPosition });
    if (options.throws) throw new Error("V6 down");
    const taken = new Set([...state.banned, ...state.picks.radiant, ...state.picks.dire]);
    const lead = options.leadOrder ?? POSITIONS;
    const universe = (computeOptions?.candidateHeroIds ?? ALL_HEROES).filter((hero) => !taken.has(hero));
    const ordered = [...universe].sort((a, b) => lead.indexOf(heroPosition(a)) - lead.indexOf(heroPosition(b)) || a - b);
    const suggestions: Suggestion[] = ordered.slice(0, 12).map((hero, index) => {
      const signals: SignalContribution[] = [
        { signal: "position_fit", raw: 0.6, normalized: 60, evidenceConfidence: 1, weighted: 100 - index, explanation: `posición de ${hero}`, sampleSize: 100 },
      ];
      if (accountId !== null && options.pool?.includes(hero)) {
        signals.push({ signal: "hero_pool_fit", raw: 1, normalized: 100, evidenceConfidence: 1, weighted: 1, explanation: "En tu pool de héroes", sampleSize: 1, applicable: true });
      }
      if (options.accountPools) {
        const heroPool = (accountId === null ? [] : options.accountPools.get(accountId) ?? [])
          .map((poolHero) => ({ hero: poolHero, source: "manual" as const, personalWinrate: null, personalGames: 0, updatedAt: "2026-09-30" }));
        signals.push(heroPoolFitScorer.score(state, hero, { heroes: {}, matchups: {}, heroPool }));
      }
      return { hero, rank: Math.min(index + 1, 6) as Suggestion["rank"], score: 100 - index, signals, reason: "fixture", confidence: "alta" as const, evidenceCoverage: 1, guessingIndex: 0 };
    });
    const functionalEvidence: FunctionalRecommendationEvidence = { metaIsStale: false, signalEvidence: suggestions.map((s) => ({ hero: s.hero, signals: [] })), heroPositions: [], teamOpening: null, partyPreferredPositions: [] };
    const set: SuggestionSet = { schema: "suggestions/v1", sessionId: state.sessionId, basedOnSeq: state.lastSeq, decisionContext: "team_opening", suggestions, comparison: null, degraded: options.degraded ?? [], computedInMs: 0, functionalEvidence };
    return set;
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

async function session(controlledPositions: Position[], options: FixtureOptions & { side?: TeamSide; humanPosition?: Position; heroPositions?: HeroPositions; bans?: number[]; heroCounters?: ReadonlyMap<number, readonly CuratedCounter[]> } = {}) {
  const side = options.side ?? "radiant";
  const store = new ProtocolSessionStore();
  const routes = createProtocolSessionRoutes({ store, computeSuggestions: fixtureCompute(options), heroPositions: options.heroPositions ?? HERO_POSITIONS, ...(options.heroCounters ? { heroCounters: options.heroCounters } : {}) });
  const created = await routes.post(jsonRequest({
    rulesetId: "dota2/ranked-all-pick",
    patch: "7.41e",
    localSide: side,
    adapterKind: "simulator",
    humanPosition: options.humanPosition ?? controlledPositions[0],
    simulatorSeed: "WP2-SEED",
    partyContext: { partySize: controlledPositions.length, side, controlledSlots: [] },
    controlledPositions,
  }));
  if (created.status !== 201) throw new Error(`create failed ${created.status}`);
  const { sessionId } = (await created.json()) as { sessionId: string };
  if (!store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: options.bans ?? [] }, { type: "BAN_RESOLUTION_COMPLETE" }])?.ok) throw new Error("bans");
  const enemy: TeamSide = side === "radiant" ? "dire" : "radiant";
  return { store, routes, sessionId, side, enemy };
}

type Session = Awaited<ReturnType<typeof session>>;

async function v4(s: Session, accountId: number | null = null): Promise<RecommendationOutputV4> {
  const response = await s.routes.getRecommendations(s.sessionId, new URL("http://127.0.0.1/x?format=v4"), accountId);
  expect(response.status).toBe(200);
  return ((await response.json()) as { output: RecommendationOutputV4 }).output;
}

function actionable(output: RecommendationOutputV4): Extract<CurrentHumanDecision, { kind: "ACTIONABLE" }> {
  if (output.decision.kind !== "ACTIONABLE") throw new Error(`expected ACTIONABLE, got ${output.decision.kind}`);
  return output.decision;
}

function visibleHeroes(decision: Extract<CurrentHumanDecision, { kind: "ACTIONABLE" }>): number[] {
  if (decision.candidates.state === "RANKED") return decision.candidates.cards.map((card) => card.heroId);
  if (decision.candidates.state === "UNRANKED_POSITIONAL") return decision.candidates.alternatives.map((alternative) => alternative.heroId);
  return [];
}

describe("WP2 -- Solo Pos1..Pos5", () => {
  for (const position of POSITIONS) {
    test(`Solo Pos${position}: una posición accionable, capacidad 1, objetivo Pos${position} (default, no estratégico), cartas creíbles para Pos${position}`, async () => {
      const s = await session([position]);
      const decision = actionable(await v4(s));
      expect(decision.actionablePositions).toEqual([position]);
      expect(decision.roundCapacity).toBe(1);
      expect(decision.targetPosition).toBe(position);
      expect(decision.targetBasis).toBe("DETERMINISTIC_DEFAULT");
      expect(decision.candidates.state).toBe("RANKED");
      expect(visibleHeroes(decision).length).toBeGreaterThan(0);
      expect(visibleHeroes(decision).every((hero) => heroPosition(hero) === position)).toBe(true);
    });
  }
});

describe("WP2 -- Party2 / Party3", () => {
  test("Party2 no contigua Pos2 + Pos5: ambas accionables, capacidad 2, UN objetivo (default, no estratégico) con cartas de ese objetivo", async () => {
    const s = await session([2, 5], { leadOrder: [5, 2, 1, 3, 4] });
    const decision = actionable(await v4(s));
    expect(decision.actionablePositions).toEqual([2, 5]);
    expect(decision.roundCapacity).toBe(2);
    // PSR-001: the top hero resolves to Pos5, but a hero rank is not a priority between positions.
    expect(decision.targetBasis).toBe("DETERMINISTIC_DEFAULT");
    expect(decision.targetPosition).toBe(2); // the Player's own position (humanPosition = 2)
    expect(decision.viewedPosition).toBe(2);
    expect(visibleHeroes(decision).every((hero) => heroPosition(hero) === 2)).toBe(true);
  });

  test("PSR-001: el héroe líder pertenece a Pos1 o a Pos4 -> la base del objetivo es la MISMA (DETERMINISTIC_DEFAULT) y el objetivo no sigue al ranking", async () => {
    const leaderIsPos1 = await session([1, 2, 3, 4, 5], { humanPosition: 2, leadOrder: [1, 2, 3, 4, 5] });
    const leaderIsPos4 = await session([1, 2, 3, 4, 5], { humanPosition: 2, leadOrder: [4, 1, 2, 3, 5] });
    const a = actionable(await v4(leaderIsPos1));
    const b = actionable(await v4(leaderIsPos4));
    expect(a.targetBasis).toBe("DETERMINISTIC_DEFAULT");
    expect(b.targetBasis).toBe("DETERMINISTIC_DEFAULT");
    expect(a.targetPosition).toBe(2);
    expect(b.targetPosition).toBe(2);
    expect(a.targetRationale).toBe(b.targetRationale);
  });

  test("Party2 permutación de cronología: misma propiedad (Pos2 sellada en slot 0 vs slot 1) -> misma decisión", async () => {
    const a = await session([2, 5], { leadOrder: [5, 2, 1, 3, 4] });
    const b = await session([2, 5], { leadOrder: [5, 2, 1, 3, 4] });
    const pick = (s: Session, slotIndex: number) => s.routes.postCommand(jsonRequest({ command: { type: "SUBMIT_SEALED_SELECTION", side: s.side, slotIndex, heroId: 200 }, assignedPosition: 2 }), s.sessionId);
    expect((await pick(a, 0)).status).toBe(202);
    expect((await pick(b, 1)).status).toBe(202);
    const decisionA = actionable(await v4(a));
    const decisionB = actionable(await v4(b));
    expect({ ...decisionA }).toEqual({ ...decisionB });
    expect(decisionA.actionablePositions).toEqual([5]);
  });

  test("Party3 Pos1 + Pos3 + Pos5: tres accionables, capacidad 2, un solo objetivo", async () => {
    const s = await session([1, 3, 5], { leadOrder: [3, 1, 5, 2, 4] });
    const decision = actionable(await v4(s));
    expect(decision.actionablePositions).toEqual([1, 3, 5]);
    expect(decision.roundCapacity).toBe(2);
    expect(decision.targetPosition).toBe(1); // humanPosition = controlledPositions[0]; the Pos3-leading ranking does not move it
    expect(decision.targetBasis).toBe("DETERMINISTIC_DEFAULT");
  });
});

describe("WP2 -- Party5", () => {
  test("Ronda 1: 5 accionables, capacidad 2, UN objetivo, candidatos sólo de ese objetivo", async () => {
    const s = await session([1, 2, 3, 4, 5], { leadOrder: [3, 1, 2, 4, 5] });
    expect(s.store.allyBotPositions(s.sessionId)).toEqual([]);
    const decision = actionable(await v4(s));
    expect(decision.actionablePositions).toEqual([1, 2, 3, 4, 5]);
    expect(decision.roundCapacity).toBe(2);
    expect(decision.targetPosition).toBe(1); // default = the Player's own position; the Pos3-leading V6 order is not a priority
    expect(decision.targetBasis).toBe("DETERMINISTIC_DEFAULT");
    expect(decision.targetRationale).toContain("No hay una prioridad estratégica clara");
    expect(decision.viewedPosition).toBe(1);
    expect(visibleHeroes(decision).every((hero) => heroPosition(hero) === 1)).toBe(true);
  });

  test("primer pick manual NO es Pos1 (Pos3): binding correcto y el objetivo se recalcula entre las cuatro restantes", async () => {
    const s = await session([1, 2, 3, 4, 5], { leadOrder: [3, 1, 2, 4, 5] });
    const viewingPos3 = await s.routes.getRecommendations(s.sessionId, new URL("http://127.0.0.1/x?format=v4&target=3"));
    const before = actionable(((await viewingPos3.json()) as { output: RecommendationOutputV4 }).output);
    expect(visibleHeroes(before).every((hero) => heroPosition(hero) === 3)).toBe(true);
    const response = await s.routes.postCommand(jsonRequest({ command: { type: "SUBMIT_SEALED_SELECTION", side: s.side, slotIndex: 0, heroId: 300 }, assignedPosition: 3 }), s.sessionId);
    expect(response.status).toBe(202);
    expect(s.store.ownAssignedPositions(s.sessionId)).toEqual([{ round: 1, slotIndex: 0, assignedPosition: 3 }]);
    const after = await v4(s);
    const decision = actionable(after);
    expect(decision.actionablePositions).toEqual([1, 2, 4, 5]);
    expect(decision.roundCapacity).toBe(1);
    expect(decision.targetPosition).not.toBe(3);
    expect(decision.targetPosition).toBe(1); // recomputed default among the remaining four (the Player's own Pos1)
    expect(visibleHeroes(decision)).not.toContain(300);
    // OLD: "no card of the previous decision survives" -- obsolete: the default target (Pos1) legitimately
    // stays the same, so its cards may repeat. NEW: nothing of the SEALED position (Pos3) survives.
    expect(visibleHeroes(decision).some((hero) => heroPosition(hero) === 3)).toBe(false);
    expect(after.meta.revision).toBeGreaterThan(0);
  });

  test("sin evidencia de prioridad (ranking degradado): DETERMINISTIC_DEFAULT, nunca presentado como estratégico", async () => {
    const s = await session([1, 2, 3, 4, 5], { humanPosition: 4, degraded: ["no_signal_available"] });
    const decision = actionable(await v4(s));
    expect(decision.targetBasis).toBe("DETERMINISTIC_DEFAULT");
    expect(decision.targetPosition).toBe(4); // the Player's own position is the stable initial view
    expect(decision.targetRationale).toContain("Vista inicial sugerida");
  });
});

describe("WP2 -- estado de candidatos explícito", () => {
  test("RANKED: rank/score/confidence presentes, sin degradación que invalide el ranking", async () => {
    const decision = actionable(await v4(await session([2])));
    expect(decision.candidates.state).toBe("RANKED");
    if (decision.candidates.state !== "RANKED") return;
    expect(decision.candidates.cards.map((card) => card.rank)).toEqual(decision.candidates.cards.map((_, index) => index + 1));
    expect(decision.candidates.degradations.some((d) => RANKING_INVALIDATING_REASONS.has(d.reason))).toBe(false);
  });

  test("UNRANKED_POSITIONAL: V6 caído -> alternativas legales de la posición, SIN rank/score/confidence en el wire", async () => {
    const s = await session([2], { throws: true });
    const response = await s.routes.getRecommendations(s.sessionId, new URL("http://127.0.0.1/x?format=v4"));
    const raw = await response.text();
    const decision = actionable((JSON.parse(raw) as { output: RecommendationOutputV4 }).output);
    expect(decision.candidates.state).toBe("UNRANKED_POSITIONAL");
    if (decision.candidates.state !== "UNRANKED_POSITIONAL") return;
    expect(decision.candidates.alternatives.length).toBeGreaterThan(0);
    expect(decision.candidates.alternatives.every((alternative) => heroPosition(alternative.heroId) === 2 && alternative.position === 2)).toBe(true);
    for (const alternative of decision.candidates.alternatives) {
      expect(Object.keys(alternative).sort()).toEqual(["heroId", "position"]);
    }
    expect(raw).not.toContain('"rank"');
    expect(raw).not.toContain('"confidence"');
  });

  test("NEGATIVO: 'ranking no disponible' + cartas rankeadas es irrepresentable -- no_signal_available nunca produce RANKED", async () => {
    const decision = actionable(await v4(await session([2], { degraded: ["no_signal_available"] })));
    expect(decision.candidates.state).not.toBe("RANKED");
    expect(decision.candidates.degradations.some((d) => d.reason === "no_signal_available")).toBe(true);
  });

  test("UNAVAILABLE: ningún héroe creíble y legal para el objetivo", async () => {
    const noPos2: HeroPositions = Object.fromEntries(Object.entries(HERO_POSITIONS).filter(([hero]) => heroPosition(Number(hero)) !== 2));
    const decision = actionable(await v4(await session([2], { heroPositions: noPos2 })));
    expect(decision.candidates.state).toBe("UNAVAILABLE");
    expect(decision.targetPosition).toBe(2);
  });
});

describe("WP2 -- sin acción humana", () => {
  test("YIELD: NO_HUMAN_ACTION con razón YIELDED, sin objetivo ni candidatos", async () => {
    const s = await session([2, 5]);
    expect((await s.routes.postYield(s.sessionId)).status).toBe(200);
    const output = await v4(s);
    expect(output.decision).toEqual({ kind: "NO_HUMAN_ACTION", actionablePositions: [], roundCapacity: 0, reason: "YIELDED" });
  });

  test("COMPLETE: NO_HUMAN_ACTION con razón DRAFT_COMPLETE", async () => {
    const s = await session([1, 2, 3, 4, 5]);
    // Party5: every own pick goes through the human path (no Ally Bot); rounds hold 2/2/1 own slots.
    const order: Position[] = [4, 1, 5, 2, 3];
    const roundSlots = [[0, 1], [0, 1], [0]];
    let own = 0;
    for (const slots of roundSlots) {
      for (const slotIndex of slots) {
        const position = order[own]!;
        const response = await s.routes.postCommand(jsonRequest({ command: { type: "SUBMIT_SEALED_SELECTION", side: s.side, slotIndex, heroId: position * 100 + 7 }, assignedPosition: position }), s.sessionId);
        expect(response.status).toBe(202);
        own += 1;
      }
      for (const slotIndex of slots) {
        const result = s.store.apply(s.sessionId, { type: "SUBMIT_SEALED_SELECTION", side: s.enemy, slotIndex, heroId: 900 + own * 2 + slotIndex });
        if (!result || result.rejected) throw new Error(`enemy ${result?.rejected}`);
      }
    }
    expect(s.store.get(s.sessionId)?.status).toBe("COMPLETE");
    expect((await v4(s)).decision).toEqual({ kind: "NO_HUMAN_ACTION", actionablePositions: [], roundCapacity: 0, reason: "DRAFT_COMPLETE" });
  });
});

describe("WP2 -- Personal Hero Pool sólo para la posición personal", () => {
  test("objetivo == posición personal: el pool entra al ranking (accountId llega a V6) y se marca", async () => {
    const calls: FixtureOptions["calls"] = [];
    const s = await session([2], { humanPosition: 2, pool: [200], calls });
    const decision = actionable(await v4(s, 4242));
    expect(decision.personalPoolApplied).toBe(true);
    expect(calls.filter((call) => call.accountId !== null).every((call) => call.targetPosition === 2)).toBe(true);
    if (decision.candidates.state !== "RANKED") throw new Error("ranked expected");
    expect(decision.candidates.cards.find((card) => card.heroId === 200)?.isFromPool).toBe(true);
  });

  test("posición VISTA != posición personal: el pool NO toca las cartas activas (ninguna llamada con cuenta, ninguna marca); la recomendación sigue en la personal", async () => {
    const calls: FixtureOptions["calls"] = [];
    // Party5, personal Pos2 (the recommended default); the Player views Pos3.
    const s = await session([1, 2, 3, 4, 5], { humanPosition: 2, leadOrder: [3, 1, 2, 4, 5], pool: [300, 200], calls });
    const response = await s.routes.getRecommendations(s.sessionId, new URL("http://127.0.0.1/x?format=v4&target=3"), 4242);
    const decision = actionable(((await response.json()) as { output: RecommendationOutputV4 }).output);
    expect(decision.viewedPosition).toBe(3);
    expect(decision.targetPosition).toBe(2);
    expect(decision.personalPoolApplied).toBe(false);
    expect(calls.every((call) => call.accountId === null)).toBe(true);
    if (decision.candidates.state !== "RANKED") throw new Error("ranked expected");
    expect(decision.candidates.cards.every((card) => card.isFromPool === false)).toBe(true);
  });
});

// Greptile PR #9 (P2) -- personalPoolApplied is provenance: true only when the pool really voted in the
// ranking. Authentication alone is not a pool.
describe("personalPoolApplied refleja si el pool realmente votó, no si hay cuenta", () => {
  const ACCOUNT_WITHOUT_POOL = 7001;
  const ACCOUNT_WITH_POOL = 4242;
  const accountPools = new Map<number, readonly number[]>([[ACCOUNT_WITH_POOL, [201, 300]]]);

  async function decisionFor(accountId: number | null, target: Position | null, calls: NonNullable<FixtureOptions["calls"]>) {
    const s = await session([2, 3], { humanPosition: 2, accountPools, calls });
    const query = target === null ? "format=v4" : `format=v4&target=${target}`;
    const response = await s.routes.getRecommendations(s.sessionId, new URL(`http://127.0.0.1/x?${query}`), accountId);
    expect(response.status).toBe(200);
    return actionable(((await response.json()) as { output: RecommendationOutputV4 }).output);
  }

  test("A: autenticado SIN pool configurado, viendo su posición personal -> false (la cuenta sí llegó a V6)", async () => {
    const calls: NonNullable<FixtureOptions["calls"]> = [];
    const decision = await decisionFor(ACCOUNT_WITHOUT_POOL, null, calls);
    expect(decision.viewedPosition).toBe(2);
    expect(calls.some((call) => call.accountId === ACCOUNT_WITHOUT_POOL)).toBe(true);
    expect(decision.personalPoolApplied).toBe(false);
    if (decision.candidates.state !== "RANKED") throw new Error("ranked expected");
    expect(decision.candidates.cards.every((card) => card.isFromPool === false)).toBe(true);
  });

  test("B: autenticado CON pool, viendo su posición personal -> true y la carta del pool se marca", async () => {
    const decision = await decisionFor(ACCOUNT_WITH_POOL, null, []);
    expect(decision.viewedPosition).toBe(2);
    expect(decision.personalPoolApplied).toBe(true);
    if (decision.candidates.state !== "RANKED") throw new Error("ranked expected");
    expect(decision.candidates.cards.filter((card) => card.isFromPool).map((card) => card.heroId)).toEqual([201]);
  });

  test("C: la misma cuenta con pool, viendo OTRA posición -> false y ninguna marca (aunque el pool tenga héroes de esa posición)", async () => {
    const calls: NonNullable<FixtureOptions["calls"]> = [];
    const decision = await decisionFor(ACCOUNT_WITH_POOL, 3, calls);
    expect(decision.viewedPosition).toBe(3);
    expect(decision.personalPoolApplied).toBe(false);
    expect(calls.every((call) => call.accountId === null)).toBe(true);
    if (decision.candidates.state !== "RANKED") throw new Error("ranked expected");
    expect(decision.candidates.cards.every((card) => card.isFromPool === false)).toBe(true);
  });

  test("D: anónimo -> false", async () => {
    const decision = await decisionFor(null, null, []);
    expect(decision.personalPoolApplied).toBe(false);
  });
});

describe("WP2 -- el contrato V3 no cambia", () => {
  test("?format=v3 sigue devolviendo recommendation-output/v3", async () => {
    const s = await session([1, 2, 3, 4, 5]);
    const body = (await (await s.routes.getRecommendations(s.sessionId, new URL("http://127.0.0.1/x?format=v3"))).json()) as { output: { schema: string } };
    expect(body.output.schema).toBe("recommendation-output/v3");
  });

  test("V4 sólo existe para sesiones con HumanActionability (Manual -> 422, nunca inventado)", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: fixtureCompute(), heroPositions: HERO_POSITIONS });
    const created = await routes.post(jsonRequest({ rulesetId: "dota2/ranked-all-pick", patch: "7.41e", localSide: "radiant", adapterKind: "manual", partyContext: { partySize: 5, side: "radiant", controlledSlots: [] }, controlledPositions: [1, 2, 3, 4, 5] }));
    const { sessionId } = (await created.json()) as { sessionId: string };
    store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: [] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
    const response = await routes.getRecommendations(sessionId, new URL("http://127.0.0.1/x?format=v4"));
    expect(response.status).toBe(422);
  });
});

describe("WP3 soporte -- navegación del selector (target=P)", () => {
  async function v4With(s: Session, query: string) {
    return s.routes.getRecommendations(s.sessionId, new URL(`http://127.0.0.1/x?format=v4${query}`));
  }

  async function decisionWith(s: Session, query: string) {
    return actionable(((await (await v4With(s, query)).json()) as { output: RecommendationOutputV4 }).output);
  }

  test("PSR-002: Coach recomienda Pos1; el usuario mira Pos3 y luego Pos5 -> la recomendación NO se mueve, las cartas siguen a la vista, sin cartas viejas", async () => {
    const s = await session([1, 2, 3, 4, 5], { humanPosition: 1, leadOrder: [3, 1, 2, 4, 5] });
    const base = await decisionWith(s, "");
    expect(base.targetPosition).toBe(1);
    expect(base.viewedPosition).toBe(1);

    const viewPos3 = await decisionWith(s, "&target=3");
    expect(viewPos3.targetPosition).toBe(1);
    expect(viewPos3.targetBasis).toBe(base.targetBasis);
    expect(viewPos3.targetRationale).toBe(base.targetRationale);
    expect(viewPos3.viewedPosition).toBe(3);
    expect(viewPos3.candidates.targetPosition).toBe(3);
    expect(viewPos3.actionablePositions).toEqual(base.actionablePositions);
    expect(visibleHeroes(viewPos3).every((hero) => heroPosition(hero) === 3)).toBe(true);

    const viewPos5 = await decisionWith(s, "&target=5");
    expect(viewPos5.targetPosition).toBe(1);
    expect(viewPos5.viewedPosition).toBe(5);
    expect(visibleHeroes(viewPos5).every((hero) => heroPosition(hero) === 5)).toBe(true);
    expect(visibleHeroes(viewPos5).some((hero) => visibleHeroes(viewPos3).includes(hero))).toBe(false); // no stale Pos3 card
  });

  test("PSR-002: navegar no muta la sesión (sin cambios de propiedad, misma cronología de estado)", async () => {
    const s = await session([1, 2, 3, 4, 5], { humanPosition: 1 });
    const before = JSON.stringify({ own: s.store.ownAssignedPositions(s.sessionId), open: s.store.humanOpenPositions(s.sessionId), status: s.store.get(s.sessionId)?.status });
    for (const position of POSITIONS) await decisionWith(s, `&target=${position}`);
    const after = JSON.stringify({ own: s.store.ownAssignedPositions(s.sessionId), open: s.store.humanOpenPositions(s.sessionId), status: s.store.get(s.sessionId)?.status });
    expect(after).toBe(before);
  });

  test("PSR-002: pedir la misma posición recomendada no cambia nada", async () => {
    const s = await session([1, 2, 3, 4, 5], { humanPosition: 1, leadOrder: [3, 1, 2, 4, 5] });
    const decision = await decisionWith(s, "&target=1");
    expect(decision.targetPosition).toBe(1);
    expect(decision.viewedPosition).toBe(1);
  });

  test("tras un pick real la recomendación se recalcula desde el estado nuevo aunque el usuario estuviera mirando otra posición", async () => {
    const s = await session([1, 2, 3, 4, 5], { humanPosition: 1, leadOrder: [3, 1, 2, 4, 5] });
    await s.routes.postCommand(jsonRequest({ command: { type: "SUBMIT_SEALED_SELECTION", side: s.side, slotIndex: 0, heroId: 100 }, assignedPosition: 1 }), s.sessionId);
    const decision = await decisionWith(s, "&target=3");
    expect(decision.actionablePositions).not.toContain(1);
    expect(decision.targetPosition).not.toBe(1); // the sealed position is never recommended again
    expect(decision.targetPosition).toBe(2); // lowest remaining eligible: personal Pos1 is gone
    expect(decision.viewedPosition).toBe(3);
  });

  test("una posición ya sellada nunca se vuelve objetivo ni vista; un target inválido es 400", async () => {
    const s = await session([1, 2, 3, 4, 5], { leadOrder: [3, 1, 2, 4, 5] });
    await s.routes.postCommand(jsonRequest({ command: { type: "SUBMIT_SEALED_SELECTION", side: s.side, slotIndex: 0, heroId: 200 }, assignedPosition: 2 }), s.sessionId);
    const decision = await decisionWith(s, "&target=2");
    expect(decision.targetPosition).not.toBe(2);
    expect(decision.viewedPosition).not.toBe(2);
    expect(decision.actionablePositions).not.toContain(2);
    for (const bad of ["9", "0", "1.5", "abc", ""]) expect((await v4With(s, `&target=${bad}`)).status).toBe(400);
  });
});

// Greptile PR #9 review #3 (P1): a flex hero credible at the viewed position whose role V6 already RESOLVED to
// another position must not be shown as a ranked card for the viewed one (it would carry LIKELY/CONFIRMED_FORCED
// under the wrong position label).
describe("deriveCandidateResult -- resolved role vs viewed position", () => {
  const FLEX = 900;
  const flexPositions: HeroPositions = { [FLEX]: [{ position: 2, matches: 1000 }, { position: 4, matches: 1000 }] };
  const view = { bannedHeroes: [], ownPicks: [], enemyPicks: [] } as never;

  function ranking(status: "LIKELY" | "CONFIRMED_FORCED" | "UNRESOLVED", resolvedPosition: Position | null) {
    const impact = { status, position: resolvedPosition, marginals: { 1: 0, 2: 0.5, 3: 0, 4: 0.5, 5: 0 }, entropy: 1 };
    const recommendation = {
      actions: [{ hero: FLEX }],
      roleImpact: { [FLEX]: impact },
      signalsByHero: { [FLEX]: [] },
      risks: [],
      confidence: "media",
    };
    return { recommendations: [recommendation], degradations: [] } as never;
  }

  function derive(status: "LIKELY" | "CONFIRMED_FORCED" | "UNRESOLVED", resolvedPosition: Position | null, targetPosition: Position) {
    return deriveCandidateResult({ targetPosition, targetRanking: ranking(status, resolvedPosition), view, heroPositions: flexPositions, personalPoolApplied: false });
  }

  for (const status of ["LIKELY", "CONFIRMED_FORCED"] as const) {
    test(`${status} resuelto a Pos2, objetivo Pos4 -> NO es carta rankeada de Pos4`, () => {
      const result = derive(status, 2, 4);
      expect(result.state).not.toBe("RANKED");
      expect(result.state).toBe("UNRANKED_POSITIONAL");
    });

    test(`${status} resuelto a Pos4, objetivo Pos4 -> sigue elegible`, () => {
      const result = derive(status, 4, 4);
      expect(result.state).toBe("RANKED");
      if (result.state !== "RANKED") return;
      expect(result.cards.map((card) => card.heroId)).toEqual([FLEX]);
      expect(result.cards[0]?.roleStatus).toBe(status);
    });
  }

  test("UNRESOLVED con evidencia curada de Pos4, objetivo Pos4 -> sigue admisible", () => {
    const result = derive("UNRESOLVED", null, 4);
    expect(result.state).toBe("RANKED");
  });
});

// Greptile PR #9 (P1) -- Safe Core survives in the V4 Simulation path as an INFORMATIONAL block. Same rule and
// same subject as V3 (V6's team-level leader), curated + public evidence only, never a target or a view.
describe("Safe Core en V4 -- informativa, nunca dueña de la acción", () => {
  // The V6 team leader is hero 100 (Pos1). Curated: 201 and 202 counter it HARD (inline fixture, never hero-counters.json).
  const curated = (vs: number): CuratedCounter => ({ vs, level: "hard", why: `fixture ${vs}` });
  const COUNTERS = new Map<number, CuratedCounter[]>([[100, [curated(201), curated(202)]]]);
  const teamEvaluations = (calls: NonNullable<FixtureOptions["calls"]>) => calls.filter((call) => call.targetPosition === undefined).length;

  test("A. ventana real: los dos counters duros curados están baneados -> UNA oportunidad informativa del líder de V6", async () => {
    const s = await session([1, 2, 3, 4, 5], { bans: [201, 202], heroCounters: COUNTERS });
    const output = await v4(s);
    expect(output.opportunity).toMatchObject({ subtype: "SAFE_CORE", heroId: 100 });
    expect(output.opportunity?.counterEvidence.sourceType).toBe("CURATED");
    expect(output.opportunity?.counterEvidence.relieved.map((entry) => entry.heroId).sort()).toEqual([201, 202]);
  });

  test("B. el mismo estado sin evidencia que la sostenga (un counter duro sigue disponible) -> sin oportunidad, y sin evaluación de equipo extra", async () => {
    const calls: NonNullable<FixtureOptions["calls"]> = [];
    const s = await session([1, 2, 3, 4, 5], { bans: [201], heroCounters: COUNTERS, calls });
    const output = await v4(s);
    expect(output).not.toHaveProperty("opportunity");
    expect(teamEvaluations(calls)).toBe(0);
    const noBans = await session([1, 2, 3, 4, 5], { heroCounters: COUNTERS, calls });
    expect(await v4(noBans)).not.toHaveProperty("opportunity");
    expect(teamEvaluations(calls)).toBe(0); // nothing to relieve -> the team V6 run is never paid
  });

  test("C. la oportunidad NO mueve objetivo, vista, capacidad ni el orden de candidatos", async () => {
    const withWindow = await v4(await session([1, 2, 3, 4, 5], { bans: [201, 202], heroCounters: COUNTERS }));
    const without = await v4(await session([1, 2, 3, 4, 5], { bans: [201, 202] }));
    expect(withWindow.opportunity).toBeDefined();
    expect(without).not.toHaveProperty("opportunity");
    const a = actionable(withWindow);
    const b = actionable(without);
    expect(a.targetPosition).toBe(b.targetPosition);
    expect(a.targetBasis).toBe(b.targetBasis);
    expect(a.viewedPosition).toBe(b.viewedPosition);
    expect(a.roundCapacity).toBe(b.roundCapacity);
    expect(a.actionablePositions).toEqual(b.actionablePositions);
    expect(visibleHeroes(a)).toEqual(visibleHeroes(b));
    expect(JSON.stringify(a)).not.toContain("SAFE_CORE");
  });

  test("D. sólo evidencia pública: ningún input privado existe en la firma y el resultado no cambia con otra cuenta", async () => {
    const s = await session([1, 2, 3, 4, 5], { bans: [201, 202], heroCounters: COUNTERS });
    const anonymous = (await v4(s)).opportunity;
    const account = (await v4(s, 4242)).opportunity;
    expect(account).toEqual(anonymous);
  });

  test("la oportunidad sólo acompaña a una decisión ACCIONABLE (nunca a NO_HUMAN_ACTION)", async () => {
    const s = await session([2, 5], { bans: [201, 202], heroCounters: COUNTERS });
    expect((await s.routes.postYield(s.sessionId)).status).toBe(200);
    const output = await v4(s);
    expect(output.decision.kind).toBe("NO_HUMAN_ACTION");
    expect(output).not.toHaveProperty("opportunity");
  });
});
