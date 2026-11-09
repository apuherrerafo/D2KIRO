import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import { ProtocolSessionStore } from "../server/protocol-session";
import { LiveCaptureRegistry } from "../live/live-capture-registry";
import { createCoachRecommendations, type CoachRecommendations } from "../server/routes/coach-recommendations";
import { createProtocolSessionRoutes } from "../server/routes/protocol-sessions";
import type { CuratedCounter } from "../signals/hero-counters";
import type { CuratedSynergy } from "../signals/hero-synergies";
import type { RecommendationOutputV4 } from "./recommendation-output-v4";
import { HERO_POSITIONS, POOL } from "./session-harness.fixtures";
import type { ComputeSuggestionsForRecommendation } from "../recommendation/perspective-context";
import { buildSuggestions } from "../signals/mix";
import type { MetaSnapshot } from "../signals/types";

// P0-05D / F-01 -- un counter SOLO estadístico se presenta como dato neutral ("53% de victorias vs X (N partidas analizadas)"),
// jamás como "Fuerte contra X". El texto nace en UN solo lugar (`counter.ts`), así que Simulador y Live lo heredan; esta prueba lo
// verifica de punta a punta con el V6 REAL y datos inline, por modalidad. Cero cambios de decisión: se compara contra el mismo
// escenario con el texto viejo imposible de producir (las decisiones se leen de las mismas superficies del producto).
//
// Modalidades: Simulador Solo / Party 2 / Party 3 / Party 5 (`controlledPositions`) y Live. Live fija `partySize: 5` en el
// registro (`LIVE_CONTROLLED_POSITIONS`): Live Solo/2/3 NO existe como modalidad -- no se simula ni se declara PASS (ver último test).

const BAN = 99;
const ENEMY = 9;
const NO_COUNTERS: ReadonlyMap<number, readonly CuratedCounter[]> = new Map();
// Sinergia curada: habilita una tarjeta sin que el counter sea el fundamento; el counter estadístico entra como complemento (la frase).
const SYNERGIES = new Map<number, readonly CuratedSynergy[]>([[3, [{ with: 1, why: "fixture: 3 inmoviliza para que 1 conecte" }]], [1, [{ with: 3, why: "fixture: 1 aprovecha la inmovilizacion de 3" }]]]);

// Hero 3 gana 80/100 vs el enemigo revelado -> alto delta, 100 partidas (>= piso de insignia) => el texto estadístico existe.
const META: MetaSnapshot = {
  heroes: Object.fromEntries(POOL.concat([ENEMY, 10, 11]).map((hero) => [hero, { id: hero, localizedName: `Hero ${hero}` }])),
  matchups: { 3: [{ vsHero: ENEMY, games: 100, wins: 80 }, { vsHero: 10, games: 300, wins: 120 }, { vsHero: 11, games: 300, wins: 150 }] }, // base del héroe ~50%: 80% vs el enemigo es ventaja real
};
const NEUTRAL = "80% de victorias vs Hero 9 (100 partidas analizadas)";
// El fundamento que habilitó la tarjeta (la sinergia) abre la frase; el número va detrás y nunca lo sustituye.
const PHRASE = `Hace pareja con un aliado ya elegido · ${NEUTRAL}`;

const compute: ComputeSuggestionsForRecommendation = async (state, _accountId, options) =>
  buildSuggestions(state, META, { ...options, heroPositions: HERO_POSITIONS, heroCapabilities: [], heroCounters: new Map(NO_COUNTERS) as Map<number, CuratedCounter[]>, heroSynergies: new Map(SYNERGIES) as Map<number, CuratedSynergy[]> });

function coachFor(store: ProtocolSessionStore): CoachRecommendations {
  return createCoachRecommendations({ source: store, computeSuggestions: compute, heroPositions: HERO_POSITIONS, heroCounters: NO_COUNTERS, heroSynergies: SYNERGIES, heroCapabilities: [], advertirApproved: new Set() });
}

const OWN: { heroId: number; position: Position }[] = [{ heroId: 1, position: 1 }, { heroId: 2, position: 5 }];
const ENEMIES = [ENEMY, 8];

async function ingestSimulator(controlledPositions: Position[]): Promise<{ store: ProtocolSessionStore; sessionId: string }> {
  const store = new ProtocolSessionStore();
  const sessionId = `sim-f01-${controlledPositions.length}`;
  const created = store.create({
    sessionId, rulesetId: "dota2/ranked-all-pick", patch: "7.41e", localSide: "radiant", adapterKind: "simulator", simulatorSeed: "F010001",
    partyContext: { partySize: controlledPositions.length as 1 | 2 | 3 | 5, side: "radiant", controlledSlots: [] }, controlledPositions,
  });
  if (!created.ok) throw new Error("simulator create failed");
  const banned = store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: [BAN] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
  if (!banned?.ok) throw new Error("bans failed");
  const routes = createProtocolSessionRoutes({ store, computeSuggestions: compute, heroPositions: HERO_POSITIONS, heroCounters: NO_COUNTERS });
  // Los picks propios en posiciones que el jugador controla viajan por la ruta con su posición; los de un compañero fuera de su control entran como pick aliado.
  for (const [slotIndex, pick] of OWN.entries()) {
    if (controlledPositions.includes(pick.position)) {
      const request = new Request("http://127.0.0.1/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex, heroId: pick.heroId }, assignedPosition: pick.position }) });
      const response = await routes.postCommand(request, sessionId);
      if (response.status !== 202) throw new Error(`own pick refused: ${response.status}`);
    } else {
      const result = store.apply(sessionId, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex, heroId: pick.heroId });
      if (!result || result.rejected) throw new Error("ally pick rejected");
    }
  }
  for (const [slotIndex, heroId] of ENEMIES.entries()) {
    const result = store.apply(sessionId, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex, heroId });
    if (!result || result.rejected) throw new Error("enemy pick rejected");
  }
  return { store, sessionId };
}

function ingestLive(): { store: ProtocolSessionStore; sessionId: string } {
  const store = new ProtocolSessionStore();
  const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41e", now: () => 1_790_000_000_000, heroPositions: HERO_POSITIONS });
  const sessionId = "live-f01";
  registry.ensureSession(sessionId, 7);
  registry.observe(sessionId, { type: "draft_started", patch: "7.41e" });
  registry.observe(sessionId, { type: "side", side: "radiant" });
  registry.observe(sessionId, { type: "ban", heroId: BAN });
  registry.observe(sessionId, { type: "bans_closed" });
  for (const pick of OWN) if (!registry.observe(sessionId, { type: "pick", side: "radiant", heroId: pick.heroId, position: pick.position }).accepted) throw new Error("live own pick refused");
  for (const heroId of ENEMIES) if (!registry.observe(sessionId, { type: "pick", side: "dire", heroId, position: null }).accepted) throw new Error("live enemy pick refused");
  return { store, sessionId };
}

interface Surfaces { v4: { heroId: number; rationale: string }[]; board: { heroId: number; reasons: string[] }[]; v4Ranking: number[]; boardRanking: number[] }

/** Todo texto de tarjeta que cada superficie real muestra, más el ranking (para comparar decisiones). */
async function surfacesOf(store: ProtocolSessionStore, sessionId: string): Promise<Surfaces> {
  const coach = coachFor(store);
  const board = await coach.recommendTeamBoard(sessionId, null, null);
  if (!board) throw new Error("board unavailable");
  const boardCards = board.positions.flatMap((column) => column.top.map((candidate) => ({ heroId: candidate.heroId, reasons: [...candidate.reasons] })));
  const headline = await coach.recommendCurrentDecision(sessionId, null, null, null);
  const v4: { heroId: number; rationale: string }[] = [];
  const v4Ranking: number[] = [];
  if (headline && headline.output.decision.kind === "ACTIONABLE") {
    for (const position of headline.output.decision.actionablePositions) {
      const view = await coach.recommendCurrentDecision(sessionId, null, null, position);
      const output = view?.output as RecommendationOutputV4 | undefined;
      if (!output || output.decision.kind !== "ACTIONABLE") continue;
      for (const card of output.decision.candidates.cards) { v4.push({ heroId: card.heroId, rationale: card.rationale }); v4Ranking.push(card.heroId); }
    }
  }
  return { v4, board: boardCards, v4Ranking, boardRanking: boardCards.map((card) => card.heroId) };
}

const texts = (surfaces: Surfaces): string[] => [...surfaces.v4.map((card) => card.rationale), ...surfaces.board.flatMap((card) => card.reasons)];

/** Los números que el motor produce, capturados del cómputo real que alimenta las superficies (no del texto renderizado). */
async function counterSignalOf(): Promise<{ raw: number | null; sampleSize: number; hasEvidence: boolean; explanation: string }> {
  let captured: { raw: number | null; sampleSize: number; hasEvidence: boolean; explanation: string } | null = null;
  const spy: ComputeSuggestionsForRecommendation = async (state, accountId, options) => {
    const result = await compute(state, accountId, options);
    const counter = (result as unknown as { suggestions: { hero: number; signals: { signal: string; raw: number | null; sampleSize: number; explanation: string; hasRevealedEnemyCounterEvidence?: boolean }[] }[] })
      .suggestions.find((suggestion) => suggestion.hero === 3)?.signals.find((signal) => signal.signal === "counter");
    if (counter) captured = { raw: counter.raw, sampleSize: counter.sampleSize, hasEvidence: counter.hasRevealedEnemyCounterEvidence === true, explanation: counter.explanation };
    return result;
  };
  const { store, sessionId } = await ingestSimulator([1, 2, 3, 4, 5]);
  await createCoachRecommendations({ source: store, computeSuggestions: spy, heroPositions: HERO_POSITIONS, heroCounters: NO_COUNTERS, heroSynergies: SYNERGIES, heroCapabilities: [], advertirApproved: new Set() }).recommendTeamBoard(sessionId, null, null);
  if (!captured) throw new Error("counter signal of hero 3 not captured");
  return captured;
}

const MODES: { name: string; positions: Position[] }[] = [
  { name: "Simulador Solo", positions: [4] },
  { name: "Simulador Party 2", positions: [4, 5] },
  { name: "Simulador Party 3", positions: [4, 5, 2] },
  { name: "Simulador Party 5", positions: [1, 2, 3, 4, 5] },
];

describe("P0-05D F-01: el counter solo estadístico es un dato neutral, no un 'Fuerte contra'", () => {
  test("la señal conserva sus números y la insignia; solo cambia la frase", async () => {
    const signal = await counterSignalOf();
    expect(signal.explanation).toBe(NEUTRAL);
    expect(signal.sampleSize).toBe(100);
    expect(signal.hasEvidence).toBe(true);
    expect(signal.raw).not.toBeNull();
  });

  for (const mode of MODES) {
    test(`${mode.name}: ninguna tarjeta dice "Fuerte contra" y el dato aparece neutral`, async () => {
      const { store, sessionId } = await ingestSimulator(mode.positions);
      const surfaces = await surfacesOf(store, sessionId);
      const all = texts(surfaces);
      expect(all.length).toBeGreaterThan(0);
      for (const text of all) expect(text).not.toContain("Fuerte contra");
      expect(all).toContain(PHRASE);
    });
  }

  test("Live (Party 5): mismo texto neutral que el Simulador Party 5 y las mismas decisiones por superficie", async () => {
    const sim = await ingestSimulator([1, 2, 3, 4, 5]);
    const live = ingestLive();
    const simSurfaces = await surfacesOf(sim.store, sim.sessionId);
    const liveSurfaces = await surfacesOf(live.store, live.sessionId);
    for (const text of texts(liveSurfaces)) expect(text).not.toContain("Fuerte contra");
    expect(texts(liveSurfaces)).toContain(PHRASE);
    // Mismo motor, mismo texto: el tablero del Simulador y el de Live coinciden en héroes, orden y frases (el texto no desempata nada).
    expect(simSurfaces.boardRanking).toEqual(liveSurfaces.boardRanking);
    expect(simSurfaces.board).toEqual(liveSurfaces.board);
  });

  test("PENDIENTE (no es PASS): Live Solo/Party 2/Party 3 no existe -- el registro de captura fija partySize 5", () => {
    const store = new ProtocolSessionStore();
    const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41e", now: () => 1_790_000_000_000, heroPositions: HERO_POSITIONS });
    registry.ensureSession("live-f01-party", 7);
    expect(store.perspectiveRecommendationContext("live-f01-party")!.partyContext?.partySize).toBe(5);
  });
});
