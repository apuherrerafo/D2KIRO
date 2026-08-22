import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import type { HeroPositions } from "./hero-positions";
import { buildComparison, buildSuggestions, mixScore, type Suggestion } from "./mix";
import type { MetaHeroInfo, MetaSnapshot, SignalContribution } from "./types";
import { SCORING_WEIGHTS_V1, SCORING_WEIGHTS_V2, SCORING_WEIGHTS_V3, SCORING_WEIGHTS_V4 } from "./weights";

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
    ...overrides,
  };
}

function meta(heroes: Record<number, MetaHeroInfo>, overrides: Partial<MetaSnapshot> = {}): MetaSnapshot {
  return { heroes, matchups: {}, ...overrides };
}

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

// TSK-045 (Fase 3, SPEC.md §10.3, criterio de aceptación 3): el candado de regresión del bug que
// originó toda la fase. El bug real no era que `role_gap` calculara mal -- era que pesaba tan poco
// (0.108 contra 0.288 de `counter`) que perdía siempre. Probarlo contra `buildSuggestions`
// COMPLETO es el punto: `position_fit` aislada puede dar el número correcto (position-fit.test.ts
// ya lo prueba) y el ranking seguir mal si el peso no alcanza -- exactamente lo que pasaba antes.
describe("SCORING_WEIGHTS_V4 — candado de regresión del bug original", () => {
  test("los 5 pesos suman exactamente 1.0", () => {
    const sum = Object.values(SCORING_WEIGHTS_V4).reduce((a, b) => a + b, 0);
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

  test("mixScore redistribuye proporcionalmente entre las señales con dato real (candado de mecanismo, no de 'reproduce V1')", () => {
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
      SCORING_WEIGHTS_V4.counter + SCORING_WEIGHTS_V4.patch_meta + SCORING_WEIGHTS_V4.team_synergy + SCORING_WEIGHTS_V4.position_fit;
    const expected =
      (100 * SCORING_WEIGHTS_V4.counter + 0 * SCORING_WEIGHTS_V4.patch_meta + 50 * SCORING_WEIGHTS_V4.team_synergy + 75 * SCORING_WEIGHTS_V4.position_fit) /
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

    const result = buildSuggestions(state, snapshot, { heroPositions: HERO_POSITIONS });

    const top3Heroes = result.suggestions.map((s) => s.hero);
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
    expect(result.suggestions.length).toBeLessThanOrEqual(3);
    for (const suggestion of result.suggestions) {
      expect(suggestion.signals.some((s) => s.signal === "position_fit")).toBe(true);
    }
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
    // 0.3, ver cálculo abajo). El score final es la redistribución proporcional real de V4 sobre
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
    const totalWeight = SCORING_WEIGHTS_V4.counter + SCORING_WEIGHTS_V4.position_fit;
    const expectedScore = (100 * SCORING_WEIGHTS_V4.counter + 50 * SCORING_WEIGHTS_V4.position_fit) / totalWeight;
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
      .sort((a, b) => SCORING_WEIGHTS_V4[b.signal] - SCORING_WEIGHTS_V4[a.signal])
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
    expect(result.suggestions.length).toBeLessThanOrEqual(3);
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
