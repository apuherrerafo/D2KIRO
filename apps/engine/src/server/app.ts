import type { Server, ServerWebSocket } from "bun";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { accounts } from "../db/schema";
import { verifyAccountToken } from "./account-token";
import { getSoleAccountId } from "../db/queries";
import type { DraftPathArchetype, HeroCapabilities } from "../draft-paths/types";
import { loadDraftFormatTurnData, type CaptainsModeTurnTable } from "../draft/draft-format-turns";
import type { DraftState } from "../draft/reducer";
import { deriveDecisionContext } from "../drafter/decision-context";
import { currentCaptainsModeTurn } from "../draft/turn-clock";
import { getHealthStatus } from "../health";
import type { OpenDotaClient } from "../meta/opendota-client";
import { getAllHeroMeta, getCachedMetaSnapshot, getMetaFreshness } from "../meta/provider";
import { requireAccount } from "./require-account";
import { createAccountRoutes } from "./routes/account";
import type { HeroPositions } from "../signals/hero-positions";
import { buildSuggestions, type SuggestionSet } from "../signals/mix";
import {
  checkCaptureToken,
  createSessionRateLimiter,
  isValidClientMessage,
  isValidDraftEventEnvelope,
  isValidSuggestionsPreviewRequest,
  type TokenRateLimiter,
} from "./edge";
import { createDraftPathsRoutes } from "./routes/draft-paths";
import { createHeroPoolRoutes } from "./routes/hero-pool";
import { createMetaRoutes } from "./routes/meta";
import { createProDrafterRoutes, handleLowConfidenceReport } from "./routes/pro-drafter";
import { createSimulatorSessionRoutes } from "./routes/simulator-sessions";
import { createTeamGroupRoutes } from "./routes/team-groups";
import { SessionStore, buildServerMessage, type ClientMessage } from "./session";

type Db<TSchema extends Record<string, unknown> = Record<string, never>> = BunSQLiteDatabase<TSchema>;

// Req 5 (§5.4): error centinela para distinguir un fallo de getCachedMetaSnapshot del resto de
// errores de computeSuggestionsForState -- el cliente recibe un mensaje de error distinto en cada
// caso y la conexión nunca se cierra.
class SnapshotUnavailableError extends Error {
  constructor() {
    super("snapshot_unavailable");
    this.name = "SnapshotUnavailableError";
  }
}

export interface AppDeps<TSchema extends Record<string, unknown> = typeof schema> {
  db: Db<TSchema>;
  openDotaClient: OpenDotaClient;
  captureToken: string;
  // TSK-036: inyectable para que las pruebas usen un fixture controlado en vez de depender del
  // capabilities.json real -- ese archivo es un borrador vivo que se sigue corrigiendo a mano, un
  // test que dependiera de su contenido real se rompería (o peor, cambiaría de resultado en
  // silencio) cada vez que se edite, mismo criterio que S2/S6/S7 de testing-seams.md.
  heroCapabilities?: HeroCapabilities[];
  // TSK-063: mismo criterio que heroCapabilities -- inyectable para pruebas, nunca el
  // hero-positions.json real ahí (costura S10).
  heroPositions?: HeroPositions;
  // TSK-073: mismo criterio -- inyectable para pruebas, nunca la tabla real de 24 turnos
  // curada en TSK-071 (costura S10, testing-seams.md: se regenera por parche).
  captainsModeTurns?: CaptainsModeTurnTable | null;
  // Req 7 (§7.6): inyectable para tests -- mismo patrón que SessionRateLimiter.
  tokenRateLimiter?: TokenRateLimiter;
  internalAuthSecret?: string;
  accountTokenNow?: () => number;
}

interface WsData {
  sessionId: string | null;
}

// apps/engine solo escucha en 127.0.0.1 (§5) -- este allowlist no es el perímetro de seguridad
// real (eso ya lo da el binding), es solo lo mínimo para que el navegador acepte una respuesta
// cross-origin de un proceso local en otro puerto (apps/web). Nunca refleja un origin remoto.
const ALLOWED_ORIGIN_PATTERN = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !ALLOWED_ORIGIN_PATTERN.test(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,x-capture-token,x-account-token",
  };
}

// Une C2 (reductor)/C3 (motor)/C4 (provider/sync) detrás de la API real de apps/engine (§3/§5).
export function createApp<TSchema extends Record<string, unknown>>(deps: AppDeps<TSchema>) {
  const captainsModeTurns = deps.captainsModeTurns !== undefined ? deps.captainsModeTurns : loadDraftFormatTurnData().captainsMode;

  // TSK-073 (spec §2.3): `turn` nunca vive en el DraftState persistido (SessionStore/reducer.ts)
  // -- es una proyección calculada al armar cada mensaje saliente, igual que ya se decidió en
  // TSK-072 para no cachear un valor redundante. `draft_state` y `snapshot` lo llevan siempre;
  // `suggestions` no lo necesita.
  function withTurn(state: DraftState): DraftState & { turn: ReturnType<typeof currentCaptainsModeTurn> } {
    return { ...state, turn: currentCaptainsModeTurn(state, captainsModeTurns) };
  }

  const sessionStore = new SessionStore();
  const rateLimiter = createSessionRateLimiter();
  const accountTokenNow = deps.accountTokenNow ?? Date.now;
  const accountNonceStore = new Map<string, number>();
  const heroPoolRoutes = createHeroPoolRoutes({ db: deps.db, openDotaClient: deps.openDotaClient });
  const accountRoutes = createAccountRoutes(deps.db);
  const teamGroupRoutes = createTeamGroupRoutes({ db: deps.db });
  const simulatorRoutes = createSimulatorSessionRoutes({ db: deps.db });
  const metaRoutes = createMetaRoutes({ db: deps.db, openDotaClient: deps.openDotaClient, heroPositions: deps.heroPositions });
  const draftPathsRoutes = createDraftPathsRoutes({ db: deps.db, sessionStore, heroCapabilities: deps.heroCapabilities });
  // Dark launch (pro-drafter-spec-v1.md §3): apagado por defecto, gate real es ENABLE_PRO_DRAFTER
  // (chequeado en el dispatch de abajo), no la sola existencia de esta instancia -- construirla no
  // toca la red ni SQLite, solo carga archivos estáticos ya usados en otras partes del motor.
  // computeSuggestionsForState está declarada más abajo (function declaration, hoisted dentro de
  // este mismo scope) -- Fase 2 (cache-aside + fallback, sesión Gobernanza 2.0): pro-drafter.ts no
  // tiene `db`, así que el fallback real a v5 se inyecta desde acá.
  const proDrafterRoutes = createProDrafterRoutes({
    heroPositions: deps.heroPositions,
    heroCapabilities: deps.heroCapabilities,
    // P14 (SPEC.md §12/§13): esta ruta es el cerebro del bot rival del simulador, nunca representa
    // a una cuenta logueada -- accountId SIEMPRE null, igual que /api/suggestions/preview.
    getMetaMatchups: async () => (await getCachedMetaSnapshot<TSchema>(deps.db, null)).matchups,
    computeV5Fallback: (state, options) => computeSuggestionsForState(state, null, { teamOpening: options?.teamOpening }),
  });
  let server: Server<WsData>;

  // TSK-048: helper compartido entre el push automático (pushSessionUpdate) y el reenvío al
  // reconectar (rama "hello" del WebSocket) -- una sola forma de calcular suggestions para un
  // DraftState dado, nunca duplicada entre los dos caminos.
  // Req 5 (§5.4): si getCachedMetaSnapshot lanza, se relanza como SnapshotUnavailableError para
  // que el llamador pueda distinguirlo de un fallo del pipeline de señales.
  async function computeSuggestionsForState(
    state: DraftState,
    accountId: number | null = null,
    options: { targetPosition?: 1 | 2 | 3 | 4 | 5; usePersonalPool?: boolean; teamOpening?: boolean; diversitySeed?: string; archetypeIntent?: DraftPathArchetype } = {},
  ): Promise<SuggestionSet> {
    let meta: Awaited<ReturnType<typeof getCachedMetaSnapshot>>;
    try {
      // TSK-098: reemplazar por el accountId de la sesión.
      meta = await getCachedMetaSnapshot<TSchema>(deps.db, accountId);
    } catch {
      throw new SnapshotUnavailableError();
    }
    const freshness = await getMetaFreshness(deps.db);
    return buildSuggestions(state, meta, { metaIsStale: freshness.isStale, heroPositions: deps.heroPositions, ...options });
  }

  // TSK-181 (Fase 4.3): SessionStore guarda la intención como `DraftPathArchetype | null` (null =
  // limpiada explícitamente); el contrato del motor la quiere como `DraftPathArchetype | undefined`
  // (ausente = sin intención). Ambos casos son "la señal queda applicable: false".
  function sessionIntent(sessionId: string): DraftPathArchetype | undefined {
    return sessionStore.archetypeIntent(sessionId) ?? undefined;
  }

  // TSK-082: sugerencias reales sin sesión -- para el bot de /random-draft, que necesita el
  // motor completo para un DraftState hipotético (sus picks durante una Blind_Round son ocultos
  // a propósito, nunca se aplican a una sesión real hasta el reveal). Reusa
  // computeSuggestionsForState tal cual -- ningún cálculo nuevo, solo un DraftState "de mentira"
  // con los campos irrelevantes (sessionId/phase/turno) en valores neutros, mismo patrón que ya
  // usa buildPrecomputeDraftState del lado de apps/web.
  async function handleSuggestionsPreview(request: Request): Promise<Response> {
    const body: unknown = await request.json().catch(() => null);
    if (!isValidSuggestionsPreviewRequest(body)) {
      return Response.json({ error: "invalid_preview_request" }, { status: 400 });
    }
    // TSK-190: el overlay de cuenta (que llena meta.heroPool para hero_pool_fit) se carga cuando
    // hay un x-account-token, independientemente de usePersonalPool. usePersonalPool queda sólo
    // como el flag del filtro duro de candidatePool (mix.ts) -- señal blanda vs. filtro son cosas
    // distintas. Token inválido -> 401 (falla ruidosa). Sin token -> accountId null, igual que antes.
    const hasAccountToken = request.headers.get("x-account-token") !== null;
    const auth = hasAccountToken || (body.usePersonalPool && !body.teamOpening)
      ? requireHttpAccount(request)
      : { ok: true as const, accountId: null };
    if (!auth.ok) return auth.response;
    const previewState: DraftState = {
      sessionId: "preview",
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
    try {
      const suggestions = await computeSuggestionsForState(previewState, auth.accountId, {
        targetPosition: body.targetPosition,
        usePersonalPool: body.usePersonalPool,
        teamOpening: body.teamOpening,
        diversitySeed: body.diversitySeed,
        archetypeIntent: body.archetypeIntent,
      });
      return Response.json(suggestions);
    } catch (err) {
      if (err instanceof SnapshotUnavailableError) {
        return Response.json({ error: "snapshot_unavailable" }, { status: 503 });
      }
      return Response.json({ error: "suggestions_failed" }, { status: 500 });
    }
  }

  // Orden garantizado tras cada evento aplicado: draft_state primero, suggestions después (§C2).
  async function pushSessionUpdate(sessionId: string): Promise<void> {
    const state = sessionStore.get(sessionId);
    server.publish(sessionId, JSON.stringify(buildServerMessage("draft_state", state.lastSeq, withTurn(state))));
    // TSK-181 (Fase 4.3): el recálculo lee la intención guardada en SessionStore -- así este push
    // automático la respeta sin ningún parámetro extra desde el capturador. `accountId` sigue en
    // null acá, igual que antes (el scoping por cuenta de este push es un TODO aparte, TSK-098).
    const suggestions = await computeSuggestionsForState(state, null, {
      archetypeIntent: sessionIntent(sessionId),
    });
    server.publish(sessionId, JSON.stringify(buildServerMessage("suggestions", state.lastSeq, suggestions)));
  }

  async function handleDraftEvent(request: Request, opts: { requireToken: boolean; rateLimit: boolean }): Promise<Response> {
    if (opts.requireToken && !checkCaptureToken(request, deps.captureToken)) {
      return new Response(null, { status: 401 });
    }

    const body: unknown = await request.json().catch(() => null);
    if (!isValidDraftEventEnvelope(body)) {
      return Response.json({ accepted: false }, { status: 400 });
    }

    const sourceIp = request.headers.get("x-forwarded-for") ?? "unknown";

    if (opts.rateLimit && deps.tokenRateLimiter) {
      const incomingToken = request.headers.get("x-capture-token") ?? "";
      if (!deps.tokenRateLimiter.allow(incomingToken)) {
        console.log(JSON.stringify({
          timestamp: new Date().toISOString(),
          event: "rate_limit_exceeded",
          scope: "token",
          sessionId: body.sessionId,
          sourceIp,
        }));
        return Response.json({ error: "rate_limit_exceeded", scope: "token" }, { status: 429 });
      }
    }

    if (opts.rateLimit && !rateLimiter.allow(body.sessionId)) {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        event: "rate_limit_exceeded",
        scope: "session",
        sessionId: body.sessionId,
        sourceIp,
      }));
      return Response.json({ error: "rate_limit_exceeded", scope: "session" }, { status: 429 });
    }

    // TSK-055: oportunista, igual que cleanupSimulatorSessions() -- sin scheduler propio.
    sessionStore.evictStale();
    const { state, rejected } = sessionStore.apply(body);
    if (!rejected) {
      // TSK-214: el push por WebSocket es best-effort y NUNCA puede tumbar la ingesta. Antes, un
      // `SnapshotUnavailableError` de computeSuggestionsForState (meta vacía o sin sincronizar)
      // se propagaba y hacía fallar el POST entero -- con el estado ya aplicado en el store, así
      // que el cliente perdía el tablero por un problema de sugerencias. Es la misma regla que ya
      // rige el resto del motor (engine.md): una señal rota nunca tira el motor completo.
      try {
        await pushSessionUpdate(body.sessionId);
      } catch (error) {
        console.error(`[app] push tras evento falló para la sesión ${body.sessionId}:`, error);
      }
    }
    // TSK-214: el estado resultante viaja en la respuesta del POST, no sólo por el push de
    // WebSocket. Next rewrites no puede proxear un WS, así que en Railway el navegador no tiene
    // socket contra el motor -- sin esto, apps/web se quedaba con su preview sintético local y el
    // tablero del simulador nunca avanzaba (bot repitiendo el mismo héroe cada ronda). El push por
    // WS sigue igual: es optimización para quien sí tiene socket, no el único camino.
    return Response.json({ accepted: !rejected, rejected, draftState: withTurn(state) }, { status: 202 });
  }

  async function handleHeroes(): Promise<Response> {
    return Response.json(await getAllHeroMeta(deps.db));
  }

  function requireHttpAccount(request: Request, allowUnknown = false) {
    if (deps.internalAuthSecret) return requireAccount(request, deps.internalAuthSecret, accountTokenNow, accountNonceStore, deps.db, allowUnknown);
    const accountId = getSoleAccountId(deps.db);
    return accountId === null
      ? { ok: false as const, response: Response.json({ error: "unknown_account" }, { status: 401 }) }
      : { ok: true as const, accountId };
  }

  async function routeApiRequest(request: Request, url: URL): Promise<Response> {
    if (request.method === "GET" && url.pathname === "/api/health") {
      return Response.json({ ...getHealthStatus(sessionStore.size), authMode: deps.internalAuthSecret ? "multi_tenant" : "single_tenant_local" });
    }
    if (request.method === "POST" && url.pathname === "/ingest/draft-event") {
      return handleDraftEvent(request, { requireToken: true, rateLimit: true });
    }
    if (request.method === "POST" && url.pathname === "/api/session/manual") {
      // TSK-214: `rateLimit: true`. Antes era `false` porque esta ruta sólo era alcanzable en
      // loopback; desde que apps/web la llama por el proxy (`/engine/api/session/manual`) deja de
      // serlo, así que aplica el mismo límite de 20 eventos/segundo por sesión que /ingest.
      return handleDraftEvent(request, { requireToken: false, rateLimit: true });
    }
    if (request.method === "POST" && url.pathname === "/api/suggestions/preview") {
      return handleSuggestionsPreview(request);
    }
    // Experimental (dark launch): mismo contrato de entrada que /api/suggestions/preview arriba.
    // Con el flag en `false` (default), cae al handler v5 real -- ningún comportamiento de
    // producción cambia hasta que alguien prenda ENABLE_PRO_DRAFTER explícitamente.
    if (request.method === "POST" && url.pathname === "/api/v1/draft/pro-recommendations") {
      if (process.env.ENABLE_PRO_DRAFTER !== "true") return handleSuggestionsPreview(request);
      return proDrafterRoutes.postRecommendations(request);
    }
    // Diagnóstico de curación de corpus (sesión Gobernanza 2.0): mismo gate que el endpoint de
    // arriba -- sin Pro-Drafter activo no hay `knn_similarity` que reportar, así que esta ruta no
    // tiene sentido con el flag apagado, apagada también.
    if (request.method === "POST" && url.pathname === "/api/pro-drafter/low-confidence-report") {
      if (process.env.ENABLE_PRO_DRAFTER !== "true") return Response.json({ error: "not_found" }, { status: 404 });
      return handleLowConfidenceReport(request);
    }
    if (request.method === "GET" && url.pathname === "/api/heroes") {
      return handleHeroes();
    }
    if (request.method === "GET" && url.pathname === "/api/meta/status") {
      return metaRoutes.status();
    }
    if (request.method === "GET" && url.pathname === "/api/meta/hero-stats") {
      return metaRoutes.heroStats();
    }
    if (request.method === "POST" && url.pathname === "/api/meta/sync") {
      const auth = requireHttpAccount(request);
      if (!auth.ok) return auth.response;
      return metaRoutes.sync(request);
    }
    if (request.method === "GET" && url.pathname === "/api/account") {
      const auth = requireHttpAccount(request);
      return auth.ok ? accountRoutes.get(auth.accountId) : auth.response;
    }
    if (request.method === "POST" && url.pathname === "/api/account") {
      const auth = requireHttpAccount(request, true);
      return auth.ok ? accountRoutes.post(auth.accountId) : auth.response;
    }
    if (request.method === "GET" && url.pathname === "/api/hero-pool") {
      const auth = requireHttpAccount(request);
      return auth.ok ? heroPoolRoutes.get(auth.accountId) : auth.response;
    }
    if (request.method === "PUT" && url.pathname === "/api/hero-pool") {
      const auth = requireHttpAccount(request);
      return auth.ok ? heroPoolRoutes.put(request, auth.accountId) : auth.response;
    }
    if (request.method === "POST" && url.pathname === "/api/hero-pool/calculate") {
      const auth = requireHttpAccount(request);
      return auth.ok ? heroPoolRoutes.calculate(request, auth.accountId) : auth.response;
    }
    if (request.method === "POST" && url.pathname === "/api/simulator/sessions") {
      return simulatorRoutes.post();
    }
    const simulatorSessionId = simulatorRoutes.parseStateSessionId(url.pathname);
    if (simulatorSessionId !== null && request.method === "GET") {
      return simulatorRoutes.stateGet(simulatorSessionId);
    }
    if (request.method === "GET" && url.pathname === "/api/team-groups") {
      const auth = requireHttpAccount(request);
      return auth.ok ? teamGroupRoutes.list(auth.accountId) : auth.response;
    }
    if (request.method === "POST" && url.pathname === "/api/team-groups") {
      const auth = requireHttpAccount(request);
      return auth.ok ? teamGroupRoutes.post(request, auth.accountId) : auth.response;
    }
    const teamGroupId = teamGroupRoutes.parseId(url.pathname);
    if (teamGroupId !== null && request.method === "GET") {
      const auth = requireHttpAccount(request);
      return auth.ok ? teamGroupRoutes.get(teamGroupId, auth.accountId) : auth.response;
    }
    if (teamGroupId !== null && request.method === "PUT") {
      const auth = requireHttpAccount(request);
      return auth.ok ? teamGroupRoutes.put(request, teamGroupId, auth.accountId) : auth.response;
    }
    if (teamGroupId !== null && request.method === "DELETE") {
      const auth = requireHttpAccount(request);
      return auth.ok ? teamGroupRoutes.delete(teamGroupId, auth.accountId) : auth.response;
    }
    const draftPathsSessionId = draftPathsRoutes.parseSessionId(url.pathname);
    if (draftPathsSessionId !== null && request.method === "GET") {
      return draftPathsRoutes.get(draftPathsSessionId);
    }
    if (request.method === "GET" && url.pathname === "/api/feedback") {
      return draftPathsRoutes.feedbackGet();
    }
    const feedbackSessionId = draftPathsRoutes.parseFeedbackSessionId(url.pathname);
    if (feedbackSessionId !== null && request.method === "POST") {
      return draftPathsRoutes.feedbackPost(request, feedbackSessionId);
    }

    return new Response("Not found", { status: 404 });
  }

  async function fetchHandler(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);

    if (url.pathname === "/ws/draft") {
      const upgraded = server.upgrade(request, { data: { sessionId: null } satisfies WsData });
      return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
    }

    // apps/web (otro puerto) llama a esta API desde el navegador -- sin esto, RTK Query nunca
    // funciona de verdad aunque curl y las pruebas de servidor pasen limpio (hallazgo de
    // @redteam, TSK-014): el preflight de un método no-simple como PUT/POST con JSON responde
    // 404 sin manejo de OPTIONS, y una respuesta sin Access-Control-Allow-Origin es invisible
    // para el JS del navegador aunque la request en sí llegue.
    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const response = await routeApiRequest(request, url);
    for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
    return response;
  }

  const websocketHandlers = {
    async message(ws: ServerWebSocket<WsData>, raw: string | Buffer) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        ws.send(JSON.stringify(buildServerMessage("error", 0, { code: "invalid_json", message: "Mensaje no es JSON válido" })));
        return;
      }
      if (!isValidClientMessage(parsed)) return;
      const message: ClientMessage = parsed;

      if (message.type === "hello" && message.sessionId) {
        if (deps.internalAuthSecret) {
          const verified = verifyAccountToken(message.accountToken, deps.internalAuthSecret, accountTokenNow, accountNonceStore);
          const known = verified.ok && deps.db.select({ id: accounts.steamAccountId }).from(accounts).where(eq(accounts.steamAccountId, verified.accountId)).limit(1).all().length > 0;
          if (!verified.ok || !known || !sessionStore.claimOwner(message.sessionId, verified.accountId)) {
            ws.send(JSON.stringify(buildServerMessage("error", 0, { code: "unauthorized", message: "Sesión no válida — volvé a iniciar sesión" })));
            ws.close(1008, "unauthorized");
            return;
          }
        }
        ws.data.sessionId = message.sessionId;
        ws.subscribe(message.sessionId);
        const state = sessionStore.get(message.sessionId);

        // Req 5.1/5.5: snapshot siempre antes de intentar calcular sugerencias -- DraftState
        // siempre disponible desde sessionStore.get() (nunca lanza). El cliente recupera el
        // tablero aunque la etapa de sugerencias falle por completo.
        ws.send(JSON.stringify(buildServerMessage("snapshot", state.lastSeq, withTurn(state))));

        // Req 5.2/5.4: sugerencias con degradación controlada -- tres casos posibles:
        //   1. computeSuggestionsForState resuelve → mensaje "suggestions" normal.
        //   2. SnapshotUnavailableError (getCachedMetaSnapshot lanzó) → mensaje "error" con
        //      code "snapshot_unavailable"; conexión permanece abierta.
        //   3. Cualquier otro error → mensaje "suggestions" degradado vacío.
        try {
          const suggestions = await computeSuggestionsForState(state, sessionStore.ownerAccountId(message.sessionId), {
            archetypeIntent: sessionIntent(message.sessionId),
          });
          ws.send(JSON.stringify(buildServerMessage("suggestions", state.lastSeq, suggestions)));
        } catch (err) {
          if (err instanceof SnapshotUnavailableError) {
            // Req 5.4: error tipado -- el cliente sabe que el snapshot de meta no está listo;
            // la conexión NO se cierra para que el cliente pueda reintentar más adelante.
            ws.send(
              JSON.stringify(
                buildServerMessage("error", state.lastSeq, {
                  code: "snapshot_unavailable",
                  message: "No se pudo construir el snapshot de meta -- reintentá en unos segundos",
                }),
              ),
            );
          } else {
            // Req 5.2: fallo del pipeline de señales -- degradación parcial, nunca silencio.
            const degradedSuggestions: SuggestionSet = {
              schema: "suggestions/v1",
              sessionId: state.sessionId,
              basedOnSeq: state.lastSeq,
              decisionContext: deriveDecisionContext(state, false),
              suggestions: [],
              comparison: null,
              degraded: ["partial_signals"],
              computedInMs: 0,
            };
            ws.send(JSON.stringify(buildServerMessage("suggestions", state.lastSeq, degradedSuggestions)));
          }
        }
      }

      // TSK-181 (Fase 4.3): el usuario eligió/limpió su intención de draft. Sólo se acepta para la
      // sesión que este socket ya reclamó con hello. Si el valor no cambió -> no-op (ni recálculo
      // ni push). Si cambió -> se guarda y se empuja SÓLO `suggestions` (el tablero no cambió, así
      // que no van snapshot ni draft_state -- excepción explícita al orden de push, como draft_paths).
      if (message.type === "set_intent" && message.sessionId && ws.data.sessionId === message.sessionId) {
        const next = message.archetypeIntent ?? null;
        if (sessionStore.archetypeIntent(message.sessionId) === next) return;
        sessionStore.setArchetypeIntent(message.sessionId, next);
        const state = sessionStore.get(message.sessionId);
        try {
          const suggestions = await computeSuggestionsForState(state, sessionStore.ownerAccountId(message.sessionId), { archetypeIntent: next ?? undefined });
          server.publish(message.sessionId, JSON.stringify(buildServerMessage("suggestions", state.lastSeq, suggestions)));
        } catch {
          // Un fallo del pipeline no tira la conexión ni pierde la intención guardada -- el próximo
          // draft-event (o un hello de reconexión) vuelve a intentar el cálculo con la intención ya
          // persistida en SessionStore.
        }
      }
      // "ping": sin respuesta requerida -- solo mantiene viva la conexión.
    },
    close(ws: ServerWebSocket<WsData>) {
      if (ws.data.sessionId) ws.unsubscribe(ws.data.sessionId);
    },
  };

  function start(hostname: string, port: number): Server<WsData> {
    server = Bun.serve<WsData>({ hostname, port, fetch: fetchHandler, websocket: websocketHandlers });
    return server;
  }

  return { start, sessionStore };
}
