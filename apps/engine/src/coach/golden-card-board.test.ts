import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import { buildRecommendationSetFromPerspective } from "../recommendation/build-from-perspective";
import type { PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import type { CuratedCounter } from "../signals/hero-counters";
import { fakeCompute, harness, HERO_POSITIONS } from "./session-harness.fixtures";
import { buildTeamCoachBoard } from "./team-coach-board";

// Cableado de la card dorada en el tablero (no la regla, que vive en golden-card.test.ts): con rivales revelados que un héroe de las
// posiciones abiertas counterea, el tablero trae la card; sin ellos, null; con la posición cerrada, null. Fixtures inline.

const ALL: Position[] = [1, 2, 3, 4, 5];
const CANDIDATE = 5; // HERO_POSITIONS: héroe 5 juega pos 3 (offlane)
const ENEMY_CORE = 1; // pos 1 -> core
const ENEMY_SUPPORT = 2; // pos 5

const hard = (vs: number): CuratedCounter => ({ vs, level: "hard", why: "razón de fixture" });
const medium = (vs: number): CuratedCounter => ({ vs, level: "medium", why: "razón de fixture" });

async function boardWith(enemies: number[], heroCounters: ReadonlyMap<number, readonly CuratedCounter[]> | undefined, controlled: Position[] = ALL) {
  const h = harness({ adapterKind: "simulator", controlledPositions: controlled });
  const base = h.store.perspectiveRecommendationContext(h.id)!;
  const context = {
    ...base,
    playerPoolsByPosition: null,
    view: { ...base.view, enemyPicks: enemies.map((heroId) => ({ heroId, visibility: "REVEALED" as const })) },
  } as unknown as PerspectiveRecommendationContext;
  const board = await buildTeamCoachBoard({
    context,
    playerPersonalPosition: 4,
    heroPositions: HERO_POSITIONS,
    heroCounters,
    buildTargetRanking: (ctx, targetPosition) =>
      buildRecommendationSetFromPerspective({ context: ctx, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS, targetPosition, teamOpening: false, singleSlotEvaluation: true }),
  });
  return board!;
}

const COUNTERS: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[ENEMY_CORE, [hard(CANDIDATE)]], [ENEMY_SUPPORT, [medium(CANDIDATE)]]]);

describe("Team Coach Board -- la card dorada viaja con datos reales del estado", () => {
  test("con 2 rivales revelados que el candidato counterea (uno duro y core), el tablero trae la card en su posición abierta", async () => {
    const board = await boardWith([ENEMY_CORE, ENEMY_SUPPORT], COUNTERS);
    expect(board.goldenCard?.heroId).toBe(CANDIDATE);
    expect(board.goldenCard?.position).toBe(3);
    expect(board.goldenCard?.wins.map((win) => win.vsHeroId)).toEqual([ENEMY_CORE, ENEMY_SUPPORT]);
  });

  test("sin counters curados (o con un solo rival revelado) no hay card", async () => {
    expect((await boardWith([ENEMY_CORE, ENEMY_SUPPORT], undefined)).goldenCard).toBeNull();
    expect((await boardWith([ENEMY_CORE], COUNTERS)).goldenCard).toBeNull();
  });

  test("si la posición donde juega ya no es una de las abiertas del jugador, no hay card", async () => {
    const onlyCarryAndMid: Position[] = [1, 2]; // el jugador solo controla pos 1 y pos 2: el offlane del candidato no es suyo
    expect((await boardWith([ENEMY_CORE, ENEMY_SUPPORT], COUNTERS, onlyCarryAndMid)).goldenCard).toBeNull();
  });
});
