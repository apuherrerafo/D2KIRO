import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import type { HeroPositions } from "./hero-positions";
import type { HeroCapabilities } from "../draft-paths/types";
import { buildAvailableSignalsReport, buildComparison, buildSuggestions, dataReady, mixScore, nonVotingReason, structurallyApplicableSignals, votingSignals, type AvailableSignalsReport, type Suggestion } from "./mix";
import { parseCalibration, type Calibration } from "./calibration";
import type { MetaHeroInfo, MetaSnapshot, SignalContribution } from "./types";

// TSK-210 (Fase 9.1, costura S18): ninguna prueba lee data/generated/percentiles.json real.
// EMPTY_CAL fuerza el fallback a RAW_RANGE dentro de calibratedNormalize; los fixtures con
// percentiles propios se construyen inline por prueba.
const EMPTY_CAL: Calibration = parseCalibration({});
import { SCORING_WEIGHTS_V1, SCORING_WEIGHTS_V2, SCORING_WEIGHTS_V3, SCORING_WEIGHTS_V4, SCORING_WEIGHTS_V5, SCORING_WEIGHTS_V6 } from "./weights";

function fixtureSuggestion(rank: 1 | 2 | 3, hero: number, signals: SignalContribution[]): Suggestion {
  return { hero, rank, score: 0, signals, reason: "", confidence: "alta", evidenceCoverage: 1, guessingIndex: 0 };
}

function draftState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    sessionId: "s1",
    schema: "draft-state/v1",
    format: "all_pick",
    patch: "7.36",
    localSide: "radiant",
    phase: "active",
    banned: [],
    picks: { radiant: [], dire: [] },
    lastSeq: 7,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "2026-07-27T00:00:00Z",
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    ...overrides,
  };
}

function meta(heroes: Record<number, MetaHeroInfo>, overrides: Partial<MetaSnapshot> = {}): MetaSnapshot {
  return { heroes, matchups: {}, ...overrides };
}

test("targetPosition con pool personal limita las sugerencias a héroes compatibles del pool", () => {
  const result = buildSuggestions(
    draftState(),
    meta(
      { 1: { id: 1, localizedName: "Carry del pool" }, 2: { id: 2, localizedName: "Support externo" }, 3: { id: 3, localizedName: "Support del pool" } },
      { heroPool: [{ hero: 1, source: "manual", personalWinrate: null, personalGames: 10, updatedAt: "now" }, { hero: 3, source: "manual", personalWinrate: null, personalGames: 10, updatedAt: "now" }] },
    ),
    { targetPosition: 5, usePersonalPool: true, heroPositions: { 1: [{ position: 1, matches: 500 }], 2: [{ position: 5, matches: 500 }], 3: [{ position: 5, matches: 500 }] } },
  );

  expect(result.suggestions.map((suggestion) => suggestion.hero)).toEqual([3]);
});

test("la sugerencia para la posición elegida explica el flex real del héroe", () => {
  const result = buildSuggestions(
    draftState(),
    meta({ 7: { id: 7, localizedName: "Earthshaker" } }),
    {
      targetPosition: 2,
      heroPositions: {
        7: [
          { position: 2, matches: 900 },
          { position: 4, matches: 700 },
          { position: 3, matches: 600 },
        ],
      },
    },
  );

  expect(result.suggestions[0]?.reason).toContain("Encaja en tu posición elegida: midlane");
  expect(result.suggestions[0]?.reason).toContain("flexearse a support y offlane");
});

test("semillas distintas rotan alternativas de calidad equivalente sin volver inestable una misma partida", () => {
  const snapshot = meta({
    1: { id: 1, localizedName: "Uno" },
    2: { id: 2, localizedName: "Dos" },
    3: { id: 3, localizedName: "Tres" },
    4: { id: 4, localizedName: "Cuatro" },
    5: { id: 5, localizedName: "Cinco" },
    6: { id: 6, localizedName: "Seis" },
    7: { id: 7, localizedName: "Siete" },
    8: { id: 8, localizedName: "Ocho" },
  });
  const options = { heroPositions: {} }; // TSK-192: >6 heroes para que la diversificacion (TOP_N=6) se dispare

  const firstDraft = buildSuggestions(draftState(), snapshot, { ...options, diversitySeed: "draft-alpha" });
  const sameDraft = buildSuggestions(draftState(), snapshot, { ...options, diversitySeed: "draft-alpha" });
  const nextDraft = buildSuggestions(draftState(), snapshot, { ...options, diversitySeed: "draft-beta" });

  expect(sameDraft.suggestions.map((suggestion) => suggestion.hero)).toEqual(firstDraft.suggestions.map((suggestion) => suggestion.hero));
  expect(nextDraft.suggestions.map((suggestion) => suggestion.hero)).not.toEqual(firstDraft.suggestions.map((suggestion) => suggestion.hero));
});

describe("SCORING_WEIGHTS_V1", () => {
  test("los 4 pesos suman exactamente 1.0", () => {
    const sum = Object.values(SCORING_WEIGHTS_V1).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });
});

// TSK-023 (fase 1b, SPEC.md §9.3): las dos pruebas obligatorias del candado de regresión cero --
// no una, ambas. La segunda es el candado real: prueba que la promesa de D8 es un hecho verificado
// con números exactos, no una afirmación de comentario.
//
// TSK-045 (Fase 3, SPEC.md §10.0 punto 4): el test "con hero_pool_fit no aplicable, mixScore
// redistribuye a exactamente los pesos de V1" que vivía acá se BORRÓ a propósito, no en silencio.
// V2 *agregaba* una señal (hero_pool_fit) escalando proporcionalmente el resto, así que con la
// señal nueva inaplicable se reproducían los pesos de V1 exactos -- una propiedad real y probada.
// V4 (weights.ts) *reemplaza* dos señales (role_gap/role_safety) por una (position_fit), no hay
// ningún estado "position_fit sin configurar" que reproduzca V1 -- ese candado no existe para V4,
// no es que se nos haya olvidado escribirlo.
describe("SCORING_WEIGHTS_V2 — candado de regresión cero", () => {
  test("los 5 pesos suman exactamente 1.0", () => {
    const sum = Object.values(SCORING_WEIGHTS_V2).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  test("un héroe en el pool con winrate alto recibe un score mayor que uno idéntico fuera del pool", () => {
    const state = draftState();
    const snapshot = meta(
      { 1: { id: 1, localizedName: "En el pool" }, 2: { id: 2, localizedName: "Fuera del pool" } },
      { heroPool: [{ hero: 1, source: "calculated", personalWinrate: 0.9, personalGames: 50, updatedAt: "2026-07-29" }] },
    );

    // heroPositions:{} (S10): sin esto, los IDs 1/2 son héroes reales (Anti-Mage/Axe) con datos
    // de posición reales y distintos -- position_fit pesa MÁS que hero_pool_fit en V4 (0.25 vs
    // 0.17), así que dejaría que el archivo real decidiera esta comparación en vez de la señal que
    // el test dice estar probando.
    const result = buildSuggestions(state, snapshot, { heroPositions: {} });
    const inPool = result.suggestions.find((s) => s.hero === 1);
    const outOfPool = result.suggestions.find((s) => s.hero === 2);

    expect(inPool).toBeDefined();
    expect(outOfPool).toBeDefined();
    expect(inPool!.score).toBeGreaterThan(outOfPool!.score);
  });

  test("con el pool nunca configurado, hero_pool_fit aparece siempre en signals[] pero no baja la confianza (applicable:false != raw:null)", () => {
    const state = draftState({ picks: { radiant: [], dire: [50] } });
    const snapshot = meta(
      { 1: { id: 1, localizedName: "Candidato" }, 50: { id: 50, localizedName: "Enemigo" } },
      { matchups: { 1: [{ vsHero: 50, games: 300, wins: 280 }, { vsHero: 60, games: 300, wins: 20 }] } },
    );

    const result = buildSuggestions(state, snapshot, { heroPositions: {} });
    const suggestion = result.suggestions.find((s) => s.hero === 1);
    const poolSignal = suggestion?.signals.find((s) => s.signal === "hero_pool_fit");

    expect(poolSignal).toBeDefined();
    expect(poolSignal?.raw).toBeNull();
    expect(poolSignal?.applicable).toBe(false);
    // Con heroPositions:{} (S10) los nulls reales suben a 3 (patch_meta, team_synergy,
    // position_fit) en vez de 2 -- el resultado no cambia, computeConfidence corta a "baja" desde
    // nullCount >= 2, así que 3 nulls sigue siendo "baja" igual que 2.
    expect(suggestion?.confidence).toBe("baja");
  });
});

// TSK-027 (feedback real de producto): mismo candado que V2, ahora compuesto -- role_safety se
// suma a la lista de señales que pueden estar "fuera de juego" sin mover un punto el
// comportamiento de fase 1 para quien no usa ninguna de las dos funciones nuevas.
//
// TSK-045: los tres tests que vivían acá sobre `role_safety` (el candado doble, "support puntúa
// más que carry" y "ya no diferencia desde el pick 3") se BORRARON a propósito, no en silencio.
// `role_safety` ya no es una señal del motor -- se fusionó en `position_fit` (SPEC.md §10.0).
// La intención de producto de esos tres tests (support primero, revelar el core después) sigue
// viva y probada, ahora contra `position_fit`: ver el describe "SCORING_WEIGHTS_V4" más abajo
// (candado de regresión del bug original) y el test "adjunta comparison de punta a punta" dentro
// de `buildSuggestions`. V3 en sí queda intacta y congelada -- solo se prueba que sigue sumando 1.0.
describe("SCORING_WEIGHTS_V3 (congelada)", () => {
  test("los 6 pesos suman exactamente 1.0", () => {
    const sum = Object.values(SCORING_WEIGHTS_V3).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });
});

// TSK-045 (Fase 3, SPEC.md §10.3): el candado de regresión del bug que originó la fase 3 vivía
// acá. Auditoría 2026-08-22: V4 quedó congelada (weights.ts) porque su propio peso de
// `position_fit` resultó insuficiente frente a un core con counter real -- mismo patrón que el
// bug original, un nivel más adelante. Los tests de comportamiento se movieron al bloque de V5
// (abajo); acá solo queda el candado de que V4 siga sumando 1.0, igual que V1/V2/V3.
describe("SCORING_WEIGHTS_V4 (congelada)", () => {
  test("los 5 pesos suman exactamente 1.0", () => {
    const sum = Object.values(SCORING_WEIGHTS_V4).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });
});

// Auditoría 2026-08-22 (Lead ML Engineer / Domain Systems Architect): con RAW_RANGE.counter ya
// recalibrado, un core que repite un rol cubierto pero tiene un counter real (delta ~0.08) casi
// empataba con el support que llena la posición faltante bajo V4 (margen ~1.5 puntos) -- la
// prioridad de rol dejó de ser confiable. `position_fit` sube de 0.25 a 0.38; `counter` baja de
// 0.27 a 0.24 (no se anula: sigue pudiendo decidir un empate); el resto baja proporcionalmente.
// SCORING_WEIGHTS_V5 es la constante activa (mix.ts) de acá en adelante.
describe("SCORING_WEIGHTS_V5 — candado de dominancia de posición sobre comodidad/matchup", () => {
  test("los 5 pesos suman exactamente 1.0", () => {
    const sum = Object.values(SCORING_WEIGHTS_V5).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  // Mismos héroes y mismos números reales que position-fit.test.ts (Escenario A, SPEC.md §10.5)
  // -- fixture propio, nunca el hero-positions.json real (S10).
  const SPECTRE = 67;
  const WRAITH_KING = 42;
  const ANTI_MAGE = 1;
  const CRYSTAL_MAIDEN = 5;
  const PUDGE = 14;
  const DAZZLE = 50;
  const ORACLE = 111;

  const HERO_POSITIONS: HeroPositions = {
    [SPECTRE]: [{ position: 1, matches: 4476 }],
    [WRAITH_KING]: [
      { position: 3, matches: 593 },
      { position: 1, matches: 415 },
    ],
    [ANTI_MAGE]: [{ position: 1, matches: 1409 }],
    [CRYSTAL_MAIDEN]: [
      { position: 5, matches: 2507 },
      { position: 4, matches: 520 },
    ],
    [PUDGE]: [
      { position: 4, matches: 4123 },
      { position: 5, matches: 2795 },
      { position: 3, matches: 2387 },
      { position: 2, matches: 540 },
    ],
    [DAZZLE]: [{ position: 5, matches: 1386 }],
    [ORACLE]: [
      { position: 5, matches: 1946 },
      { position: 4, matches: 233 },
    ],
  };

  test("mixScore redistribuye proporcionalmente entre las señales con dato real (candado de mecanismo, no de 'reproduce V4')", () => {
    // Números elegidos para que cada raw normalice a un valor distinto y verificable a mano:
    // counter->100 (tope de su rango), patch_meta->0 (piso), team_synergy->50, position_fit->75.
    // hero_pool_fit excluida (applicable:false) -- no vota, no se cuenta en totalWeight.
    const signals: SignalContribution[] = [
      { signal: "counter", raw: 0.3, weighted: 0, explanation: "", sampleSize: 10 },
      { signal: "patch_meta", raw: 0.3, weighted: 0, explanation: "", sampleSize: 10 },
      { signal: "team_synergy", raw: 0.5, weighted: 0, explanation: "", sampleSize: 0 },
      { signal: "position_fit", raw: 0.75, weighted: 0, explanation: "", sampleSize: 0 },
      { signal: "hero_pool_fit", raw: null, weighted: 0, explanation: "", sampleSize: 0, applicable: false },
    ];

    const score = mixScore(signals);

    const totalWeight =
      SCORING_WEIGHTS_V5.counter + SCORING_WEIGHTS_V5.patch_meta + SCORING_WEIGHTS_V5.team_synergy + SCORING_WEIGHTS_V5.position_fit;
    const expected =
      (100 * SCORING_WEIGHTS_V5.counter + 0 * SCORING_WEIGHTS_V5.patch_meta + 50 * SCORING_WEIGHTS_V5.team_synergy + 75 * SCORING_WEIGHTS_V5.position_fit) /
      totalWeight;
    expect(score).toBeCloseTo(expected, 10);
  });

  test("Spectre pickeado del lado propio + Wraith King disponible: Wraith King no aparece en el top 3", () => {
    const state = draftState({ picks: { radiant: [SPECTRE], dire: [] } });
    const snapshot = meta({
      [WRAITH_KING]: { id: WRAITH_KING, localizedName: "Wraith King" },
      [ANTI_MAGE]: { id: ANTI_MAGE, localizedName: "Anti-Mage" },
      [CRYSTAL_MAIDEN]: { id: CRYSTAL_MAIDEN, localizedName: "Crystal Maiden" },
      [PUDGE]: { id: PUDGE, localizedName: "Pudge" },
      [DAZZLE]: { id: DAZZLE, localizedName: "Dazzle" },
      [ORACLE]: { id: ORACLE, localizedName: "Oracle" },
    });

    // heroCapabilities:[] (S9, TSK-069): con Spectre pickeado del lado propio, team_synergy ya no
    // es null -- sin esto, el archivo real de capabilities.json decidiría parte de esta
    // comparación en vez de dejarla 100% en manos de position_fit, que es la señal que este test
    // dice estar probando (mismo criterio que heroPositions:{} en los tests de arriba).
    const result = buildSuggestions(state, snapshot, { heroPositions: HERO_POSITIONS, heroCapabilities: [] });

    // TSK-192: el Copilot muestra 6; el candado de Fase 3 es que WK (repite rol ya cubierto) no
    // se PROMUEVE -- se verifica contra el top 3, no contra la lista extendida.
    const top3Heroes = result.suggestions.slice(0, 3).map((s) => s.hero);
    expect(top3Heroes).not.toContain(WRAITH_KING);
  });

  test("buildSuggestions sin heroPositions en las opciones sigue funcionando (carga el archivo real, S10 criterio 4)", () => {
    const state = draftState();
    const snapshot = meta({
      1: { id: 1, localizedName: "A" },
      2: { id: 2, localizedName: "B" },
      3: { id: 3, localizedName: "C" },
      4: { id: 4, localizedName: "D" },
    });

    expect(() => buildSuggestions(state, snapshot)).not.toThrow();
    const result = buildSuggestions(state, snapshot);
    expect(result.suggestions.length).toBeLessThanOrEqual(6); // TSK-192
    for (const suggestion of result.suggestions) {
      expect(suggestion.signals.some((s) => s.signal === "position_fit")).toBe(true);
    }
  });

  // Auditoría 2026-08-22, Tarea 2: el escenario adversarial exacto que motivó V5. Opción A llena
  // la posición que le falta al equipo pero está fuera del pool del usuario; Opción B repite un
  // rol que el equipo ya tiene cubierto pero trae un counter real (delta 0.08, ya recalibrado) y
  // está dentro del pool. Calculado a mano contra la fórmula real de mixScore antes de escribir
  // este test: A ≈ 58.9, B ≈ 40.7, margen ≈ 18.2 -- criterio de aceptación: al menos 15 puntos.
  test("llenar la posición faltante le gana a repetir rol con counter real + comodidad de pool, por al menos 15 puntos", () => {
    const optionA_fillsNeededPosition_outOfPool: SignalContribution[] = [
      { signal: "patch_meta", raw: 0.45, weighted: 0, explanation: "", sampleSize: 500 },
      { signal: "team_synergy", raw: 0.4, weighted: 0, explanation: "", sampleSize: 0 },
      { signal: "hero_pool_fit", raw: 0.2, weighted: 0, explanation: "Fuera de tu pool de héroes", sampleSize: 0, applicable: true },
      { signal: "position_fit", raw: 0.85, weighted: 0, explanation: "", sampleSize: 2000 },
      // counter: sin dato registrado para este candidato (raw: null) -- se excluye, no vota.
    ];
    const optionB_repeatsRole_realCounter_inPool: SignalContribution[] = [
      { signal: "counter", raw: 0.08, weighted: 0, explanation: "", sampleSize: 300 },
      { signal: "patch_meta", raw: 0.54, weighted: 0, explanation: "", sampleSize: 500 },
      { signal: "team_synergy", raw: 0.2, weighted: 0, explanation: "", sampleSize: 0 },
      { signal: "hero_pool_fit", raw: 0.7, weighted: 0, explanation: "En tu pool", sampleSize: 200, applicable: true },
      { signal: "position_fit", raw: 0.05, weighted: 0, explanation: "", sampleSize: 2000 },
    ];

    const scoreA = mixScore(optionA_fillsNeededPosition_outOfPool);
    const scoreB = mixScore(optionB_repeatsRole_realCounter_inPool);

    expect(scoreA - scoreB).toBeGreaterThan(15);
  });
});

// TSK-180 (Fase 4.2, SPEC.md §11.13.5 / §11.13.8): `archetype_fit` entra como 6ª señal ponderada.
// SCORING_WEIGHTS_V6 = V5 × 0.90 + archetype_fit 0.10. Candado de regresión cero del tipo V1→V2 de
// 1b (V6 *agrega* una señal con estado "no configurada"), no el de V4→V5.
describe("SCORING_WEIGHTS_V6 — archetype_fit integrado (candado de regresión cero + sensibilidad)", () => {
  const NAT_PROPHET = 1; // structuralDamage high, scaling low
  const ANTI_MAGE = 2; // structuralDamage low, scaling high
  const MID = 3; // structuralDamage medium, scaling medium
  const CAPS: HeroCapabilities[] = [
    { hero: NAT_PROPHET, damageType: "magical", hasInitiation: false, hasCatch: false, hasWaveclear: true, structuralDamage: "high", teamfight: "low", scaling: "low" },
    { hero: ANTI_MAGE, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: true, structuralDamage: "low", teamfight: "low", scaling: "high" },
    { hero: MID, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: true, structuralDamage: "medium", teamfight: "low", scaling: "medium" },
  ];
  const THREE_HEROES: Record<number, MetaHeroInfo> = {
    [NAT_PROPHET]: { id: NAT_PROPHET, localizedName: "Nature's Prophet" },
    [ANTI_MAGE]: { id: ANTI_MAGE, localizedName: "Anti-Mage" },
    [MID]: { id: MID, localizedName: "Neutro" },
  };

  test("los 6 pesos suman exactamente 1.0", () => {
    const sum = Object.values(SCORING_WEIGHTS_V6).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  test("position_fit sigue siendo el mayor peso de V6 (Fase 3 no se reabre)", () => {
    const max = Math.max(...Object.values(SCORING_WEIGHTS_V6));
    expect(SCORING_WEIGHTS_V6.position_fit).toBe(max);
  });

  // Candado de regresión cero, con números exactos (SPEC.md §11.13.5): con archetype_fit sin voto
  // (applicable: false), mixScore con V6 reproduce el mismo número que la redistribución de V5.
  test("sin intención, mixScore reproduce la redistribución de V5 al bit", () => {
    const signals: SignalContribution[] = [
      { signal: "counter", raw: 0.12, weighted: 0, explanation: "", sampleSize: 0 }, // -> 100
      { signal: "patch_meta", raw: 0.3, weighted: 0, explanation: "", sampleSize: 0 }, // -> 0
      { signal: "team_synergy", raw: 0.5, weighted: 0, explanation: "", sampleSize: 0 }, // -> 50
      { signal: "hero_pool_fit", raw: 0.8, weighted: 0, explanation: "", sampleSize: 0 }, // -> 80
      { signal: "position_fit", raw: 0.75, weighted: 0, explanation: "", sampleSize: 0 }, // -> 75
      { signal: "archetype_fit", raw: null, weighted: 0, applicable: false, explanation: "", sampleSize: 0 },
    ];
    const norm = { counter: 100, patch_meta: 0, team_synergy: 50, hero_pool_fit: 80, position_fit: 75 } as const;
    const totalV5 =
      SCORING_WEIGHTS_V5.counter + SCORING_WEIGHTS_V5.patch_meta + SCORING_WEIGHTS_V5.team_synergy + SCORING_WEIGHTS_V5.hero_pool_fit + SCORING_WEIGHTS_V5.position_fit;
    const expected =
      (norm.counter * SCORING_WEIGHTS_V5.counter +
        norm.patch_meta * SCORING_WEIGHTS_V5.patch_meta +
        norm.team_synergy * SCORING_WEIGHTS_V5.team_synergy +
        norm.hero_pool_fit * SCORING_WEIGHTS_V5.hero_pool_fit +
        norm.position_fit * SCORING_WEIGHTS_V5.position_fit) /
      totalV5;
    expect(mixScore(signals)).toBeCloseTo(expected, 10);
  });

  // Candado de sensibilidad contra buildSuggestions COMPLETO (SPEC.md §11.13.8 crit. 3), no la
  // señal aislada: con intención el top-1 cambia, y "scaling" invierte "push". Sin esta prueba,
  // una implementación que ignore `intent` pasaría el resto y seguiría rota (hallazgo tipo TSK-036).
  test("archetypeIntent inclina el top-3 y 'scaling' invierte 'push'", () => {
    const base = { heroPositions: {} as HeroPositions, heroCapabilities: CAPS };
    const push = buildSuggestions(draftState(), meta(THREE_HEROES), { ...base, archetypeIntent: "push" });
    const scaling = buildSuggestions(draftState(), meta(THREE_HEROES), { ...base, archetypeIntent: "scaling" });
    expect(push.suggestions[0]?.hero).toBe(NAT_PROPHET);
    expect(scaling.suggestions[0]?.hero).toBe(ANTI_MAGE);
  });

  test("archetype_fit aparece en signals[]: applicable:false sin intención, número con intención", () => {
    const base = { heroPositions: {} as HeroPositions, heroCapabilities: CAPS };
    const noIntent = buildSuggestions(draftState(), meta(THREE_HEROES), base);
    const withIntent = buildSuggestions(draftState(), meta(THREE_HEROES), { ...base, archetypeIntent: "push" });
    const sNo = noIntent.suggestions[0]?.signals.find((s) => s.signal === "archetype_fit");
    const sYes = withIntent.suggestions.find((s) => s.hero === NAT_PROPHET)?.signals.find((s) => s.signal === "archetype_fit");
    expect(sNo?.raw).toBeNull();
    expect(sNo?.applicable).toBe(false);
    expect(typeof sYes?.raw).toBe("number");
  });
});

// Auditoría 2026-08-22: candado de regresión para la recalibración de RAW_RANGE.counter
// ([-0.3, 0.3] -> [-0.12, 0.12]). Antes de este cambio, un hard counter real (delta ~0.08) perdía
// contra un héroe simplemente popular sin ventaja de matchup (patch_meta alto) -- confirmado por
// cálculo, no solo sospechado (ver auditoría, mixScore aislado sin position_fit/team_synergy/
// hero_pool_fit de por medio). Este test fija el comportamiento correcto de forma permanente.
describe("RAW_RANGE.counter recalibrado -- counter ya no queda ahogado por patch_meta", () => {
  test("hard counter real (delta 0.08) le gana a un héroe popular sin ventaja de matchup (patch_meta 0.58)", () => {
    const heroA: SignalContribution[] = [
      { signal: "counter", raw: 0.08, weighted: 0, explanation: "", sampleSize: 300 },
      { signal: "patch_meta", raw: 0.5, weighted: 0, explanation: "", sampleSize: 500 },
    ];
    const heroB: SignalContribution[] = [
      { signal: "counter", raw: 0.0, weighted: 0, explanation: "", sampleSize: 300 },
      { signal: "patch_meta", raw: 0.58, weighted: 0, explanation: "", sampleSize: 500 },
    ];

    expect(mixScore(heroA)).toBeGreaterThan(mixScore(heroB));
  });
});

// TSK-186 (Fase 8, SPEC.md §14.5 / §14.7-2 / §14.10-2): `counter` deja de ser singleton de
// módulo y se ensambla por llamada con la capa curada inyectable (`heroCounters`), mismo patrón
// que position_fit/team_synergy/archetype_fit.
describe("Fase 8 -- counter cableado como scorer por llamada (candado de pipeline)", () => {
  const OPTS = { heroPositions: {} as HeroPositions, heroCapabilities: [] as HeroCapabilities[] };

  test("heroCounters vacío es un no-op: mismo ranking y counter sigue en raw:null (§14.7-2)", () => {
    // Earthshaker (7) revelado del rival, ningún par curado entre estos héroes, matchups:{} ->
    // la capa estadística tampoco tiene dato: counter es raw:null igual que antes de Fase 8.
    const state = draftState({ picks: { radiant: [], dire: [7] } });
    const snapshot = meta({
      5: { id: 5, localizedName: "Crystal Maiden" },
      31: { id: 31, localizedName: "Lich" },
      50: { id: 50, localizedName: "Dazzle" },
    });

    const withEmpty = buildSuggestions(state, snapshot, { ...OPTS, heroCounters: new Map() });
    const withRealFile = buildSuggestions(state, snapshot, OPTS); // carga hero-counters.json real

    expect(withEmpty.suggestions.map((s) => s.hero)).toEqual(withRealFile.suggestions.map((s) => s.hero));
    for (const suggestion of withEmpty.suggestions) {
      expect(suggestion.signals.find((s) => s.signal === "counter")?.raw).toBeNull();
    }
  });

  test("un hard counter curado reordena el top del pipeline completo (§14.10-3, no la señal aislada)", () => {
    const HUSKAR = 59;
    const ANCIENT_APPARITION = 68;
    const state = draftState({ picks: { radiant: [], dire: [ANCIENT_APPARITION] } });
    const snapshot = meta({
      [HUSKAR]: { id: HUSKAR, localizedName: "Huskar" },
      31: { id: 31, localizedName: "Lich" },
    });

    const neutral = buildSuggestions(state, snapshot, { ...OPTS, heroCounters: new Map() });
    const withCounter = buildSuggestions(state, snapshot, {
      ...OPTS,
      heroCounters: new Map([
        [HUSKAR, [{ vs: ANCIENT_APPARITION, level: "hard" as const, why: "Ice Blast bloquea toda tu curación" }]],
      ]),
    });

    const huskarNeutral = neutral.suggestions.find((s) => s.hero === HUSKAR)!;
    const huskarCountered = withCounter.suggestions.find((s) => s.hero === HUSKAR)!;

    expect(huskarNeutral.signals.find((s) => s.signal === "counter")?.raw).toBeNull();
    expect(huskarCountered.signals.find((s) => s.signal === "counter")?.raw).toBeCloseTo(-0.12, 10);
    expect(huskarCountered.score).toBeLessThan(huskarNeutral.score);
  });
});

// TSK-032: feedback real de producto ("no veo la explicación de porque es bueno el draft frente
// al otro") -- comparación explícita entre el pick #1 y el #2, aislada de buildSuggestions con
// fixtures directos (mismo criterio que mixScore: más preciso que reconstruirlo indirectamente).
//
// R0.3 / Task 13 (CP2): `buildComparison` ahora deriva `delta` de la contribución `weighted` REAL
// (fuente única `StateWeightedContribution`, proyectada en `Suggestion.signals`), NO de un
// `weightedContributions` recalculado aparte. Los fixtures fijan `weighted` = lo que la mezcla por
// estado habría producido; `raw` sigue gateando la comparabilidad (dato real en AMBOS lados) y el
// #1 debe aportar (`weighted > 0`, CP4).
describe("buildComparison", () => {
  test("identifica la señal con mayor ventaja del #1 sobre el #2, ignorando una señal empatada", () => {
    const top = fixtureSuggestion(1, 1, [
      { signal: "counter", raw: 0.3, weighted: 40, explanation: "", sampleSize: 10 },
      { signal: "patch_meta", raw: 0.5, weighted: 20, explanation: "", sampleSize: 10 }, // igual en ambos
    ]);
    const second = fixtureSuggestion(2, 2, [
      { signal: "counter", raw: -0.3, weighted: 5, explanation: "", sampleSize: 10 },
      { signal: "patch_meta", raw: 0.5, weighted: 20, explanation: "", sampleSize: 10 },
    ]);

    const comparison = buildComparison([top, second]);

    expect(comparison).not.toBeNull();
    expect(comparison?.vsHero).toBe(2);
    expect(comparison?.signal).toBe("counter");
    expect(comparison?.delta).toBeCloseTo(35, 10); // 40 - 5, diferencia de `weighted` reales
  });

  test("una señal con raw:null de un solo lado nunca es candidata, aunque su weighted favorezca al #1", () => {
    const top = fixtureSuggestion(1, 1, [
      { signal: "counter", raw: 0.3, weighted: 30, explanation: "", sampleSize: 10 },
      { signal: "position_fit", raw: 1, weighted: 45, explanation: "", sampleSize: 0 }, // solo el #1 tiene dato
    ]);
    const second = fixtureSuggestion(2, 2, [
      { signal: "counter", raw: -0.3, weighted: 8, explanation: "", sampleSize: 10 },
      { signal: "position_fit", raw: null, weighted: 20, explanation: "", sampleSize: 0 }, // μ-fill: raw sigue null
    ]);

    const comparison = buildComparison([top, second]);

    // position_fit no es comparable (raw:null del lado del #2, aunque tenga weighted por μ) --
    // counter es la única señal con dato real en ambos lados.
    expect(comparison?.signal).toBe("counter");
  });

  test("una señal con applicable:false de un lado tampoco es comparable", () => {
    const top = fixtureSuggestion(1, 1, [
      { signal: "counter", raw: 0.3, weighted: 30, explanation: "", sampleSize: 10 },
      { signal: "hero_pool_fit", raw: 0.8, weighted: 25, explanation: "", sampleSize: 0 },
    ]);
    const second = fixtureSuggestion(2, 2, [
      { signal: "counter", raw: -0.3, weighted: 8, explanation: "", sampleSize: 10 },
      { signal: "hero_pool_fit", raw: null, weighted: 0, explanation: "", sampleSize: 0, applicable: false },
    ]);

    const comparison = buildComparison([top, second]);

    expect(comparison?.signal).toBe("counter");
  });

  test("empate exacto en todas las señales comparables -> null, nunca se inventa una comparación", () => {
    const signals: SignalContribution[] = [{ signal: "counter", raw: 0.1, weighted: 30, explanation: "", sampleSize: 10 }];
    const top = fixtureSuggestion(1, 1, signals);
    const second = fixtureSuggestion(2, 2, signals);

    expect(buildComparison([top, second])).toBeNull();
  });

  test("una señal citada en comparison tiene weighted > 0 en el #1 (CP4)", () => {
    // #1 tiene counter con weighted 0 (raw negativo -> normalizó a 0): no puede ser la ventaja.
    const top = fixtureSuggestion(1, 1, [
      { signal: "counter", raw: -0.3, weighted: 0, explanation: "", sampleSize: 10 },
      { signal: "position_fit", raw: 0.6, weighted: 22, explanation: "", sampleSize: 0 },
    ]);
    const second = fixtureSuggestion(2, 2, [
      { signal: "counter", raw: -0.3, weighted: 0, explanation: "", sampleSize: 10 },
      { signal: "position_fit", raw: 0.2, weighted: 10, explanation: "", sampleSize: 0 },
    ]);

    const comparison = buildComparison([top, second]);

    expect(comparison?.signal).toBe("position_fit"); // counter (weighted 0) nunca se cita
    expect(comparison?.delta).toBeCloseTo(12, 10);
  });

  test("con menos de 2 sugerencias, no hay comparación", () => {
    const only = fixtureSuggestion(1, 1, [{ signal: "counter", raw: 0.3, weighted: 30, explanation: "", sampleSize: 10 }]);

    expect(buildComparison([only])).toBeNull();
    expect(buildComparison([])).toBeNull();
  });
});

describe("buildSuggestions", () => {
  test("candidatos excluyen baneados y ya elegidos de ambos lados", () => {
    const state = draftState({ banned: [2], picks: { radiant: [3], dire: [4] } });
    const snapshot = meta({
      1: { id: 1, localizedName: "A" },
      2: { id: 2, localizedName: "B" },
      3: { id: 3, localizedName: "C" },
      4: { id: 4, localizedName: "D" },
    });

    const result = buildSuggestions(state, snapshot);

    const suggestedHeroes = result.suggestions.map((s) => s.hero);
    expect(suggestedHeroes).toEqual([1]);
  });

  // TSK-210 (Fase 9.1, §16.7 E7 / AC1 bullet 2): candado de regresión cero al nivel de
  // `buildSuggestions`. Con `_legacyMixMode` el motor vuelve a la redistribución candidate-specific
  // de V6 -- mismo score exacto, mismo `confidence` por conteo de nulls, byte a byte.
  test("_legacyMixMode: señal en null redistribuye proporcionalmente (candado de regresión cero de V6)", () => {
    // Equipo propio vacío -> team_synergy null. Sin patchStats -> patch_meta null. Sin heroPool ->
    // hero_pool_fit no aplicable. position_fit vota (hero 1 carry puro, raw 0.5 -> norm 50).
    // counter: delta 0.4333 clamp a 0.12 -> norm 100. Score = redistribución de V6 (= ratio de V5,
    // el factor 0.90 se cancela) sobre las 2 señales con dato.
    const state = draftState({ picks: { radiant: [], dire: [50] } });
    const snapshot = meta({
      1: { id: 1, localizedName: "Candidato" },
      50: { id: 50, localizedName: "Enemigo" },
    }, {
      matchups: {
        1: [
          { vsHero: 50, games: 300, wins: 280 },
          { vsHero: 60, games: 300, wins: 20 },
        ],
      },
    });
    const heroPositions: HeroPositions = { 1: [{ position: 1, matches: 1000 }] };

    const result = buildSuggestions(state, snapshot, { heroPositions, _legacyMixMode: true });
    const suggestion = result.suggestions.find((s) => s.hero === 1);

    expect(suggestion).toBeDefined();
    const totalWeight = SCORING_WEIGHTS_V5.counter + SCORING_WEIGHTS_V5.position_fit;
    const expectedScore = (100 * SCORING_WEIGHTS_V5.counter + 50 * SCORING_WEIGHTS_V5.position_fit) / totalWeight;
    expect(suggestion?.score).toBeCloseTo(expectedScore, 5);
    expect(suggestion?.confidence).toBe("baja"); // legacy: 2 señales en null (patch_meta, team_synergy)
    const nonNullSignals = suggestion?.signals.filter((s) => s.raw !== null) ?? [];
    expect(nonNullSignals.map((s) => s.signal).sort()).toEqual(["counter", "position_fit"]);
  });

  // TSK-210 (Fase 9.1, §16.7): el mismo estado por el camino ACTIVO (mezcla por estado). Con
  // EMPTY_CAL, `calibratedNormalize` cae a RAW_RANGE, así que las 2 señales de A(S) normalizan
  // igual que en legacy -> el score numérico coincide. Lo que cambia: patch_meta/team_synergy ya
  // no "cuentan como null" (están fuera de A(S)), así que la cobertura es total.
  test("mezcla por estado: A(S) excluye las señales inaplicables, no las trata como null penalizador", () => {
    const state = draftState({ picks: { radiant: [], dire: [50] } });
    const snapshot = meta({
      1: { id: 1, localizedName: "Candidato" },
      50: { id: 50, localizedName: "Enemigo" },
    }, {
      matchups: { 1: [{ vsHero: 50, games: 300, wins: 280 }, { vsHero: 60, games: 300, wins: 20 }] },
    });
    const heroPositions: HeroPositions = { 1: [{ position: 1, matches: 1000 }] };

    const result = buildSuggestions(state, snapshot, { heroPositions, calibration: EMPTY_CAL });
    const suggestion = result.suggestions.find((s) => s.hero === 1);

    expect(suggestion).toBeDefined();
    // A(S) = {counter, position_fit}: denominador de V6 sobre esas dos. counter -> 100, pf -> 50.
    const denom = SCORING_WEIGHTS_V6.counter + SCORING_WEIGHTS_V6.position_fit;
    const expectedScore = (100 * SCORING_WEIGHTS_V6.counter + 50 * SCORING_WEIGHTS_V6.position_fit) / denom;
    expect(suggestion?.score).toBeCloseTo(expectedScore, 5);
    // Ambas señales de A(S) tienen dato -> cobertura total, sin adivinar.
    expect(suggestion?.evidenceCoverage).toBeCloseTo(1, 10);
    expect(suggestion?.guessingIndex).toBeCloseTo(0, 10);
    expect(suggestion?.confidence).toBe("alta");
    // patch_meta / team_synergy siguen en el desglose con raw:null (nunca se les escribe μ en raw).
    const patchMeta = suggestion?.signals.find((s) => s.signal === "patch_meta");
    expect(patchMeta?.raw).toBeNull();
    expect(patchMeta?.weighted).toBe(0); // fuera de A(S) -> contribución 0, no w'·μ
  });

  test("Suggestion.reason es trazable a los signals de esa sugerencia", () => {
    const state = draftState({ picks: { radiant: [], dire: [50] } });
    const snapshot = meta(
      { 1: { id: 1, localizedName: "Candidato" }, 50: { id: 50, localizedName: "Enemigo" } },
      { matchups: { 1: [{ vsHero: 50, games: 300, wins: 280 }, { vsHero: 60, games: 300, wins: 20 }] } },
    );
    const heroPositions: HeroPositions = { 1: [{ position: 1, matches: 1000 }] };

    const result = buildSuggestions(state, snapshot, { heroPositions });
    const suggestion = result.suggestions[0];

    // buildReason muestra las 2 señales de mayor peso con dato real, no todas -- con solo 2
    // señales reales acá (counter/position_fit, ver test anterior), ambas entran.
    const topTwoByWeight = (suggestion?.signals.filter((s) => s.raw !== null) ?? [])
      .sort((a, b) => SCORING_WEIGHTS_V6[b.signal] - SCORING_WEIGHTS_V6[a.signal])
      .slice(0, 2);
    for (const signal of topTwoByWeight) {
      expect(suggestion?.reason).toContain(signal.explanation);
    }
  });

  test("computedInMs queda bajo 300ms en el caso normal (~130 héroes candidatos)", () => {
    const heroes: Record<number, MetaHeroInfo> = {};
    for (let id = 1; id <= 130; id++) heroes[id] = { id, localizedName: `Hero ${id}`, roles: ["Carry"] };
    const state = draftState();
    const snapshot = meta(heroes);

    const result = buildSuggestions(state, snapshot);

    expect(result.computedInMs).toBeLessThan(300);
    expect(result.suggestions.length).toBeLessThanOrEqual(6); // TSK-192
  });

  test("sin candidatos válidos -> suggestions: [] sin lanzar (nunca un error del sistema)", () => {
    const state = draftState({ picks: { radiant: [1], dire: [] } });
    const snapshot = meta({ 1: { id: 1, localizedName: "Único héroe, ya elegido" } });

    expect(() => buildSuggestions(state, snapshot)).not.toThrow();
    expect(buildSuggestions(state, snapshot).suggestions).toEqual([]);
  });


  test("CP7 RED: sin se?ales votantes no debe fabricar un ranking", () => {
    const state = draftState({ localSide: "unknown" });
    const snapshot = meta({
      1: { id: 1, localizedName: "Primero" },
      2: { id: 2, localizedName: "Segundo" },
    });

    expect(votingSignals(state, snapshot, { heroPositions: {}, heroCapabilities: [] }).size).toBe(0);
    expect(buildSuggestions(state, snapshot, { heroPositions: {}, heroCapabilities: [] }).suggestions).toEqual([]);
  });
  test("degraded incluye unknown_format y unconfirmed_state cuando aplica", () => {
    const state = draftState({ format: "unknown", quality: { unconfirmed: [1], captureStatus: "ok" } });
    const snapshot = meta({ 1: { id: 1, localizedName: "A" } });

    const result = buildSuggestions(state, snapshot);

    expect(result.degraded).toContain("unknown_format");
    expect(result.degraded).toContain("unconfirmed_state");
  });

  // TSK-045: reemplaza el test "support-vs-carry (TSK-027), role_safety es la señal decisiva".
  // La intención de producto original (TSK-027: primer pick, support antes que carry) se conserva
  // completa -- lo que cambia es el mecanismo. Antes lo decidía `role_safety` por una ventana dura
  // de 2 picks; ahora lo decide `position_fit` de forma continua (TIMING_BLEND), fusionada con la
  // cobertura de rol (SPEC.md §10.0).
  test("adjunta comparison de punta a punta: primer pick, un support puntúa más que un carry vía position_fit", () => {
    const state = draftState({ picks: { radiant: [], dire: [] } });
    const snapshot = meta({
      1: { id: 1, localizedName: "Support-like" },
      2: { id: 2, localizedName: "Carry-like" },
    });
    const heroPositions: HeroPositions = {
      1: [{ position: 5, matches: 1000 }], // hard support puro
      2: [{ position: 1, matches: 1000 }], // carry puro
    };

    const result = buildSuggestions(state, snapshot, { heroPositions });
    const support = result.suggestions.find((s) => s.hero === 1);

    expect(support?.rank).toBe(1);
    expect(result.comparison).not.toBeNull();
    expect(result.comparison?.vsHero).toBe(2);
    expect(result.comparison?.signal).toBe("position_fit");
    expect(result.comparison?.delta).toBeGreaterThan(0);
  });

  test("sin candidatos válidos, comparison también es null (no solo suggestions vacío)", () => {
    const state = draftState({ picks: { radiant: [1], dire: [] } });
    const snapshot = meta({ 1: { id: 1, localizedName: "Único héroe, ya elegido" } });

    expect(buildSuggestions(state, snapshot).comparison).toBeNull();
  });

  test("meta.isStale -> degraded incluye stale_meta y confidence nunca es 'alta'", () => {
    const state = draftState({ picks: { radiant: [], dire: [50] } });
    const snapshot = meta(
      { 1: { id: 1, localizedName: "Candidato" }, 50: { id: 50, localizedName: "Enemigo" } },
      { matchups: { 1: [{ vsHero: 50, games: 300, wins: 280 }, { vsHero: 60, games: 300, wins: 20 }] } },
    );

    const result = buildSuggestions(state, snapshot, { metaIsStale: true, heroPositions: {} });

    expect(result.degraded).toContain("stale_meta");
    expect(result.suggestions.every((s) => s.confidence !== "alta")).toBe(true);
  });
});

// ============================================================================
// TSK-210 (Fase 9.1, SPEC.md §16.7-§16.8): mezcla por estado -- A(S), redistribución por estado,
// μᵢ(S), EvidenceCoverage/GuessingIndex, calibración empírica cableada.
// ============================================================================
describe("TSK-210 -- mezcla por estado (Fase 9.1)", () => {
  const CARRY_POS: HeroPositions = { 1: [{ position: 1, matches: 1000 }], 2: [{ position: 1, matches: 1000 }], 3: [{ position: 1, matches: 1000 }] };

  // Fixture con enemigo revelado (50) -> counter entra en A(S). Sin picks propios -> team_synergy
  // fuera. Sin heroPool -> hero_pool_fit fuera. Sin intención -> archetype_fit fuera.
  function stateWithEnemy() {
    return draftState({ picks: { radiant: [], dire: [50] } });
  }

  test("AC1 -- mixScore aislado sigue reproduciendo V6 exacto (candado E7 al nivel de la función)", () => {
    const signals: SignalContribution[] = [
      { signal: "counter", raw: 0.12, weighted: 0, explanation: "", sampleSize: 0 }, // -> 100
      { signal: "position_fit", raw: 0.5, weighted: 0, explanation: "", sampleSize: 0 }, // -> 50
    ];
    const denom = SCORING_WEIGHTS_V6.counter + SCORING_WEIGHTS_V6.position_fit;
    const expected = (100 * SCORING_WEIGHTS_V6.counter + 50 * SCORING_WEIGHTS_V6.position_fit) / denom;
    expect(mixScore(signals)).toBeCloseTo(expected, 10);
  });

  test("AC2 -- μᵢ(S): un candidato sin counter recibe w'·μ (no 0, no excluido); su raw sigue null", () => {
    const snapshot = meta(
      { 1: { id: 1, localizedName: "Con matchup" }, 2: { id: 2, localizedName: "Sin matchup" }, 50: { id: 50, localizedName: "Enemigo" } },
      { matchups: { 1: [{ vsHero: 50, games: 300, wins: 210 }, { vsHero: 60, games: 300, wins: 150 }] } }, // solo el 1 tiene dato vs 50
    );

    const result = buildSuggestions(stateWithEnemy(), snapshot, { heroPositions: CARRY_POS, heroCounters: new Map(), calibration: EMPTY_CAL });
    const s1 = result.suggestions.find((s) => s.hero === 1)!;
    const s2 = result.suggestions.find((s) => s.hero === 2)!;
    const c1 = s1.signals.find((s) => s.signal === "counter")!;
    const c2 = s2.signals.find((s) => s.signal === "counter")!;

    // A(S) = {counter, position_fit}. w'_counter sobre ese denominador.
    const wCounter = SCORING_WEIGHTS_V6.counter / (SCORING_WEIGHTS_V6.counter + SCORING_WEIGHTS_V6.position_fit);
    // μ_counter = normalized del único candidato con dato (el 1).
    const muCounter = c1.normalized as number;

    expect(c1.raw).not.toBeNull();
    expect(c2.raw).toBeNull(); // el hueco de datos NO se rellena en raw
    expect(c2.weighted).toBeCloseTo(wCounter * muCounter, 8); // se rellena en weighted vía μ
    expect(c2.weighted).toBeGreaterThan(0);
  });

  test("AC3 -- EvidenceCoverage: cobertura total -> 1; parcial -> w' de la señal con dato", () => {
    const snapshot = meta(
      { 1: { id: 1, localizedName: "Full" }, 2: { id: 2, localizedName: "Parcial" }, 50: { id: 50, localizedName: "Enemigo" } },
      { matchups: { 1: [{ vsHero: 50, games: 300, wins: 210 }, { vsHero: 60, games: 300, wins: 150 }] } },
    );

    const result = buildSuggestions(stateWithEnemy(), snapshot, { heroPositions: CARRY_POS, heroCounters: new Map(), calibration: EMPTY_CAL });
    const s1 = result.suggestions.find((s) => s.hero === 1)!;
    const s2 = result.suggestions.find((s) => s.hero === 2)!;

    const denom = SCORING_WEIGHTS_V6.counter + SCORING_WEIGHTS_V6.position_fit;
    const wPosition = SCORING_WEIGHTS_V6.position_fit / denom;

    expect(s1.evidenceCoverage).toBeCloseTo(1, 10); // counter + position_fit, ambas con dato
    expect(s1.guessingIndex).toBeCloseTo(0, 10);
    expect(s2.evidenceCoverage).toBeCloseTo(wPosition, 8); // sólo position_fit tiene dato
    expect(s2.guessingIndex).toBeCloseTo(1 - wPosition, 8);
  });

  test("AC4 -- calibración corrupta: mismo ranking y mismo score que el camino legacy de V6", () => {
    // 3 candidatos, todos con matchup vs el enemigo revelado y con datos de posición -> todos
    // tienen cobertura total de A(S), así que la redistribución por estado coincide con la
    // candidate-specific de V6 (mismo denominador para todos).
    const snapshot = meta(
      {
        1: { id: 1, localizedName: "A" },
        2: { id: 2, localizedName: "B" },
        3: { id: 3, localizedName: "C" },
        50: { id: 50, localizedName: "Enemigo" },
      },
      {
        matchups: {
          1: [{ vsHero: 50, games: 300, wins: 200 }, { vsHero: 60, games: 300, wins: 150 }],
          2: [{ vsHero: 50, games: 300, wins: 160 }, { vsHero: 60, games: 300, wins: 150 }],
          3: [{ vsHero: 50, games: 300, wins: 120 }, { vsHero: 60, games: 300, wins: 150 }],
        },
      },
    );
    const corrupt = parseCalibration({ schemaVersion: 99, signals: "broken" }); // -> Calibration vacía

    const calibrated = buildSuggestions(stateWithEnemy(), snapshot, { heroPositions: CARRY_POS, heroCounters: new Map(), calibration: corrupt });
    const legacy = buildSuggestions(stateWithEnemy(), snapshot, { heroPositions: CARRY_POS, heroCounters: new Map(), _legacyMixMode: true });

    expect(calibrated.suggestions.map((s) => s.hero)).toEqual(legacy.suggestions.map((s) => s.hero));
    for (const s of calibrated.suggestions) {
      const l = legacy.suggestions.find((x) => x.hero === s.hero)!;
      expect(s.score).toBeCloseTo(l.score, 8);
    }
  });

  test("AC5 -- sensibilidad: con percentiles de counter angostos, el countereado cae MÁS que con RAW_RANGE", () => {
    // 1 es countereado por 50 (medium -> raw -0.06); 2 counterea a 50 (medium -> raw +0.06).
    // Misma posición para los dos -> el único diferenciador es counter.
    const snapshot = meta({
      1: { id: 1, localizedName: "Countereado" },
      2: { id: 2, localizedName: "Counterea" },
      50: { id: 50, localizedName: "Enemigo" },
    });
    const heroCounters = new Map([
      [1, [{ vs: 50, level: "medium" as const, why: "1 sufre contra 50" }]],
      [50, [{ vs: 2, level: "medium" as const, why: "50 sufre contra 2" }]],
    ]);
    const narrow = parseCalibration({
      schemaVersion: 1,
      signals: { counter: { global: { p05: -0.05, p95: 0.05, n: 1000 } }, position_fit: { global: { p05: 0, p95: 1, n: 1000 } } },
    });

    const base = { heroPositions: CARRY_POS, heroCounters };
    const wide = buildSuggestions(stateWithEnemy(), snapshot, { ...base, calibration: EMPTY_CAL });
    const tight = buildSuggestions(stateWithEnemy(), snapshot, { ...base, calibration: narrow });

    const gap = (r: typeof wide) =>
      r.suggestions.find((s) => s.hero === 2)!.score - r.suggestions.find((s) => s.hero === 1)!.score;

    expect(gap(tight)).toBeGreaterThan(gap(wide) * 1.5);
    expect(tight.suggestions.find((s) => s.hero === 1)!.rank).toBe(2); // el countereado queda último
  });

  test("TSK-213: el default (sin options.calibration) normaliza con RAW_RANGE, no con percentiles", () => {
    // counter raw 0.06 -> RAW_RANGE [-0.12, 0.12] -> normalized = (0.06+0.12)/0.24*100 = 75.
    // Con la calibración empírica de percentiles.json (counter ~[-0.041, 0.057]) daría ~100.
    const snapshot = meta({
      1: { id: 1, localizedName: "Countera" },
      50: { id: 50, localizedName: "Enemigo" },
    });
    const heroCounters = new Map([[50, [{ vs: 1, level: "medium" as const, why: "50 sufre contra 1" }]]]);
    const result = buildSuggestions(stateWithEnemy(), snapshot, { heroPositions: CARRY_POS, heroCounters });
    const c = result.suggestions.find((s) => s.hero === 1)!.signals.find((s) => s.signal === "counter")!;
    expect(c.raw).toBeCloseTo(0.06, 10);
    expect(c.normalized).toBeCloseTo(75, 6); // RAW_RANGE, no percentiles
  });

  test("confidence sale de EvidenceCoverage, no del conteo de nulls (§16.7 punto 7)", () => {
    // A(S) = {position_fit} sólo para el VOTO (sin enemigo revelado, sin picks propios; patch_meta
    // es estructuralmente aplicable pero no vota -- Task 11/12). Un candidato con position_fit ->
    // cobertura 1 -> alta.
    const snapshot = meta({ 1: { id: 1, localizedName: "Solo" } });
    const result = buildSuggestions(draftState(), snapshot, { heroPositions: { 1: [{ position: 1, matches: 1000 }] }, calibration: EMPTY_CAL });
    expect(result.suggestions[0]?.evidenceCoverage).toBeCloseTo(1, 10);
    expect(result.suggestions[0]?.confidence).toBe("alta");
  });
});

// ============================================================================
// R0.3 / Task 11 (design §4.3a, requisito 3.2 c1, CP3 parte estructural):
// `structurallyApplicableSignals` (`A(S)`) depende SÓLO de la estructura del
// DraftState y de las funciones que pidió el llamador -- nunca de la calibración
// ni de la presencia/frescura de datos. La calibración es transformación de
// normalización, jamás interruptor de disponibilidad.
// ============================================================================
describe("Task 11 -- A(S) estructural desacoplada de la calibración", () => {
  const KNOWN_POS: HeroPositions = { 1: [{ position: 1, matches: 1000 }], 2: [{ position: 1, matches: 1000 }], 7: [{ position: 2, matches: 1000 }] };
  const bareOptions = () => ({ heroCounters: new Map(), heroPositions: KNOWN_POS });

  // --- Caso 1: estructura presente + datos presentes -> applicable = true ---
  test("estructura presente: enemigo revelado -> counter; pick propio -> team_synergy; lado conocido -> position_fit", () => {
    const withEnemy = structurallyApplicableSignals(draftState({ picks: { radiant: [], dire: [50] } }), meta({}), bareOptions());
    expect(withEnemy.has("counter")).toBe(true);
    expect(withEnemy.has("position_fit")).toBe(true);

    const withOwn = structurallyApplicableSignals(draftState({ picks: { radiant: [7], dire: [] } }), meta({}), bareOptions());
    expect(withOwn.has("team_synergy")).toBe(true);
  });

  // --- Caso 2: estructura presente + datos ausentes/no calibrados -> applicable SIGUE true ---
  test("patch_meta es estructuralmente aplicable en TODO estado, haya o no datos de parche", () => {
    for (const state of [
      draftState({ localSide: "unknown", picks: { radiant: [], dire: [] } }),
      draftState({ picks: { radiant: [], dire: [] } }),
      draftState({ picks: { radiant: [1, 2], dire: [50, 51] }, banned: [9] }),
    ]) {
      expect(structurallyApplicableSignals(state, meta({}), bareOptions()).has("patch_meta")).toBe(true);
    }
  });

  test("candado: A(S) y el score son idénticos con o sin calibración de patch_meta (la calibración no enciende la señal)", () => {
    const state = draftState({ picks: { radiant: [7], dire: [50] } });
    const snapshot = meta({ 1: { id: 1, localizedName: "A" }, 7: { id: 7, localizedName: "Own" }, 50: { id: 50, localizedName: "Enemy" } });
    // Antes de Task 11 esta calibración metía patch_meta en A(S) -> cambiaba denominador y score.
    const withPatchCal = parseCalibration({ schemaVersion: 1, signals: { patch_meta: { global: { p05: 0.3, p95: 0.7, n: 1000 } } } });

    const base = { heroCounters: new Map(), heroPositions: KNOWN_POS };
    const empty = buildSuggestions(state, snapshot, { ...base, calibration: EMPTY_CAL });
    const calibrated = buildSuggestions(state, snapshot, { ...base, calibration: withPatchCal });

    for (const set of [empty, calibrated]) {
      const pm = set.suggestions[0]?.signals.find((s) => s.signal === "patch_meta");
      expect(pm?.weighted).toBe(0); // patch_meta no vota: la calibración no es interruptor de disponibilidad
    }
    expect(calibrated.suggestions.map((s) => s.hero)).toEqual(empty.suggestions.map((s) => s.hero));
    for (const s of calibrated.suggestions) {
      const e = empty.suggestions.find((x) => x.hero === s.hero)!;
      expect(s.score).toBeCloseTo(e.score, 10);
    }
  });

  // --- Caso 3: estructura ausente + datos presentes -> applicable = false ---
  test("estructura ausente pese a meta rico: sin picks propios -> sin team_synergy/counter; sin lado -> sin position_fit", () => {
    const richMeta = meta(
      { 1: { id: 1, localizedName: "A" }, 50: { id: 50, localizedName: "B" } },
      { matchups: { 1: [{ vsHero: 50, games: 800, wins: 500 }] } },
    );
    const noOwnNoEnemy = structurallyApplicableSignals(draftState({ picks: { radiant: [], dire: [] } }), richMeta, bareOptions());
    expect(noOwnNoEnemy.has("team_synergy")).toBe(false);
    expect(noOwnNoEnemy.has("counter")).toBe(false);

    const unknownSide = structurallyApplicableSignals(draftState({ localSide: "unknown", picks: { radiant: [], dire: [] } }), richMeta, bareOptions());
    expect(unknownSide.has("position_fit")).toBe(false);
  });

  // --- Caso 4: estructura ausente + datos ausentes -> applicable = false ---
  test("estructura ausente + meta vacío: A(S) mínimo = {patch_meta, position_fit}", () => {
    const minimal = structurallyApplicableSignals(draftState({ picks: { radiant: [], dire: [] } }), meta({}), bareOptions());
    expect([...minimal].sort()).toEqual(["patch_meta", "position_fit"]);
  });
});

// ============================================================================
// R0.3 / Task 12 (design §4.3a-b, requisitos 3.2 c2-c5 / 3.3, CP3 / CP3b /
// Property 3 / Property 11): `dataReady` es un flag explícito por señal,
// ortogonal a `raw` y a la calibración; `votes == (structurallyApplicable AND
// dataReady)`; `patch_meta` tiene contrato R0 EXACTO (no vota, no consume peso,
// producción idéntica a pre-R0); toda señal que no vota se etiqueta con
// `nonVotingReason ∈ {"data_not_ready","not_structurally_applicable"}`.
// ============================================================================
describe("Task 12 -- data readiness por señal + contrato exacto de patch_meta", () => {
  const KNOWN_POS: HeroPositions = { 1: [{ position: 1, matches: 1000 }], 2: [{ position: 1, matches: 1000 }], 7: [{ position: 2, matches: 1000 }] };
  const bareOptions = () => ({ heroCounters: new Map(), heroPositions: KNOWN_POS });
  const ALL_SIGNALS = ["counter", "patch_meta", "team_synergy", "hero_pool_fit", "position_fit", "archetype_fit"] as const;

  // ---- REGRESSION MATRIX A/B/C/D: votes == (structurallyApplicable AND dataReady) ----
  test("A/B/C/D -- votes es exactamente la conjunción structurallyApplicable AND dataReady, por señal y por estado", () => {
    const states = [
      draftState({ localSide: "unknown", picks: { radiant: [], dire: [] } }),
      draftState({ picks: { radiant: [], dire: [] } }),
      draftState({ picks: { radiant: [7], dire: [50] } }),
      draftState({ picks: { radiant: [1, 2], dire: [50, 51] }, banned: [9] }),
    ];
    for (const state of states) {
      const snapshot = meta({});
      const applicable = structurallyApplicableSignals(state, snapshot, bareOptions());
      const voting = votingSignals(state, snapshot, bareOptions());
      for (const signal of ALL_SIGNALS) {
        const structurally = applicable.has(signal);
        const ready = dataReady(signal, snapshot);
        // regla formal (requisito 3.2 c3): la conjunción, nunca inferida de raw
        expect(voting.has(signal)).toBe(structurally && ready);
        // Caso C/D: no estructural => nunca vota aunque dataReady sea true
        if (!structurally) expect(voting.has(signal)).toBe(false);
        // Caso B: estructural pero no lista => no vota (patch_meta)
        if (structurally && !ready) expect(voting.has(signal)).toBe(false);
      }
    }
  });

  test("E -- cambiar la calibración NO cambia dataReady ni A(S) ni el conjunto votante", () => {
    const state = draftState({ picks: { radiant: [7], dire: [50] } });
    const snapshot = meta({});
    // dataReady ni siquiera acepta calibración como parámetro -> imposible que la use de interruptor.
    expect(dataReady("patch_meta", snapshot)).toBe(false);
    expect(dataReady("position_fit", snapshot)).toBe(true);
    const votingA = [...votingSignals(state, snapshot, bareOptions())].sort();
    const votingB = [...votingSignals(state, snapshot, bareOptions())].sort();
    expect(votingA).toEqual(votingB);
    expect(votingA).not.toContain("patch_meta");
  });

  test("F -- cambiar A(S) (revelar un enemigo) NO vuelve dataReady=true para patch_meta", () => {
    const before = draftState({ picks: { radiant: [], dire: [] } });
    const after = draftState({ picks: { radiant: [], dire: [50] } });
    const snapshot = meta({});
    expect(structurallyApplicableSignals(before, snapshot, bareOptions()).has("counter")).toBe(false);
    expect(structurallyApplicableSignals(after, snapshot, bareOptions()).has("counter")).toBe(true);
    // patch_meta estructuralmente aplicable en ambos, dataReady=false en ambos
    for (const s of [before, after]) {
      expect(structurallyApplicableSignals(s, snapshot, bareOptions()).has("patch_meta")).toBe(true);
      expect(dataReady("patch_meta", snapshot)).toBe(false);
      expect(votingSignals(s, snapshot, bareOptions()).has("patch_meta")).toBe(false);
    }
  });

  // ---- nonVotingReason: causa explícita, nunca inferida de raw ----
  test("C -- señal no estructuralmente aplicable => nonVotingReason = 'not_structurally_applicable'", () => {
    const state = draftState({ localSide: "unknown", picks: { radiant: [], dire: [] } });
    const snapshot = meta({});
    expect(structurallyApplicableSignals(state, snapshot, bareOptions()).has("position_fit")).toBe(false);
    expect(nonVotingReason("position_fit", state, snapshot, bareOptions())).toBe("not_structurally_applicable");
    expect(nonVotingReason("counter", state, snapshot, bareOptions())).toBe("not_structurally_applicable");
  });

  test("B -- patch_meta estructuralmente aplicable pero no lista => nonVotingReason = 'data_not_ready'", () => {
    const state = draftState({ picks: { radiant: [7], dire: [50] } });
    const snapshot = meta({});
    expect(nonVotingReason("patch_meta", state, snapshot, bareOptions())).toBe("data_not_ready");
  });

  test("A -- una señal que vota tiene nonVotingReason = null", () => {
    const state = draftState({ picks: { radiant: [7], dire: [50] } });
    const snapshot = meta({});
    expect(nonVotingReason("position_fit", state, snapshot, bareOptions())).toBeNull();
    expect(nonVotingReason("counter", state, snapshot, bareOptions())).toBeNull();
  });

  test("toda señal fuera del conjunto votante tiene un nonVotingReason del enum, y viceversa", () => {
    const state = draftState({ picks: { radiant: [7], dire: [50] } });
    const snapshot = meta({});
    const voting = votingSignals(state, snapshot, bareOptions());
    for (const signal of ALL_SIGNALS) {
      const reason = nonVotingReason(signal, state, snapshot, bareOptions());
      if (voting.has(signal)) {
        expect(reason).toBeNull();
      } else {
        expect(reason === "data_not_ready" || reason === "not_structurally_applicable").toBe(true);
      }
    }
  });

  // ---- RAW ORTHOGONALITY: raw numérico NO fuerza dataReady=true ----
  test("orthogonality -- patch_meta con patchStats >= 500 (raw numérico) SIGUE sin votar y con weighted 0", () => {
    const patchStats = {
      1: [{ patch: "7.36", bracket: "archon" as const, picks: 5000, wins: 3000 }],
      2: [{ patch: "7.36", bracket: "archon" as const, picks: 5000, wins: 2000 }],
    };
    const snapshot = meta({ 1: { id: 1, localizedName: "A" }, 2: { id: 2, localizedName: "B" } }, { patchStats });
    const result = buildSuggestions(draftState(), snapshot, { heroPositions: { 1: [{ position: 1, matches: 999 }], 2: [{ position: 1, matches: 999 }] }, calibration: EMPTY_CAL });
    for (const suggestion of result.suggestions) {
      const pm = suggestion.signals.find((s) => s.signal === "patch_meta")!;
      expect(pm.raw).not.toBeNull(); // el scorer produjo un winrate real
      expect(pm.weighted).toBe(0); // pero dataReady=false => no vota
    }
    expect(dataReady("patch_meta", snapshot)).toBe(false);
    expect(votingSignals(draftState(), snapshot, { heroPositions: {} }).has("patch_meta")).toBe(false);
  });

  test("orthogonality inversa -- una señal con raw:null para un candidato PUEDE seguir votando", () => {
    // counter: enemigo revelado sin matchups -> raw null para ese candidato, pero la señal vota
    // (está en A(S) y dataReady=true). raw ⊥ votes en ambas direcciones.
    const state = draftState({ picks: { radiant: [], dire: [50] } });
    const snapshot = meta({ 1: { id: 1, localizedName: "A" }, 50: { id: 50, localizedName: "E" } });
    expect(votingSignals(state, snapshot, bareOptions()).has("counter")).toBe(true);
    const result = buildSuggestions(state, snapshot, bareOptions());
    const c = result.suggestions[0]?.signals.find((s) => s.signal === "counter");
    expect(c?.raw).toBeNull();
  });

  // ---- CP3b / Property 11: contrato R0 EXACTO de patch_meta + producción idéntica a pre-R0 ----
  test("CP3b -- patch_meta: structurallyApplicable=true, dataReady=false, votes=false, weighted=0, reason='data_not_ready'", () => {
    const state = draftState({ picks: { radiant: [7], dire: [50] } });
    const snapshot = meta({ 1: { id: 1, localizedName: "A" }, 7: { id: 7, localizedName: "Own" }, 50: { id: 50, localizedName: "Enemy" } });
    const opts = { heroCounters: new Map(), heroPositions: KNOWN_POS, calibration: EMPTY_CAL };

    expect(structurallyApplicableSignals(state, snapshot, opts).has("patch_meta")).toBe(true);
    expect(dataReady("patch_meta", snapshot)).toBe(false);
    expect(votingSignals(state, snapshot, opts).has("patch_meta")).toBe(false);
    expect(nonVotingReason("patch_meta", state, snapshot, opts)).toBe("data_not_ready");

    const result = buildSuggestions(state, snapshot, opts);
    for (const suggestion of result.suggestions) {
      const pm = suggestion.signals.find((s) => s.signal === "patch_meta")!;
      expect(pm.weighted).toBe(0);
      expect(pm.raw).toBeNull(); // sin patchStats -> hueco de dato, aceptable (ortogonal a votes)
    }
  });

  test("CP3b candado -- votingSignals == A(S) \\ {patch_meta} (byte-idéntico a lo que Task 11 hardcodeaba)", () => {
    // El filtro que Task 12 reemplaza era `.filter((id) => id !== "patch_meta")`. Si `votingSignals`
    // difiere de eso en algún estado, el denominador / stateMean / score cambiarían -> STOP.
    for (const state of [
      draftState({ localSide: "unknown", picks: { radiant: [], dire: [] } }),
      draftState({ picks: { radiant: [], dire: [] } }),
      draftState({ picks: { radiant: [7], dire: [50] } }),
      draftState({ picks: { radiant: [1, 2], dire: [50, 51] }, banned: [9] }),
      draftState({ picks: { radiant: [1], dire: [] } }),
    ]) {
      const snapshot = meta({});
      const applicable = structurallyApplicableSignals(state, snapshot, bareOptions());
      const expected = new Set([...applicable].filter((id) => id !== "patch_meta"));
      expect([...votingSignals(state, snapshot, bareOptions())].sort()).toEqual([...expected].sort());
    }
  });

  test("CP3b -- producción idéntica: ranking y todos los signals[].weighted no se mueven con hero_pool_fit presente", () => {
    // hero_pool_fit residual DIFERIDO: con pool presente entra a A(S) y dataReady=default true ->
    // vota igual que hoy; sin pool no entra. Verificamos que ambos caminos siguen byte-idénticos.
    const heroPool = [
      { hero: 1, source: "manual" as const, personalWinrate: 0.6, personalGames: 40, updatedAt: "now" },
      { hero: 2, source: "manual" as const, personalWinrate: 0.4, personalGames: 40, updatedAt: "now" },
    ];
    const heroes = { 1: { id: 1, localizedName: "A" }, 2: { id: 2, localizedName: "B" }, 3: { id: 3, localizedName: "C" } };
    const heroPositions: HeroPositions = { 1: [{ position: 1, matches: 999 }], 2: [{ position: 1, matches: 999 }], 3: [{ position: 1, matches: 999 }] };

    const withPool = buildSuggestions(draftState(), meta(heroes, { heroPool }), { heroPositions, calibration: EMPTY_CAL });
    // hero_pool_fit debe estar votando (raw numérico, weighted > 0 para el que está en pool con winrate)
    const hpf1 = withPool.suggestions.find((s) => s.hero === 1)!.signals.find((s) => s.signal === "hero_pool_fit")!;
    expect(hpf1.raw).not.toBeNull();
    expect(votingSignals(draftState(), meta(heroes, { heroPool }), { heroPositions }).has("hero_pool_fit")).toBe(true);

    const noPool = buildSuggestions(draftState(), meta(heroes), { heroPositions, calibration: EMPTY_CAL });
    expect(votingSignals(draftState(), meta(heroes), { heroPositions }).has("hero_pool_fit")).toBe(false);
    const hpfNo = noPool.suggestions[0]!.signals.find((s) => s.signal === "hero_pool_fit")!;
    expect(hpfNo.weighted).toBe(0);
  });

  // ---- REGRESSION MATRIX G: una señal que no vota NO consume el denominador de pesos ----
  test("G -- patch_meta (no vota) no diluye a las demás: con solo position_fit votante, w' = 1.0", () => {
    // A(S) = {position_fit, patch_meta}; voting = {position_fit}. Si patch_meta consumiera peso,
    // w'(position_fit) = 0.342 / (0.342 + 0.117) < 1 y el score caería por debajo del normalized.
    const snapshot = meta({ 1: { id: 1, localizedName: "Solo" } });
    const result = buildSuggestions(draftState(), snapshot, { heroPositions: { 1: [{ position: 1, matches: 1000 }] }, calibration: EMPTY_CAL });
    const top = result.suggestions[0]!;
    const pf = top.signals.find((s) => s.signal === "position_fit")!;
    // position_fit único votante -> w'=1 -> score == normalized(position_fit) exacto
    expect(pf.normalized).not.toBeNull();
    expect(top.score).toBeCloseTo(pf.normalized as number, 10);
    expect(top.evidenceCoverage).toBeCloseTo(1, 10); // cobertura = Σ w' de señales con dato = 1
  });

  test("G -- el denominador sólo suma señales votantes: score reproducible a mano con position_fit + counter", () => {
    // voting = {position_fit, counter}; patch_meta fuera. denom = 0.342 + 0.216 = 0.558.
    const snapshot = meta({ 1: { id: 1, localizedName: "A" }, 50: { id: 50, localizedName: "E" } });
    const heroCounters = new Map([[50, [{ vs: 1, level: "medium" as const, why: "50 sufre contra 1" }]]]);
    const state = draftState({ picks: { radiant: [], dire: [50] } });
    const result = buildSuggestions(state, snapshot, { heroPositions: { 1: [{ position: 1, matches: 1000 }] }, heroCounters, calibration: EMPTY_CAL });
    const top = result.suggestions.find((s) => s.hero === 1)!;
    const pf = top.signals.find((s) => s.signal === "position_fit")!;
    const c = top.signals.find((s) => s.signal === "counter")!;
    const denom = SCORING_WEIGHTS_V6.position_fit + SCORING_WEIGHTS_V6.counter;
    const expectedScore =
      (SCORING_WEIGHTS_V6.position_fit / denom) * (pf.normalized as number) +
      (SCORING_WEIGHTS_V6.counter / denom) * (c.normalized as number);
    expect(top.score).toBeCloseTo(expectedScore, 8);
  });
});

// ============================================================================
// R0.3 / Task 13 (design §4.3 "Data Models" (b), requisito 3.1, CP2/CP4/CP10):
// `score` / `reason` / `comparison` / `evidence` se derivan de UNA sola fuente
// canónica (`StateWeightedContribution[]`, proyectada fielmente en
// `Suggestion.signals`). `weightedContributions` legacy queda fuera del camino
// activo. Los flags de Task 12 sobreviven: una señal que no vota (`patch_meta`)
// NUNCA reaparece como votante porque un derivado se reconstruya por otra ruta.
// ============================================================================
describe("Task 13 -- cálculo único: score/reason/comparison/evidence de una fuente", () => {
  const CARRY2: HeroPositions = { 1: [{ position: 1, matches: 1000 }], 2: [{ position: 1, matches: 1000 }] };
  // patchStats presente -> patch_meta.raw es un winrate real, pero dataReady=false -> weighted=0.
  const PATCH_STATS = {
    1: [{ patch: "7.36", bracket: "archon" as const, picks: 5000, wins: 3800 }], // winrate alto
    2: [{ patch: "7.36", bracket: "archon" as const, picks: 5000, wins: 1400 }], // winrate bajo
  };

  test("CP4 -- reason nunca cita patch_meta (weighted=0) aunque tenga raw de patchStats; toda señal citada aporta", () => {
    const snapshot = meta({ 1: { id: 1, localizedName: "Solo" } }, { patchStats: { 1: PATCH_STATS[1] } });
    const result = buildSuggestions(draftState(), snapshot, { heroPositions: { 1: [{ position: 1, matches: 1000 }] }, calibration: EMPTY_CAL });
    const s = result.suggestions[0]!;
    const pm = s.signals.find((x) => x.signal === "patch_meta")!;

    expect(pm.raw).not.toBeNull(); // el scorer produjo un winrate
    expect(pm.weighted).toBe(0); // pero no vota
    expect(s.reason).not.toContain(pm.explanation); // CP4: no citada
    // toda señal cuya explanation aparece en `reason` tiene weighted > 0
    for (const c of s.signals) {
      if (c.explanation.length > 0 && s.reason.includes(c.explanation)) {
        expect(c.weighted).toBeGreaterThan(0);
      }
    }
  });

  test("CP2/CP4 -- patch_meta (votes=false) nunca dirige comparison; delta = diferencia de signals[].weighted", () => {
    const snapshot = meta(
      { 1: { id: 1, localizedName: "A" }, 2: { id: 2, localizedName: "B" } },
      { patchStats: PATCH_STATS },
    );
    // Sin enemigo revelado ni pick propio: voting = {position_fit}. patch_meta NO vota pese a su raw.
    const result = buildSuggestions(draftState(), snapshot, { heroPositions: CARRY2, heroCounters: new Map(), calibration: EMPTY_CAL });

    expect(result.comparison?.signal).not.toBe("patch_meta");
    if (result.comparison) {
      const top = result.suggestions.find((x) => x.rank === 1)!;
      const second = result.suggestions.find((x) => x.rank === 2)!;
      const wt = top.signals.find((x) => x.signal === result.comparison!.signal)!.weighted;
      const ws = second.signals.find((x) => x.signal === result.comparison!.signal)!.weighted;
      expect(result.comparison.delta).toBeCloseTo(wt - ws, 10);
    }
  });

  test("CP2 -- comparison.delta reproducible desde signals[].weighted con cobertura parcial (μ-fill)", () => {
    // hero 1 tiene matchup vs el enemigo revelado (50); hero 2 NO -> counter.raw:null para el 2,
    // rellenado con μ. Con `weightedContributions` (legacy) el denominador del 2 excluiría counter
    // -> el delta viejo NO coincidiría con la diferencia de signals[].weighted. Task 13: sí coincide.
    const snapshot = meta(
      { 1: { id: 1, localizedName: "Con matchup" }, 2: { id: 2, localizedName: "Sin matchup" }, 50: { id: 50, localizedName: "Enemigo" } },
      { matchups: { 1: [{ vsHero: 50, games: 400, wins: 300 }, { vsHero: 60, games: 400, wins: 90 }] } },
    );
    const state = draftState({ picks: { radiant: [], dire: [50] } });
    const heroCounters = new Map([
      [1, [{ vs: 50, level: "hard" as const, why: "1 counterea a 50" }]],
      [50, [{ vs: 2, level: "hard" as const, why: "50 counterea a 2" }]],
    ]);
    const result = buildSuggestions(state, snapshot, { heroPositions: CARRY2, heroCounters, calibration: EMPTY_CAL });
    const cmp = result.comparison;
    if (cmp) {
      const top = result.suggestions.find((x) => x.rank === 1)!;
      const second = result.suggestions.find((x) => x.rank === 2)!;
      const wt = top.signals.find((x) => x.signal === cmp.signal)!;
      const ws = second.signals.find((x) => x.signal === cmp.signal)!;
      expect(wt.raw).not.toBeNull();
      expect(ws.raw).not.toBeNull(); // comparable => dato real en ambos lados
      expect(cmp.delta).toBeCloseTo(wt.weighted - ws.weighted, 10);
    }
  });

  test("CP10 -- Σ signals[].weighted == score en el camino normal", () => {
    const snapshot = meta(
      { 1: { id: 1, localizedName: "A" }, 2: { id: 2, localizedName: "B" }, 3: { id: 3, localizedName: "C" }, 50: { id: 50, localizedName: "E" } },
      { matchups: { 1: [{ vsHero: 50, games: 400, wins: 280 }], 2: [{ vsHero: 50, games: 400, wins: 150 }] }, patchStats: PATCH_STATS },
    );
    const state = draftState({ picks: { radiant: [3], dire: [50] } });
    const result = buildSuggestions(state, snapshot, {
      heroPositions: { 1: [{ position: 1, matches: 900 }], 2: [{ position: 1, matches: 900 }], 3: [{ position: 3, matches: 900 }] },
      heroCounters: new Map(),
      calibration: EMPTY_CAL,
    });
    expect(result.suggestions.length).toBeGreaterThan(0);
    for (const s of result.suggestions) {
      const sum = s.signals.reduce((a, c) => a + c.weighted, 0);
      expect(sum).toBeCloseTo(s.score, 6);
    }
  });

  test("CP10 -- Σ signals[].weighted == score en teamOpening (con alivio por ban)", () => {
    const heroPositions = {
      1: [{ position: 1 as const, matches: 300 }],
      2: [{ position: 2 as const, matches: 300 }],
      3: [{ position: 3 as const, matches: 300 }],
      4: [{ position: 4 as const, matches: 300 }],
      5: [{ position: 5 as const, matches: 300 }],
      6: [{ position: 5 as const, matches: 300 }],
    };
    const snapshot = meta(
      Object.fromEntries([1, 2, 3, 4, 5, 6].map((h) => [h, { id: h, localizedName: `Hero ${h}` }])),
      { matchups: { 1: [{ vsHero: 99, games: 400, wins: 150 }] } }, // hero 1: matchup adverso vs 99 (baneado)
    );
    const state = draftState({ localSide: "radiant", banned: [99], picks: { radiant: [], dire: [] } });
    const result = buildSuggestions(state, snapshot, { teamOpening: true, heroPositions, heroCapabilities: [], calibration: EMPTY_CAL });

    const relieved = result.suggestions.find((s) => s.hero === 1)!;
    // el alivio por ban movió el score de este candidato
    const withoutBan = buildSuggestions({ ...state, banned: [] }, snapshot, { teamOpening: true, heroPositions, heroCapabilities: [], calibration: EMPTY_CAL });
    expect(relieved.score).toBeGreaterThan(withoutBan.suggestions.find((s) => s.hero === 1)!.score);
    // CP10 se mantiene pese al reemplazo del score
    for (const s of result.suggestions) {
      const sum = s.signals.reduce((a, c) => a + c.weighted, 0);
      expect(sum).toBeCloseTo(s.score, 5);
    }
  });

  test("CP10 -- Σ signals[].weighted == score en el camino legacy (_legacyMixMode)", () => {
    const snapshot = meta(
      { 1: { id: 1, localizedName: "A" }, 2: { id: 2, localizedName: "B" }, 50: { id: 50, localizedName: "E" } },
      { matchups: { 1: [{ vsHero: 50, games: 300, wins: 220 }, { vsHero: 60, games: 300, wins: 40 }] } },
    );
    const state = draftState({ picks: { radiant: [], dire: [50] } });
    const result = buildSuggestions(state, snapshot, { heroPositions: CARRY2, _legacyMixMode: true });
    for (const s of result.suggestions) {
      const sum = s.signals.reduce((a, c) => a + c.weighted, 0);
      expect(sum).toBeCloseTo(s.score, 6);
    }
  });

  test("score reconstruible desde la proyección de la fuente única (Σ weighted) en los tres caminos", () => {
    const snapshot = meta(
      { 1: { id: 1, localizedName: "A" }, 2: { id: 2, localizedName: "B" }, 50: { id: 50, localizedName: "E" } },
      { matchups: { 1: [{ vsHero: 50, games: 400, wins: 260 }] }, patchStats: PATCH_STATS },
    );
    const normal = buildSuggestions(draftState({ picks: { radiant: [], dire: [50] } }), snapshot, { heroPositions: CARRY2, heroCounters: new Map(), calibration: EMPTY_CAL });
    const legacy = buildSuggestions(draftState({ picks: { radiant: [], dire: [50] } }), snapshot, { heroPositions: CARRY2, _legacyMixMode: true });
    for (const set of [normal, legacy]) {
      for (const s of set.suggestions) {
        expect(s.signals.reduce((a, c) => a + c.weighted, 0)).toBeCloseTo(s.score, 6);
      }
    }
  });

  test("evidence sólo cita counter/synergy cuando esa señal votó y aportó (weighted > 0)", () => {
    // patch_meta con raw pero sin voto no genera evidencia; counter/synergy sí, y sólo si aportan.
    const state = draftState({ localSide: "radiant", picks: { radiant: [1, 2], dire: [10, 11] } });
    const snapshot = meta(
      { 1: { id: 1, localizedName: "U1" }, 2: { id: 2, localizedName: "U2" }, 3: { id: 3, localizedName: "Cand" }, 10: { id: 10, localizedName: "E1" }, 11: { id: 11, localizedName: "E2" } },
      { matchups: { 3: [{ vsHero: 10, games: 400, wins: 300 }, { vsHero: 11, games: 400, wins: 260 }] }, patchStats: { 3: PATCH_STATS[1] } },
    );
    const result = buildSuggestions(state, snapshot, {
      heroPositions: { 1: [{ position: 5, matches: 400 }], 2: [{ position: 1, matches: 400 }], 3: [{ position: 4, matches: 400 }] },
      heroCapabilities: [
        { hero: 1, damageType: "magical", hasInitiation: false, hasCatch: true, hasWaveclear: false, structuralDamage: "low", teamfight: "medium", scaling: "low" },
        { hero: 2, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: true, structuralDamage: "high", teamfight: "low", scaling: "high" },
        { hero: 3, damageType: "magical", hasInitiation: true, hasCatch: true, hasWaveclear: false, structuralDamage: "low", teamfight: "high", scaling: "low" },
      ],
      heroCounters: new Map(),
      calibration: EMPTY_CAL,
    });
    const cand = result.suggestions.find((s) => s.hero === 3)!;
    const pm = cand.signals.find((s) => s.signal === "patch_meta")!;
    expect(pm.weighted).toBe(0);
    // ninguna entrada de evidencia repite el texto de patch_meta
    for (const e of cand.evidence ?? []) expect(e.text).not.toContain(pm.explanation);
    // la evidencia de counter/synergy, si aparece, corresponde a una señal que votó con weighted>0
    for (const e of cand.evidence ?? []) {
      if (e.kind === "counter") expect(cand.signals.find((s) => s.signal === "counter")!.weighted).toBeGreaterThan(0);
      if (e.kind === "synergy") expect(cand.signals.find((s) => s.signal === "team_synergy")!.weighted).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// R0.3 / Task 16 (design §4.3 "Data Models" (e), requisito 3.2 c6, CP3/CP7):
// `AvailableSignalsReport` es una vista DERIVADA por decisión -- no recalcula
// applicability/readiness/votes. Distingue "no aplicable estructuralmente" de
// "aplicable pero dataReady=false" de "raw:null", expone `voting`/`degenerate`,
// y sigue produciéndose cuando `suggestions === []`.
// ============================================================================
describe("Task 16 -- AvailableSignalsReport por decisión", () => {
  const KNOWN_POS: HeroPositions = {
    1: [{ position: 1, matches: 1000 }],
    2: [{ position: 1, matches: 1000 }],
    7: [{ position: 2, matches: 1000 }],
  };
  const bareOptions = () => ({ heroCounters: new Map(), heroPositions: KNOWN_POS, calibration: EMPTY_CAL });
  const ALL_SIGNALS = ["counter", "patch_meta", "team_synergy", "hero_pool_fit", "position_fit", "archetype_fit"] as const;
  const bySignal = (r: AvailableSignalsReport, s: string): AvailableSignalsReport["signals"][number] =>
    r.signals.find((x) => x.signal === s)!;

  test("expone las 6 señales, una por SignalId, en el orden congelado de SCORING_WEIGHTS_V6", () => {
    const report = buildAvailableSignalsReport(draftState({ picks: { radiant: [7], dire: [50] } }), meta({}), bareOptions());
    expect(report.signals.map((s) => s.signal)).toEqual([
      "position_fit",
      "counter",
      "patch_meta",
      "team_synergy",
      "hero_pool_fit",
      "archetype_fit",
    ]);
  });

  // --- Matriz de regresión: los 4 estados por señal ---
  test("1 -- señal estructuralmente aplicable + dataReady => votes=true, sin nonVotingReason, en voting[]", () => {
    const state = draftState({ picks: { radiant: [7], dire: [50] } });
    const report = buildAvailableSignalsReport(state, meta({}), bareOptions());
    for (const id of ["position_fit", "counter", "team_synergy"] as const) {
      const row = bySignal(report, id);
      expect(row.structurallyApplicable).toBe(true);
      expect(row.dataReady).toBe(true);
      expect(row.votes).toBe(true);
      expect(row.nonVotingReason).toBeUndefined();
      expect(report.voting).toContain(id);
    }
  });

  test("2 -- aplicable pero dataReady=false (patch_meta) => votes=false, nonVotingReason='data_not_ready', fuera de voting[]", () => {
    const state = draftState({ picks: { radiant: [7], dire: [50] } });
    const row = bySignal(buildAvailableSignalsReport(state, meta({}), bareOptions()), "patch_meta");
    expect(row.structurallyApplicable).toBe(true);
    expect(row.dataReady).toBe(false);
    expect(row.votes).toBe(false);
    expect(row.nonVotingReason).toBe("data_not_ready");
    expect(buildAvailableSignalsReport(state, meta({}), bareOptions()).voting).not.toContain("patch_meta");
  });

  test("3 -- señal no estructuralmente aplicable => votes=false, nonVotingReason='not_structurally_applicable'", () => {
    // Sin picks propios ni enemigos revelados: counter/team_synergy/archetype_fit/hero_pool_fit no aplican.
    const state = draftState({ picks: { radiant: [], dire: [] } });
    const report = buildAvailableSignalsReport(state, meta({}), bareOptions());
    for (const id of ["counter", "team_synergy", "archetype_fit", "hero_pool_fit"] as const) {
      const row = bySignal(report, id);
      expect(row.structurallyApplicable).toBe(false);
      expect(row.votes).toBe(false);
      expect(row.nonVotingReason).toBe("not_structurally_applicable");
    }
  });

  test("4 -- patch_meta LOCK: en todo estado structurallyApplicable=true, dataReady=false, votes=false, reason='data_not_ready'", () => {
    for (const state of [
      draftState({ localSide: "unknown", picks: { radiant: [], dire: [] } }),
      draftState({ picks: { radiant: [], dire: [] } }),
      draftState({ picks: { radiant: [1, 2], dire: [50, 51] }, banned: [9] }),
    ]) {
      const row = bySignal(buildAvailableSignalsReport(state, meta({}), bareOptions()), "patch_meta");
      expect(row.structurallyApplicable).toBe(true);
      expect(row.dataReady).toBe(false);
      expect(row.votes).toBe(false);
      expect(row.nonVotingReason).toBe("data_not_ready");
    }
  });

  test("5 -- raw numérico + votes=false: el reporte preserva ambas verdades (patch_meta con patchStats reales)", () => {
    const patchStats = {
      1: [{ patch: "7.36", bracket: "archon" as const, picks: 5000, wins: 3000 }],
      2: [{ patch: "7.36", bracket: "archon" as const, picks: 5000, wins: 2000 }],
    };
    const snapshot = meta({ 1: { id: 1, localizedName: "A" }, 2: { id: 2, localizedName: "B" } }, { patchStats });
    const heroPositions: HeroPositions = { 1: [{ position: 1, matches: 999 }], 2: [{ position: 1, matches: 999 }] };
    const opts = { heroCounters: new Map(), heroPositions, calibration: EMPTY_CAL };
    // el scorer produce un raw numérico...
    const pm = buildSuggestions(draftState(), snapshot, opts).suggestions[0]!.signals.find((s) => s.signal === "patch_meta")!;
    expect(pm.raw).not.toBeNull();
    expect(pm.weighted).toBe(0);
    // ...y el reporte lo sigue mostrando como no-listo / no-votante, sin mirar `raw`.
    const row = bySignal(buildAvailableSignalsReport(draftState(), snapshot, opts), "patch_meta");
    expect(row.dataReady).toBe(false);
    expect(row.votes).toBe(false);
    expect(row.nonVotingReason).toBe("data_not_ready");
  });

  test("6 -- estado degenerado (no_signal_available): el reporte se produce aunque suggestions === []", () => {
    const state = draftState({ localSide: "unknown", picks: { radiant: [], dire: [] } });
    const snapshot = meta({ 1: { id: 1, localizedName: "Primero" }, 2: { id: 2, localizedName: "Segundo" } });
    const opts = { heroPositions: {}, heroCapabilities: [], heroCounters: new Map(), calibration: EMPTY_CAL };

    const suggestionSet = buildSuggestions(state, snapshot, opts);
    expect(suggestionSet.suggestions).toEqual([]);
    expect(suggestionSet.degraded).toContain("no_signal_available");

    const report = buildAvailableSignalsReport(state, snapshot, opts);
    expect(report.degenerate).toBe(true);
    expect(report.voting).toEqual([]);
    expect(report.decisionContext).toBe("no_signal_available");
    // explica POR QUÉ ninguna señal vota, señal por señal
    for (const row of report.signals) {
      expect(row.votes).toBe(false);
      expect(row.nonVotingReason === "data_not_ready" || row.nonVotingReason === "not_structurally_applicable").toBe(true);
    }
    expect(bySignal(report, "patch_meta").nonVotingReason).toBe("data_not_ready");
    expect(bySignal(report, "position_fit").nonVotingReason).toBe("not_structurally_applicable");
  });

  test("7 -- ranking normal: report.voting == votingSignals real == señales con votes=true en el report", () => {
    const state = draftState({ picks: { radiant: [7], dire: [50] } });
    const snapshot = meta({ 1: { id: 1, localizedName: "A" }, 7: { id: 7, localizedName: "Own" }, 50: { id: 50, localizedName: "Enemy" } });
    const opts = bareOptions();

    const report = buildAvailableSignalsReport(state, snapshot, opts);
    const canonical = [...votingSignals(state, snapshot, opts)].sort();
    expect([...report.voting].sort()).toEqual(canonical);
    expect(report.signals.filter((s) => s.votes).map((s) => s.signal).sort()).toEqual(canonical);

    // cruce con buildSuggestions: toda señal con weighted>0 en una sugerencia está en report.voting;
    // toda señal votes=false en el report tiene weighted 0 en esa sugerencia.
    const suggestion = buildSuggestions(state, snapshot, opts).suggestions[0]!;
    for (const sig of suggestion.signals) {
      if (sig.weighted > 0) expect(report.voting).toContain(sig.signal);
      if (!report.voting.includes(sig.signal)) expect(sig.weighted).toBe(0);
    }
  });

  test("8 -- determinista: dos llamadas con el mismo input dan un reporte byte-idéntico", () => {
    const state = draftState({ picks: { radiant: [1, 2], dire: [50, 51] }, banned: [9] });
    const snapshot = meta({});
    const a = buildAvailableSignalsReport(state, snapshot, bareOptions());
    const b = buildAvailableSignalsReport(state, snapshot, bareOptions());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("9 -- construir el reporte no altera el ranking ni los scores de buildSuggestions", () => {
    const state = draftState({ picks: { radiant: [], dire: [50] } });
    const snapshot = meta(
      { 1: { id: 1, localizedName: "A" }, 2: { id: 2, localizedName: "B" }, 50: { id: 50, localizedName: "E" } },
      { matchups: { 1: [{ vsHero: 50, games: 400, wins: 260 }], 2: [{ vsHero: 50, games: 400, wins: 300 }] } },
    );
    const opts = { heroPositions: KNOWN_POS, heroCounters: new Map(), calibration: EMPTY_CAL };
    const before = buildSuggestions(state, snapshot, opts);
    buildAvailableSignalsReport(state, snapshot, opts);
    const after = buildSuggestions(state, snapshot, opts);
    expect(after.suggestions.map((s) => s.hero)).toEqual(before.suggestions.map((s) => s.hero));
    for (let i = 0; i < before.suggestions.length; i += 1) {
      expect(after.suggestions[i]!.score).toBeCloseTo(before.suggestions[i]!.score, 12);
    }
  });

  test("10 -- `calibrated` refleja la banda empírica pero NUNCA cambia `votes`", () => {
    const state = draftState({ picks: { radiant: [7], dire: [50] } });
    const snapshot = meta({});
    const withCal = parseCalibration({
      schemaVersion: 1,
      signals: { position_fit: { global: { p05: 0.1, p95: 0.9, n: 1000 } }, patch_meta: { global: { p05: 0.3, p95: 0.7, n: 1000 } } },
    });

    const empty = buildAvailableSignalsReport(state, snapshot, bareOptions());
    for (const row of empty.signals) expect(row.calibrated).toBe(false);

    const calibrated = buildAvailableSignalsReport(state, snapshot, { heroCounters: new Map(), heroPositions: KNOWN_POS, calibration: withCal });
    expect(bySignal(calibrated, "position_fit").calibrated).toBe(true);
    expect(bySignal(calibrated, "patch_meta").calibrated).toBe(true);
    expect(bySignal(calibrated, "counter").calibrated).toBe(false);
    // la calibración no es interruptor de disponibilidad:
    expect(bySignal(calibrated, "position_fit").votes).toBe(bySignal(empty, "position_fit").votes);
    expect(bySignal(calibrated, "patch_meta").votes).toBe(false);
    expect(calibrated.voting).toEqual(empty.voting);
  });

  test("11 -- invariante Task 12 preservado: votes == (structurallyApplicable AND dataReady) para toda señal", () => {
    for (const state of [
      draftState({ localSide: "unknown", picks: { radiant: [], dire: [] } }),
      draftState({ picks: { radiant: [], dire: [] } }),
      draftState({ picks: { radiant: [7], dire: [50] } }),
      draftState({ picks: { radiant: [1, 2], dire: [50, 51] }, banned: [9] }),
    ]) {
      const report = buildAvailableSignalsReport(state, meta({}), bareOptions());
      for (const row of report.signals) {
        expect(row.votes).toBe(row.structurallyApplicable && row.dataReady);
        expect(row.nonVotingReason !== undefined).toBe(!row.votes);
        if (row.nonVotingReason !== undefined) {
          expect(row.nonVotingReason === "data_not_ready" || row.nonVotingReason === "not_structurally_applicable").toBe(true);
        }
      }
      expect(report.degenerate).toBe(report.voting.length === 0);
      // el reporte deriva de las MISMAS funciones canónicas (no un cálculo paralelo)
      const canonicalVoting = votingSignals(state, meta({}), bareOptions());
      for (const id of ALL_SIGNALS) expect(bySignal(report, id).votes).toBe(canonicalVoting.has(id));
    }
  });

  test("12 -- degenerado presente aun con una señal estructuralmente aplicable pero no lista; la primera votante recupera el ranking", () => {
    const snapshot = meta({ 1: { id: 1, localizedName: "A" }, 2: { id: 2, localizedName: "B" } });
    const heroPositions: HeroPositions = { 1: [{ position: 1, matches: 999 }], 2: [{ position: 5, matches: 999 }] };
    const opts = { heroCounters: new Map(), heroPositions, calibration: EMPTY_CAL };

    // localSide "unknown": position_fit no aplica; patch_meta SÍ aplica estructuralmente pero
    // dataReady=false -> ninguna señal vota -> degenerado (no sólo "nada aplica", también "algo
    // aplica pero no está listo").
    const degen = draftState({ localSide: "unknown", picks: { radiant: [], dire: [] } });
    const degenReport = buildAvailableSignalsReport(degen, snapshot, opts);
    expect(degenReport.degenerate).toBe(true);
    expect(degenReport.decisionContext).toBe("no_signal_available");
    expect(bySignal(degenReport, "patch_meta").structurallyApplicable).toBe(true);
    expect(bySignal(degenReport, "patch_meta").dataReady).toBe(false);
    expect(buildSuggestions(degen, snapshot, opts).suggestions).toEqual([]);

    // Fijar el lado hace votar a position_fit -> se recupera el ranking normal.
    const live = draftState({ localSide: "radiant", picks: { radiant: [], dire: [] } });
    const liveReport = buildAvailableSignalsReport(live, snapshot, opts);
    expect(liveReport.degenerate).toBe(false);
    expect(liveReport.voting).toEqual(["position_fit"]);
    expect(liveReport.decisionContext).not.toBe("no_signal_available");
    expect(buildSuggestions(live, snapshot, opts).suggestions.length).toBeGreaterThan(0);
  });
});
