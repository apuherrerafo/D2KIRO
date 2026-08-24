#!/usr/bin/env bun
// Prueba manual CLI del pipeline Pro-Drafter v1.0 (`bun run draft:test`, package.json raíz).
// Corre `runProDrafterPipeline` sobre 3 escenarios sintéticos contra el corpus/perfiles/posiciones
// REALES ya curados en apps/engine/src/ (mismo criterio que scripts/fetch-pro-drafts.ts: script de
// desarrollador, nunca invocado desde el motor). No es un test de `bun test` -- es inspección
// manual del Top 3 y su desglose de señales antes de decidir si el endpoint experimental (§2,
// ENABLE_PRO_DRAFTER) se activa contra datos reales.

import { runProDrafterPipeline } from "../apps/engine/src/pipeline/run-pipeline";
import { loadPipelineWeights } from "../apps/engine/src/pipeline/weight-loader";
import { loadDraftCorpus } from "../apps/engine/src/knn/corpus";
import { buildDraftIndex } from "../apps/engine/src/knn/draft-index";
import { loadHeroLineProfiles } from "../apps/engine/src/lane/profiles";
import { loadHeroPositions } from "../apps/engine/src/signals/hero-positions";
import type { DraftState } from "../apps/engine/src/draft/reducer";

// Mismo shape mínimo que `previewState` de POST /api/suggestions/preview (server/app.ts) -- los
// campos irrelevantes para el pipeline (sessionId/phase/turno) quedan en valores neutros.
function draftState(overrides: Partial<DraftState>): DraftState {
  return {
    sessionId: "cli-test",
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
    updatedAt: new Date().toISOString(),
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    ...overrides,
  };
}

// Los 3 heroId elegidos existen a la vez en pro-draft-corpus.json (candidatos/vecinos reales) y en
// hero-line-profiles.json (perfil de línea real) -- sin eso, knn_similarity/lane_score saldrían
// `null` para casi todo el pool y el escenario no mostraría nada interesante.
const SCENARIOS: { name: string; state: DraftState }[] = [
  {
    name: "Early Push (pick #1, sin rivales confirmados)",
    state: draftState({ picks: { radiant: [8], dire: [] } }),
  },
  {
    name: "Late Game Greedy (draft avanzado, bans reales)",
    state: draftState({ picks: { radiant: [8, 9], dire: [3, 17] }, banned: [11, 16] }),
  },
  {
    name: "Flex-Pick Rival (2 picks rivales, target de denial ambiguo)",
    state: draftState({ picks: { radiant: [2], dire: [9, 17] } }),
  },
];

function formatRaw(raw: number | null): string {
  return raw === null ? "null (sin dato)" : raw.toFixed(4);
}

function main(): void {
  const corpus = loadDraftCorpus();
  const index = buildDraftIndex(corpus, "7.41");
  const heroPositions = loadHeroPositions();
  const weights = loadPipelineWeights();
  const profiles = loadHeroLineProfiles();

  console.log(`Corpus real cargado: ${corpus.length} drafts. Pesos: ${JSON.stringify(weights)}\n`);

  for (const scenario of SCENARIOS) {
    console.log(`=== ${scenario.name} ===`);
    console.log(`  picks propios: [${scenario.state.picks.radiant.join(", ")}]  picks rivales: [${scenario.state.picks.dire.join(", ")}]  bans: [${scenario.state.banned.join(", ")}]`);

    const results = runProDrafterPipeline(scenario.state, index, corpus, heroPositions, weights, profiles);

    if (results.length === 0) {
      console.log("  (sin candidatos -- corpus vacío o todos los héroes del corpus ya baneados/pickeados)\n");
      continue;
    }

    results.forEach((candidate, rank) => {
      console.log(`  #${rank + 1} heroId ${candidate.heroId} -- score ${candidate.score.toFixed(4)}`);
      for (const signal of candidate.signals) {
        console.log(`       ${signal.signal.padEnd(15)} raw: ${formatRaw(signal.raw)}`);
      }
    });
    console.log("");
  }
}

main();
