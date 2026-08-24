import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { runProDrafterPipeline } from "./run-pipeline";
import type { PipelineWeights } from "./weight-loader";
import type { DraftCandidate } from "../knn/corpus";
import { buildDraftIndex } from "../knn/draft-index";
import type { HeroLineProfile } from "../lane/profiles";
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
]);

const WEIGHTS: PipelineWeights = { knn_similarity: 0.4, lane_score: 0.35, denial_score: 0.25 };

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
  // matchupWinrate(2,10,*)=1.0 (único enfrentamiento registrado en el corpus, hero2 ganó);
  // flexTarget=hero10 (entropía 1, mayor que hero11); earlyPressure(2)=killPressure=0.2
  const denialRaw = 1.0 * 0.5 + 1.0 * 0.5 + 0.5 * 0.2 * 1;

  expect(hero2?.signals.find((s) => s.signal === "knn_similarity")?.raw).toBeCloseTo(knnRaw, 10);
  expect(hero2?.signals.find((s) => s.signal === "lane_score")?.raw).toBeCloseTo(laneRaw, 10);
  expect(hero2?.signals.find((s) => s.signal === "denial_score")?.raw).toBeCloseTo(denialRaw, 10);

  const expectedScore =
    (knnRaw / 1) * 100 * WEIGHTS.knn_similarity +
    (laneRaw / 1) * 100 * WEIGHTS.lane_score +
    (denialRaw / 2) * 100 * WEIGHTS.denial_score;
  expect(hero2?.score).toBeCloseTo(expectedScore, 6);
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
