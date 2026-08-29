import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import type { HeroPositions } from "./hero-positions";
import type { HeroCapabilities } from "../draft-paths/types";
import { buildComparison, buildSuggestions, mixScore, type Suggestion } from "./mix";
import type { MetaHeroInfo, MetaSnapshot, SignalContribution } from "./types";
import { SCORING_WEIGHTS_V1, SCORING_WEIGHTS_V2, SCORING_WEIGHTS_V3, SCORING_WEIGHTS_V4, SCORING_WEIGHTS_V5, SCORING_WEIGHTS_V6 } from "./weights";

function fixtureSuggestion(rank: 1 | 2 | 3, hero: number, signals: SignalContribution[]): Suggestion {
  return { hero, rank, score: 0, signals, reason: "", confidence: "alta" };
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
describe("buildComparison", () => {
  test("identifica la señal con mayor ventaja del #1 sobre el #2, ignorando una señal empatada", () => {
    const top = fixtureSuggestion(1, 1, [
      { signal: "counter", raw: 0.3, weighted: 0, explanation: "", sampleSize: 10 }, // normaliza a 100
      { signal: "patch_meta", raw: 0.5, weighted: 0, explanation: "", sampleSize: 10 }, // normaliza a 50, igual en ambos
    ]);
    const second = fixtureSuggestion(2, 2, [
      { signal: "counter", raw: -0.3, weighted: 0, explanation: "", sampleSize: 10 }, // normaliza a 0
      { signal: "patch_meta", raw: 0.5, weighted: 0, explanation: "", sampleSize: 10 },
    ]);

    const comparison = buildComparison([top, second]);

    expect(comparison).not.toBeNull();
    expect(comparison?.vsHero).toBe(2);
    expect(comparison?.signal).toBe("counter");
    expect(comparison?.delta).toBeGreaterThan(0);
  });

  test("una señal con raw:null de un solo lado nunca es candidata, aunque numéricamente favorecería al #1", () => {
    const top = fixtureSuggestion(1, 1, [
      { signal: "counter", raw: 0.3, weighted: 0, explanation: "", sampleSize: 10 },
      { signal: "position_fit", raw: 1, weighted: 0, explanation: "", sampleSize: 0 }, // solo el #1 tiene dato
    ]);
    const second = fixtureSuggestion(2, 2, [
      { signal: "counter", raw: -0.3, weighted: 0, explanation: "", sampleSize: 10 },
      { signal: "position_fit", raw: null, weighted: 0, explanation: "", sampleSize: 0 },
    ]);

    const comparison = buildComparison([top, second]);

    // position_fit no cuenta como comparable (falta dato del lado del #2) -- counter es la única
    // señal con voto real en ambos lados, así que es la única que puede ganar.
    expect(comparison?.signal).toBe("counter");
  });

  test("una señal con applicable:false de un lado tampoco es comparable", () => {
    const top = fixtureSuggestion(1, 1, [
      { signal: "counter", raw: 0.3, weighted: 0, explanation: "", sampleSize: 10 },
      { signal: "hero_pool_fit", raw: 0.8, weighted: 0, explanation: "", sampleSize: 0 },
    ]);
    const second = fixtureSuggestion(2, 2, [
      { signal: "counter", raw: -0.3, weighted: 0, explanation: "", sampleSize: 10 },
      { signal: "hero_pool_fit", raw: null, weighted: 0, explanation: "", sampleSize: 0, applicable: false },
    ]);

    const comparison = buildComparison([top, second]);

    expect(comparison?.signal).toBe("counter");
  });

  test("empate exacto en todas las señales comparables -> null, nunca se inventa una comparación", () => {
    const signals: SignalContribution[] = [{ signal: "counter", raw: 0.1, weighted: 0, explanation: "", sampleSize: 10 }];
    const top = fixtureSuggestion(1, 1, signals);
    const second = fixtureSuggestion(2, 2, signals);

    expect(buildComparison([top, second])).toBeNull();
  });

  test("con menos de 2 sugerencias, no hay comparación", () => {
    const only = fixtureSuggestion(1, 1, [{ signal: "counter", raw: 0.3, weighted: 0, explanation: "", sampleSize: 10 }]);

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

  test("señal en null: el peso se redistribuye proporcionalmente, no se trata como 0", () => {
    // Equipo propio vacío -> team_synergy siempre null. Sin patchStats -> patch_meta null. Sin
    // heroPool -> hero_pool_fit no aplicable. Con heroPositions inyectado (S10) y n=0 (draft
    // vacío del lado propio), position_fit SÍ vota: hero 1 es carry puro (posición 1, 100% del
    // dato), need(1)=1 con equipo propio vacío -> fill=1, safety=0, t=TIMING_BLEND[0]=0.50 ->
    // raw = 0.5*1 + 0.5*0 = 0.5 -> normaliza a 50. counter normaliza a 100 (delta 0.4333 clamp a
    // 0.12, ver cálculo abajo). El score final es la redistribución proporcional real de V5 sobre
    // las 2 señales con dato, calculada con las constantes reales (no un número mágico
    // hardcodeado, para que un cambio de peso futuro no rompa este test en silencio).
    const state = draftState({ picks: { radiant: [], dire: [50] } });
    const snapshot = meta({
      1: { id: 1, localizedName: "Candidato" },
      50: { id: 50, localizedName: "Enemigo" },
    }, {
      matchups: {
        1: [
          { vsHero: 50, games: 300, wins: 280 }, // winrate vs 50 = 0.9333
          { vsHero: 60, games: 300, wins: 20 }, // baseline = (280+20)/600 = 0.5 -> delta = 0.4333, clamp a 0.3 -> normaliza a 100
        ],
      },
    });
    const heroPositions: HeroPositions = { 1: [{ position: 1, matches: 1000 }] };

    const result = buildSuggestions(state, snapshot, { heroPositions });
    const suggestion = result.suggestions.find((s) => s.hero === 1);

    expect(suggestion).toBeDefined();
    const totalWeight = SCORING_WEIGHTS_V5.counter + SCORING_WEIGHTS_V5.position_fit;
    const expectedScore = (100 * SCORING_WEIGHTS_V5.counter + 50 * SCORING_WEIGHTS_V5.position_fit) / totalWeight;
    expect(suggestion?.score).toBeCloseTo(expectedScore, 5);
    expect(suggestion?.confidence).toBe("baja"); // 2 señales en null (patch_meta, team_synergy)
    const nonNullSignals = suggestion?.signals.filter((s) => s.raw !== null) ?? [];
    expect(nonNullSignals.map((s) => s.signal).sort()).toEqual(["counter", "position_fit"]);
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
