import type { DraftState, HeroId } from "../../draft/reducer";
import { loadDraftCorpus, type DraftCandidate } from "../../knn/corpus";
import { buildDraftIndex } from "../../knn/draft-index";
import { loadHeroLineProfiles } from "../../lane/profiles";
import { loadPipelineWeights } from "../../pipeline/weight-loader";
import { runProDrafterPipeline, type PipelineCandidateResult } from "../../pipeline/run-pipeline";
import { loadHeroPositions, type HeroPositions } from "../../signals/hero-positions";
import type { SuggestionSet } from "../../signals/mix";
import { isValidSuggestionsPreviewRequest, type SuggestionsPreviewRequest } from "../edge";

// Endpoint experimental (tras ENABLE_PRO_DRAFTER, ver server/app.ts): expone `runProDrafterPipeline`
// (pipeline/), hasta ahora deliberadamente apagado. Reutiliza el MISMO contrato de entrada que
// POST /api/suggestions/preview (SuggestionsPreviewRequest) a propósito -- con el flag en `false`,
// app.ts cae al handler v5 existente sin transformar el body: un solo formato de request para las
// dos rutas, nunca dos contratos distintos según el flag.
//
// Fase 2 (Performance & Resiliencia, sesión Gobernanza 2.0): cache-aside en memoria + fallback
// transparente a v5. `runProDrafterPipeline` es SÍNCRONO -- el "timeout" de abajo mide el tiempo
// YA transcurrido después de que la llamada termina, no la interrumpe a mitad de cálculo (JS de
// un solo hilo no permite eso sin workers, y este proyecto no tiene ninguno). Lo que sí garantiza:
// el cliente nunca RECIBE una respuesta de Pro-Drafter que se pasó del presupuesto -- si se pasó,
// se descarta igual y cae a v5, mismo resultado observable que un timeout real.
const PIPELINE_TIMEOUT_MS = 200;
const CACHE_TTL_MS = 5 * 60_000; // 5 min -- sin invalidación por evento de draft, TTL puro, mismo criterio que SessionStore
const CACHE_MAX_ENTRIES = 200; // cota dura de memoria -- desaloja el más viejo (FIFO/LRU simple)

export interface ProDrafterRouteDeps {
  // Inyectables para pruebas -- mismo criterio que heroCapabilities/heroPositions en AppDeps
  // (testing-seams.md): nunca el corpus/hero-positions.json real en un test.
  corpus?: readonly DraftCandidate[];
  heroPositions?: HeroPositions;
  // Inyectable para simular fallas/timeouts del pipeline en pruebas sin depender de datos reales
  // -- mismo patrón que corpus/heroPositions. Default: la implementación real.
  runPipeline?: typeof runProDrafterPipeline;
  // v5 real (buildSuggestions + MetaSnapshot vía SQLite) -- este módulo no tiene `db`, así que el
  // fallback se inyecta desde server/app.ts (computeSuggestionsForState ya existe ahí, TSK-048).
  computeV5Fallback?: (state: DraftState) => Promise<SuggestionSet>;
  // Reloj inyectable -- mismo patrón que el resto del motor (engine.md: nunca Date.now() propio
  // sin poder inyectarlo), usado tanto para medir el presupuesto de 200ms como el TTL de caché.
  now?: () => number;
}

interface ProDrafterSuggestion {
  hero: HeroId;
  rank: 1 | 2 | 3;
  score: number;
  // [] en fallback -- v5 usa SignalId (position_fit/team_synergy/counter/patch_meta/hero_pool_fit),
  // vocabulario disjunto del de Pro-Drafter (knn_similarity/lane_score/denial_score, ver
  // signals/types.ts vs pipeline/run-pipeline.ts). Nunca se fabrica un valor que v5 no calculó.
  signals: PipelineCandidateResult["signals"];
}

export interface ProDrafterResponse {
  schema: "pro-drafter-suggestions/v1";
  suggestions: ProDrafterSuggestion[];
  fallback_applied: boolean;
  cache_hit: boolean;
}

interface CacheEntry {
  response: ProDrafterResponse;
  expiresAt: number;
}

// Fingerprint de la COMBINACIÓN de héroes -- se ordenan los ids para que el orden de confirmación
// no invalide el cache (decisión explícita: mismo conjunto de héroes = misma entrada, aunque el
// orden de pick difiera).
function fingerprint(body: SuggestionsPreviewRequest): string {
  const sortedIds = (ids: readonly HeroId[]) => [...ids].sort((a, b) => a - b).join(",");
  return [
    body.format,
    body.patch,
    body.localSide,
    `banned:${sortedIds(body.banned)}`,
    `radiant:${sortedIds(body.picks.radiant)}`,
    `dire:${sortedIds(body.picks.dire)}`,
  ].join("|");
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
  const pipelineImpl = deps.runPipeline ?? runProDrafterPipeline;
  const now = deps.now ?? Date.now;

  // Cache-aside en memoria, propia de esta instancia -- Map preserva orden de inserción: un hit
  // borra+reinserta la entrada (la mueve al final, LRU real) y un overflow desaloja la primera
  // (la más vieja). Nunca persiste a disco -- se pierde en cada reinicio del proceso, mismo
  // criterio que SessionStore (TSK-055).
  const cache = new Map<string, CacheEntry>();

  function cacheGet(key: string): ProDrafterResponse | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      cache.delete(key);
      return null;
    }
    cache.delete(key);
    cache.set(key, entry);
    return { ...entry.response, cache_hit: true };
  }

  function cacheSet(key: string, response: ProDrafterResponse): void {
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }
    cache.set(key, { response, expiresAt: now() + CACHE_TTL_MS });
  }

  // null = Pro-Drafter falló o se pasó del presupuesto -- el llamador cae a v5, nunca deja
  // pasar una respuesta a medio calcular ni relanza el error como 500.
  function runPipelineWithBudget(state: DraftState): ProDrafterSuggestion[] | null {
    const start = now();
    try {
      const results = pipelineImpl(state, index, corpus, heroPositions, weights, profiles);
      if (now() - start > PIPELINE_TIMEOUT_MS) return null;
      return results.map((r, i) => ({ hero: r.heroId, rank: (i + 1) as 1 | 2 | 3, score: r.score, signals: r.signals }));
    } catch {
      return null;
    }
  }

  async function buildFallbackSuggestions(state: DraftState): Promise<ProDrafterSuggestion[]> {
    if (!deps.computeV5Fallback) return [];
    const v5 = await deps.computeV5Fallback(state);
    return v5.suggestions.map((s) => ({ hero: s.hero, rank: s.rank, score: s.score, signals: [] }));
  }

  async function postRecommendations(request: Request): Promise<Response> {
    const body: unknown = await request.json().catch(() => null);
    if (!isValidSuggestionsPreviewRequest(body)) {
      return Response.json({ error: "invalid_preview_request" }, { status: 400 });
    }

    const key = fingerprint(body);
    const cached = cacheGet(key);
    if (cached) return Response.json(cached);

    const state = previewStateFrom(body);
    const proSuggestions = runPipelineWithBudget(state);

    const response: ProDrafterResponse = proSuggestions
      ? { schema: "pro-drafter-suggestions/v1", suggestions: proSuggestions, fallback_applied: false, cache_hit: false }
      : {
          schema: "pro-drafter-suggestions/v1",
          suggestions: await buildFallbackSuggestions(state),
          fallback_applied: true,
          cache_hit: false,
        };

    cacheSet(key, response);
    return Response.json(response);
  }

  return { postRecommendations };
}
