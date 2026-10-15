import { describe, expect, test } from "bun:test";
import type { TeamCoachBoard } from "../coach";
import { selectLivePositionPriority, type LivePositionPriorityInput } from "../coach/live-position-priority";
import { fakeCompute } from "../coach/session-harness.fixtures";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { DraftEventEnvelope } from "../draft/reducer";
import type { ComputeSuggestionsForRecommendation } from "../recommendation/perspective-context";
import { ProtocolSessionStore } from "../server/protocol-session";
import { createProtocolSessionRoutes } from "../server/routes/protocol-sessions";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import { LiveCaptureRegistry } from "./live-capture-registry";
import { resolveLiveOwnPositions, type LiveOwnPickEvidence } from "./live-position-resolver";

// GATE 0 -- contrato base del live (docs/agents/live-contract.md). Las 7 verdades que el producto ya rompió una vez.
//
// Las que el código de hoy cumple son `test` normales: candados contra regresión.
// Las que el código de hoy VIOLA son `test.failing`: el candado ya está en rojo. Cuando el paso del roadmap que las
// arregla aterrice, bun hace fallar el `test.failing` ("marked as failing but it passed") y obliga a convertirlo en un
// `test` normal en ese mismo PR. Nunca se borra uno para hacer pasar la suite.
//
// Posiciones, pools y counters son fixtures inline (S10): nunca el archivo curado.

const share = (position: Position, matches: number) => ({ position, matches });

/** Héroe p*10+k: se juega SOLO en la posición p. 34/134: offlane/soft support. 45: soft/hard support. */
const POSITIONS: HeroPositions = {
  ...Object.fromEntries(([1, 2, 3, 4, 5] as Position[]).flatMap((position) => [0, 1, 2, 3].map((k) => [position * 10 + k, [share(position, 1000)]]))),
  34: [share(3, 600), share(4, 500)],
  134: [share(3, 600), share(4, 500)],
  45: [share(4, 600), share(5, 500)],
};
const ALL_HEROES = Object.keys(POSITIONS).map(Number);
/** Para el stand-in de V6: todo héroe "se juega" en toda posición, así la única admisión que actúa es la del motor. */
const PERMISSIVE: HeroPositions = Object.fromEntries(ALL_HEROES.map((hero) => [hero, ([1, 2, 3, 4, 5] as Position[]).map((position) => share(position, 1000))]));
const POOLS: Partial<Record<Position, readonly number[]>> = { 1: [10, 11], 2: [20, 21, 22], 3: [30, 31, 34, 134], 4: [34, 134, 40, 41], 5: [50, 51, 45] };
/** Keyed by the VICTIM: hero 41 (Pos 4) hard-counters the enemy 91. */
const ENEMY_COUNTERED = 91;
const COUNTERS = new Map<number, CuratedCounter[]>([[ENEMY_COUNTERED, [{ vs: 41, level: "hard", why: "fixture" }]]]);
const ACCOUNT = 4242;
/** Un héroe que no está en ninguna columna ni es counter de nada: banearlo es irrelevante para el ranking. */
const IRRELEVANT_BAN = 99;

let seq = 0;

/**
 * A V6 stand-in that ranks exactly the candidate universe the engine hands it (`candidateHeroIds`), in a fixed order.
 * It applies no positional admission of its own, so whatever universe reaches a column is the engine's decision.
 */
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

function setup(sessionId: string, options: { pools?: Partial<Record<Position, readonly number[]>> | null; readBans?: boolean } = {}) {
  const pools = options.pools === undefined ? POOLS : options.pools;
  const store = new ProtocolSessionStore();
  const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41e", now: () => 1_790_000_000_000, heroPositions: POSITIONS });
  const routes = createProtocolSessionRoutes({
    store,
    computeSuggestions: universeHonouringCompute(),
    heroPositions: POSITIONS,
    heroCounters: COUNTERS,
    liveRecommendationGate: (id) => registry.recommendationGate(id),
  });
  registry.ensureSession(sessionId, ACCOUNT);
  registry.observe(sessionId, { type: "draft_started", patch: "7.41e" });
  registry.observe(sessionId, { type: "side", side: "radiant" });
  if (options.readBans !== false) registry.observe(sessionId, { type: "ban", heroId: IRRELEVANT_BAN + 1 });
  if (pools) registry.setTeamContext(sessionId, ACCOUNT, { teamGroupId: 7, playerPoolsByPosition: pools });
  const send = (payload: DraftEventEnvelope["payload"]) => {
    seq += 1;
    return registry.ingestEnvelope({ schema: "draft-event/v1", eventId: `contract-${seq}`, sessionId, seq, emittedAt: "2026-10-15T12:00:00.000Z", source: "ocr", confidence: 0.95, payload });
  };
  send({ type: "capture_health", status: "ok", detail: "VISUAL_OK" });
  async function board(): Promise<TeamCoachBoard> {
    const response = await routes.getTeamRecommendations(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/team-recommendations`));
    expect(response.status).toBe(200);
    return (await response.json()) as TeamCoachBoard;
  }
  return {
    registry,
    board,
    ally: (hero: number) => send({ type: "hero_picked", hero, side: "radiant" }),
    enemy: (hero: number) => send({ type: "hero_picked", hero, side: "dire" }),
    ban: (hero: number) => registry.observe(sessionId, { type: "ban", heroId: hero }),
  };
}

const column = (board: TeamCoachBoard, position: Position) => board.positions.find((candidate) => candidate.position === position)!;
/** A column's own ranking, in rank order (the primary-first display order is a plan, not the ranking). */
const ranking = (board: TeamCoachBoard, position: Position) => [...column(board, position).top].sort((a, b) => a.rank - b.rank).map((card) => card.heroId);

function picks(...heroes: (number | [number, Position])[]): LiveOwnPickEvidence[] {
  return heroes.map((hero) => (Array.isArray(hero) ? { heroId: hero[0], explicitPosition: hero[1] } : { heroId: hero, explicitPosition: null }));
}
function resolve(ownPicks: LiveOwnPickEvidence[], pools: Partial<Record<Position, readonly number[]>> | null = POOLS) {
  return resolveLiveOwnPositions({ ownPicks, playerPoolsByPosition: pools, heroPositions: POSITIONS });
}

describe("VERDAD 1 -- el pool controla candidatos, no identidad", () => {
  // Cumplida desde el Paso 1a: el pool ya no es fuente de identidad (UNIQUE_POOL eliminado).
  test("un héroe que solo lista el pool de Pos 5 NO se vuelve Pos 5: queda sin vincular", async () => {
    const t = setup("contract-1a");
    t.ally(50);
    const body = await t.board();
    expect(body.unboundOwnHeroIds).toEqual([50]);
    expect(column(body, 5).filledHeroId).not.toBe(50);
  });

  // Viola hoy: el pool es sólo un bonus (hero_pool_fit); el universo de la columna es credibleHeroesForPosition.
  test.failing("con pool configurado, los candidatos de esa posición salen SOLO del pool", async () => {
    const t = setup("contract-1b", { pools: { ...POOLS, 4: [42, 43] } });
    const body = await t.board();
    const pos4 = ranking(body, 4);
    expect(pos4.length).toBeGreaterThan(0);
    expect(pos4.every((heroId) => heroId === 42 || heroId === 43)).toBe(true);
  });

  // Viola hoy: credibleHeroesForPosition / candidateServesPosition expulsan al héroe del pool antes de rankear.
  test.failing("un héroe del pool que la estadística no ve en esa posición sigue siendo candidato (Rubick carry)", async () => {
    // 42 sólo se juega de Pos 4 en los datos, pero el jugador lo declaró en su pool de Pos 1.
    const t = setup("contract-1c", { pools: { ...POOLS, 1: [10, 42] } });
    const body = await t.board();
    expect(ranking(body, 1)).toContain(42);
  });
});

describe("VERDAD 2 -- un vínculo exacto héroe→posición exige evidencia de identidad", () => {
  test("una posición explícita es un hecho y nada la sobrescribe", () => {
    expect(resolve(picks([51, 3])).heroes[0]).toEqual({ heroId: 51, position: 3, provenance: "EXPLICIT", possiblePositions: [3] });
  });

  // Cumplida desde el Paso 1a: JOINT_INFERENCE por credibilidad eliminado.
  test("un héroe fuera de todo pool, creíble en una sola posición libre, NO se vincula", () => {
    const result = resolve(picks(31), { 1: [11], 2: [21], 4: [41], 5: [51] });
    expect(result.heroes[0]!.provenance).toBe("UNRESOLVED");
    expect(result.heroes[0]!.position).toBeNull();
  });

  // Cumplida desde el Paso 1a: "queda una sola posición" es una restricción de conjunto, no una identidad.
  test("cuatro posiciones explícitas: la quinta queda ocupada, pero el quinto héroe NO recibe identidad por deducción", () => {
    const result = resolveLiveOwnPositions({ ownPicks: picks([11, 1], [21, 2], [31, 3], [41, 4], 77), playerPoolsByPosition: null, heroPositions: {} });
    expect(result.necessarilyOccupied).toContain(5);
    expect(result.heroes[4]).toMatchObject({ heroId: 77, position: null, provenance: "UNRESOLVED" });
  });
});

describe("VERDAD 2 (b) -- LOCAL_PLAYER: héroe local de GSI + posición declarada por el jugador", () => {
  test("posición declarada + héroe local de GSI => ese héroe, y sólo ese, queda LOCAL_PLAYER", () => {
    const result = resolveLiveOwnPositions({ ownPicks: picks(50, 21), localPlayer: { position: 2, heroId: 21 }, playerPoolsByPosition: POOLS, heroPositions: POSITIONS });
    expect(result.heroes).toEqual([
      { heroId: 50, position: null, provenance: "UNRESOLVED", possiblePositions: [1, 3, 4, 5] },
      { heroId: 21, position: 2, provenance: "LOCAL_PLAYER", possiblePositions: [2] },
    ]);
  });

  test("sin posición declarada, o sin héroe local, no hay vínculo", () => {
    for (const localPlayer of [{ position: null, heroId: 21 }, { position: 2, heroId: null }, null] as const) {
      const result = resolveLiveOwnPositions({ ownPicks: picks(21), localPlayer, playerPoolsByPosition: POOLS, heroPositions: POSITIONS });
      expect(result.heroes[0]).toMatchObject({ position: null, provenance: "UNRESOLVED" });
    }
  });
});

describe("VERDAD 3 -- desconocido gana a identidad inferida", () => {
  // Cumplida desde el Paso 1a: ya no hay vínculos encadenados vía pools ("31 sólo está en el pool de Pos 3, así que 34 es el Pos 4").
  test("un segundo pick no 'desambigua' al primero a través de los pools: ambos quedan sin identidad", () => {
    const result = resolve(picks(34, 31));
    expect(result.heroes.map((hero) => hero.provenance)).toEqual(["UNRESOLVED", "UNRESOLVED"]);
  });

  // Cumplida desde el Paso 1a: el pool ya no restringe el dominio de cada héroe. La restricción de CONJUNTO sí es legítima (abajo).
  test("con 1/2/5 explícitas, dos héroes de pool único 3 y 4 ocupan {3,4} sin que se afirme cuál es cuál", () => {
    const result = resolve(picks([11, 1], [21, 2], [51, 5], 31, 41));
    expect(result.necessarilyOccupied).toEqual([1, 2, 3, 4, 5]);
    expect(result.heroes.slice(3).map((hero) => hero.provenance)).toEqual(["UNRESOLVED", "UNRESOLVED"]);
  });

  test("restricción de conjunto lógicamente necesaria: con 1/2/5 explícitas, dos héroes sin dato ocupan {3,4}, ambos sin identidad", () => {
    const result = resolveLiveOwnPositions({ ownPicks: picks([11, 1], [21, 2], [51, 5], 77, 78), playerPoolsByPosition: null, heroPositions: {} });
    expect(result.necessarilyOccupied).toEqual([1, 2, 3, 4, 5]);
    expect(result.heroes.slice(3)).toEqual([
      { heroId: 77, position: null, provenance: "UNRESOLVED", possiblePositions: [3, 4] },
      { heroId: 78, position: null, provenance: "UNRESOLVED", possiblePositions: [3, 4] },
    ]);
  });
});

describe("VERDAD 4 -- un ban no leído queda desconocido, nunca 'no baneado'", () => {
  // Viola hoy: el estado sólo expone `bans: number`; "0 bans leídos" y "bans no leídos" son indistinguibles.
  // Se arregla en el Paso 2 (el nombre del campo lo fija ese paso; si cambia, cambia acá en el mismo PR).
  test.failing("con picks pero sin ningún ban leído, el estado declara el conocimiento de bans como DESCONOCIDO", () => {
    const t = setup("contract-4", { readBans: false });
    t.ally(50);
    const status = t.registry.status("contract-4")!;
    expect(status).toHaveProperty("banKnowledge", "UNKNOWN");
  });
});

describe("VERDAD 5 -- el ranking puede recalcularse y mantener el mismo orden", () => {
  test("mismo estado, dos recálculos: columnas idénticas", async () => {
    const t = setup("contract-5a");
    t.ally(41);
    const first = await t.board();
    const second = await t.board();
    expect(second.positions).toEqual(first.positions);
    expect(second.currentDecision).toEqual(first.currentDecision);
  });

  test("un ban irrelevante recalcula sin mover ningún ranking ni marcar error", async () => {
    const t = setup("contract-5b");
    const before = await t.board();
    t.ban(IRRELEVANT_BAN);
    const after = await t.board();
    for (const position of [1, 2, 3, 4, 5] as Position[]) {
      expect(column(after, position).state).toBe(column(before, position).state);
      expect(ranking(after, position)).toEqual(ranking(before, position));
    }
  });
});

describe("VERDAD 6 -- la decisión de posición y el ranking de héroes son decisiones distintas", () => {
  const COLUMNS = ([1, 2, 3, 4, 5] as Position[]).map((position) => ({ position, heroIds: [position * 10, position * 10 + 1, position * 10 + 2] }));
  const input = (partial: Partial<LivePositionPriorityInput> = {}): LivePositionPriorityInput => ({
    actionablePositions: [1, 2, 3, 4, 5], phase: "PICK_ROUND_1", columns: COLUMNS, revealedEnemies: [], heroCounters: new Map(), playerPoolsByPosition: null, unavailable: new Set(), occupancy: null, ...partial,
  });
  const reversed = COLUMNS.map((entry) => ({ ...entry, heroIds: [...entry.heroIds].reverse() }));

  test("reordenar los héroes dentro de las columnas no cambia la posición elegida (fallback ni ventana de counter)", () => {
    expect(selectLivePositionPriority(input({ columns: reversed }))).toEqual(selectLivePositionPriority(input()));
    const withWindow = { revealedEnemies: [ENEMY_COUNTERED], heroCounters: COUNTERS };
    expect(selectLivePositionPriority(input({ ...withWindow, columns: reversed }))).toEqual(selectLivePositionPriority(input(withWindow)));
  });

  test("que la decisión pase a otra posición no altera el ranking propio de las demás columnas", async () => {
    const t = setup("contract-6");
    const before = await t.board();
    expect(before.currentDecision.targetBasis).toBe("PHASE_FALLBACK");
    t.enemy(ENEMY_COUNTERED); // abre una ventana de counter en Pos 4; 91 no es candidato de ninguna columna
    const after = await t.board();
    expect(after.currentDecision).toMatchObject({ recommendedPosition: 4, targetBasis: "STRATEGIC" });
    for (const position of [1, 2, 3, 5] as Position[]) expect(ranking(after, position)).toEqual(ranking(before, position));
  });
});

describe("VERDAD 7 -- PHASE_FALLBACK jamás se presenta como ventaja táctica", () => {
  test("el fallback se nombra como orden de fase, sin héroe protagonista ni lenguaje de ventaja", () => {
    const priority = selectLivePositionPriority({ actionablePositions: [1, 2, 3, 4, 5], phase: "PICK_ROUND_1", columns: [], revealedEnemies: [], unavailable: new Set() });
    expect(priority).toMatchObject({ targetBasis: "PHASE_FALLBACK", signal: "PHASE", signalHeroId: null });
    expect(priority.targetRationale).toContain("no una ventaja");
    expect(priority.targetRationale).not.toContain("Ventana de counter");
    expect(priority.targetRationale).not.toContain("Asegurar el pool");
  });

  test("en el tablero, una decisión por fase nunca sale con base STRATEGIC", async () => {
    const body = await setup("contract-7").board();
    expect(body.currentDecision.targetBasis).toBe("PHASE_FALLBACK");
    expect(body.currentDecision.reason).toContain("no una ventaja");
  });
});
