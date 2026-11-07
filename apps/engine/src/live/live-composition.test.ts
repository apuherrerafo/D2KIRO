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

function setup(sessionId: string) {
  const store = new ProtocolSessionStore();
  const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41f", now: () => 1_790_000_000_000, heroPositions: POSITIONS });
  const routes = createProtocolSessionRoutes({
    store,
    computeSuggestions: universeHonouringCompute(),
    heroPositions: POSITIONS,
    heroCounters: strongOpenerCounters(ALL_HEROES, IRRELEVANT_BAN + 1, NO_COUNTERS),
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

describe("Live: ELIGE AHORA y la composición de cinco", () => {
  test("Lion + Crystal Maiden + Rubick: ELIGE AHORA no manda a un cuarto support, manda a lo que falta (offlane)", async () => {
    const t = setup("composition-1");
    t.ally(LION);
    t.ally(CRYSTAL);
    t.enemy(ENEMIES[0]!);
    t.enemy(ENEMIES[1]!);
    t.ally(RUBICK);
    const body = await t.board();
    expect(SUPPORT_SEATS).not.toContain(body.currentDecision.recommendedPosition!);
    expect(body.currentDecision.recommendedPosition).toBe(3);
    expect(OFFLANERS).toContain(body.currentDecision.recommendedHeroId!);
    expect(body.currentDecision.targetBasis).toBe("PHASE_FALLBACK"); // jamás se presenta como ventaja táctica
    expect(body.currentDecision.reason).toBe("");
  });

  test("cuatro supports (alguno ya juega fuera de rol): ELIGE AHORA tampoco manda a un quinto, aunque la asignación completa no exista", async () => {
    const t = setup("composition-8");
    t.ally(LION);
    t.ally(CRYSTAL);
    t.enemy(ENEMIES[0]!);
    t.enemy(ENEMIES[1]!);
    t.ally(RUBICK);
    t.ally(GRIMSTROKE);
    t.enemy(ENEMIES[2]!);
    const body = await t.board();
    expect(SUPPORT_SEATS).not.toContain(body.currentDecision.recommendedPosition!);
  });

  test("no se inventa ninguna posición: los tres picks siguen sin vincular y las cinco columnas siguen abiertas y elegibles", async () => {
    const t = setup("composition-2");
    t.ally(LION);
    t.ally(CRYSTAL);
    t.enemy(ENEMIES[0]!);
    t.enemy(ENEMIES[1]!);
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
    const body = await setup("composition-3").board();
    expect(body.currentDecision.recommendedPosition).toBe(5);
    expect(body.currentDecision.targetBasis).toBe("PHASE_FALLBACK");
  });

  test("un solo support no cambia nada: ELIGE AHORA sigue exactamente el orden por fase de siempre (el segundo asiento de support sigue abierto)", async () => {
    const t = setup("composition-4");
    t.ally(LION);
    t.enemy(ENEMIES[0]!);
    const body = await t.board();
    expect(body.currentDecision.recommendedPosition).toBe(5);
  });

  test("flex: Ogre Magi + Zeus cubren en buena parte los asientos de support -> sigue el orden de fase con lo que falta (offlane), sin obligar al carry", async () => {
    const t = setup("composition-5");
    t.ally(OGRE);
    t.ally(ZEUS);
    t.enemy(ENEMIES[0]!);
    t.enemy(ENEMIES[1]!);
    const body = await t.board();
    expect(body.currentDecision.recommendedPosition).toBe(3);
    expect(body.currentDecision.targetBasis).toBe("PHASE_FALLBACK");
    // los flex siguen siendo elegibles en sus columnas: nada se oculta
    for (const position of [1, 2, 3, 4, 5] as Position[]) expect(column(body, position).eligibleNow).toBe(true);
  });

  test("una posición que el jugador sí asignó explícitamente se respeta: su columna sigue llena y no se reasigna", async () => {
    const t = setup("composition-6");
    t.ally(LION, 4);
    t.ally(CRYSTAL, 5);
    t.enemy(ENEMIES[0]!);
    t.enemy(ENEMIES[1]!);
    t.ally(RUBICK);
    const body = await t.board();
    expect(column(body, 4).alreadyFilled).toBe(true);
    expect(column(body, 4).filledHeroId).toBe(LION);
    expect(column(body, 5).alreadyFilled).toBe(true);
    expect(column(body, 5).filledHeroId).toBe(CRYSTAL);
    expect(SUPPORT_SEATS).not.toContain(body.currentDecision.recommendedPosition!);
  });

  test("héroes del rival revelados no mueven la composición propia: sólo cuentan los picks propios", async () => {
    const t = setup("composition-7");
    t.ally(LION);
    t.ally(CRYSTAL);
    t.enemy(ENEMIES[0]!);
    t.enemy(ENEMIES[1]!);
    t.ally(RUBICK);
    const before = (await t.board()).currentDecision.recommendedPosition;
    t.enemy(ENEMIES[2]!);
    const after = (await t.board()).currentDecision.recommendedPosition;
    expect(after).toBe(before);
  });
});
