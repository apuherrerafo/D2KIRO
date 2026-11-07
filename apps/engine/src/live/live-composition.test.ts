import { describe, expect, test } from "bun:test";
import type { TeamCoachBoard } from "../coach";
import { fakeCompute, strongOpenerCounters } from "../coach/session-harness.fixtures";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { DraftEventEnvelope } from "../draft/reducer";
import type { ComputeSuggestionsForRecommendation } from "../recommendation/perspective-context";
import { ProtocolSessionStore } from "../server/protocol-session";
import { createProtocolSessionRoutes } from "../server/routes/protocol-sessions";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import { LiveCaptureRegistry } from "./live-capture-registry";

// Live Companion -- composición viable de cinco: ELIGE AHORA no manda a un cuarto support cuando los picks propios ya cubren los dos asientos de
// support y faltan carry y offlane. Tablero completo (registro Live + rutas reales + tablero real); sólo V6 es un stand-in determinista.
// Posiciones y counters son fixtures inline (S10): nunca el archivo curado.

const share = (position: Position, matches: number) => ({ position, matches });

const LION = 41; // support con un poco de mid
const CRYSTAL = 42; // hard support con un poco de mid
const RUBICK = 43; // support con un poco de mid
const GRIMSTROKE = 44; // el "cuarto support"
const OGRE = 45; // flex de verdad: offlane / soft / hard
const ZEUS = 46; // flex de verdad: mid / soft
const CARRIES = [11, 12, 13];
const MIDS = [21, 22];
const OFFLANERS = [31, 32, 33];
const LION_REAL = 51; // Lion de verdad: 37% pos 4 / 52% pos 5 / 11% mid
const CRYSTAL_REAL = 52; // Crystal Maiden de verdad: 16% pos 4 / 84% pos 5
const HARD_SUPPORT = 53; // hard support dominante: 65% pos 5 / 25% pos 4 / 10% mid
const PURE_SUPPORTS = [47, 48, 49, 50]; // supports que en los datos sólo juegan pos 4/5 (sin ningún mid)

const POSITIONS: HeroPositions = {
  ...Object.fromEntries(CARRIES.map((hero) => [hero, [share(1, 9000)]])),
  ...Object.fromEntries(MIDS.map((hero) => [hero, [share(2, 9000)]])),
  ...Object.fromEntries(OFFLANERS.map((hero) => [hero, [share(3, 9000)]])),
  [LION]: [share(4, 5000), share(5, 3500), share(2, 1000)],
  [CRYSTAL]: [share(5, 6000), share(4, 2500), share(2, 700)],
  [RUBICK]: [share(4, 4000), share(5, 3800), share(2, 800)],
  [GRIMSTROKE]: [share(5, 5000), share(4, 3000), share(2, 900)],
  [OGRE]: [share(3, 2500), share(4, 4000), share(5, 3500)],
  [ZEUS]: [share(2, 2500), share(4, 6000), share(5, 1500)],
  [LION_REAL]: [share(5, 5200), share(4, 3700), share(2, 1100)],
  [CRYSTAL_REAL]: [share(5, 8400), share(4, 1600)],
  [HARD_SUPPORT]: [share(5, 6500), share(4, 2500), share(2, 1000)],
  ...Object.fromEntries(PURE_SUPPORTS.map((hero, index) => [hero, index % 2 === 0 ? [share(4, 6000), share(5, 4000)] : [share(5, 6000), share(4, 4000)]])),
};
const ALL_HEROES = Object.keys(POSITIONS).map(Number);
const PERMISSIVE: HeroPositions = Object.fromEntries(ALL_HEROES.map((hero) => [hero, ([1, 2, 3, 4, 5] as Position[]).map((position) => share(position, 1000))]));
const ACCOUNT = 4242;
const IRRELEVANT_BAN = 99;
const ENEMIES = [91, 92, 93, 94];
const NO_COUNTERS = new Map<number, CuratedCounter[]>();

let seq = 0;

/** V6 stand-in: rankea exactamente el universo de candidatos que el motor le entrega (misma técnica que live-contract.test.ts). */
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

/** `withoutEvidence`: héroes sin ningún fundamento (no aparecen en ninguna columna: ni evidencia fuerte ni débil). */
function setup(sessionId: string, options: { withoutEvidence?: readonly number[] } = {}) {
  const store = new ProtocolSessionStore();
  const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41f", now: () => 1_790_000_000_000, heroPositions: POSITIONS });
  const routes = createProtocolSessionRoutes({
    store,
    computeSuggestions: universeHonouringCompute(),
    heroPositions: POSITIONS,
    heroCounters: strongOpenerCounters(ALL_HEROES.filter((hero) => !options.withoutEvidence?.includes(hero)), IRRELEVANT_BAN + 1, NO_COUNTERS),
    liveRecommendationGate: (id) => registry.recommendationGate(id),
  });
  registry.ensureSession(sessionId, ACCOUNT);
  registry.observe(sessionId, { type: "draft_started", patch: "7.41f" });
  registry.observe(sessionId, { type: "side", side: "radiant" });
  registry.observe(sessionId, { type: "ban", heroId: IRRELEVANT_BAN + 1 });
  registry.setTeamContext(sessionId, ACCOUNT, { teamGroupId: 7, playerPoolsByPosition: {} });
  const send = (payload: DraftEventEnvelope["payload"], source: DraftEventEnvelope["source"] = "ocr") => {
    seq += 1;
    return registry.ingestEnvelope({ schema: "draft-event/v1", eventId: `composition-${seq}`, sessionId, seq, emittedAt: "2026-10-15T12:00:00.000Z", source, confidence: 0.95, payload });
  };
  send({ type: "capture_health", status: "ok", detail: "VISUAL_OK" });
  async function board(): Promise<TeamCoachBoard> {
    const response = await routes.getTeamRecommendations(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/team-recommendations`));
    if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    return (await response.json()) as TeamCoachBoard;
  }
  return {
    board,
    // Una posición afirmada llega por una fuente que sabe quién es quién (Overwolf/GSI); la captura visual nunca la trae.
    ally: (hero: number, position?: Position) => (position === undefined ? send({ type: "hero_picked", hero, side: "radiant" }) : send({ type: "hero_picked", hero, side: "radiant", position } as DraftEventEnvelope["payload"], "overwolf")),
    enemy: (hero: number) => send({ type: "hero_picked", hero, side: "dire" }),
  };
}

const column = (board: TeamCoachBoard, position: Position) => board.positions.find((candidate) => candidate.position === position)!;
const SUPPORT_SEATS: Position[] = [4, 5];

const [E0, E1, E2, E3] = ENEMIES as [number, number, number, number];

/** Round 1 completa: dos picks propios y dos del rival, para que un tercer pick propio sea un draft Live legal. */
function round1(t: ReturnType<typeof setup>, first: [number, Position?], second: [number, Position?]) {
  t.ally(...first);
  t.ally(...second);
  t.enemy(E0);
  t.enemy(E1);
}

describe("Live: ELIGE AHORA y la composición de cinco", () => {
  test("Lion + Crystal Maiden + Rubick: ELIGE AHORA no manda a un cuarto support, manda a lo que falta (offlane)", async () => {
    const t = setup("composition-1");
    round1(t, [LION], [CRYSTAL]);
    t.ally(RUBICK);
    const body = await t.board();
    expect(SUPPORT_SEATS).not.toContain(body.currentDecision.recommendedPosition!);
    expect(body.currentDecision.recommendedPosition).toBe(3);
    expect(OFFLANERS).toContain(body.currentDecision.recommendedHeroId!);
    expect(body.currentDecision.targetBasis).toBe("PHASE_FALLBACK"); // jamás se presenta como ventaja táctica
    expect(body.currentDecision.reason).toBe("");
  });

  test("POSICIÓN DECLARADA: con Lion afirmado en pos 4 y Crystal Maiden + Rubick sin vincular, el arreglo sigue funcionando (no vuelve al orden fijo)", async () => {
    const t = setup("composition-2");
    round1(t, [LION, 4], [CRYSTAL]);
    t.ally(RUBICK);
    const body = await t.board();
    expect(column(body, 4).alreadyFilled).toBe(true);
    expect(column(body, 4).filledHeroId).toBe(LION);
    expect(body.currentDecision.recommendedPosition).toBe(3);
  });

  test("POSICIONES PARCIALMENTE DECLARADAS: dos asientos afirmados (4 y 5) + un tercer support sin vincular -> sigue a lo que falta, los asientos declarados no se reasignan", async () => {
    const t = setup("composition-3");
    round1(t, [LION, 4], [CRYSTAL, 5]);
    t.ally(RUBICK);
    const body = await t.board();
    expect(column(body, 4).filledHeroId).toBe(LION);
    expect(column(body, 5).filledHeroId).toBe(CRYSTAL);
    expect(body.unboundOwnHeroIds).toEqual([RUBICK]);
    expect([1, 2, 3]).toContain(body.currentDecision.recommendedPosition!);
  });

  test("CUATRO SUPPORTS sin declarar: ELIGE AHORA tampoco manda a un quinto, aunque la asignación completa no exista", async () => {
    const t = setup("composition-4");
    round1(t, [LION], [CRYSTAL]);
    t.ally(RUBICK);
    t.ally(GRIMSTROKE);
    t.enemy(E2);
    t.enemy(E3);
    const body = await t.board();
    expect([1, 2, 3]).toContain(body.currentDecision.recommendedPosition!); // no vacuo: hay decisión y no es un support
  });

  test("CUATRO SUPPORTS con uno declarado: el arreglo tampoco se apaga", async () => {
    const t = setup("composition-5");
    round1(t, [LION, 4], [CRYSTAL]);
    t.ally(RUBICK);
    t.ally(GRIMSTROKE);
    t.enemy(E2);
    t.enemy(E3);
    const body = await t.board();
    expect([1, 2, 3]).toContain(body.currentDecision.recommendedPosition!); // no vacuo: hay decisión y no es un support
  });

  test("CUATRO SUPPORTS PUROS 4/5 con uno declarado: el declarado no se saca de la cuenta y el arreglo no se apaga", async () => {
    const t = setup("composition-5b");
    round1(t, [PURE_SUPPORTS[0]!, 4], [PURE_SUPPORTS[1]!]);
    t.ally(PURE_SUPPORTS[2]!);
    t.ally(PURE_SUPPORTS[3]!);
    t.enemy(E2);
    t.enemy(E3);
    const body = await t.board();
    expect(column(body, 4).filledHeroId).toBe(PURE_SUPPORTS[0]!);
    expect([1, 2, 3]).toContain(body.currentDecision.recommendedPosition!);
  });

  test("MID FALTANTE sin candidato fuerte: no se inventa un ELIGE AHORA ni se vuelve a mandar a otro support; las tarjetas elegibles se conservan", async () => {
    const t = setup("composition-6", { withoutEvidence: [...MIDS, ZEUS] }) // Zeus también juega mid (25%);
    round1(t, [LION], [CRYSTAL]);
    t.ally(CARRIES[0]!);
    t.ally(OFFLANERS[0]!);
    t.enemy(E2);
    t.enemy(E3);
    const body = await t.board();
    expect(body.currentDecision.recommendedPosition).toBeNull();
    expect(body.currentDecision.recommendedHeroId).toBeNull();
    expect(body.currentDecision.reason).toBe("");
    // nada se oculta: las columnas siguen elegibles y con sus tarjetas; el mid, que no tiene ningún héroe con fundamento, queda vacío (sin relleno)
    for (const position of [1, 2, 3, 4, 5] as Position[]) expect(column(body, position).eligibleNow).toBe(true);
    for (const position of [1, 3, 4] as Position[]) expect(column(body, position).top.length).toBeGreaterThan(0); // las tarjetas elegibles se conservan
    expect(column(body, 2).top.every((card) => card.evidenceStrength === "WEAK")).toBe(true); // sólo evidencia débil: sin recomendación fuerte inventada
  });

  test("MID FALTANTE pero con candidato fuerte: ELIGE AHORA va al mid (lo que falta)", async () => {
    const t = setup("composition-7");
    round1(t, [LION], [CRYSTAL]);
    t.ally(CARRIES[0]!);
    t.ally(OFFLANERS[0]!);
    t.enemy(E2);
    t.enemy(E3);
    const body = await t.board();
    expect(body.currentDecision.recommendedPosition).toBe(2);
    expect(MIDS).toContain(body.currentDecision.recommendedHeroId!);
  });

  test("ADVERSARIAL -- dos offlaners: el segundo offlane no se vuelve a recomendar como si faltara", async () => {
    const t = setup("composition-8");
    round1(t, [OFFLANERS[0]!], [OFFLANERS[1]!]);
    t.ally(LION);
    const body = await t.board();
    expect(body.currentDecision.recommendedPosition).not.toBe(3);
  });

  test("ADVERSARIAL -- sin ningún support (tres cores): el cambio no bloquea a los supports, siguen siendo lo que falta", async () => {
    const t = setup("composition-9");
    round1(t, [CARRIES[0]!], [MIDS[0]!]);
    t.ally(OFFLANERS[0]!);
    const body = await t.board();
    expect(SUPPORT_SEATS).toContain(body.currentDecision.recommendedPosition!);
  });

  test("no se inventa ninguna posición: los picks sin declarar siguen sin vincular y las cinco columnas siguen abiertas y elegibles", async () => {
    const t = setup("composition-10");
    round1(t, [LION], [CRYSTAL]);
    t.ally(RUBICK);
    const body = await t.board();
    expect([...body.unboundOwnHeroIds].sort((a, b) => a - b)).toEqual([LION, CRYSTAL, RUBICK].sort((a, b) => a - b));
    for (const position of [1, 2, 3, 4, 5] as Position[]) {
      expect(column(body, position).alreadyFilled).toBe(false);
      expect(column(body, position).eligibleNow).toBe(true);
    }
    // el jugador puede seguir eligiendo un cuarto support: la columna se muestra completa, sólo cambia a cuál apunta ELIGE AHORA
    expect(column(body, 4).top.length).toBeGreaterThan(0);
    expect(column(body, 5).top.length).toBeGreaterThan(0);
  });

  test("el primer pick queda idéntico: sin picks propios, el orden por fase de siempre", async () => {
    const body = await setup("composition-11").board();
    expect(body.currentDecision.recommendedPosition).toBe(5);
    expect(body.currentDecision.targetBasis).toBe("PHASE_FALLBACK");
  });

  test("un solo support no cambia nada: ELIGE AHORA sigue el orden por fase (el segundo asiento de support sigue abierto)", async () => {
    const t = setup("composition-12");
    t.ally(LION);
    t.enemy(E0);
    const body = await t.board();
    expect(body.currentDecision.recommendedPosition).toBe(5);
  });

  test("flex: Ogre Magi + Zeus no cierran los asientos de support (pueden ser core) -> sigue el orden de fase con lo que falta, sin ocultar nada", async () => {
    const t = setup("composition-13");
    round1(t, [OGRE], [ZEUS]);
    const body = await t.board();
    expect(body.currentDecision.targetBasis).toBe("PHASE_FALLBACK");
    for (const position of [1, 2, 3, 4, 5] as Position[]) expect(column(body, position).eligibleNow).toBe(true);
  });

  test("héroes del rival revelados no mueven la composición propia: sólo cuentan los picks propios", async () => {
    const t = setup("composition-14");
    round1(t, [LION], [CRYSTAL]);
    t.ally(RUBICK);
    const before = (await t.board()).currentDecision.recommendedPosition;
    t.enemy(E2);
    const after = (await t.board()).currentDecision.recommendedPosition;
    expect(after).toBe(before);
  });
});

describe("Live: bloque de supports, un solo pick y columna faltante", () => {
  test("DOS SUPPORTS PEGADOS (perfil real): Lion 37/52 + Crystal Maiden 16/84 ya cubren los dos asientos de support -> el tercer pick no va a un support", async () => {
    const t = setup("composition-15");
    round1(t, [LION_REAL], [CRYSTAL_REAL]);
    t.ally(CARRIES[0]!);
    const body = await t.board();
    expect(SUPPORT_SEATS).not.toContain(body.currentDecision.recommendedPosition!);
    expect(body.currentDecision.recommendedPosition).toBe(3);
  });

  test("DOS SUPPORTS PEGADOS con el mid faltante y un core ya elegido: el quinto pick tampoco es un tercer support", async () => {
    const t = setup("composition-16");
    round1(t, [LION_REAL], [CRYSTAL_REAL]);
    t.ally(CARRIES[0]!);
    t.ally(OFFLANERS[0]!);
    t.enemy(E2);
    t.enemy(E3);
    const body = await t.board();
    expect(body.currentDecision.recommendedPosition).toBe(2);
  });

  test("UN SOLO hard support dominante: ELIGE AHORA no se mueve (con un solo pick no hay nada que inferir), igual que el primer pick", async () => {
    const t = setup("composition-17");
    t.ally(HARD_SUPPORT);
    t.enemy(E0);
    const body = await t.board();
    expect(body.currentDecision.recommendedPosition).toBe(5);
    expect(body.currentDecision.targetBasis).toBe("PHASE_FALLBACK");
  });

  test("CARRY faltante sin candidato fuerte: tampoco se vuelve a mandar a otro support (mismo gate que el mid)", async () => {
    const t = setup("composition-18", { withoutEvidence: CARRIES });
    round1(t, [LION_REAL], [CRYSTAL_REAL]);
    t.ally(MIDS[0]!);
    t.ally(OFFLANERS[0]!);
    t.enemy(E2);
    t.enemy(E3);
    const body = await t.board();
    expect(body.currentDecision.recommendedPosition).toBeNull();
    expect(body.currentDecision.recommendedHeroId).toBeNull();
  });
});
