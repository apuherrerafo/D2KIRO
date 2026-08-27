import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { OPENING_REPEAT_STRATEGY_PENALTY, OPENING_TOP_N, positionFitScore, runProDrafterPipeline } from "./run-pipeline";
import type { PipelineWeights } from "./weight-loader";
import type { DraftCandidate } from "../knn/corpus";
import { buildDraftIndex } from "../knn/draft-index";
import type { HeroLineProfile } from "../lane/profiles";
import type { HeroCapabilities } from "../draft-paths/types";
import type { HeroMatchupStat } from "../signals/types";
import type { HeroPositions } from "../signals/hero-positions";
import type { DraftState, HeroId } from "../draft/reducer";

// Local builder, autocontenido por archivo (mismo criterio que el resto del motor,
// testing-seams.md).
function draftState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    sessionId: "s1",
    schema: "draft-state/v1",
    format: "all_pick",
    patch: "7.35d",
    localSide: "radiant",
    phase: "active",
    banned: [],
    picks: { radiant: [], dire: [] },
    lastSeq: 0,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: new Date(0).toISOString(),
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    ...overrides,
  };
}

// heroId 1: 800/200 en pos1/pos2 (roleWeight 0.8). héroes 10/11 dan al rival un flex target real
// (10: 50/50 pos4/pos5, entropía 1; 11: especialista, entropía 0 -- 10 gana como target).
const HERO_POSITIONS: HeroPositions = {
  1: [
    { position: 1, matches: 800 },
    { position: 2, matches: 200 },
  ],
  10: [
    { position: 4, matches: 500 },
    { position: 5, matches: 500 },
  ],
  11: [{ position: 5, matches: 1000 }],
};

const PROFILES = new Map<HeroId, HeroLineProfile>([
  [1, { heroId: 1, sustain: 0.5, killPressure: 0.5, harassRange: 0.5, dispelSave: 0.5, creepControl: 0.5 }],
  [2, { heroId: 2, sustain: 0.8, killPressure: 0.2, harassRange: 0.3, dispelSave: 0.4, creepControl: 0.6 }],
  [10, { heroId: 10, sustain: 0.3, killPressure: 0.7, harassRange: 0.6, dispelSave: 0.2, creepControl: 0.3 }],
  [11, { heroId: 11, sustain: 0.4, killPressure: 0.5, harassRange: 0.4, dispelSave: 0.3, creepControl: 0.5 }],
  // Perfiles opuestos a propósito (ver test "usa TODO el roster" más abajo) -- si el pipeline
  // siguiera mirando solo el primer aliado/los dos primeros rivales, agregar estos dos picks no
  // cambiaría ningún resultado.
  [3, { heroId: 3, sustain: 0.1, killPressure: 0.9, harassRange: 0.1, dispelSave: 0.9, creepControl: 0.1 }],
  [12, { heroId: 12, sustain: 0.9, killPressure: 0.1, harassRange: 0.9, dispelSave: 0.1, creepControl: 0.9 }],
]);

const WEIGHTS: PipelineWeights = { knn_similarity: 0.4, lane_score: 0.35, denial_score: 0.25 };

test("positionFitScore refleja la posición objetivo sin inventar presencia", () => {
  expect(positionFitScore(1, 5, { 1: [{ position: 5, matches: 800 }, { position: 4, matches: 200 }] })).toBeCloseTo(0.8, 9);
  expect(positionFitScore(2, 5, { 2: [{ position: 3, matches: 500 }] })).toBe(0);
});

const STATE = draftState({ picks: { radiant: [1], dire: [10, 11] } });

test("candidato único con datos completos en las 3 etapas -- número final exacto, trazable a mano", () => {
  // Equipos de 2 (no 5) a propósito: nada en run-pipeline.ts asume tamaño de equipo, y un corpus
  // mínimo hace el número final verificable a mano sin ambigüedad de ranking (S9/S10: fixture
  // sintético, nunca datos reales).
  const corpus: DraftCandidate[] = [
    { draftId: "m1", patch: "7.35d", radiantHeroes: [1, 2], direHeroes: [10, 11], winningSide: "radiant" },
  ];
  const index = buildDraftIndex(corpus, "7.35d");

  const results = runProDrafterPipeline(STATE, index, corpus, HERO_POSITIONS, WEIGHTS, PROFILES);

  expect(results).toHaveLength(1);
  const hero2 = results[0];
  expect(hero2?.heroId).toBe(2);

  const knnRaw = 0.8 / 1.8; // sim(own=[1], m1): intersección {1} peso 0.8, unión {1,2} peso 1.8
  // Φ_k por dimensión (ally=[hero2,hero1] vs enemy=[hero10,hero11]), pesos iguales 0.2 c/u:
  // sustain +0.30, killPressure -0.25, harassRange -0.10, dispelSave +0.20, creepControl +0.15
  const laneWeightedSum = 0.2 * (0.3 - 0.25 - 0.1 + 0.2 + 0.15);
  const laneRaw = 1 / (1 + Math.exp(-laneWeightedSum));
  // Gobernanza 2.0 (ampliación 5v5): denial_score ya no mira solo al rival de mayor entropía --
  // promedia el denial contra CADA rival confirmado (acá los 2, hero10 y hero11).
  // matchupWinrate(2,10,*)=1.0 (único enfrentamiento hero2 vs hero10 en el corpus, hero2 ganó);
  // hero10 tiene 2 posiciones 50/50 (entropía 1); earlyPressure(2)=killPressure=0.2
  const denialRaw10 = 1.0 * 0.5 + 1.0 * 0.5 + 0.5 * 0.2 * 1; // 1.1
  // matchupWinrate(2,11,*)=1.0 (único enfrentamiento hero2 vs hero11, hero2 ganó); hero11 tiene
  // una única posición registrada (pos5, 100% de probabilidad, entropía 0)
  const denialRaw11 = 1.0 * 1.0 + 0.5 * 0.2 * 0; // 1.0
  const denialRaw = (denialRaw10 + denialRaw11) / 2; // 1.05 -- promedio sobre los 2 rivales

  expect(hero2?.signals.find((s) => s.signal === "knn_similarity")?.raw).toBeCloseTo(knnRaw, 10);
  expect(hero2?.signals.find((s) => s.signal === "lane_score")?.raw).toBeCloseTo(laneRaw, 10);
  expect(hero2?.signals.find((s) => s.signal === "denial_score")?.raw).toBeCloseTo(denialRaw, 10);

  // Fase 6 (SPEC.md §13.4): STATE tiene own=1 (radiant:[1]), enemy=2 (dire:[10,11]) ->
  // confirmed=3, t=openingBlend(1,2)=0.25. Pesos decaídos: knn=0.4*(1-0.25)=0.3, lane=0.35 sin
  // cambio, denial=1-0.3-0.35=0.35 (por resta, no por suma directa de WEIGHTS.denial_score).
  const phaseWeights = { knn_similarity: 0.3, lane_score: 0.2875, denial_score: 0.4125 };
  const expectedScore =
    (knnRaw / 1) * 100 * phaseWeights.knn_similarity +
    (laneRaw / 1) * 100 * phaseWeights.lane_score +
    (denialRaw / 2) * 100 * phaseWeights.denial_score;
  expect(hero2?.score).toBeCloseTo(expectedScore, 6);
});

test("lane_score usa TODO el roster confirmado, no solo el 1er aliado y los 2 primeros rivales (ampliación 5v5)", () => {
  const corpus: DraftCandidate[] = [
    { draftId: "m1", patch: "7.35d", radiantHeroes: [1, 2], direHeroes: [10, 11], winningSide: "radiant" },
  ];
  const index = buildDraftIndex(corpus, "7.35d");

  const narrowState = draftState({ picks: { radiant: [1], dire: [10, 11] } });
  // 3er aliado (hero3) y 3er rival (hero12) con perfiles OPUESTOS a los ya presentes (ver
  // PROFILES) -- si el pipeline siguiera con la ventana fija de antes, agregarlos no cambiaría
  // nada. Que sí cambie es la prueba real de que el roster completo entra al cálculo, no un
  // número exacto (eso ya lo cubre lane/evaluate.test.ts para la aritmética pura de la mezcla).
  const widerState = draftState({ picks: { radiant: [1, 3], dire: [10, 11, 12] } });

  const narrowResults = runProDrafterPipeline(narrowState, index, corpus, HERO_POSITIONS, WEIGHTS, PROFILES);
  const widerResults = runProDrafterPipeline(widerState, index, corpus, HERO_POSITIONS, WEIGHTS, PROFILES);

  const narrowLane = narrowResults.find((r) => r.heroId === 2)?.signals.find((s) => s.signal === "lane_score")?.raw;
  const widerLane = widerResults.find((r) => r.heroId === 2)?.signals.find((s) => s.signal === "lane_score")?.raw;

  expect(narrowLane).not.toBeNull();
  expect(widerLane).not.toBeNull();
  expect(widerLane).not.toBeCloseTo(narrowLane ?? Number.NaN, 6);
});

test("denial_score promedia contra TODOS los rivales confirmados, no solo el de mayor entropía (ampliación 5v5)", () => {
  const corpus: DraftCandidate[] = [
    { draftId: "m1", patch: "7.35d", radiantHeroes: [1, 2], direHeroes: [10, 11], winningSide: "radiant" },
  ];
  const index = buildDraftIndex(corpus, "7.35d");
  const state = draftState({ picks: { radiant: [1], dire: [10, 11] } });

  const results = runProDrafterPipeline(state, index, corpus, HERO_POSITIONS, WEIGHTS, PROFILES);
  const denialRaw = results.find((r) => r.heroId === 2)?.signals.find((s) => s.signal === "denial_score")?.raw;

  // hero11 (entropía 0) antes quedaba totalmente descartado -- el promedio (1.05) es distinto de
  // lo que daría mirar solo a hero10 (1.1, el de mayor entropía, comportamiento viejo).
  expect(denialRaw).toBeCloseTo(1.05, 10);
  expect(denialRaw).not.toBeCloseTo(1.1, 6);
});

test("nunca devuelve más de 3 candidatos, siempre ordenados descendente por score", () => {
  const corpus: DraftCandidate[] = [
    { draftId: "e1", patch: "7.35d", radiantHeroes: [1, 2, 3, 4, 5], direHeroes: [10, 11, 12, 13, 14], winningSide: "radiant" },
    { draftId: "e2", patch: "7.35d", radiantHeroes: [1, 6, 7, 8, 9], direHeroes: [10, 11, 15, 16, 17], winningSide: "radiant" },
    { draftId: "e3", patch: "7.35d", radiantHeroes: [20, 21, 22, 23, 24], direHeroes: [1, 2, 25, 26, 27], winningSide: "dire" },
  ];
  const index = buildDraftIndex(corpus, "7.35d");

  const results = runProDrafterPipeline(STATE, index, corpus, HERO_POSITIONS, WEIGHTS, PROFILES);

  expect(results.length).toBeLessThanOrEqual(3);
  const scores = results.map((r) => r.score);
  for (let i = 1; i < scores.length; i++) {
    expect(scores[i - 1] ?? -Infinity).toBeGreaterThanOrEqual(scores[i] ?? -Infinity);
  }
  // ningún resultado repite un héroe baneado/pickeado (1, 10, 11)
  for (const r of results) expect([1, 10, 11]).not.toContain(r.heroId);
});

test("candidato sin perfil curado y ausente de todo vecino ganador -- degrada sin lanzar", () => {
  const corpus: DraftCandidate[] = [
    { draftId: "d1", patch: "7.35d", radiantHeroes: [1], direHeroes: [10, 11], winningSide: "radiant" },
    { draftId: "d2", patch: "7.35d", radiantHeroes: [10, 11], direHeroes: [1, 99], winningSide: "radiant" }, // 99 pierde
  ];
  const index = buildDraftIndex(corpus, "7.35d");

  const results = runProDrafterPipeline(STATE, index, corpus, HERO_POSITIONS, WEIGHTS, PROFILES);

  expect(results).toHaveLength(1);
  const hero99 = results[0];
  expect(hero99?.heroId).toBe(99);
  // sin perfil -- lane_score se calcula igual (sustitución neutra, 6.3), nunca null
  expect(hero99?.signals.find((s) => s.signal === "lane_score")?.raw).not.toBeNull();
  // nunca aparece en el lado ganador de ningún vecino -- knn_similarity cae a null
  expect(hero99?.signals.find((s) => s.signal === "knn_similarity")?.raw).toBeNull();
  expect(Number.isFinite(hero99?.score)).toBe(true);
});

test("sin picks rivales confirmados -- denial_score cae a null para todos, el pipeline no rompe", () => {
  const corpus: DraftCandidate[] = [
    { draftId: "m1", patch: "7.35d", radiantHeroes: [1, 2], direHeroes: [10, 11], winningSide: "radiant" },
  ];
  const index = buildDraftIndex(corpus, "7.35d");
  const noEnemyState = draftState({ picks: { radiant: [1], dire: [] } });

  const results = runProDrafterPipeline(noEnemyState, index, corpus, HERO_POSITIONS, WEIGHTS, PROFILES);

  expect(results.length).toBeGreaterThan(0);
  for (const r of results) {
    expect(r.signals.find((s) => s.signal === "denial_score")?.raw).toBeNull();
    expect(Number.isFinite(r.score)).toBe(true);
  }
});

test("Fase 6: con own+enemy >= 4, los pesos por fase son idénticos a WEIGHTS (fase media/tardía sin cambios)", () => {
  const corpus: DraftCandidate[] = [
    { draftId: "m1", patch: "7.35d", radiantHeroes: [1, 2], direHeroes: [10, 11], winningSide: "radiant" },
  ];
  const index = buildDraftIndex(corpus, "7.35d");
  // own=[1,3] (2), enemy=[10,11,12] (3) -> confirmed=5 >= 4
  const lateState = draftState({ picks: { radiant: [1, 3], dire: [10, 11, 12] } });

  const withBaseWeights = runProDrafterPipeline(lateState, index, corpus, HERO_POSITIONS, WEIGHTS, PROFILES);
  const hero2 = withBaseWeights.find((r) => r.heroId === 2)!;

  const knnRaw = hero2.signals.find((s) => s.signal === "knn_similarity")?.raw ?? 0;
  const laneRaw = hero2.signals.find((s) => s.signal === "lane_score")?.raw ?? 0;
  const denialRaw = hero2.signals.find((s) => s.signal === "denial_score")?.raw ?? 0;
  // Mismas escalas de normalización que merge.ts (knn/lane en [0,1], denial en [0,2]) -- ver el
  // primer test de este archivo para el mismo patrón de cálculo a mano.
  const expectedScore =
    (knnRaw / 1) * 100 * WEIGHTS.knn_similarity +
    (laneRaw / 1) * 100 * WEIGHTS.lane_score +
    (denialRaw / 2) * 100 * WEIGHTS.denial_score;
  expect(hero2.score).toBeCloseTo(expectedScore, 6);
});

test("Fase 6: options.matchups inyectado usa la fuente real en vez del proxy del corpus", () => {
  const corpus: DraftCandidate[] = [
    { draftId: "m1", patch: "7.35d", radiantHeroes: [1, 2], direHeroes: [10, 11], winningSide: "radiant" },
  ];
  const index = buildDraftIndex(corpus, "7.35d");

  const withoutMatchups = runProDrafterPipeline(STATE, index, corpus, HERO_POSITIONS, WEIGHTS, PROFILES);
  // Datos reales opuestos a lo que el corpus proxy diría (corpus: hero2 le ganó a hero10/11
  // siempre) -- si la fuente real está conectada, el denial_score debe cambiar.
  const withMatchups = runProDrafterPipeline(STATE, index, corpus, HERO_POSITIONS, WEIGHTS, PROFILES, {
    matchups: { 2: [{ vsHero: 10, games: 500, wins: 100 }, { vsHero: 11, games: 500, wins: 100 }] },
  });

  const denialWithout = withoutMatchups.find((r) => r.heroId === 2)?.signals.find((s) => s.signal === "denial_score")?.raw;
  const denialWith = withMatchups.find((r) => r.heroId === 2)?.signals.find((s) => s.signal === "denial_score")?.raw;

  expect(denialWithout).not.toBeNull();
  expect(denialWith).not.toBeNull();
  expect(denialWith).not.toBeCloseTo(denialWithout ?? Number.NaN, 6);
});

test("pool de candidatos vacío (corpus vacío) -> [] sin lanzar", () => {
  const index = buildDraftIndex([], "7.35d");
  const results = runProDrafterPipeline(STATE, index, [], HERO_POSITIONS, WEIGHTS, PROFILES);
  expect(results).toEqual([]);
});

// Activación deliberada (sesión 2026-08-24, decisión explícita del usuario -- no un /blueprint
// formal, esta sesión ES el gate): server/ ya no está completamente aislado de pipeline/, pero
// sigue habiendo exactamente UN punto de entrada real (routes/pro-drafter.ts), nunca uno disperso
// en app.ts u otro archivo. El gate real que mantiene "producción sin cambios" es el flag
// ENABLE_PRO_DRAFTER en app.ts, no la ausencia total de imports -- verificado abajo.
test("server/ importa pipeline/ solo desde el punto de entrada deliberado (routes/pro-drafter.ts)", () => {
  const serverDir = join(import.meta.dir, "..", "server");
  const files = readdirSync(serverDir, { recursive: true }) as string[];
  const tsFiles = files.filter((f) => f.endsWith(".ts"));
  expect(tsFiles.length).toBeGreaterThan(0);

  const importsPipeline = /from\s+["'][^"']*\/pipeline\/[^"']*["']/;
  const filesImportingPipeline = tsFiles.filter((file) => importsPipeline.test(readFileSync(join(serverDir, file), "utf-8")));

  expect(filesImportingPipeline).toEqual(["routes/pro-drafter.ts"]);
});

test("app.ts gatea el pipeline experimental tras ENABLE_PRO_DRAFTER -- nunca activo por default", () => {
  const appContent = readFileSync(join(import.meta.dir, "..", "server", "app.ts"), "utf-8");
  expect(appContent.includes('process.env.ENABLE_PRO_DRAFTER !== "true"')).toBe(true);
});

test("pipeline completo sobre un corpus sintético se mantiene rápido", () => {
  // Objetivo real del doc (pro-drafter-spec-v1.md §3): ~3.2ms promedio total para el pipeline
  // secuencial -- distinto del presupuesto de sistema de <10ms/pick que da el doc en su resumen
  // ejecutivo (§1), un piso más arriba en la pila. El assertion usa un margen generoso a
  // propósito para no volverse flaky en CI compartido (documentado en el plan de Fase 5-8): esto
  // prueba ausencia de una regresión de orden de magnitud, no el número exacto.
  const corpus: DraftCandidate[] = Array.from({ length: 150 }, (_, i) => ({
    draftId: `perf-${i}`,
    patch: "7.35d",
    radiantHeroes: [0, 1, 2, 3, 4].map((k) => ((i + k) % 60) + 1),
    direHeroes: [5, 6, 7, 8, 9].map((k) => ((i + k) % 60) + 1),
    winningSide: i % 2 === 0 ? "radiant" : ("dire" as const),
  }));
  const index = buildDraftIndex(corpus, "7.35d");
  const state = draftState({ picks: { radiant: [1], dire: [2, 3] } });

  runProDrafterPipeline(state, index, corpus, {}, WEIGHTS, new Map()); // warm-up

  const start = performance.now();
  runProDrafterPipeline(state, index, corpus, {}, WEIGHTS, new Map());
  const elapsedMs = performance.now() - start;

  expect(elapsedMs).toBeLessThan(80);
});

// ---------------------------------------------------------------------------
// Fase 6 (SPEC.md §13.8/§13.9): modo teamOpening. Fixture propio, aislado de los tests de arriba.
// ---------------------------------------------------------------------------

const OPENING_CORPUS: DraftCandidate[] = [
  { draftId: "o1", patch: "7.41e", radiantHeroes: [1, 2, 3, 4, 5], direHeroes: [6, 7, 8, 9, 10, 11], winningSide: "radiant" },
];
const OPENING_INDEX = buildDraftIndex(OPENING_CORPUS, "7.41e");

// Todos comprometidos a una sola posición (entropía 0) -- 2 y 9 comparten posición con el ban 90
// (pos1) a propósito, para que el alivio por solapamiento posicional los alcance.
const OPENING_POSITIONS: HeroPositions = {
  1: [{ position: 2, matches: 500 }],
  2: [{ position: 1, matches: 500 }],
  3: [{ position: 2, matches: 500 }],
  4: [{ position: 3, matches: 500 }],
  5: [{ position: 4, matches: 500 }],
  6: [{ position: 5, matches: 500 }],
  7: [{ position: 3, matches: 500 }],
  8: [{ position: 4, matches: 500 }],
  9: [{ position: 1, matches: 500 }],
  10: [{ position: 5, matches: 500 }],
  11: [{ position: 5, matches: 500 }], // baseline muy malo a propósito -- ver hero11 en profiles
  90: [{ position: 1, matches: 500 }], // ban "counter real": comprometido, H=0
  // 92 -- deliberadamente AUSENTE de heroPositions: cae en la uniforme, H=log2(5) máxima.
};

// Baseline (sin bans) por lane_score: 1 > 3 > 4 > 5 > 6 (top 5) > 7 > 8 > 2 > 9 > 10 -- 2 y 9
// quedan fuera del top-5 a propósito, para que el alivio por ban sea lo que los meta adentro.
const OPENING_PROFILES = new Map<HeroId, HeroLineProfile>([
  [1, { heroId: 1, sustain: 0.62, killPressure: 0.5, harassRange: 0.5, dispelSave: 0.5, creepControl: 0.5 }],
  [3, { heroId: 3, sustain: 0.58, killPressure: 0.5, harassRange: 0.5, dispelSave: 0.5, creepControl: 0.5 }],
  [4, { heroId: 4, sustain: 0.56, killPressure: 0.5, harassRange: 0.5, dispelSave: 0.5, creepControl: 0.5 }],
  [5, { heroId: 5, sustain: 0.54, killPressure: 0.5, harassRange: 0.5, dispelSave: 0.5, creepControl: 0.5 }],
  [6, { heroId: 6, sustain: 0.52, killPressure: 0.5, harassRange: 0.5, dispelSave: 0.5, creepControl: 0.5 }],
  [7, { heroId: 7, sustain: 0.5, killPressure: 0.5, harassRange: 0.5, dispelSave: 0.5, creepControl: 0.48 }],
  [8, { heroId: 8, sustain: 0.5, killPressure: 0.5, harassRange: 0.5, dispelSave: 0.5, creepControl: 0.47 }],
  [2, { heroId: 2, sustain: 0.5, killPressure: 0.5, harassRange: 0.5, dispelSave: 0.5, creepControl: 0.46 }],
  [9, { heroId: 9, sustain: 0.5, killPressure: 0.5, harassRange: 0.5, dispelSave: 0.5, creepControl: 0.45 }],
  [10, { heroId: 10, sustain: 0.5, killPressure: 0.5, harassRange: 0.5, dispelSave: 0.5, creepControl: 0.44 }],
  // Muy por debajo del resto a propósito (sustain 0.1 vs ~0.5) -- su desventaja de score excede
  // por mucho OPENING_REPEAT_STRATEGY_PENALTY(4.0), así que ninguna diversificación debería
  // meterlo al top-5 aunque sea la única estrategia distinta disponible (criterio 9b).
  [11, { heroId: 11, sustain: 0.1, killPressure: 0.5, harassRange: 0.5, dispelSave: 0.5, creepControl: 0.5 }],
]);

const OPENING_WEIGHTS: PipelineWeights = { knn_similarity: 0.4, lane_score: 0.35, denial_score: 0.25 };

function openingState(banned: HeroId[]): DraftState {
  return draftState({ localSide: "radiant", picks: { radiant: [], dire: [] }, banned });
}

// Counters reales (H=0): héroes 2 y 9 pierden feo contra el héroe 90 (banearlo los alivia).
const COUNTER_MATCHUPS: Record<HeroId, HeroMatchupStat[]> = {
  2: [{ vsHero: 90, games: 400, wins: 100 }], // wr 0.25 -- muy adverso
  9: [{ vsHero: 90, games: 400, wins: 100 }],
};

test("Fase 6 (criterio 1): la apertura devuelve 5, no 3", () => {
  const results = runProDrafterPipeline(openingState([]), OPENING_INDEX, OPENING_CORPUS, OPENING_POSITIONS, OPENING_WEIGHTS, OPENING_PROFILES, {
    teamOpening: true,
  });
  expect(results).toHaveLength(OPENING_TOP_N);
  expect(OPENING_TOP_N).toBe(5);
});

test("Fase 6 (criterio 2): determinismo -- misma corrida, mismo orden y mismos scores", () => {
  const run = () =>
    runProDrafterPipeline(openingState([90]), OPENING_INDEX, OPENING_CORPUS, OPENING_POSITIONS, OPENING_WEIGHTS, OPENING_PROFILES, {
      teamOpening: true,
      matchups: COUNTER_MATCHUPS,
    });
  const first = run();
  const second = run();
  expect(second.map((r) => r.heroId)).toEqual(first.map((r) => r.heroId));
  expect(second.map((r) => r.score)).toEqual(first.map((r) => r.score));
});

test("Fase 6 (criterio 4): sin bans, denial_score es raw:null para los 5, nunca 0", () => {
  const results = runProDrafterPipeline(openingState([]), OPENING_INDEX, OPENING_CORPUS, OPENING_POSITIONS, OPENING_WEIGHTS, OPENING_PROFILES, {
    teamOpening: true,
  });
  expect(results).toHaveLength(5);
  for (const r of results) {
    expect(r.signals.find((s) => s.signal === "denial_score")?.raw).toBeNull();
  }
});

test("Fase 6 (criterio 5): knn_similarity es null para todos en apertura", () => {
  const results = runProDrafterPipeline(openingState([90]), OPENING_INDEX, OPENING_CORPUS, OPENING_POSITIONS, OPENING_WEIGHTS, OPENING_PROFILES, {
    teamOpening: true,
    matchups: COUNTER_MATCHUPS,
  });
  for (const r of results) {
    expect(r.signals.find((s) => s.signal === "knn_similarity")?.raw).toBeNull();
  }
});

test("Fase 6 (criterio 3, el criterio de éxito real de la fase): dos conjuntos de bans contrastantes producen un top-5 que difiere en >=2 héroes y en el rank 1", () => {
  const withCounterBan = runProDrafterPipeline(
    openingState([90]),
    OPENING_INDEX,
    OPENING_CORPUS,
    OPENING_POSITIONS,
    OPENING_WEIGHTS,
    OPENING_PROFILES,
    { teamOpening: true, matchups: COUNTER_MATCHUPS },
  );
  // 92: alta entropía (sin entrada en heroPositions), sin matchup adverso -- no debería reordenar
  // nada, solo dar un empujón uniforme a todos los comprometidos (mismo commitment=1 para todos).
  const withFlexBan = runProDrafterPipeline(
    openingState([92]),
    OPENING_INDEX,
    OPENING_CORPUS,
    OPENING_POSITIONS,
    OPENING_WEIGHTS,
    OPENING_PROFILES,
    { teamOpening: true, matchups: {} },
  );

  const topA = withCounterBan.map((r) => r.heroId);
  const topB = withFlexBan.map((r) => r.heroId);

  const onlyInA = topA.filter((h) => !topB.includes(h));
  const onlyInB = topB.filter((h) => !topA.includes(h));
  expect(onlyInA.length + onlyInB.length).toBeGreaterThanOrEqual(2);
  expect(topA[0]).not.toBe(topB[0]);

  // criterio 8: ningún raw de denial_score supera 2 (normalize() nunca clampea) en este fixture.
  for (const r of [...withCounterBan, ...withFlexBan]) {
    const denial = r.signals.find((s) => s.signal === "denial_score")?.raw;
    if (denial !== null && denial !== undefined) expect(denial).toBeLessThanOrEqual(2);
  }
});

test("Fase 6 (criterio 9a): diversificación -- un candidato de otra estrategia entra si su desventaja es menor que OPENING_REPEAT_STRATEGY_PENALTY", () => {
  // 5 candidatos "push" con scores muy cercanos entre sí, un 6to "scaling" apenas 1 punto por
  // debajo del 5to -- por debajo del margen de 4.0, debe entrar desplazando al que repite estrategia.
  const capabilities: HeroCapabilities[] = [
    { hero: 1, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "high", teamfight: "low", scaling: "low" },
    { hero: 3, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "high", teamfight: "low", scaling: "low" },
    { hero: 4, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "high", teamfight: "low", scaling: "low" },
    { hero: 5, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "high", teamfight: "low", scaling: "low" },
    { hero: 6, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "high", teamfight: "low", scaling: "low" },
    { hero: 7, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "low", teamfight: "low", scaling: "low" }, // scaling
  ];
  const results = runProDrafterPipeline(openingState([]), OPENING_INDEX, OPENING_CORPUS, OPENING_POSITIONS, OPENING_WEIGHTS, OPENING_PROFILES, {
    teamOpening: true,
    heroCapabilities: capabilities,
  });
  // Con el fixture baseline (1>3>4>5>6>7 por lane_score), 1/3/4/5/6 son todos "push" -- sin
  // diversificación, hero7 ("scaling", 6to lugar) nunca entraría al top-5. Con la penalización de
  // 4.0 aplicada a partir del 2do "push" repetido, hero7 sí entra desplazando a hero6.
  expect(results.map((r) => r.heroId)).toContain(7);
  expect(results).toHaveLength(5);
});

test("Fase 6 (criterio 9b): un candidato de otra estrategia NO entra si su desventaja excede la penalización", () => {
  // hero11: mismo "scaling" que hero7 en la prueba anterior, pero con un baseline muy por debajo
  // (sustain 0.1 vs ~0.5 del resto) -- su desventaja de score excede por mucho los 4.0 puntos de
  // OPENING_REPEAT_STRATEGY_PENALTY, así que nunca debería desplazar a un "push" mejor puntuado.
  const capabilities: HeroCapabilities[] = [
    { hero: 1, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "high", teamfight: "low", scaling: "low" },
    { hero: 3, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "high", teamfight: "low", scaling: "low" },
    { hero: 4, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "high", teamfight: "low", scaling: "low" },
    { hero: 5, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "high", teamfight: "low", scaling: "low" },
    { hero: 6, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "high", teamfight: "low", scaling: "low" },
    { hero: 11, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "low", teamfight: "low", scaling: "low" }, // scaling
  ];
  const results = runProDrafterPipeline(openingState([]), OPENING_INDEX, OPENING_CORPUS, OPENING_POSITIONS, OPENING_WEIGHTS, OPENING_PROFILES, {
    teamOpening: true,
    heroCapabilities: capabilities,
  });
  expect(results.map((r) => r.heroId)).not.toContain(11);
  expect(results).toHaveLength(5);
});

test("Fase 6: sin heroCapabilities, todos caen en 'scaling' y el orden por score queda intacto", () => {
  const results = runProDrafterPipeline(openingState([]), OPENING_INDEX, OPENING_CORPUS, OPENING_POSITIONS, OPENING_WEIGHTS, OPENING_PROFILES, {
    teamOpening: true,
  });
  expect(results.map((r) => r.heroId)).toEqual([1, 3, 4, 5, 6]);
});
