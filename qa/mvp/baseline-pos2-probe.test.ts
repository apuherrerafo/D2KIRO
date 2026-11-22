import { expect, test } from "bun:test";
import { createProtocolSessionRoutes } from "../../apps/engine/src/server/routes/protocol-sessions";
import { ProtocolSessionStore } from "../../apps/engine/src/server/protocol-session";
import { loadHeroPositions } from "../../apps/engine/src/signals/hero-positions";
import type { SuggestionSet } from "../../apps/engine/src/signals/mix";
import { independentlyCredibleForPosition, loadQaPositionEvidence } from "./position-oracle";

const CARRY_IDS = [1, 8, 12] as const; // Anti-Mage, Juggernaut, Phantom Lancer.
const MID_ID = 25; // Lina; substantial Pos2 evidence in the shipped artifact.

function request(body: unknown): Request {
  return new Request("http://qa.local", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

const BANNED_THREAT = 2; // Axe: amenaza curada de Lina en la variante con fundamento.

async function probe(grounded: boolean): Promise<{ serialized: number[]; coach: number[]; evidence: ReturnType<typeof loadQaPositionEvidence> }> {
  const positions = loadHeroPositions();
  const evidence = loadQaPositionEvidence();
  const store = new ProtocolSessionStore();
  const routes = createProtocolSessionRoutes({
    store,
    heroPositions: positions,
    // Variante con fundamento: Lina tiene un counter curado contra una amenaza que se banea -> BAN_OPENS (fundamento real).
    ...(grounded ? { heroCounters: new Map([[MID_ID, [{ vs: BANNED_THREAT, level: "hard" as const, why: "QA fixture" }]]]) } : {}),
    computeSuggestions: async (state): Promise<SuggestionSet> => ({
      schema: "suggestions/v1",
      sessionId: state.sessionId,
      basedOnSeq: state.lastSeq,
      decisionContext: "team_opening",
      suggestions: [...CARRY_IDS, MID_ID].map((hero, index) => ({ hero, rank: (index + 1) as 1 | 2 | 3 | 4, score: 100 - index, signals: [], reason: "QA probe", confidence: "alta", evidenceCoverage: 1, guessingIndex: 0 })),
      comparison: null,
      degraded: [],
      computedInMs: 0,
      functionalEvidence: { metaIsStale: false, signalEvidence: [], heroPositions: [], teamOpening: null, partyPreferredPositions: [] },
    }),
  });
  const created = await routes.post(request({
    rulesetId: "dota2/ranked-all-pick", patch: "7.41e", localSide: "radiant", adapterKind: "simulator",
    partyContext: { partySize: 1, side: "radiant", controlledSlots: [] }, controlledPositions: [2], humanPosition: 2, simulatorSeed: "QAP00001",
  }));
  expect(created.status).toBe(201);
  const { sessionId } = await created.json() as { sessionId: string };
  store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: grounded ? [BANNED_THREAT] : [] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
  const response = await routes.getRecommendations(sessionId, new URL(`http://qa.local/${sessionId}/recommendations?format=v3`));
  expect(response.status).toBe(200);
  const body = await response.json() as { recommendationSet: { decision: { controlledSlots: { position?: number }[]; humanActionability?: { eligiblePositions: number[]; roundCapacity: number } }; recommendations: { actions: { hero: number }[] }[] }; output: { shortlist: { heroId: number }[] } | null };
  expect(store.metadata(sessionId)?.controlledPositions).toEqual([2]);
  expect(store.humanOpenPositions(sessionId)).toEqual([2]);
  // PD-001: eligibility lives on humanActionability; the generic round slot carries NO position.
  expect(body.recommendationSet.decision.humanActionability).toMatchObject({ eligiblePositions: [2], roundCapacity: 1 });
  expect(body.recommendationSet.decision.controlledSlots.map((slot) => slot.position)).toEqual([undefined]);
  const serialized = body.recommendationSet.recommendations.flatMap((entry) => entry.actions.map((action) => action.hero));
  const coach = body.output?.shortlist.map((card) => card.heroId) ?? [];
  return { serialized, coach, evidence };
}

// Contrato de elegibilidad (dueño, 2026-11-03/04; P0-04, 2026-11-08): el Coach sólo muestra héroes con al menos un fundamento
// verificable. La posición NO es fundamento. Sin fundamento no hay tarjeta (output null), ni relleno ni mensaje.
// Este probe es anterior (2026-09-27) a ese contrato; sigue guardando lo suyo: los carries nunca salen como opción de Pos2.
test("QA-P0-001 baseline probe: Solo Pos2 does not serialize carry-only candidates as Pos2 options (sin fundamento: el Coach no muestra nada)", async () => {
  const { serialized, coach, evidence } = await probe(false);
  expect(serialized).toEqual([MID_ID]);
  expect(coach).toEqual([]); // Lina sin fundamento -> sin tarjeta; antes se esperaba [MID_ID] (oráculo previo al contrato).
  for (const carry of CARRY_IDS) {
    expect(independentlyCredibleForPosition(evidence, carry, 2).credible).toBe(false);
    expect(serialized).not.toContain(carry);
    expect(coach).not.toContain(carry);
  }
});

test("QA-P0-001 baseline probe: con un fundamento real (ban que abre a Lina) el Coach muestra a Lina y a ningún carry", async () => {
  const { serialized, coach, evidence } = await probe(true);
  expect(serialized).toEqual([MID_ID]);
  expect(coach).toEqual([MID_ID]);
  for (const carry of CARRY_IDS) {
    expect(independentlyCredibleForPosition(evidence, carry, 2).credible).toBe(false);
    expect(serialized).not.toContain(carry);
    expect(coach).not.toContain(carry);
  }
});
