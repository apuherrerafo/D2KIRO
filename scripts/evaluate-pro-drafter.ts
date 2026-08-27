#!/usr/bin/env bun
// Paso 2 (sesión Gobernanza 2.0, continuación de TSK-090/091/093): evaluación offline
// leave-one-out del pipeline Pro-Drafter contra v5 (buildSuggestions) sobre el corpus real de
// drafts profesionales (502 drafts / 124 héroes distintos, patch 7.41). Script
// de desarrollador, nunca invocado desde el motor -- mismo criterio que test-pipeline.ts/
// batch-harness.ts/fetch-pro-drafts.ts. Cero red: todo el dato es el corpus ya sincronizado.
//
// Metodología: para cada draft real, se oculta cada uno de los 5 héroes del lado ganador (uno a
// la vez) y se reconstruye el DraftState como si ese pick todavía no se hubiera hecho -- picks
// propios = los otros 4 del lado ganador, picks rivales = los 5 del lado perdedor completo (mismo
// criterio que el escenario "Late Game Greedy" de test-pipeline.ts: rival totalmente revelado).
// Se mide si el héroe oculto (el pick real que el equipo profesional eligió y ganó con él)
// aparece en el Top-1/Top-3 de cada motor. Leave-one-out real: el índice KNN y los matchups
// derivados del corpus para v5 EXCLUYEN el draft bajo evaluación en cada corrida -- sin esto, el
// propio draft evaluado sería su mejor vecino, inflando el resultado de forma artificial.
//
// [LIMITACIÓN DOCUMENTADA, no oculta]: la comparación NO es apples-to-apples con v5 en producción
// real. v5 recibe acá un MetaSnapshot derivado del corpus (matchups agregados por co-ocurrencia,
// sin `patchStats` ni `heroPool` reales) -- `patch_meta` y `hero_pool_fit` quedan `null`/
// `applicable:false` en casi todos los casos, y `counter` casi siempre `null` (MIN_MATCHUP_GAMES
// = 200, un corpus de ~174 drafts leave-one-out casi nunca junta 200 partidas para un par de
// héroes específico). v5 real en producción tiene `patch_meta`/`counter` poblados desde SQLite
// (sincronizado de OpenDota, miles de partidas). Esto no invalida la comparación -- pro-drafter
// tampoco tiene acceso a más datos que este mismo corpus -- pero significa que el v5 de acá corre
// mayormente con `team_synergy` (capabilities.json real) + `position_fit` (hero-positions.json
// real), no con sus 5 señales completas. Documentado para no presentar un benchmark más fuerte de
// lo que realmente es.

import { buildSuggestions } from "../apps/engine/src/signals/mix";
import type { MetaSnapshot, HeroMatchupStat, MetaHeroInfo } from "../apps/engine/src/signals/types";
import { loadHeroPositions } from "../apps/engine/src/signals/hero-positions";
import { loadDraftCorpus, type DraftCandidate } from "../apps/engine/src/knn/corpus";
import { buildDraftIndex } from "../apps/engine/src/knn/draft-index";
import { loadHeroLineProfiles } from "../apps/engine/src/lane/profiles";
import { loadHeroCapabilities } from "../apps/engine/src/draft-paths/capabilities";
import { loadPipelineWeights } from "../apps/engine/src/pipeline/weight-loader";
import { runProDrafterPipeline } from "../apps/engine/src/pipeline/run-pipeline";
import type { DraftState, HeroId } from "../apps/engine/src/draft/reducer";
import { calibrateRolePressure, profileDistance, rolePressure } from "./role-pressure";

function baseDraftState(overrides: Partial<DraftState>): DraftState {
  return {
    sessionId: "eval-loo",
    schema: "draft-state/v1",
    format: "all_pick",
    patch: "7.41",
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

// MetaSnapshot para v5 derivado del MISMO corpus que usa pro-drafter -- ninguno de los dos motores
// recibe una fuente de datos que el otro no tenga. `pool` ya excluye el draft bajo evaluación
// (leave-one-out).
function buildMetaFromCorpus(pool: readonly DraftCandidate[]): MetaSnapshot {
  const heroes: Record<HeroId, MetaHeroInfo> = {};
  const pairWins = new Map<string, { wins: number; games: number }>();

  for (const draft of pool) {
    for (const h of [...draft.radiantHeroes, ...draft.direHeroes]) heroes[h] = { id: h, localizedName: `Hero ${h}` };

    for (const radiantHero of draft.radiantHeroes) {
      for (const direHero of draft.direHeroes) {
        for (const [a, b, aWon] of [
          [radiantHero, direHero, draft.winningSide === "radiant"],
          [direHero, radiantHero, draft.winningSide === "dire"],
        ] as const) {
          const key = `${a}:${b}`;
          const row = pairWins.get(key) ?? { wins: 0, games: 0 };
          row.games += 1;
          if (aWon) row.wins += 1;
          pairWins.set(key, row);
        }
      }
    }
  }

  const matchups: Record<HeroId, HeroMatchupStat[]> = {};
  for (const [key, row] of pairWins) {
    const [aStr, bStr] = key.split(":");
    const a = Number(aStr);
    const b = Number(bStr);
    (matchups[a] ??= []).push({ vsHero: b, games: row.games, wins: row.wins });
  }

  return { heroes, matchups, heroPool: [], personalBaselineWinrate: null };
}

interface TrialResult {
  engine: "v5" | "pro-drafter";
  top1: boolean;
  top3: boolean;
  rank: number | null; // null si el héroe oculto no aparece en absoluto entre los candidatos rankeados
}

// Diagnóstico adicional, no pedido por la métrica original pero necesario para explicar el
// resultado: ¿cuántas veces cada señal del pipeline realmente vota (raw !== null) sobre el
// candidato Top-1 real de cada corrida?
const proSignalNullCounts: Record<string, { null: number; total: number }> = {
  knn_similarity: { null: 0, total: 0 },
  lane_score: { null: 0, total: 0 },
  denial_score: { null: 0, total: 0 },
};

function rankOf(orderedHeroes: readonly HeroId[], target: HeroId): number | null {
  const index = orderedHeroes.indexOf(target);
  return index === -1 ? null : index + 1;
}

function summarize(label: string, trials: TrialResult[]): void {
  const n = trials.length;
  const top1 = trials.filter((t) => t.top1).length;
  const top3 = trials.filter((t) => t.top3).length;
  const ranked = trials.filter((t) => t.rank !== null);
  const avgRank = ranked.length === 0 ? null : ranked.reduce((s, t) => s + (t.rank ?? 0), 0) / ranked.length;
  console.log(`\n${label} (n=${n})`);
  console.log(`  Top-1 hit rate: ${top1}/${n} (${((top1 / n) * 100).toFixed(1)}%)`);
  console.log(`  Top-3 hit rate: ${top3}/${n} (${((top3 / n) * 100).toFixed(1)}%)`);
  console.log(`  Rank promedio cuando el pick real aparece rankeado: ${avgRank === null ? "n/a" : avgRank.toFixed(1)} (sobre ${ranked.length}/${n} corridas con dato)`);
}

function main(): void {
  const fullCorpus = loadDraftCorpus();
  const heroPositions = loadHeroPositions();
  const weights = loadPipelineWeights();
  const profiles = loadHeroLineProfiles();

  console.log(`Corpus real: ${fullCorpus.length} drafts únicos, patch(es): ${[...new Set(fullCorpus.map((d) => d.patch))].join(", ")}`);

  const v5Trials: TrialResult[] = [];
  const proTrials: TrialResult[] = [];

  for (const draft of fullCorpus) {
    const pool = fullCorpus.filter((d) => d.draftId !== draft.draftId); // leave-one-out real
    const index = buildDraftIndex(pool, draft.patch);
    const meta = buildMetaFromCorpus(pool);

    const winningHeroes = draft.winningSide === "radiant" ? draft.radiantHeroes : draft.direHeroes;
    const losingHeroes = draft.winningSide === "radiant" ? draft.direHeroes : draft.radiantHeroes;

    for (const heldOutHero of winningHeroes) {
      const ownPicks = winningHeroes.filter((h) => h !== heldOutHero);
      const state = baseDraftState({
        patch: draft.patch,
        localSide: "radiant",
        picks: { radiant: ownPicks, dire: [...losingHeroes] },
      });

      const v5Result = buildSuggestions(state, meta);
      const v5Order = v5Result.suggestions.map((s) => s.hero); // solo Top 3 reales de buildSuggestions
      const v5Rank = rankOf(v5Order, heldOutHero);
      v5Trials.push({ engine: "v5", top1: v5Rank === 1, top3: v5Rank !== null, rank: v5Rank });

      const proResults = runProDrafterPipeline(state, index, pool, heroPositions, weights, profiles);
      const proOrder = proResults.map((r) => r.heroId);
      const proRank = rankOf(proOrder, heldOutHero);
      proTrials.push({ engine: "pro-drafter", top1: proRank === 1, top3: proRank !== null, rank: proRank });

      for (const result of proResults) {
        for (const signal of result.signals) {
          const bucket = proSignalNullCounts[signal.signal]!;
          bucket.total += 1;
          if (signal.raw === null) bucket.null += 1;
        }
      }
    }
  }

  summarize("v5 (buildSuggestions, MetaSnapshot derivado del corpus)", v5Trials);
  summarize("Pro-Drafter (runProDrafterPipeline)", proTrials);

  console.log("\nDiagnóstico: tasa de raw:null por señal del pipeline, sobre cada candidato evaluado (no solo el Top 3)");
  for (const [signal, counts] of Object.entries(proSignalNullCounts)) {
    console.log(`  ${signal.padEnd(15)} null en ${counts.null}/${counts.total} (${((counts.null / counts.total) * 100).toFixed(1)}%)`);
  }

  console.log(
    "\nNota: ambos motores solo comparan contra su propio Top 3 -- \"Top-3 hit rate\" significa " +
      "\"el pick real del profesional está entre las 3 sugerencias que el motor habría mostrado\", " +
      "no una probabilidad de acertar el pick #1 exacto. Ver cabecera del script para las " +
      "limitaciones documentadas de esta comparación (v5 corre con datos parciales respecto a " +
      "producción real).",
  );
}

// TSK-135: sensibilidad de la apertura a los bans. Es un modo manual separado del benchmark
// leave-one-out: no cambia pesos ni flags y siempre usa una semilla fija para que dos corridas
// produzcan exactamente el mismo diagnóstico.
const BAN_SENSITIVITY_SEED = 135_2026;
const BAN_VARIANT_SIZE = 16;
const BAN_SAMPLE_SIZE = 50;

interface SensitivityPair {
  first: readonly HeroId[];
  second: readonly HeroId[];
}

interface SensitivityMetrics {
  meanJaccard: number;
  meanDistinctPerTop5: number;
  rankOneChanges: number;
  pairs: number;
}

interface RolePressurePair {
  banPressureDelta: number;
  outputPressureDelta: number;
}

function nextRandom(seed: number): number {
  let value = seed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function sampleBans(heroIds: readonly HeroId[], seed: number): HeroId[] {
  const shuffled = [...heroIds];
  let state = seed;
  for (let i = shuffled.length - 1; i > 0; i--) {
    state = nextRandom(state);
    const j = state % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled.slice(0, BAN_VARIANT_SIZE);
}

function jaccard(left: readonly HeroId[], right: readonly HeroId[]): number {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  return [...a].filter((hero) => b.has(hero)).length / union.size;
}

function evaluateSensitivityPath(
  pairs: readonly SensitivityPair[],
  calculate: (bans: readonly HeroId[], draft: DraftCandidate) => readonly HeroId[],
  drafts: readonly DraftCandidate[],
): SensitivityMetrics {
  let jaccardTotal = 0;
  let distinctTotal = 0;
  let rankOneChanges = 0;
  pairs.forEach((pair, index) => {
    const draft = drafts[index]!;
    const first = calculate(pair.first, draft);
    const second = calculate(pair.second, draft);
    jaccardTotal += jaccard(first, second);
    distinctTotal += (new Set(first).size + new Set(second).size) / 2;
    if (first[0] !== second[0]) rankOneChanges += 1;
  });
  return {
    meanJaccard: jaccardTotal / pairs.length,
    meanDistinctPerTop5: distinctTotal / pairs.length,
    rankOneChanges,
    pairs: pairs.length,
  };
}

function runBanSensitivity(): void {
  const fullCorpus = loadDraftCorpus();
  if (fullCorpus.length < BAN_SAMPLE_SIZE) throw new Error(`Se necesitan al menos ${BAN_SAMPLE_SIZE} drafts; hay ${fullCorpus.length}`);
  const drafts = fullCorpus.slice(0, BAN_SAMPLE_SIZE);
  const heroIds = [...new Set(fullCorpus.flatMap((draft) => [...draft.radiantHeroes, ...draft.direHeroes]))];
  const pairs = drafts.map((_, index) => ({
    first: sampleBans(heroIds, BAN_SENSITIVITY_SEED + index * 2),
    second: sampleBans(heroIds, BAN_SENSITIVITY_SEED + index * 2 + 1),
  }));
  const heroPositions = loadHeroPositions();
  const heroCapabilities = loadHeroCapabilities();
  const weights = loadPipelineWeights();
  const profiles = loadHeroLineProfiles();
  const index = buildDraftIndex(fullCorpus, drafts[0]!.patch);
  const meta = buildMetaFromCorpus(fullCorpus);

  const stateFor = (draft: DraftCandidate, bans: readonly HeroId[]): DraftState => baseDraftState({
    patch: draft.patch,
    banned: [...bans],
    picks: { radiant: [], dire: [] },
  });
  const v5 = evaluateSensitivityPath(pairs, (bans, draft) => buildSuggestions(stateFor(draft, bans), meta, { teamOpening: true }).suggestions.map((s) => s.hero), drafts);
  const pro = evaluateSensitivityPath(pairs, (bans, draft) => runProDrafterPipeline(stateFor(draft, bans), index, fullCorpus, heroPositions, weights, profiles, {
    teamOpening: true,
    matchups: meta.matchups,
    heroCapabilities,
  }).slice(0, 5).map((result) => result.heroId), drafts);

  const rolePressurePairs: RolePressurePair[] = pairs.map((pair, index) => {
    const draft = drafts[index]!;
    const firstV5 = runProDrafterPipeline(stateFor(draft, pair.first), index, fullCorpus, heroPositions, weights, profiles, {
      teamOpening: true, matchups: meta.matchups, heroCapabilities,
    }).slice(0, 5).map((result) => result.heroId);
    const secondV5 = runProDrafterPipeline(stateFor(draft, pair.second), index, fullCorpus, heroPositions, weights, profiles, {
      teamOpening: true, matchups: meta.matchups, heroCapabilities,
    }).slice(0, 5).map((result) => result.heroId);
    return {
      banPressureDelta: profileDistance(rolePressure(pair.first, heroPositions), rolePressure(pair.second, heroPositions)),
      outputPressureDelta: profileDistance(rolePressure(firstV5, heroPositions), rolePressure(secondV5, heroPositions)),
    };
  });
  const roleCalibration = calibrateRolePressure(rolePressurePairs);

  console.log(`Ban sensitivity (seed=${BAN_SENSITIVITY_SEED}, drafts=${drafts.length}, bans por variante=${BAN_VARIANT_SIZE})`);
  for (const metrics of [v5, pro]) {
    const label = metrics === v5 ? "v5" : "pro-drafter";
    console.log(`  ${label}: Jaccard medio=${metrics.meanJaccard.toFixed(3)}, héroes distintos Top-5=${metrics.meanDistinctPerTop5.toFixed(1)}/5, rank 1 cambia=${((metrics.rankOneChanges / metrics.pairs) * 100).toFixed(1)}%`);
  }
  console.log(`  Role-Pressure: bans irrelevantes=${roleCalibration.irrelevantPairs}, estabilidad=${(roleCalibration.stableIrrelevantRate * 100).toFixed(1)}%; bans pivotales=${roleCalibration.pivotalPairs}, cambio dinámico=${(roleCalibration.dynamicPivotalRate * 100).toFixed(1)}%`);
  const sensitivityPassed = roleCalibration.stableIrrelevantRate >= 0.8
    && roleCalibration.dynamicPivotalRate >= 0.5
    && roleCalibration.irrelevantPairs > 0
    && roleCalibration.pivotalPairs > 0;
  console.log(`  Jaccard (diagnóstico histórico): pro-drafter=${pro.meanJaccard.toFixed(3)}, v5=${v5.meanJaccard.toFixed(3)}`);
  console.log(`  gate Role-Pressure: estabilidad irrelevante >= 80%, cambio pivotal >= 50%`);
  console.log(`  estado de calibración: ${sensitivityPassed ? "objetivos alcanzados" : "objetivos aún no alcanzados; ENABLE_PRO_DRAFTER permanece apagado"}`);
}

if (Bun.argv.includes("--ban-sensitivity")) runBanSensitivity();
else main();
