import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import { buildComparison, buildSuggestions, mixScore, type Suggestion } from "./mix";
import type { MetaHeroInfo, MetaSnapshot, SignalContribution } from "./types";
import { SCORING_WEIGHTS_V1, SCORING_WEIGHTS_V2, SCORING_WEIGHTS_V3 } from "./weights";

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
describe("SCORING_WEIGHTS_V2 — candado de regresión cero", () => {
  test("los 5 pesos suman exactamente 1.0", () => {
    const sum = Object.values(SCORING_WEIGHTS_V2).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  test("con hero_pool_fit no aplicable, mixScore redistribuye a exactamente los pesos de V1 (0.40/0.25/0.20/0.15)", () => {
    // raw elegidos para que cada señal normalice a un número distinto y verificable a mano:
    // counter->100 (tope de su rango), patch_meta->0 (piso), team_synergy->75, role_gap->50.
    const signals: SignalContribution[] = [
      { signal: "counter", raw: 0.3, weighted: 0, explanation: "", sampleSize: 10 },
      { signal: "patch_meta", raw: 0.3, weighted: 0, explanation: "", sampleSize: 10 },
      { signal: "team_synergy", raw: 0.75, weighted: 0, explanation: "", sampleSize: 0 },
      { signal: "role_gap", raw: -0.5, weighted: 0, explanation: "", sampleSize: 0 },
      { signal: "hero_pool_fit", raw: null, weighted: 0, explanation: "", sampleSize: 0, applicable: false },
    ];

    const score = mixScore(signals);

    // Esperado usando los pesos ORIGINALES de V1, no V2 crudo -- esto es lo que demuestra que la
    // redistribución proporcional reproduce V1 exactamente, no una aproximación.
    const expected = 100 * SCORING_WEIGHTS_V1.counter + 0 * SCORING_WEIGHTS_V1.patch_meta + 75 * SCORING_WEIGHTS_V1.team_synergy + 50 * SCORING_WEIGHTS_V1.role_gap;
    expect(score).toBeCloseTo(expected, 10);
  });

  test("un héroe en el pool con winrate alto recibe un score mayor que uno idéntico fuera del pool", () => {
    const state = draftState();
    const snapshot = meta(
      { 1: { id: 1, localizedName: "En el pool" }, 2: { id: 2, localizedName: "Fuera del pool" } },
      { heroPool: [{ hero: 1, source: "calculated", personalWinrate: 0.9, personalGames: 50, updatedAt: "2026-07-29" }] },
    );

    const result = buildSuggestions(state, snapshot);
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

    const result = buildSuggestions(state, snapshot);
    const suggestion = result.suggestions.find((s) => s.hero === 1);
    const poolSignal = suggestion?.signals.find((s) => s.signal === "hero_pool_fit");

    expect(poolSignal).toBeDefined();
    expect(poolSignal?.raw).toBeNull();
    expect(poolSignal?.applicable).toBe(false);
    // Mismo resultado que el test "señal en null" de arriba (2 nulls reales: patch_meta,
    // team_synergy) -- hero_pool_fit no aplicable no suma un tercer null a la cuenta.
    expect(suggestion?.confidence).toBe("baja");
  });
});

// TSK-027 (feedback real de producto): mismo candado que V2, ahora compuesto -- role_safety se
// suma a la lista de señales que pueden estar "fuera de juego" sin mover un punto el
// comportamiento de fase 1 para quien no usa ninguna de las dos funciones nuevas.
describe("SCORING_WEIGHTS_V3 — candado de regresión cero, doble", () => {
  test("los 6 pesos suman exactamente 1.0", () => {
    const sum = Object.values(SCORING_WEIGHTS_V3).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  test("con role_safety null (fuera de ventana) y hero_pool_fit no aplicable, mixScore redistribuye a exactamente los pesos de V1", () => {
    const signals: SignalContribution[] = [
      { signal: "counter", raw: 0.3, weighted: 0, explanation: "", sampleSize: 10 },
      { signal: "patch_meta", raw: 0.3, weighted: 0, explanation: "", sampleSize: 10 },
      { signal: "team_synergy", raw: 0.75, weighted: 0, explanation: "", sampleSize: 0 },
      { signal: "role_gap", raw: -0.5, weighted: 0, explanation: "", sampleSize: 0 },
      { signal: "hero_pool_fit", raw: null, weighted: 0, explanation: "", sampleSize: 0, applicable: false },
      { signal: "role_safety", raw: null, weighted: 0, explanation: "", sampleSize: 0 },
    ];

    const score = mixScore(signals);

    const expected = 100 * SCORING_WEIGHTS_V1.counter + 0 * SCORING_WEIGHTS_V1.patch_meta + 75 * SCORING_WEIGHTS_V1.team_synergy + 50 * SCORING_WEIGHTS_V1.role_gap;
    expect(score).toBeCloseTo(expected, 10);
  });

  test("primer pick propio: un candidato Support puntúa más que un candidato Carry idéntico en todo lo demás (caso original del reporte del usuario)", () => {
    const state = draftState({ picks: { radiant: [], dire: [] } });
    const snapshot = meta({
      1: { id: 1, localizedName: "Support A", roles: ["Support"] },
      2: { id: 2, localizedName: "Carry A", roles: ["Carry"] },
    });

    const result = buildSuggestions(state, snapshot);
    const support = result.suggestions.find((s) => s.hero === 1);
    const carry = result.suggestions.find((s) => s.hero === 2);

    expect(support).toBeDefined();
    expect(carry).toBeDefined();
    expect(support!.score).toBeGreaterThan(carry!.score);
  });

  test("pick propio 3 en adelante: role_safety ya no diferencia (ambos candidatos empatan en esa señal)", () => {
    const state = draftState({ picks: { radiant: [10, 11], dire: [] } });
    const snapshot = meta({
      1: { id: 1, localizedName: "Support A", roles: ["Support"] },
      2: { id: 2, localizedName: "Carry A", roles: ["Carry"] },
    });

    const result = buildSuggestions(state, snapshot);
    const support = result.suggestions.find((s) => s.hero === 1);
    const carry = result.suggestions.find((s) => s.hero === 2);

    const supportRoleSafety = support?.signals.find((s) => s.signal === "role_safety");
    const carryRoleSafety = carry?.signals.find((s) => s.signal === "role_safety");
    expect(supportRoleSafety?.raw).toBeNull();
    expect(carryRoleSafety?.raw).toBeNull();
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
      { signal: "role_safety", raw: 1, weighted: 0, explanation: "", sampleSize: 0 }, // solo el #1 tiene dato
    ]);
    const second = fixtureSuggestion(2, 2, [
      { signal: "counter", raw: -0.3, weighted: 0, explanation: "", sampleSize: 10 },
      { signal: "role_safety", raw: null, weighted: 0, explanation: "", sampleSize: 0 },
    ]);

    const comparison = buildComparison([top, second]);

    // role_safety no cuenta como comparable (falta dato del lado del #2) -- counter es la única
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
    // Equipo propio vacío -> team_synergy siempre null. Sin patchStats -> patch_meta null.
    // counter y role_gap normalizan ambos a exactamente 100. role_safety también vota ahora
    // (TSK-027): 0 picks propios está dentro de su ventana, el candidato no tiene rol Support ->
    // raw:0, normaliza a 0. El score ya no es 100 puro -- es la redistribución proporcional real
    // de V3 sobre las 3 señales con dato, calculada abajo con las constantes reales (no un número
    // mágico hardcodeado, para que un cambio de peso futuro no rompa este test en silencio).
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

    const result = buildSuggestions(state, snapshot);
    const suggestion = result.suggestions.find((s) => s.hero === 1);

    expect(suggestion).toBeDefined();
    const totalWeight = SCORING_WEIGHTS_V3.counter + SCORING_WEIGHTS_V3.role_gap + SCORING_WEIGHTS_V3.role_safety;
    const expectedScore =
      (100 * SCORING_WEIGHTS_V3.counter + 100 * SCORING_WEIGHTS_V3.role_gap + 0 * SCORING_WEIGHTS_V3.role_safety) / totalWeight;
    expect(suggestion?.score).toBeCloseTo(expectedScore, 5);
    expect(suggestion?.confidence).toBe("baja"); // 2 señales en null (patch_meta, team_synergy)
    const nonNullSignals = suggestion?.signals.filter((s) => s.raw !== null) ?? [];
    expect(nonNullSignals.map((s) => s.signal).sort()).toEqual(["counter", "role_gap", "role_safety"]);
  });

  test("Suggestion.reason es trazable a los signals de esa sugerencia", () => {
    const state = draftState({ picks: { radiant: [], dire: [50] } });
    const snapshot = meta(
      { 1: { id: 1, localizedName: "Candidato" }, 50: { id: 50, localizedName: "Enemigo" } },
      { matchups: { 1: [{ vsHero: 50, games: 300, wins: 280 }, { vsHero: 60, games: 300, wins: 20 }] } },
    );

    const result = buildSuggestions(state, snapshot);
    const suggestion = result.suggestions[0];

    // buildReason muestra las 2 señales de mayor peso con dato real, no todas -- con 3 señales
    // reales ahora (counter/role_gap/role_safety, TSK-027), solo las 2 más pesadas entran.
    const topTwoByWeight = (suggestion?.signals.filter((s) => s.raw !== null) ?? [])
      .sort((a, b) => SCORING_WEIGHTS_V3[b.signal] - SCORING_WEIGHTS_V3[a.signal])
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

  test("adjunta comparison de punta a punta: en el escenario support-vs-carry (TSK-027), role_safety es la señal decisiva", () => {
    const state = draftState({ picks: { radiant: [], dire: [] } });
    const snapshot = meta({
      1: { id: 1, localizedName: "Support A", roles: ["Support"] },
      2: { id: 2, localizedName: "Carry A", roles: ["Carry"] },
    });

    const result = buildSuggestions(state, snapshot);
    const support = result.suggestions.find((s) => s.hero === 1);

    expect(support?.rank).toBe(1);
    expect(result.comparison).not.toBeNull();
    expect(result.comparison?.vsHero).toBe(2);
    expect(result.comparison?.signal).toBe("role_safety");
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

    const result = buildSuggestions(state, snapshot, { metaIsStale: true });

    expect(result.degraded).toContain("stale_meta");
    expect(result.suggestions.every((s) => s.confidence !== "alta")).toBe(true);
  });
});
