import { describe, expect, test } from "bun:test";
import { assignTeamPrimaries, type RecommendationOutputV4, type TeamCoachBoard } from "../../coach";
import { fakeCompute } from "../../coach/session-harness.fixtures";
import type { HeroPositions } from "../../signals/hero-positions";
import { ProtocolSessionStore } from "../protocol-session";
import { createProtocolSessionRoutes } from "./protocol-sessions";

// Team Coach Board over HTTP: REAL kernel + REAL ProtocolSessionStore + REAL perspective-safe
// recommendation path; only V6's scorer is a deterministic fixture (fakeCompute). Curated positions
// are an INLINE fixture -- nothing here reads hero-positions.json.

// Hero 10 is played evenly at every position: its role stays UNRESOLVED, so it is credible -- and V6's
// best -- in ALL FIVE columns. The primary plan must give it to exactly one of them. (A 50/50 two-position
// flex never reaches two columns: role impact resolves it LIKELY to one position, so it cannot duplicate.)
const POSITIONS: HeroPositions = {
  10: [1, 2, 3, 4, 5].map((position) => ({ position: position as 1 | 2 | 3 | 4 | 5, matches: 1000 })),
  1: [{ position: 1, matches: 1000 }],
  2: [{ position: 1, matches: 1000 }],
  3: [{ position: 1, matches: 1000 }],
  4: [{ position: 2, matches: 1000 }],
  5: [{ position: 2, matches: 1000 }],
  6: [{ position: 3, matches: 1000 }],
  7: [{ position: 3, matches: 1000 }],
  8: [{ position: 3, matches: 1000 }],
  9: [{ position: 4, matches: 1000 }],
  11: [{ position: 4, matches: 1000 }],
  12: [{ position: 5, matches: 1000 }],
  13: [{ position: 5, matches: 1000 }],
  14: [{ position: 5, matches: 1000 }],
};
const POOL = [10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14];

function jsonRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

async function setup(controlledPositions: (1 | 2 | 3 | 4 | 5)[] = [1, 2, 3, 4, 5], humanPosition: 1 | 2 | 3 | 4 | 5 = 2) {
  const store = new ProtocolSessionStore();
  const routes = createProtocolSessionRoutes({ store, computeSuggestions: fakeCompute(POOL, POSITIONS), heroPositions: POSITIONS, heroCounters: new Map() });
  const created = await routes.post(jsonRequest({
    rulesetId: "dota2/ranked-all-pick",
    patch: "7.41e",
    localSide: "radiant",
    adapterKind: "simulator",
    humanPosition,
    simulatorSeed: "TEAMBOARD",
    partyContext: { partySize: controlledPositions.length, side: "radiant", controlledSlots: [] },
    controlledPositions,
  }));
  expect(created.status).toBe(201);
  const { sessionId } = (await created.json()) as { sessionId: string };
  store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: [] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
  async function board(): Promise<TeamCoachBoard> {
    const response = await routes.getTeamRecommendations(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/team-recommendations`));
    expect(response.status).toBe(200);
    return (await response.json()) as TeamCoachBoard;
  }
  async function v4(): Promise<RecommendationOutputV4> {
    const response = await routes.getRecommendations(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/recommendations?format=v4`));
    return ((await response.json()) as { output: RecommendationOutputV4 }).output;
  }
  async function pick(position: 1 | 2 | 3 | 4 | 5, heroId: number) {
    const slot = store.authorizedLegalActions(sessionId)!.find((action) => action.type === "SUBMIT_SEALED_SELECTION" && action.side === "radiant");
    if (!slot || slot.type !== "SUBMIT_SEALED_SELECTION") throw new Error("no open own slot");
    const response = await routes.postCommand(jsonRequest({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: slot.slotIndex, heroId }, assignedPosition: position }), sessionId);
    return (await response.json()) as { accepted: boolean };
  }
  return { store, routes, sessionId, board, v4, pick };
}

const heroesOf = (board: TeamCoachBoard) => board.positions.flatMap((column) => column.top.map((card) => card.heroId));

describe("GET .../team-recommendations -- Team Coach Board", () => {
  test("1. Party5 devuelve 5 rankings, uno por posición, con top >= 3", async () => {
    const { board } = await setup();
    const body = await board();
    expect(body.schema).toBe("team-coach-board/v1");
    expect(body.positions.map((column) => column.position)).toEqual([1, 2, 3, 4, 5]);
    for (const column of body.positions) {
      expect(column.state).toBe("RANKED");
      expect(column.eligibleNow).toBe(true);
      expect(column.alreadyFilled).toBe(false);
      expect(column.top.length).toBeGreaterThanOrEqual(3);
      // Every card serves the column's own position.
      for (const card of column.top) expect(POSITIONS[card.heroId]!.some((share) => share.position === column.position)).toBe(true);
    }
  });

  test("2. exactamente un recommendedPosition, y es el MISMO objetivo que el currentDecision V4 canónico", async () => {
    const { board, v4 } = await setup();
    const body = await board();
    const decision = (await v4()).decision;
    expect(decision.kind).toBe("ACTIONABLE");
    if (decision.kind !== "ACTIONABLE") return;
    expect(body.currentDecision.recommendedPosition).toBe(decision.targetPosition);
    expect(body.currentDecision.targetBasis).toBe(decision.targetBasis);
    expect(body.positions.filter((column) => column.position === body.currentDecision.recommendedPosition)).toHaveLength(1);
    const recommendedColumn = body.positions.find((column) => column.position === body.currentDecision.recommendedPosition)!;
    expect(body.currentDecision.recommendedHeroId).toBe(recommendedColumn.primaryHeroId);
    expect(body.currentDecision.reason.length).toBeGreaterThan(0);
    // Advisory, never narrowing: every eligible position stays actionable.
    expect(body.currentDecision.actionablePositions).toEqual([1, 2, 3, 4, 5]);
  });

  test("plan primario: un héroe #1 en las 5 columnas es la primaria de UNA sola; sigue visible como alternativa en las demás", async () => {
    const { board } = await setup();
    const body = await board();
    for (const column of body.positions) expect(column.top.map((card) => card.heroId)).toContain(10);
    for (const column of body.positions) expect(column.top.find((card) => card.rank === 1)!.heroId).toBe(10);
    const primaries = body.positions.map((column) => column.primaryHeroId).filter((heroId) => heroId !== null);
    expect(primaries).toHaveLength(5);
    expect(new Set(primaries).size).toBe(5);
    expect(body.positions.filter((column) => column.primaryHeroId === 10)).toHaveLength(1);
    for (const column of body.positions) {
      expect(column.top.filter((card) => card.isPrimary)).toHaveLength(1);
      expect(column.top[0]!.isPrimary).toBe(true);
    }
  });

  test("3. elegir Pos5 aunque la recomendación sea otra es legal; 4. recalcula; 5. el héroe desaparece", async () => {
    const { board, pick } = await setup();
    const before = await board();
    expect(before.currentDecision.recommendedPosition).not.toBe(5);
    const chosen = before.positions.find((column) => column.position === 5)!.top[1]!.heroId; // not even the primary
    const result = await pick(5, chosen);
    expect(result.accepted).toBe(true);

    const after = await board();
    expect(after.stateIdentity).not.toBe(before.stateIdentity);
    const pos5 = after.positions.find((column) => column.position === 5)!;
    expect(pos5).toMatchObject({ state: "FILLED", alreadyFilled: true, filledHeroId: chosen, eligibleNow: false, top: [] });
    const open = after.positions.filter((column) => column.position !== 5);
    expect(open).toHaveLength(4);
    for (const column of open) {
      expect(column.state).toBe("RANKED");
      expect(column.eligibleNow).toBe(true);
    }
    expect(heroesOf(after)).not.toContain(chosen);
    expect(after.currentDecision.actionablePositions).toEqual([1, 2, 3, 4]);
  });

  test("6. todas las columnas usan el mismo stateIdentity (el del snapshot, igual al de V4)", async () => {
    const { board, v4 } = await setup();
    const body = await board();
    for (const column of body.positions) expect(column.stateIdentity).toBe(body.stateIdentity);
    expect((await v4()).meta.basedOn.stateIdentity).toBe(body.stateIdentity);
  });

  test("7. pedir el board no muta el kernel ni la sesión", async () => {
    const { store, sessionId, board } = await setup();
    const before = JSON.stringify({ state: store.get(sessionId), bindings: store.ownAssignedPositions(sessionId), legal: store.authorizedLegalActions(sessionId) });
    await board();
    await board();
    const after = JSON.stringify({ state: store.get(sessionId), bindings: store.ownAssignedPositions(sessionId), legal: store.authorizedLegalActions(sessionId) });
    expect(after).toBe(before);
  });

  test("Party3: sólo las 3 posiciones humanas son columnas principales", async () => {
    const { board } = await setup([1, 2, 3], 2);
    const body = await board();
    expect(body.positions.map((column) => column.position)).toEqual([1, 2, 3]);
    expect(body.currentDecision.recommendedPosition).toBe(2);
  });

  test("sesión desconocida -> 404; lado ajeno -> 403", async () => {
    const { routes, sessionId } = await setup();
    expect((await routes.getTeamRecommendations("nope", new URL("http://127.0.0.1/x"))).status).toBe(404);
    expect((await routes.getTeamRecommendations(sessionId, new URL("http://127.0.0.1/x?side=dire"))).status).toBe(403);
  });
});

describe("assignTeamPrimaries (pure)", () => {
  test("asignación inyectiva de suma mínima de ranks, desempate determinista por posición", () => {
    const plan = assignTeamPrimaries([
      { position: 4, heroIds: [10, 9] },
      { position: 2, heroIds: [10, 4] },
    ]);
    expect(plan.get(2)).toBe(10);
    expect(plan.get(4)).toBe(9);
  });

  test("cede la primaria cuando el otro lado no tiene alternativa", () => {
    const plan = assignTeamPrimaries([
      { position: 2, heroIds: [10, 4] },
      { position: 4, heroIds: [10] },
    ]);
    expect(plan.get(4)).toBe(10);
    expect(plan.get(2)).toBe(4);
  });

  test("sin héroe distinto disponible la posición queda sin primaria", () => {
    const plan = assignTeamPrimaries([
      { position: 1, heroIds: [7] },
      { position: 3, heroIds: [7] },
    ]);
    expect(plan.get(1)).toBe(7);
    expect(plan.get(3)).toBeNull();
  });
});
