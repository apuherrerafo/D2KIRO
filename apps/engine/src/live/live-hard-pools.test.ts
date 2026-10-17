import { describe, expect, test } from "bun:test";
import type { TeamCoachBoard } from "../coach";
import { deriveCandidateResult } from "../coach/current-human-decision";
import { fakeCompute } from "../coach/session-harness.fixtures";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { PerspectiveDraftView } from "../draft-protocol/types";
import type { DraftEventEnvelope } from "../draft/reducer";
import type { ComputeSuggestionsForRecommendation } from "../recommendation/perspective-context";
import type { RecommendationSetV2 } from "../recommendation/types";
import { ProtocolSessionStore } from "../server/protocol-session";
import { createProtocolSessionRoutes } from "../server/routes/protocol-sessions";
import type { HeroPositions } from "../signals/hero-positions";
import { LiveCaptureRegistry } from "./live-capture-registry";

// Step 1B-B -- HARD Party5 pools. A configured, non-empty pool for position P is the candidate universe of P:
//   * pool controls ADMISSION (a pool hero is never expelled by credibility; a non-pool hero never appears),
//   * pool NEVER provides IDENTITY (no hero -> position binding is ever derived from membership),
//   * an exhausted pool is reported truthfully -- it never falls back to heroes outside it.
// REAL registry -> REAL kernel -> REAL store -> REAL Team Coach Board route. Positions and pools are inline (S10).
// The V6 stand-in applies no positional admission of its own, so whatever universe reaches a column is the engine's decision.

const share = (position: Position, matches: number) => ({ position, matches });
/** Hero p*10+k plays ONLY position p. 34/134: offlane/soft support. 45: soft/hard support. */
const POSITIONS: HeroPositions = {
  ...Object.fromEntries(([1, 2, 3, 4, 5] as Position[]).flatMap((position) => [0, 1, 2, 3].map((k) => [position * 10 + k, [share(position, 1000)]]))),
  34: [share(3, 600), share(4, 500)],
  134: [share(3, 600), share(4, 500)],
  45: [share(4, 600), share(5, 500)],
};
const ALL_HEROES = Object.keys(POSITIONS).map(Number);
const PERMISSIVE: HeroPositions = Object.fromEntries(ALL_HEROES.map((hero) => [hero, ([1, 2, 3, 4, 5] as Position[]).map((position) => share(position, 1000))]));
type Pools = Partial<Record<Position, readonly number[]>>;
const POOLS: Pools = { 1: [10, 11], 2: [20, 21, 22], 3: [30, 31, 34, 134], 4: [34, 134, 40, 41], 5: [50, 51, 45] };
const ACCOUNT = 4242;
const IRRELEVANT_BAN = 99;
/** Rubick: the data only ever sees him at Pos 4, but the player declared him in the Pos 1 pool. */
const RUBICK = 42;

let seq = 0;

function universeHonouringCompute(): ComputeSuggestionsForRecommendation {
  const base = fakeCompute(ALL_HEROES, PERMISSIVE);
  return async (state, accountId, options) => {
    const set = await base(state, accountId, options);
    if (!options?.candidateHeroIds) return set;
    const allowed = new Set(options.candidateHeroIds);
    const suggestions = set.suggestions
      .filter((suggestion) => allowed.has(suggestion.hero))
      .map((suggestion, index) => ({ ...suggestion, rank: Math.min(index + 1, 6) as typeof suggestion.rank }));
    const signalEvidence = set.functionalEvidence?.signalEvidence.filter((entry) => allowed.has(entry.hero));
    return { ...set, suggestions, functionalEvidence: set.functionalEvidence && signalEvidence ? { ...set.functionalEvidence, signalEvidence } : set.functionalEvidence };
  };
}

function setup(sessionId: string, pools: Pools | null) {
  const store = new ProtocolSessionStore();
  const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41e", now: () => 1_790_000_000_000, heroPositions: POSITIONS });
  const routes = createProtocolSessionRoutes({
    store,
    computeSuggestions: universeHonouringCompute(),
    heroPositions: POSITIONS,
    heroCounters: new Map(),
    liveRecommendationGate: (id) => registry.recommendationGate(id),
  });
  registry.ensureSession(sessionId, ACCOUNT);
  registry.observe(sessionId, { type: "draft_started", patch: "7.41e" });
  registry.observe(sessionId, { type: "side", side: "radiant" });
  registry.observe(sessionId, { type: "ban", heroId: IRRELEVANT_BAN + 1 });
  if (pools) registry.setTeamContext(sessionId, ACCOUNT, { teamGroupId: 7, playerPoolsByPosition: pools });
  const send = (payload: DraftEventEnvelope["payload"]) => {
    seq += 1;
    return registry.ingestEnvelope({ schema: "draft-event/v1", eventId: `hard-pool-${seq}`, sessionId, seq, emittedAt: "2026-10-15T12:00:00.000Z", source: "ocr", confidence: 0.95, payload });
  };
  send({ type: "capture_health", status: "ok", detail: "VISUAL_OK" });
  async function board(): Promise<TeamCoachBoard> {
    const response = await routes.getTeamRecommendations(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/team-recommendations`));
    expect(response.status).toBe(200);
    return (await response.json()) as TeamCoachBoard;
  }
  return {
    board,
    ally: (hero: number) => send({ type: "hero_picked", hero, side: "radiant" }),
    enemy: (hero: number) => send({ type: "hero_picked", hero, side: "dire" }),
    ban: (hero: number) => registry.observe(sessionId, { type: "ban", heroId: hero }),
  };
}

const column = (board: TeamCoachBoard, position: Position) => board.positions.find((candidate) => candidate.position === position)!;
const ranking = (board: TeamCoachBoard, position: Position) => [...column(board, position).top].sort((a, b) => a.rank - b.rank).map((card) => card.heroId);
const ALL_POSITIONS: Position[] = [1, 2, 3, 4, 5];

describe("1. un héroe del pool que la estadística no ve en esa posición sigue siendo candidato", () => {
  test("Rubick en el pool de Pos 1 es candidato de Pos 1", async () => {
    const t = setup("hp-1", { ...POOLS, 1: [10, RUBICK] });
    const body = await t.board();
    expect(column(body, 1).state).toBe("RANKED");
    expect(ranking(body, 1)).toContain(RUBICK);
  });

  test("lo es en cualquier fase del draft con otros héroes ya elegidos", async () => {
    const t = setup("hp-1b", { ...POOLS, 1: [10, RUBICK] });
    t.enemy(70);
    t.enemy(71);
    expect(ranking(await t.board(), 1)).toContain(RUBICK);
  });
});

describe("2. un héroe fuera del pool configurado no se recomienda", () => {
  test("la columna de Pos 1 contiene exactamente el pool, aunque otros héroes sean creíbles ahí", async () => {
    const t = setup("hp-2", POOLS);
    const body = await t.board();
    expect([...ranking(body, 1)].sort((a, b) => a - b)).toEqual([10, 11]);
    expect(ranking(body, 1)).not.toContain(12);
    expect(ranking(body, 1)).not.toContain(13);
  });

  test("lo mismo en las cinco columnas: nadie sale de su propio pool", async () => {
    const body = await setup("hp-2b", POOLS).board();
    for (const position of ALL_POSITIONS) {
      const pool = new Set(POOLS[position]);
      expect(ranking(body, position).every((heroId) => pool.has(heroId))).toBe(true);
    }
  });

  test("la rationale y el primario también salen del pool", async () => {
    const body = await setup("hp-2c", POOLS).board();
    for (const position of ALL_POSITIONS) {
      const primary = column(body, position).primaryHeroId;
      if (primary !== null) expect(POOLS[position]).toContain(primary);
    }
  });
});

describe("3. un héroe del pool baneado o elegido no está disponible", () => {
  test("baneado y elegido por el rival desaparecen de la columna", async () => {
    const t = setup("hp-3", POOLS);
    t.ban(10);
    t.enemy(20);
    const body = await t.board();
    expect(ranking(body, 1)).toEqual([11]);
    expect(ranking(body, 2)).not.toContain(20);
    expect(ranking(body, 2).length).toBeGreaterThan(0);
  });

  test("un héroe propio ya elegido deja de ofrecerse en las otras columnas donde también está en el pool", async () => {
    const t = setup("hp-3b", POOLS);
    t.ally(134);
    const body = await t.board();
    for (const position of ALL_POSITIONS) expect(ranking(body, position)).not.toContain(134);
  });
});

describe("4. un pool agotado no tiene fallback fuera del pool", () => {
  test("pool de Pos 1 agotado: la columna queda sin opciones y no aparece ningún otro héroe", async () => {
    const t = setup("hp-4", POOLS);
    t.ban(10);
    t.enemy(11);
    const body = await t.board();
    const pos1 = column(body, 1);
    expect(pos1.state).toBe("UNAVAILABLE");
    expect(pos1.top).toEqual([]);
    expect(pos1.primaryHeroId).toBeNull();
    expect(pos1.note).toContain("pool");
    // el resto del tablero sigue vivo
    for (const position of [2, 3, 4, 5] as Position[]) expect(column(body, position).state).toBe("RANKED");
  });

  test("se prefiere otra posición viable: la decisión no apunta a la posición agotada", async () => {
    const control = await setup("hp-4-control", POOLS).board();
    expect(control.currentDecision.recommendedPosition).toBe(5); // orden de fase: Pos 5 primero
    const t = setup("hp-4b", POOLS);
    for (const hero of [50, 51]) t.ban(hero);
    t.enemy(45);
    const body = await t.board();
    expect(column(body, 5).state).toBe("UNAVAILABLE");
    expect(body.currentDecision.recommendedPosition).not.toBe(5);
    expect(body.currentDecision.recommendedPosition).not.toBeNull();
    // la posición agotada sigue siendo legalmente elegible: sólo se estrecha el objetivo recomendado
    expect(body.currentDecision.actionablePositions).toContain(5);
  });

  test("todas las posiciones agotadas: se informa con verdad, sin héroe recomendado ni fuera del pool", async () => {
    const t = setup("hp-4c", { 1: [10], 2: [20], 3: [30], 4: [40], 5: [50] });
    for (const hero of [10, 20, 30, 40, 50]) t.ban(hero);
    const body = await t.board();
    for (const position of ALL_POSITIONS) {
      expect(column(body, position).state).toBe("UNAVAILABLE");
      expect(column(body, position).top).toEqual([]);
    }
    expect(body.currentDecision.recommendedHeroId).toBeNull();
    expect(body.currentDecision.reason).toContain("pool");
  });
});

describe("5. sin pool configurado se conserva el universo creíble actual", () => {
  test("sin contexto de equipo: Pos 1 sigue ofreciendo a los héroes creíbles en Pos 1", async () => {
    const body = await setup("hp-5", null).board();
    expect([...ranking(body, 1)].sort((a, b) => a - b)).toEqual([10, 11, 12, 13]);
    expect(ranking(body, 1)).not.toContain(RUBICK);
  });

  test("un pool vacío para una posición equivale a no configurarlo; las demás posiciones siguen duras", async () => {
    const body = await setup("hp-5b", { ...POOLS, 1: [] }).board();
    expect([...ranking(body, 1)].sort((a, b) => a - b)).toEqual([10, 11, 12, 13]);
    expect([...ranking(body, 2)].sort((a, b) => a - b)).toEqual([20, 21, 22]);
  });

  test("la columna sin pool no se contamina con el pool de otra posición", async () => {
    const body = await setup("hp-5c", { 2: [20, RUBICK] }).board();
    expect(ranking(body, 1)).not.toContain(RUBICK);
    expect(ranking(body, 2)).toContain(RUBICK);
  });
});

describe("6. un compañero ambiguo sigue sin resolverse", () => {
  test("Earthshaker (flex Pos 3/4, en ambos pools) no se vincula a ninguna posición por estar en el pool", async () => {
    const t = setup("hp-6", POOLS);
    t.ally(34);
    const body = await t.board();
    expect(body.unboundOwnHeroIds).toEqual([34]);
    for (const position of ALL_POSITIONS) expect(column(body, position).filledHeroId).not.toBe(34);
  });
});

describe("7. la pertenencia a un pool jamás crea identidad héroe -> posición", () => {
  test("un héroe que sólo lista el pool de Pos 1 y se elige como propio queda sin vincular", async () => {
    const t = setup("hp-7", { ...POOLS, 1: [10, RUBICK], 4: [40, 41] });
    t.ally(RUBICK);
    const body = await t.board();
    expect(body.unboundOwnHeroIds).toEqual([RUBICK]);
    expect(column(body, 1).filledHeroId).toBeNull();
    expect(column(body, 4).filledHeroId).toBeNull();
  });

  test("ofrecer a un héroe en una columna no lo convierte en dato de identidad de ese héroe en otra", async () => {
    const body = await setup("hp-7b", { ...POOLS, 1: [10, RUBICK] }).board();
    expect(ranking(body, 1)).toContain(RUBICK);
    expect(column(body, 1).filledHeroId).toBeNull();
    expect(body.unboundOwnHeroIds).toEqual([]);
  });
});

describe("deriveCandidateResult con admittedPool (alternativas posicionales)", () => {
  const view = { bannedHeroes: [10], ownPicks: [], enemyPicks: [{ visibility: "REVEALED", heroId: 11 }] } as unknown as PerspectiveDraftView;
  const unrankable = { degradations: [{ reason: "NO_LEGAL_HERO_UNIVERSE", detail: "fixture" }], recommendations: [] } as unknown as RecommendationSetV2;
  const input = { targetPosition: 1 as Position, targetRanking: unrankable, view, heroPositions: POSITIONS, personalPoolApplied: false };

  test("sin ranking confiable, las alternativas salen sólo del pool y legales, no del universo creíble", () => {
    const result = deriveCandidateResult({ ...input, admittedPool: [10, 11, RUBICK, 13] });
    expect(result.state).toBe("UNRANKED_POSITIONAL");
    if (result.state !== "UNRANKED_POSITIONAL") return;
    expect(result.alternatives.map((alternative) => alternative.heroId)).toEqual([13, RUBICK]);
  });

  test("contraste: sin pool configurado ofrece el universo creíble de la posición (comportamiento previo)", () => {
    const result = deriveCandidateResult(input);
    expect(result.state).toBe("UNRANKED_POSITIONAL");
    if (result.state !== "UNRANKED_POSITIONAL") return;
    expect(result.alternatives.map((alternative) => alternative.heroId)).toEqual([12, 13]);
  });

  test("pool totalmente no disponible: UNAVAILABLE con motivo de pool, nunca un héroe de fuera", () => {
    const result = deriveCandidateResult({ ...input, admittedPool: [10, 11] });
    expect(result.state).toBe("UNAVAILABLE");
    if (result.state !== "UNAVAILABLE") return;
    expect(result.reason).toContain("pool");
  });
});
