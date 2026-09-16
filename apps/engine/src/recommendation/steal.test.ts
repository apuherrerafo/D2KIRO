import { describe, expect, test } from "bun:test";
import { applyProtocolCommand, createProtocolState } from "../draft-protocol";
import type { DraftProtocolState } from "../draft-protocol/types";
import type { OpponentModelResult } from "./opponent-model";
import { evaluateSteal } from "./steal";

function apRound1State(sessionId: string): DraftProtocolState {
  const created = createProtocolState(sessionId, "dota2/ranked-all-pick");
  if (!created.ok) throw new Error("fixture setup failed");
  return applyProtocolCommand(created.state, { type: "BAN_RESOLUTION_COMPLETE" }).state;
}

function model(heroes: readonly { hero: number; score: number }[]): OpponentModelResult {
  return {
    decision: { actor: "dire", actionKind: "PICK", phase: "PICK_ROUND_1", round: 1, step: null, controlledSlots: [{ side: "dire", slotIndex: 0 }], actionCount: 1 },
    eligibleHeroIds: null,
    suggestionSet: heroes.length === 0
      ? null
      : {
          schema: "suggestions/v1",
          sessionId: "s",
          basedOnSeq: 0,
          decisionContext: "team_opening",
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
        },
    shortlist: heroes.map((h) => ({ hero: h.hero, suggestion: { hero: h.hero, rank: 1, score: h.score, signals: [], reason: "fixture", confidence: "alta", evidenceCoverage: 1, guessingIndex: 0 } })),
    failed: false,
  };
}

const FAILED_MODEL: OpponentModelResult = { decision: { actor: "dire", actionKind: null, phase: null, round: null, step: null, controlledSlots: [], actionCount: 0 }, eligibleHeroIds: null, suggestionSet: null, shortlist: [], failed: true };

describe("evaluateSteal", () => {
  test("Case A -- el héroe sigue disponible para el rival tras nuestra acción -> STILL_CONTESTABLE, nunca 'robado'", () => {
    const state = apRound1State("steal-still-contestable");
    const baseline = model([{ hero: 5, score: 80 }]);
    const after = model([{ hero: 5, score: 80 }]); // untouched, or still sealed-hidden -- same effect
    const result = evaluateSteal(baseline, after, state, [1]); // our own candidate hero is 1, not 5 -- 5 is what dire wanted
    // ourHeroes=[1] but hero 1 never appeared in dire's baseline -> NOT_APPLICABLE for THIS call.
    expect(result.status).toBe("NOT_APPLICABLE");
  });

  test("Case A -- nuestro propio héroe SÍ era codiciado por el rival y sigue disponible tras nuestra acción -> STILL_CONTESTABLE", () => {
    const state = apRound1State("steal-still-contestable-2");
    const baseline = model([{ hero: 1, score: 90 }]);
    const after = model([{ hero: 1, score: 90 }]); // hidden collision: dire can still legally want hero 1
    const result = evaluateSteal(baseline, after, state, [1]);
    expect(result.status).toBe("STILL_CONTESTABLE");
    expect(result.heroId).toBe(1);
    expect(result.opponentBaselineValue).toBe(90);
    expect(result.afterOurActionValue).toBe(90);
    expect(result.displacedResponse).toBeNull();
  });

  test("Case B -- nuestra acción realmente retira un héroe codiciado del universo del rival -> MATERIALIZED", () => {
    const state = apRound1State("steal-materialized");
    const baseline = model([{ hero: 1, score: 90 }, { hero: 2, score: 70 }]);
    const after = model([{ hero: 2, score: 70 }]); // hero 1 genuinely gone now (banned/confirmed+revealed)
    const result = evaluateSteal(baseline, after, state, [1]);
    expect(result.status).toBe("MATERIALIZED");
    expect(result.heroId).toBe(1);
    expect(result.opponentBaselineValue).toBe(90);
    expect(result.afterOurActionValue).toBeNull();
    expect(result.displacedResponse).toEqual({ slot: { side: "dire", slotIndex: 0 }, hero: 2 }); // opponent settles for hero 2
  });

  test("ninguno de nuestros héroes candidatos aparecía en el ranking del rival -> NOT_APPLICABLE, nunca un umbral inventado", () => {
    const state = apRound1State("steal-not-applicable");
    const baseline = model([{ hero: 9, score: 50 }]);
    const after = model([{ hero: 9, score: 50 }]);
    const result = evaluateSteal(baseline, after, state, [1, 2]);
    expect(result.status).toBe("NOT_APPLICABLE");
    expect(result.heroId).toBeNull();
    expect(result.opponentBaselineValue).toBeNull();
    expect(result.afterOurActionValue).toBeNull();
  });

  test("baseline o after fallidos -> SIMULATION_UNAVAILABLE, nunca lanza ni inventa valores", () => {
    const state = apRound1State("steal-unavailable");
    const okModel = model([{ hero: 1, score: 90 }]);
    expect(evaluateSteal(FAILED_MODEL, okModel, state, [1]).status).toBe("SIMULATION_UNAVAILABLE");
    expect(evaluateSteal(okModel, FAILED_MODEL, state, [1]).status).toBe("SIMULATION_UNAVAILABLE");
  });

  test("compound -- de dos héroes candidatos, se reporta el de mayor valor base para el rival", () => {
    const state = apRound1State("steal-compound");
    const baseline = model([{ hero: 2, score: 95 }, { hero: 1, score: 60 }]);
    const after = model([{ hero: 1, score: 60 }]); // hero 2 (the stronger baseline candidate) is gone
    const result = evaluateSteal(baseline, after, state, [1, 2]);
    expect(result.heroId).toBe(2);
    expect(result.status).toBe("MATERIALIZED");
  });

  test("desempate determinista: valores base iguales -> gana el heroId más bajo", () => {
    const state = apRound1State("steal-tiebreak");
    const baseline = model([{ hero: 5, score: 80 }, { hero: 3, score: 80 }]);
    const after = model([{ hero: 5, score: 80 }, { hero: 3, score: 80 }]);
    const result = evaluateSteal(baseline, after, state, [5, 3]);
    expect(result.heroId).toBe(3);
  });
});
