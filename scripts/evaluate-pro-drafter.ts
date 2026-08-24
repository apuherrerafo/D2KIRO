#!/usr/bin/env bun
// Paso 2 (sesión Gobernanza 2.0, continuación de TSK-090/091/093): evaluación offline
// leave-one-out del pipeline Pro-Drafter contra v5 (buildSuggestions) sobre el corpus real de
// drafts profesionales (175 drafts tras la ampliación de esta misma sesión, patch 7.41). Script
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
import { loadPipelineWeights } from "../apps/engine/src/pipeline/weight-loader";
import { runProDrafterPipeline } from "../apps/engine/src/pipeline/run-pipeline";
import type { DraftState, HeroId } from "../apps/engine/src/draft/reducer";

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

main();
