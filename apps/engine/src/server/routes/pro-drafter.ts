import type { DraftState, HeroId } from "../../draft/reducer";
import { loadDraftCorpus, type DraftCandidate } from "../../knn/corpus";
import { buildDraftIndex } from "../../knn/draft-index";
import { loadHeroLineProfiles } from "../../lane/profiles";
import { loadPipelineWeights } from "../../pipeline/weight-loader";
import { runProDrafterPipeline, type PipelineCandidateResult } from "../../pipeline/run-pipeline";
import { loadHeroPositions, type HeroPositions } from "../../signals/hero-positions";
import { isValidSuggestionsPreviewRequest, type SuggestionsPreviewRequest } from "../edge";

// Endpoint experimental (tras ENABLE_PRO_DRAFTER, ver server/app.ts): expone `runProDrafterPipeline`
// (pipeline/), hasta ahora deliberadamente apagado. Reutiliza el MISMO contrato de entrada que
// POST /api/suggestions/preview (SuggestionsPreviewRequest) a propósito -- con el flag en `false`,
// app.ts cae al handler v5 existente sin transformar el body: un solo formato de request para las
// dos rutas, nunca dos contratos distintos según el flag.
export interface ProDrafterRouteDeps {
  // Inyectables para pruebas -- mismo criterio que heroCapabilities/heroPositions en AppDeps
  // (testing-seams.md): nunca el corpus/hero-positions.json real en un test.
  corpus?: readonly DraftCandidate[];
  heroPositions?: HeroPositions;
}

interface ProDrafterSuggestion {
  hero: HeroId;
  rank: 1 | 2 | 3;
  score: number;
  signals: PipelineCandidateResult["signals"];
}

export interface ProDrafterResponse {
  schema: "pro-drafter-suggestions/v1";
  suggestions: ProDrafterSuggestion[];
}

function previewStateFrom(body: SuggestionsPreviewRequest): DraftState {
  return {
    sessionId: "pro-drafter-experimental",
    schema: "draft-state/v1",
    format: body.format,
    patch: body.patch,
    localSide: body.localSide,
    phase: "active",
    banned: body.banned,
    picks: body.picks,
    lastSeq: 0,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: new Date().toISOString(),
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
  };
}

export function createProDrafterRoutes(deps: ProDrafterRouteDeps = {}) {
  const corpus = deps.corpus ?? loadDraftCorpus();
  const heroPositions = deps.heroPositions ?? loadHeroPositions();
  const weights = loadPipelineWeights();
  const profiles = loadHeroLineProfiles();
  const index = buildDraftIndex(corpus, corpus[0]?.patch ?? "unknown");

  async function postRecommendations(request: Request): Promise<Response> {
    const body: unknown = await request.json().catch(() => null);
    if (!isValidSuggestionsPreviewRequest(body)) {
      return Response.json({ error: "invalid_preview_request" }, { status: 400 });
    }

    const state = previewStateFrom(body);
    const results = runProDrafterPipeline(state, index, corpus, heroPositions, weights, profiles);

    const response: ProDrafterResponse = {
      schema: "pro-drafter-suggestions/v1",
      suggestions: results.map((r, i) => ({ hero: r.heroId, rank: (i + 1) as 1 | 2 | 3, score: r.score, signals: r.signals })),
    };
    return Response.json(response);
  }

  return { postRecommendations };
}
