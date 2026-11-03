import { describe, expect, test } from "bun:test";
import type { TeamSide } from "../draft-protocol/types";
import type { FunctionalRecommendationEvidence } from "../recommendation/evidence";
import type { RecommendationSetV2 } from "../recommendation/types";
import type { SuggestionSet } from "../signals/mix";
import { ProtocolSessionStore } from "./protocol-session";
import { createProtocolSessionRoutes } from "./routes/protocol-sessions";

// WP1 -- HumanActionability through the REAL store and the REAL public routes (no mocks of session
// semantics; only V6 is a deterministic fixture). Negative proofs required by the recovery plan.

type Position = 1 | 2 | 3 | 4 | 5;

function jsonRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

async function fakeSuggestions(): Promise<SuggestionSet> {
  const heroes = [101, 102, 103, 104, 105, 106];
  const functionalEvidence: FunctionalRecommendationEvidence = { metaIsStale: false, signalEvidence: heroes.map((hero) => ({ hero, signals: [] })), heroPositions: [], teamOpening: null, partyPreferredPositions: [] };
  return {
    schema: "suggestions/v1",
    sessionId: "fixture",
    basedOnSeq: 0,
    decisionContext: "team_opening",
    suggestions: heroes.map((hero, index) => ({ hero, rank: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6, score: 100 - index, signals: [], reason: "fixture", confidence: "alta" as const, evidenceCoverage: 1, guessingIndex: 0 })),
    comparison: null,
    degraded: [],
    computedInMs: 0,
    functionalEvidence,
  };
}

async function session(controlledPositions: Position[], side: TeamSide = "radiant") {
  const store = new ProtocolSessionStore();
  const routes = createProtocolSessionRoutes({ store, computeSuggestions: fakeSuggestions });
  const created = await routes.post(jsonRequest({
    rulesetId: "dota2/ranked-all-pick",
    patch: "7.41e",
    localSide: side,
    adapterKind: "simulator",
    humanPosition: controlledPositions[0],
    simulatorSeed: "WP1-SEED",
    partyContext: { partySize: controlledPositions.length, side, controlledSlots: [] },
    controlledPositions,
  }));
  if (created.status !== 201) throw new Error(`create failed ${created.status}`);
  const { sessionId } = (await created.json()) as { sessionId: string };
  const bans = store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: [] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
  if (!bans?.ok) throw new Error("bans failed");
  const enemy: TeamSide = side === "radiant" ? "dire" : "radiant";
  return { store, routes, sessionId, side, enemy };
}

type Session = Awaited<ReturnType<typeof session>>;

function humanPick(s: Session, slotIndex: number, heroId: number, position: Position) {
  return s.routes.postCommand(jsonRequest({ command: { type: "SUBMIT_SEALED_SELECTION", side: s.side, slotIndex, heroId }, assignedPosition: position }), s.sessionId);
}

function enemySeal(s: Session, slotIndex: number, heroId: number) {
  const result = s.store.apply(s.sessionId, { type: "SUBMIT_SEALED_SELECTION", side: s.enemy, slotIndex, heroId });
  if (!result || result.rejected) throw new Error(`enemy seal rejected ${result?.rejected}`);
}

async function snapshot(s: Session) {
  return (await s.routes.get(s.sessionId, new URL("http://127.0.0.1/x")).json()) as { humanActionability: unknown; legalActions: unknown[] };
}

describe("WP1 -- Party5 Round 1", () => {
  test("eligiblePositions = [1..5], roundCapacity = 2, allyBotPositions = [] -- NO [1, 2]", async () => {
    const s = await session([1, 2, 3, 4, 5]);
    expect(s.store.humanActionability(s.sessionId)).toEqual({ eligiblePositions: [1, 2, 3, 4, 5], roundCapacity: 2, hasHumanAction: true, noActionReason: null });
    expect(s.store.allyBotPositions(s.sessionId)).toEqual([]);
    expect((await snapshot(s)).humanActionability).toEqual({ eligiblePositions: [1, 2, 3, 4, 5], roundCapacity: 2, hasHumanAction: true, noActionReason: null });
    const v2 = (await (await s.routes.getRecommendations(s.sessionId, new URL("http://127.0.0.1/x"))).json()) as RecommendationSetV2;
    expect(v2.decision.humanActionability?.eligiblePositions).toEqual([1, 2, 3, 4, 5]);
    expect(v2.decision.controlledSlots.length).toBe(2);
    expect(v2.decision.controlledSlots.every((slot) => slot.position === undefined)).toBe(true);
  });

  test("primer pick humano NO es Pos1 (Pos4): binding correcto, quedan las otras cuatro elegibles, capacidad 1", async () => {
    const s = await session([1, 2, 3, 4, 5]);
    const response = await humanPick(s, 0, 404, 4);
    expect(response.status).toBe(202);
    expect(s.store.ownAssignedPositions(s.sessionId)).toEqual([{ round: 1, slotIndex: 0, assignedPosition: 4 }]);
    expect(s.store.humanActionability(s.sessionId)).toEqual({ eligiblePositions: [1, 2, 3, 5], roundCapacity: 1, hasHumanAction: true, noActionReason: null });
  });

  test("Party5 no puede ceder (no hay Ally Bot): yield rechazado, la acción humana sigue intacta", async () => {
    const s = await session([1, 2, 3, 4, 5]);
    const response = await s.routes.postYield(s.sessionId);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe("no_ally_bot_capacity");
    expect(s.store.humanActionability(s.sessionId)?.hasHumanAction).toBe(true);
  });
});

describe("WP1 -- Yield", () => {
  test("tras ceder, NINGUNA selección humana se acepta ni se expone para esa oportunidad", async () => {
    const s = await session([2, 5]);
    expect((await s.routes.postYield(s.sessionId)).status).toBe(200);
    const before = s.store.get(s.sessionId);

    const response = await humanPick(s, 0, 202, 2);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe("round_yielded");
    expect(s.store.get(s.sessionId)).toBe(before); // the kernel was never touched
    expect(s.store.ownAssignedPositions(s.sessionId)).toEqual([]);

    expect(s.store.humanActionability(s.sessionId)).toEqual({ eligiblePositions: [], roundCapacity: 0, hasHumanAction: false, noActionReason: "YIELDED" });
    expect((await snapshot(s)).humanActionability).toMatchObject({ hasHumanAction: false, noActionReason: "YIELDED" });
    const v2 = (await (await s.routes.getRecommendations(s.sessionId, new URL("http://127.0.0.1/x"))).json()) as RecommendationSetV2;
    expect(v2.decision.controlledSlots).toEqual([]);
    expect(v2.decision.actionKind).toBeNull();
  });

  test("el Ally Bot sigue pudiendo absorber la ronda cedida (sólo se cierra el camino humano)", async () => {
    const s = await session([2, 5]);
    expect((await s.routes.postYield(s.sessionId)).status).toBe(200);
    const outcome = s.store.applyAllyBotSelection(s.sessionId, { type: "SUBMIT_SEALED_SELECTION", side: s.side, slotIndex: 0, heroId: 101 }, 1);
    expect(outcome.ok).toBe(true);
  });
});

describe("WP1 -- Position != pick chronology (metamórfico)", () => {
  test("misma propiedad, distinto orden/slot de picks -> misma HumanActionability", async () => {
    const a = await session([1, 3, 5]);
    const b = await session([1, 3, 5]);
    // A: Pos1 on slot 0. B: Pos1 on slot 1. Same ownership state after one pick.
    expect((await humanPick(a, 0, 101, 1)).status).toBe(202);
    expect((await humanPick(b, 1, 101, 1)).status).toBe(202);
    expect(a.store.humanActionability(a.sessionId)).toEqual(b.store.humanActionability(b.sessionId));
    expect(a.store.humanActionability(a.sessionId)).toEqual({ eligiblePositions: [3, 5], roundCapacity: 1, hasHumanAction: true, noActionReason: null });
  });

  test("Party3 Pos1+Pos5 selladas en orden inverso en la ronda 1 -> la ronda 2 ofrece exactamente Pos3 en ambos", async () => {
    const a = await session([1, 3, 5]);
    const b = await session([1, 3, 5]);
    expect((await humanPick(a, 0, 101, 1)).status).toBe(202);
    expect((await humanPick(a, 1, 505, 5)).status).toBe(202);
    expect((await humanPick(b, 0, 505, 5)).status).toBe(202);
    expect((await humanPick(b, 1, 101, 1)).status).toBe(202);
    for (const s of [a, b]) {
      enemySeal(s, 0, 901);
      enemySeal(s, 1, 902);
    }
    expect(a.store.humanActionability(a.sessionId)).toEqual(b.store.humanActionability(b.sessionId));
    expect(a.store.humanActionability(a.sessionId)).toEqual({ eligiblePositions: [3], roundCapacity: 1, hasHumanAction: true, noActionReason: null });
  });

  test("Party2 no contigua (Pos2 + Pos5) en Dire: ambas elegibles, capacidad 2", async () => {
    const s = await session([2, 5], "dire");
    expect(s.store.humanActionability(s.sessionId)).toEqual({ eligiblePositions: [2, 5], roundCapacity: 2, hasHumanAction: true, noActionReason: null });
    expect(s.store.allyBotPositions(s.sessionId)).toEqual([1, 3, 4]);
  });
});

// PD-001 -- POSITION != PICK ORDER != ROUND SLOT != CONTROLLER. Authoritative own-position truth is born
// ONLY at submit (hero + assignedPosition); it is never inferred from slotIndex, round, pick ordinal or
// candidate order. Through the REAL store and the REAL public routes.
describe("PD-001 -- assignedPosition enviada por el humano es la única autoridad", () => {
  test("B. Party2 Pos2+Pos5: Pos5 primero y Pos2 después -> ambas legales, bindings exactos sin inversión cronológica", async () => {
    const s = await session([2, 5]);
    expect((await humanPick(s, 0, 505, 5)).status).toBe(202);
    expect(s.store.humanActionability(s.sessionId)).toEqual({ eligiblePositions: [2], roundCapacity: 1, hasHumanAction: true, noActionReason: null });
    expect((await humanPick(s, 1, 202, 2)).status).toBe(202);
    expect(s.store.ownAssignedPositions(s.sessionId)).toEqual([
      { round: 1, slotIndex: 0, assignedPosition: 5 },
      { round: 1, slotIndex: 1, assignedPosition: 2 },
    ]);
    expect(s.store.humanOpenPositions(s.sessionId)).toEqual([]);
  });

  test("C. orden inverso: Pos2 primero y Pos5 después -> también legal, bindings exactos", async () => {
    const s = await session([2, 5]);
    expect((await humanPick(s, 0, 202, 2)).status).toBe(202);
    expect((await humanPick(s, 1, 505, 5)).status).toBe(202);
    expect(s.store.ownAssignedPositions(s.sessionId)).toEqual([
      { round: 1, slotIndex: 0, assignedPosition: 2 },
      { round: 1, slotIndex: 1, assignedPosition: 5 },
    ]);
    expect(s.store.humanOpenPositions(s.sessionId)).toEqual([]);
  });

  test("el slot no decide la posición: Pos5 en slot 1 y Pos2 en slot 0 también es legal", async () => {
    const s = await session([2, 5]);
    expect((await humanPick(s, 1, 505, 5)).status).toBe(202);
    expect((await humanPick(s, 0, 202, 2)).status).toBe(202);
    expect(s.store.ownAssignedPositions(s.sessionId)).toEqual([
      { round: 1, slotIndex: 1, assignedPosition: 5 },
      { round: 1, slotIndex: 0, assignedPosition: 2 },
    ]);
  });

  test("D. Solo Pos3: el slot genérico es sin posición y enviar assignedPosition = 3 se acepta", async () => {
    const s = await session([3]);
    expect(s.store.humanActionability(s.sessionId)).toEqual({ eligiblePositions: [3], roundCapacity: 1, hasHumanAction: true, noActionReason: null });
    const v2 = (await (await s.routes.getRecommendations(s.sessionId, new URL("http://127.0.0.1/x"))).json()) as RecommendationSetV2;
    expect(v2.decision.controlledSlots.length).toBe(1);
    expect(v2.decision.controlledSlots.every((slot) => slot.position === undefined)).toBe(true);
    expect((await humanPick(s, 0, 303, 3)).status).toBe(202);
    expect(s.store.ownAssignedPositions(s.sessionId)).toEqual([{ round: 1, slotIndex: 0, assignedPosition: 3 }]);
  });

  test("Party2 Pos2+Pos5 antes de sellar: V2 expone elegibilidad completa y ningún slot con posición", async () => {
    const s = await session([2, 5]);
    const v2 = (await (await s.routes.getRecommendations(s.sessionId, new URL("http://127.0.0.1/x"))).json()) as RecommendationSetV2;
    expect(v2.decision.humanActionability).toEqual({ eligiblePositions: [2, 5], roundCapacity: 2, hasHumanAction: true, noActionReason: null });
    expect(v2.decision.controlledSlots.length).toBe(2);
    expect(v2.decision.controlledSlots.every((slot) => slot.position === undefined)).toBe(true);
  });
});
