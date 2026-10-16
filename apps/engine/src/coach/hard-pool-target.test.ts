import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import { buildRecommendationSetFromPerspective } from "../recommendation/build-from-perspective";
import type { PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import { CoachOrchestrator } from "./orchestrator";
import { buildTeamCoachBoard } from "./team-coach-board";
import { selectDecisionTarget } from "./current-human-decision";
import { fakeCompute, harness, HERO_POSITIONS } from "./session-harness.fixtures";

// Step 1B-B (closing pass) -- every Party5 target-selection path agrees: a position whose configured pool is exhausted
// is NOT a viable target. REAL kernel + REAL store; V6's scorer is the harness stand-in. Positions and pools are inline (S10).
//   hero 1 -> Pos 1, hero 4 -> Pos 2, hero 5 -> Pos 3, hero 3 -> Pos 4, hero 2 -> Pos 5.

const ALL: Position[] = [1, 2, 3, 4, 5];
type Pools = Partial<Record<Position, readonly number[]>>;

function coachFor() {
  return new CoachOrchestrator({
    heroPositions: HERO_POSITIONS,
    buildRecommendationSet: (context) => buildRecommendationSetFromPerspective({ context, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS }),
    buildTeamEvaluation: (context) => buildRecommendationSetFromPerspective({ context, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS, singleSlotEvaluation: true }),
    buildTargetRanking: (context, targetPosition) =>
      buildRecommendationSetFromPerspective({ context, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS, targetPosition, teamOpening: false, singleSlotEvaluation: true }),
  });
}

async function decide(pools: Pools | null, options: { bans?: number[]; personal?: Position; requestedTarget?: Position } = {}) {
  const h = harness({ adapterKind: "simulator", controlledPositions: ALL, bans: options.bans });
  const base = h.store.perspectiveRecommendationContext(h.id)!;
  const context: PerspectiveRecommendationContext = { ...base, playerPoolsByPosition: pools };
  expect(context.humanActionability?.eligiblePositions).toEqual(ALL);
  const result = await coachFor().recomputeCurrentDecision({ context, playerPersonalPosition: options.personal ?? 4, requestedTarget: options.requestedTarget });
  const decision = result!.output.decision;
  if (decision.kind !== "ACTIONABLE") throw new Error("expected ACTIONABLE");
  return decision;
}

describe("recomputeCurrentDecision (V4) con un pool configurado agotado", () => {
  test("control: con el pool de Pos 4 vivo, Pos 4 (la del jugador) sigue siendo el objetivo", async () => {
    const decision = await decide({ 4: [3] });
    expect(decision.targetPosition).toBe(4);
  });

  test("Pos 4 agotada (su único héroe baneado) no puede ser el objetivo, aunque sea la posición del jugador", async () => {
    const decision = await decide({ 4: [3] }, { bans: [3] });
    expect(decision.targetPosition).not.toBe(4);
    expect(decision.viewedPosition).not.toBe(4);
    expect(decision.actionablePositions).toContain(4); // sigue siendo legalmente elegible: sólo se estrecha el objetivo
  });

  test("se elige otra posición viable, de forma determinista, y la razón lo dice", async () => {
    const decision = await decide({ 4: [3] }, { bans: [3] });
    expect(decision.targetPosition).toBe(1); // la más baja elegible con opción
    expect(decision.targetBasis).toBe("DETERMINISTIC_DEFAULT");
    expect(decision.targetRationale).toContain("pool");
    expect(decision.candidates.state).not.toBe("UNAVAILABLE");
  });

  test("la posición personal sigue ganando entre las viables", async () => {
    const decision = await decide({ 4: [3] }, { bans: [3], personal: 2 });
    expect(decision.targetPosition).toBe(2);
  });

  test("ningún héroe fuera del pool se introduce en la posición con pool configurado", async () => {
    const decision = await decide({ 2: [4, 7] }, { personal: 2 });
    expect(decision.targetPosition).toBe(2);
    if (decision.candidates.state === "RANKED") expect(decision.candidates.cards.every((card) => [4, 7].includes(card.heroId))).toBe(true);
    if (decision.candidates.state === "UNRANKED_POSITIONAL") expect(decision.candidates.alternatives.every((alt) => [4, 7].includes(alt.heroId))).toBe(true);
  });

  test("ver explícitamente la posición agotada se respeta (navegación) y se informa con verdad, sin héroe fuera del pool", async () => {
    const decision = await decide({ 4: [3] }, { bans: [3], requestedTarget: 4 });
    expect(decision.targetPosition).not.toBe(4);
    expect(decision.viewedPosition).toBe(4);
    expect(decision.candidates.state).toBe("UNAVAILABLE");
    if (decision.candidates.state === "UNAVAILABLE") expect(decision.candidates.reason).toContain("pool");
  });

  test("las cinco agotadas: no hay objetivo viable, se informa con verdad y no se recomienda ningún héroe", async () => {
    const decision = await decide({ 1: [1], 2: [4], 3: [5], 4: [3], 5: [2] }, { bans: [1, 2, 3, 4, 5] });
    expect(decision.candidates.state).toBe("UNAVAILABLE");
    if (decision.candidates.state === "UNAVAILABLE") expect(decision.candidates.reason).toContain("pool");
    expect(decision.targetRationale).not.toContain("la recomendación pasa a");
  });

  test("sin pool configurado el comportamiento previo se conserva (objetivo = posición del jugador)", async () => {
    expect((await decide(null)).targetPosition).toBe(4);
    expect((await decide({})).targetPosition).toBe(4);
    expect((await decide({ 4: [] }, { bans: [3] })).targetPosition).toBe(4); // pool vacío == no configurado
  });
});

describe("selectDecisionTarget con viablePositions", () => {
  test("sin viablePositions o con el conjunto completo: idéntico al comportamiento previo", () => {
    const base = selectDecisionTarget({ eligiblePositions: [1, 2, 3], playerPersonalPosition: 3 });
    expect(selectDecisionTarget({ eligiblePositions: [1, 2, 3], playerPersonalPosition: 3, viablePositions: [1, 2, 3] })).toEqual(base);
    expect(selectDecisionTarget({ eligiblePositions: [1, 2, 3], playerPersonalPosition: 3, viablePositions: [] })).toEqual(base);
    expect(base.targetPosition).toBe(3);
  });

  test("viables estrecha el campo; la razón no afirma 'única posición pendiente' cuando hay más elegibles", () => {
    const target = selectDecisionTarget({ eligiblePositions: [1, 2, 3], playerPersonalPosition: 3, viablePositions: [2] });
    expect(target.targetPosition).toBe(2);
    expect(target.targetRationale).not.toContain("única");
  });
});

describe("tablero del Team Coach (camino simulador) y V4 coinciden", () => {
  async function board(pools: Pools | null, bans: number[], personal: Position) {
    const h = harness({ adapterKind: "simulator", controlledPositions: ALL, bans });
    const context: PerspectiveRecommendationContext = { ...h.store.perspectiveRecommendationContext(h.id)!, playerPoolsByPosition: pools };
    const result = await buildTeamCoachBoard({
      context,
      playerPersonalPosition: personal,
      heroPositions: HERO_POSITIONS,
      buildTargetRanking: (ctx, targetPosition) =>
        buildRecommendationSetFromPerspective({ context: ctx, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS, targetPosition, teamOpening: false, singleSlotEvaluation: true }),
    });
    return result!;
  }

  test("la posición personal agotada no es la decisión del tablero; coincide con el objetivo de V4", async () => {
    const pools: Pools = { 4: [3] };
    const body = await board(pools, [3], 4);
    const v4 = await decide(pools, { bans: [3], personal: 4 });
    expect(body.currentDecision.recommendedPosition).not.toBe(4);
    expect(body.currentDecision.recommendedPosition).toBe(v4.targetPosition);
    expect(body.currentDecision.actionablePositions).toContain(4);
    expect(body.positions.find((column) => column.position === 4)!.state).toBe("UNAVAILABLE");
  });

  test("control: con el pool vivo el tablero y V4 apuntan a la posición personal", async () => {
    const body = await board({ 4: [3] }, [], 4);
    expect(body.currentDecision.recommendedPosition).toBe(4);
    expect((await decide({ 4: [3] }, { personal: 4 })).targetPosition).toBe(4);
  });

  test("las cinco agotadas: el tablero no recomienda héroe y lo dice con verdad", async () => {
    const pools: Pools = { 1: [1], 2: [4], 3: [5], 4: [3], 5: [2] };
    const body = await board(pools, [1, 2, 3, 4, 5], 4);
    for (const column of body.positions) expect(column.state).toBe("UNAVAILABLE");
    expect(body.currentDecision.recommendedHeroId).toBeNull();
    expect(body.currentDecision.reason).toContain("pool");
  });
});
