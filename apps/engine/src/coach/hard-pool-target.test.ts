import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import { buildRecommendationSetFromPerspective } from "../recommendation/build-from-perspective";
import type { PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import { CoachOrchestrator } from "./orchestrator";
import { buildTeamCoachBoard, buildTeamPositionPriority } from "./team-coach-board";
import { selectDecisionTarget, targetFromPriority } from "./current-human-decision";
import { selectLivePositionPriority } from "./live-position-priority";
import { poolsByConfirmedPosition, type SavedTeamMember } from "../recommendation/team-positions";
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

describe("recomputeCurrentDecision (V4) con un pool configurado agotado (Hero Pools V2: el pool es preferencia)", () => {
  test("control: con el pool de Pos 4 vivo, Pos 4 (la del jugador) sigue siendo el objetivo", async () => {
    const decision = await decide({ 4: [3] });
    expect(decision.targetPosition).toBe(4);
    expect(decision.poolState).toBe("ACTIVE");
  });

  test("Pos 4 agotada (su único héroe baneado) sigue siendo el objetivo: un pool agotado no cierra la posición", async () => {
    const decision = await decide({ 4: [3] }, { bans: [3] });
    expect(decision.targetPosition).toBe(4);
    expect(decision.viewedPosition).toBe(4);
    expect(decision.actionablePositions).toContain(4);
    expect(decision.poolState).toBe("EXHAUSTED");
  });

  test("la razón no habla de un 'pool' que bloquee: si no hay héroe creíble lo dice por la posición", async () => {
    const decision = await decide({ 4: [3] }, { bans: [3] });
    expect(decision.targetRationale).not.toContain("pool");
    if (decision.candidates.state === "UNAVAILABLE") expect(decision.candidates.reason).not.toContain("pool");
  });

  test("la posición personal sigue ganando", async () => {
    const decision = await decide({ 4: [3] }, { bans: [3], personal: 2 });
    expect(decision.targetPosition).toBe(2);
  });

  test("el pool no restringe ni expande: sólo héroes creíbles de la posición, y los del pool quedan marcados", async () => {
    const decision = await decide({ 2: [4, 7] }, { personal: 2 });
    expect(decision.targetPosition).toBe(2);
    if (decision.candidates.state !== "RANKED") throw new Error("expected RANKED");
    const cards = decision.candidates.cards;
    expect(cards.map((card) => card.heroId)).toContain(4);
    expect(cards.map((card) => card.heroId)).not.toContain(7); // hero 7 is not credible at Pos 2 in the fixture
    expect(cards.find((card) => card.heroId === 4)!.poolMembership).toBe("IN_POOL");
    expect(decision.poolOwner).toBe("TEAMMATE");
  });

  test("ver explícitamente la posición agotada se respeta (navegación)", async () => {
    const decision = await decide({ 4: [3] }, { bans: [3], requestedTarget: 4 });
    expect(decision.viewedPosition).toBe(4);
    expect(decision.targetPosition).toBe(4);
  });

  test("las cinco agotadas: todas siguen siendo objetivo posible y se informa por la posición, no por un pool", async () => {
    const decision = await decide({ 1: [1], 2: [4], 3: [5], 4: [3], 5: [2] }, { bans: [1, 2, 3, 4, 5] });
    expect(decision.poolState).toBe("EXHAUSTED");
    if (decision.candidates.state === "UNAVAILABLE") expect(decision.candidates.reason).not.toContain("pool");
  });

  test("sin pool configurado el comportamiento previo se conserva (objetivo = posición del jugador)", async () => {
    expect((await decide(null)).targetPosition).toBe(4);
    expect((await decide({})).targetPosition).toBe(4);
    expect((await decide({ 4: [] }, { bans: [3] })).targetPosition).toBe(4); // pool vacío == no configurado
    expect((await decide(null)).poolState).toBe("NONE");
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
  function boardInput(pools: Pools | null, bans: number[], personal: Position) {
    const h = harness({ adapterKind: "simulator", controlledPositions: ALL, bans });
    const context: PerspectiveRecommendationContext = { ...h.store.perspectiveRecommendationContext(h.id)!, playerPoolsByPosition: pools };
    return {
      context,
      playerPersonalPosition: personal,
      heroPositions: HERO_POSITIONS,
      buildTargetRanking: (ctx: PerspectiveRecommendationContext, targetPosition: Position) =>
        buildRecommendationSetFromPerspective({ context: ctx, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS, targetPosition, teamOpening: false, singleSlotEvaluation: true }),
    };
  }

  async function board(pools: Pools | null, bans: number[], personal: Position) {
    return (await buildTeamCoachBoard(boardInput(pools, bans, personal)))!;
  }

  // What the route does: V4 takes the board's position priority when >= 2 positions are open.
  async function v4LikeTheRoute(pools: Pools | null, bans: number[], personal: Position) {
    const input = boardInput(pools, bans, personal);
    const positionPriority = await buildTeamPositionPriority(input);
    const result = await coachFor().recomputeCurrentDecision({ context: input.context, playerPersonalPosition: personal, positionPriority });
    const decision = result!.output.decision;
    if (decision.kind !== "ACTIONABLE") throw new Error("expected ACTIONABLE");
    return decision;
  }

  test("un pool agotado no cierra la columna: el tablero sigue el orden habitual (Pos5), Pos4 sigue accionable, y V4 coincide", async () => {
    const pools: Pools = { 4: [3] };
    const body = await board(pools, [3], 4);
    const v4 = await v4LikeTheRoute(pools, [3], 4);
    expect(body.currentDecision.recommendedPosition).toBe(5);
    expect(body.currentDecision.targetBasis).toBe("PHASE_FALLBACK");
    expect(body.currentDecision.recommendedPosition).toBe(v4.targetPosition);
    expect(v4.targetBasis).toBe("DETERMINISTIC_DEFAULT"); // V4's wire has no PHASE_FALLBACK: "no clear strategic priority"
    expect(body.currentDecision.actionablePositions).toContain(4);
    expect(v4.actionablePositions).toContain(4);
  });

  test("POOL_SCARCITY: a Pos4 le queda un solo héroe del pool de ESTA partida -> tablero y V4 la recomiendan, como STRATEGIC", async () => {
    const pools: Pools = { 4: [3] };
    const body = await board(pools, [], 1);
    const v4 = await v4LikeTheRoute(pools, [], 1);
    expect(body.currentDecision.recommendedPosition).toBe(4);
    expect(body.currentDecision.targetBasis).toBe("STRATEGIC");
    expect(v4.targetPosition).toBe(4);
    expect(v4.targetBasis).toBe("STRATEGIC");
  });

  // Player != Position != Decision order. The priority names a POSITION; which player sits there (and whose pool applies)
  // comes only from team-positions. A swap changes that mapping, never the habitual order of the positions.
  test("swap por partida: el pool que cuenta es el del asiento de ESTA partida -- cambia la escasez, no el orden habitual", async () => {
    const members: SavedTeamMember[] = [{ id: 10, position: 4, heroPool: [3] }, { id: 20, position: 3, heroPool: [5] }];
    const usual = poolsByConfirmedPosition(members);
    const swapped = poolsByConfirmedPosition(members, new Map([[10, 3 as const], [20, 4 as const]]));
    expect(usual).toEqual({ 4: [3], 3: [5] });
    expect(swapped).toEqual({}); // a pool never travels with the player to a seat that is not their confirmed position

    const withUsual = await board(usual, [], 1);
    // Pos 3 and Pos 4 each have one hero left: a tie narrows the field to them and the habitual order decides -- not STRATEGIC.
    expect(withUsual.currentDecision.targetBasis).toBe("PHASE_FALLBACK");
    expect(withUsual.currentDecision.recommendedPosition).toBe(4);

    const withSwap = await board(swapped, [], 1);
    expect(withSwap.currentDecision.targetBasis).toBe("PHASE_FALLBACK");
    expect(withSwap.currentDecision.recommendedPosition).toBe(5);
    // Both seats stay open and ranked in either case: the swap never hides an option.
    for (const body of [withUsual, withSwap]) expect(body.currentDecision.actionablePositions).toEqual(ALL);
  });

  test("el pool de otro asiento no cuenta: con el mismo héroe en el pool de Pos2 (no de Pos4), Pos4 no tiene escasez", async () => {
    const body = await board({ 2: [3] }, [], 4);
    expect(body.currentDecision.targetBasis).not.toBe("STRATEGIC");
    expect(body.currentDecision.recommendedPosition).toBe(5);
  });

  test("control: con el pool vivo el tablero y V4 apuntan a la posición personal", async () => {
    const body = await board({ 4: [3] }, [], 4);
    expect(body.currentDecision.recommendedPosition).toBe(4);
    expect((await decide({ 4: [3] }, { personal: 4 })).targetPosition).toBe(4);
  });

  test("las cinco agotadas: ninguna columna se cierra por su pool; sin héroe creíble disponible no hay recomendación", async () => {
    const pools: Pools = { 1: [1], 2: [4], 3: [5], 4: [3], 5: [2] };
    const body = await board(pools, [1, 2, 3, 4, 5], 4);
    expect(body.currentDecision.recommendedHeroId).toBeNull();
    expect(body.currentDecision.reason).not.toContain("pool");
  });
});

describe("targetFromPriority -- lo que V4 toma del orden de posiciones del tablero", () => {
  const COLUMNS = ALL.map((position) => ({ position, heroIds: [position * 10, position * 10 + 1] }));
  const base = { actionablePositions: ALL, phase: "PICK_ROUND_1" as const, columns: COLUMNS, revealedEnemies: [], unavailable: new Set<number>() };

  test("el orden habitual viaja como DETERMINISTIC_DEFAULT con su razón, sin llamarse ventaja", () => {
    const target = targetFromPriority(selectLivePositionPriority(base), ALL)!;
    expect(target.targetPosition).toBe(5);
    expect(target.targetBasis).toBe("DETERMINISTIC_DEFAULT");
    expect(target.targetRationale).toContain("no una ventaja");
  });

  test("COUNTER_WINDOW gana a la fase y viaja como STRATEGIC", () => {
    const counters = new Map([[90, [{ vs: 41, level: "hard" as const, why: "fixture" }]]]);
    const priority = selectLivePositionPriority({ ...base, revealedEnemies: [90], heroCounters: counters });
    expect(priority.signal).toBe("COUNTER_WINDOW");
    const target = targetFromPriority(priority, ALL)!;
    expect(target.targetPosition).toBe(4);
    expect(target.targetBasis).toBe("STRATEGIC");
  });

  test("sin prioridad, o apuntando a una posición no elegible, V4 vuelve a selectDecisionTarget (null)", () => {
    expect(targetFromPriority(null, ALL)).toBeNull();
    expect(targetFromPriority(undefined, ALL)).toBeNull();
    expect(targetFromPriority(selectLivePositionPriority(base), [1, 2, 3])).toBeNull();
  });
});
