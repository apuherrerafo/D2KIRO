import { mkdirSync } from "node:fs";
import type { DraftState, HeroId } from "../../draft/reducer";
import { loadDraftCorpus, type DraftCandidate } from "../../knn/corpus";
import { buildDraftIndex } from "../../knn/draft-index";
import { loadHeroLineProfiles } from "../../lane/profiles";
import { loadPipelineWeights } from "../../pipeline/weight-loader";
import { runProDrafterPipeline, type PipelineCandidateResult } from "../../pipeline/run-pipeline";
import { loadHeroCapabilities } from "../../draft-paths/capabilities";
import type { HeroCapabilities } from "../../draft-paths/types";
import { loadHeroPositions, type HeroPositions } from "../../signals/hero-positions";
import type { HeroMatchupStat } from "../../signals/types";
import type { SuggestionSet } from "../../signals/mix";
import { createRelationshipIndex } from "../../signals/relationship-index";
import { createSynergyIndex, type SynergyStat } from "../../signals/synergy-index";
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
  computeV5Fallback?: (state: DraftState, options?: { teamOpening?: boolean }) => Promise<SuggestionSet>;
  heroCapabilities?: readonly HeroCapabilities[];
  getMetaMatchups?: () => Promise<Record<HeroId, HeroMatchupStat[]>>;
  getSynergies?: () => Promise<Record<HeroId, SynergyStat[]>>;
  // Reloj inyectable -- mismo patrón que el resto del motor (engine.md: nunca Date.now() propio
  // sin poder inyectarlo), usado tanto para medir el presupuesto de 200ms como el TTL de caché.
  now?: () => number;
}

interface ProDrafterSuggestion {
  hero: HeroId;
  rank: 1 | 2 | 3 | 4 | 5;
  score: number;
  // [] en fallback -- v5 usa SignalId (position_fit/team_synergy/counter/patch_meta/hero_pool_fit),
  // vocabulario disjunto del de Pro-Drafter (knn_similarity/lane_score/denial_score, ver
  // signals/types.ts vs pipeline/run-pipeline.ts). Nunca se fabrica un valor que v5 no calculó.
  signals: PipelineCandidateResult["signals"];
  evidence?: {
    observedEnemyCount: number;
    counterMatchups: number;
    counterConfidence: number | null;
    synergy: "available" | "unavailable";
    synergyPairs: number;
    synergyConfidence: number | null;
    position: "applied" | "unavailable";
  };
}

// Fase 3 (apps/web, sesión Gobernanza 2.0): redundante con `fallback_applied` a propósito -- el
// consumidor (badge de motor en ProDrafterPanel) lo usa como fuente única en vez de invertir un
// boolean, y queda derivado de `fallback_applied` en un solo punto (ver postRecommendations) para
// que las dos banderas nunca puedan divergir.
export type ProEngineVersion = "pro-drafter" | "v5";

export interface ProDrafterResponse {
  schema: "pro-drafter-suggestions/v1";
  suggestions: ProDrafterSuggestion[];
  fallback_applied: boolean;
  cache_hit: boolean;
  engine_version: ProEngineVersion;
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
    `opening:${body.teamOpening === true}`,
    `targetPosition:${body.targetPosition ?? "none"}`,
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
  const heroCapabilities = deps.heroCapabilities ?? loadHeroCapabilities();
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
  async function runPipelineWithBudget(state: DraftState, teamOpening: boolean, targetPosition: 1 | 2 | 3 | 4 | 5 | undefined): Promise<ProDrafterSuggestion[] | null> {
    let matchups: Record<HeroId, HeroMatchupStat[]> | undefined;
    let synergies: Record<HeroId, SynergyStat[]> | undefined;
    try {
      matchups = await deps.getMetaMatchups?.();
      synergies = await deps.getSynergies?.();
    } catch {
      matchups = undefined;
    }
    const start = now();
    try {
      const results = pipelineImpl(state, index, corpus, heroPositions, weights, profiles, {
        teamOpening,
        targetPosition,
        topN: 5,
        matchups,
        heroCapabilities,
      });
      if (now() - start > PIPELINE_TIMEOUT_MS) return null;
      const enemySide = state.localSide === "radiant" ? "dire" : state.localSide === "dire" ? "radiant" : null;
      const observedEnemies = enemySide ? state.picks[enemySide] : [];
      const relationshipIndex = createRelationshipIndex(matchups ?? {});
      const synergyIndex = createSynergyIndex(synergies ?? {});
      return results.map((r, i) => {
        const counterEvidence = relationshipIndex.counterRows(r.heroId, observedEnemies);
        const synergyEvidence = synergyIndex.synergyRows(r.heroId, state.localSide === "unknown" ? [] : state.picks[state.localSide]);
        return {
          hero: r.heroId,
          rank: (i + 1) as 1 | 2 | 3 | 4 | 5,
          score: r.score,
          signals: r.signals,
          evidence: {
            observedEnemyCount: observedEnemies.length,
            counterMatchups: counterEvidence.length,
            counterConfidence: counterEvidence.length === 0 ? null : Math.min(...counterEvidence.map((row) => row.confidence)),
            synergy: synergyEvidence.length === 0 ? "unavailable" as const : "available" as const,
            synergyPairs: synergyEvidence.length,
            synergyConfidence: synergyEvidence.length === 0 ? null : Math.min(...synergyEvidence.map((row) => row.confidence)),
            position: targetPosition === undefined ? "unavailable" as const : "applied" as const,
          },
        };
      });
    } catch {
      return null;
    }
  }

  async function buildFallbackSuggestions(state: DraftState, teamOpening: boolean): Promise<ProDrafterSuggestion[]> {
    if (!deps.computeV5Fallback) return [];
    const v5 = await deps.computeV5Fallback(state, { teamOpening });
    const maxRank = 5;
    return v5.suggestions
      .filter((suggestion) => suggestion.rank <= maxRank)
      .map((suggestion) => ({ hero: suggestion.hero, rank: suggestion.rank as 1 | 2 | 3 | 4 | 5, score: suggestion.score, signals: [] }));
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
    const proSuggestions = await runPipelineWithBudget(state, body.teamOpening === true, body.targetPosition);

    const response: ProDrafterResponse = proSuggestions
      ? { schema: "pro-drafter-suggestions/v1", suggestions: proSuggestions, fallback_applied: false, cache_hit: false, engine_version: "pro-drafter" }
      : {
          schema: "pro-drafter-suggestions/v1",
          suggestions: await buildFallbackSuggestions(state, body.teamOpening === true),
          fallback_applied: true,
          cache_hit: false,
          engine_version: "v5",
        };

    cacheSet(key, response);
    return Response.json(response);
  }

  return { postRecommendations };
}

// Reporte de "confianza baja" (curación de corpus, sesión Gobernanza 2.0): diagnóstico interno
// para el usuario, no para producto -- registra qué héroes salieron con `knn_similarity: null`
// durante un draft del simulador, para priorizar a mano qué héroes necesitan más partidas
// profesionales en el corpus. Deliberadamente NO cuelga de `createProDrafterRoutes` -- no
// necesita `corpus`/`heroPositions`/`weights`/`profiles`, solo valida y escribe a disco.
export interface LowConfidenceReportEntry {
  readonly hero: HeroId;
  readonly heroName: string;
  readonly rank: 1 | 2 | 3;
}

export interface LowConfidenceReportRequest {
  readonly sessionId: string;
  readonly patch: string;
  readonly entries: readonly LowConfidenceReportEntry[];
}

// `sessionId` se usa para construir un nombre de archivo -- input externo, se valida antes de
// tocar el filesystem (nunca se confía en que sea un UUID solo porque el cliente siempre manda
// uno real). Un `sessionId` con "/" o ".." nunca llega a formar parte de una ruta de archivo.
const SAFE_SESSION_ID_PATTERN = /^[a-zA-Z0-9-]+$/;
const REPORTS_DIR = "./data/low-confidence-reports";

// Exportada para pruebas -- misma razón que isValidSuggestionsPreviewRequest en edge.ts.
export function isValidLowConfidenceReportEntry(value: unknown): value is LowConfidenceReportEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    Number.isInteger(e.hero) &&
    (e.hero as number) > 0 &&
    typeof e.heroName === "string" &&
    e.heroName.length > 0 &&
    (e.rank === 1 || e.rank === 2 || e.rank === 3)
  );
}

export function isValidLowConfidenceReportRequest(value: unknown): value is LowConfidenceReportRequest {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  if (typeof b.sessionId !== "string" || !SAFE_SESSION_ID_PATTERN.test(b.sessionId)) return false;
  if (typeof b.patch !== "string" || b.patch.length === 0) return false;
  if (!Array.isArray(b.entries) || b.entries.length === 0) return false;
  return b.entries.every(isValidLowConfidenceReportEntry);
}

// `apps/engine/data/` ya existe como carpeta de datos locales no versionados (dota2coach.sqlite,
// TSK-002) -- este reporte cae ahí mismo por el mismo criterio, nunca en el repo. `reportsDir`
// inyectable -- mismo patrón de testing-seams que el resto del motor -- para que las pruebas
// escriban a un directorio temporal, nunca a `./data/` real.
export async function handleLowConfidenceReport(request: Request, reportsDir: string = REPORTS_DIR): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  if (!isValidLowConfidenceReportRequest(body)) {
    return Response.json({ error: "invalid_low_confidence_report" }, { status: 400 });
  }

  mkdirSync(reportsDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const fileName = `${generatedAt.replace(/[:.]/g, "-")}-${body.sessionId}.json`;
  await Bun.write(`${reportsDir}/${fileName}`, `${JSON.stringify({ ...body, generatedAt }, null, 2)}\n`);

  return Response.json({ written: true }, { status: 201 });
}
