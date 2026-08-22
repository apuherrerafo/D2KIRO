import type { Server, ServerWebSocket } from "bun";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "../db/schema";
import { getAllSettings, upsertSetting } from "../db/queries";
import type { HeroCapabilities } from "../draft-paths/types";
import type { DraftState } from "../draft/reducer";
import { getHealthStatus } from "../health";
import type { OpenDotaClient } from "../meta/opendota-client";
import { getAllHeroMeta, getCachedMetaSnapshot, getMetaFreshness, invalidateMetaSnapshotCache } from "../meta/provider";
import type { HeroPositions } from "../signals/hero-positions";
import { buildSuggestions, type SuggestionSet } from "../signals/mix";
import { checkCaptureToken, createSessionRateLimiter, isValidClientMessage, isValidDraftEventEnvelope, type TokenRateLimiter } from "./edge";
import { createDraftPathsRoutes } from "./routes/draft-paths";
import { createHeroPoolRoutes } from "./routes/hero-pool";
import { createMetaRoutes } from "./routes/meta";
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
  // Req 7 (§7.6): inyectable para tests -- mismo patrón que SessionRateLimiter.
  tokenRateLimiter?: TokenRateLimiter;
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
    "Access-Control-Allow-Headers": "content-type,x-capture-token",
  };
}

// Une C2 (reductor)/C3 (motor)/C4 (provider/sync) detrás de la API real de apps/engine (§3/§5).
export function createApp<TSchema extends Record<string, unknown>>(deps: AppDeps<TSchema>) {
  const sessionStore = new SessionStore();
  const rateLimiter = createSessionRateLimiter();
  const heroPoolRoutes = createHeroPoolRoutes({ db: deps.db, openDotaClient: deps.openDotaClient });
  const teamGroupRoutes = createTeamGroupRoutes({ db: deps.db });
  const simulatorRoutes = createSimulatorSessionRoutes({ db: deps.db });
  const metaRoutes = createMetaRoutes({ db: deps.db, openDotaClient: deps.openDotaClient, heroPositions: deps.heroPositions });
  const draftPathsRoutes = createDraftPathsRoutes({ db: deps.db, sessionStore, heroCapabilities: deps.heroCapabilities });
  let server: Server<WsData>;

  // TSK-048: helper compartido entre el push automático (pushSessionUpdate) y el reenvío al
  // reconectar (rama "hello" del WebSocket) -- una sola forma de calcular suggestions para un
  // DraftState dado, nunca duplicada entre los dos caminos.
  // Req 5 (§5.4): si getCachedMetaSnapshot lanza, se relanza como SnapshotUnavailableError para
  // que el llamador pueda distinguirlo de un fallo del pipeline de señales.
  async function computeSuggestionsForState(state: DraftState): Promise<SuggestionSet> {
    let meta: Awaited<ReturnType<typeof getCachedMetaSnapshot>>;
    try {
      meta = await getCachedMetaSnapshot(deps.db);
    } catch {
      throw new SnapshotUnavailableError();
    }
    const freshness = await getMetaFreshness(deps.db);
    return buildSuggestions(state, meta, { metaIsStale: freshness.isStale });
  }

  // Orden garantizado tras cada evento aplicado: draft_state primero, suggestions después (§C2).
  async function pushSessionUpdate(sessionId: string): Promise<void> {
    const state = sessionStore.get(sessionId);
    server.publish(sessionId, JSON.stringify(buildServerMessage("draft_state", state.lastSeq, state)));
    const suggestions = await computeSuggestionsForState(state);
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
    const { rejected } = sessionStore.apply(body);
    if (!rejected) await pushSessionUpdate(body.sessionId);
    return Response.json({ accepted: !rejected, rejected }, { status: 202 });
  }

  async function handleHeroes(): Promise<Response> {
    return Response.json(await getAllHeroMeta(deps.db));
  }

  async function handleSettingsGet(): Promise<Response> {
    return Response.json(getAllSettings(deps.db));
  }

  function isValidSettingBody(value: unknown): value is { key: string; value: string } {
    if (typeof value !== "object" || value === null) return false;
    const body = value as Record<string, unknown>;
    return typeof body.key === "string" && body.key.length > 0 && typeof body.value === "string";
  }

  // Input externo: se valida en el borde antes de tocar la DB, igual que cualquier otro envelope.
  async function handleSettingsPut(request: Request): Promise<Response> {
    const body: unknown = await request.json().catch(() => null);
    if (!isValidSettingBody(body)) {
      return Response.json({ error: "Se espera { key: string, value: string }" }, { status: 400 });
    }
    upsertSetting(deps.db, body.key, body.value);
    if (body.key === "personal_baseline_winrate") {
      invalidateMetaSnapshotCache();
    }
    return Response.json({ key: body.key, value: body.value }, { status: 200 });
  }

  async function routeApiRequest(request: Request, url: URL): Promise<Response> {
    if (request.method === "GET" && url.pathname === "/api/health") {
      return Response.json(getHealthStatus(sessionStore.size));
    }
    if (request.method === "POST" && url.pathname === "/ingest/draft-event") {
      return handleDraftEvent(request, { requireToken: true, rateLimit: true });
    }
    if (request.method === "POST" && url.pathname === "/api/session/manual") {
      return handleDraftEvent(request, { requireToken: false, rateLimit: false });
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
      return metaRoutes.sync(request);
    }
    if (request.method === "GET" && url.pathname === "/api/settings") {
      return handleSettingsGet();
    }
    if (request.method === "PUT" && url.pathname === "/api/settings") {
      return handleSettingsPut(request);
    }
    if (request.method === "GET" && url.pathname === "/api/hero-pool") {
      return heroPoolRoutes.get();
    }
    if (request.method === "PUT" && url.pathname === "/api/hero-pool") {
      return heroPoolRoutes.put(request);
    }
    if (request.method === "POST" && url.pathname === "/api/hero-pool/calculate") {
      return heroPoolRoutes.calculate(request);
    }
    if (request.method === "POST" && url.pathname === "/api/simulator/sessions") {
      return simulatorRoutes.post();
    }
    const simulatorSessionId = simulatorRoutes.parseStateSessionId(url.pathname);
    if (simulatorSessionId !== null && request.method === "GET") {
      return simulatorRoutes.stateGet(simulatorSessionId);
    }
    if (request.method === "GET" && url.pathname === "/api/team-groups") {
      return teamGroupRoutes.list();
    }
    if (request.method === "POST" && url.pathname === "/api/team-groups") {
      return teamGroupRoutes.post(request);
    }
    const teamGroupId = teamGroupRoutes.parseId(url.pathname);
    if (teamGroupId !== null && request.method === "GET") {
      return teamGroupRoutes.get(teamGroupId);
    }
    if (teamGroupId !== null && request.method === "PUT") {
      return teamGroupRoutes.put(request, teamGroupId);
    }
    if (teamGroupId !== null && request.method === "DELETE") {
      return teamGroupRoutes.delete(teamGroupId);
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
        ws.data.sessionId = message.sessionId;
        ws.subscribe(message.sessionId);
        const state = sessionStore.get(message.sessionId);

        // Req 5.1/5.5: snapshot siempre antes de intentar calcular sugerencias -- DraftState
        // siempre disponible desde sessionStore.get() (nunca lanza). El cliente recupera el
        // tablero aunque la etapa de sugerencias falle por completo.
        ws.send(JSON.stringify(buildServerMessage("snapshot", state.lastSeq, state)));

        // Req 5.2/5.4: sugerencias con degradación controlada -- tres casos posibles:
        //   1. computeSuggestionsForState resuelve → mensaje "suggestions" normal.
        //   2. SnapshotUnavailableError (getCachedMetaSnapshot lanzó) → mensaje "error" con
        //      code "snapshot_unavailable"; conexión permanece abierta.
        //   3. Cualquier otro error → mensaje "suggestions" degradado vacío.
        try {
          const suggestions = await computeSuggestionsForState(state);
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
              suggestions: [],
              comparison: null,
              degraded: ["partial_signals"],
              computedInMs: 0,
            };
            ws.send(JSON.stringify(buildServerMessage("suggestions", state.lastSeq, degradedSuggestions)));
          }
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
