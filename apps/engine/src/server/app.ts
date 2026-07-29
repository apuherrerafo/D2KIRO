import type { Server, ServerWebSocket } from "bun";
import { desc } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "../db/schema";
import { metaSync } from "../db/schema";
import { getAllSettings, getHeroPool, replaceHeroPool, upsertSetting, type HeroPoolWriteRow } from "../db/queries";
import { calculateProposedPool, type HeroPoolInputRow } from "../hero-pool/calculate-pool";
import { getHealthStatus } from "../health";
import { mapPlayerHero } from "../meta/mappers";
import type { OpenDotaClient } from "../meta/opendota-client";
import { buildMetaSnapshot, getAllHeroMeta, getMetaFreshness } from "../meta/provider";
import { beginMetaSync, runMetaSync } from "../meta/sync";
import { isValidRawPlayerHero, isValidSteamAccountId } from "../meta/validation";
import { buildSuggestions } from "../signals/mix";
import { checkCaptureToken, createSessionRateLimiter, isValidClientMessage, isValidDraftEventEnvelope } from "./edge";
import { SessionStore, buildServerMessage, type ClientMessage } from "./session";

type Db<TSchema extends Record<string, unknown> = Record<string, never>> = BunSQLiteDatabase<TSchema>;

export interface AppDeps<TSchema extends Record<string, unknown> = typeof schema> {
  db: Db<TSchema>;
  openDotaClient: OpenDotaClient;
  captureToken: string;
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
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,x-capture-token",
  };
}

// Une C2 (reductor)/C3 (motor)/C4 (provider/sync) detrás de la API real de apps/engine (§3/§5).
export function createApp<TSchema extends Record<string, unknown>>(deps: AppDeps<TSchema>) {
  const sessionStore = new SessionStore();
  const rateLimiter = createSessionRateLimiter();
  let server: Server<WsData>;
  // TSK-021: sin cola, sin reintento automático (§9.5) -- un flag por proceso alcanza para este
  // servidor local de un solo usuario. Un segundo POST mientras el primero sigue en vuelo se
  // rechaza de inmediato con 409, nunca se encola.
  let heroPoolCalculationInProgress = false;

  // Orden garantizado tras cada evento aplicado: draft_state primero, suggestions después (§C2).
  async function pushSessionUpdate(sessionId: string): Promise<void> {
    const state = sessionStore.get(sessionId);
    const meta = await buildMetaSnapshot(deps.db);
    const freshness = await getMetaFreshness(deps.db);

    server.publish(sessionId, JSON.stringify(buildServerMessage("draft_state", state.lastSeq, state)));
    const suggestions = buildSuggestions(state, meta, { metaIsStale: freshness.isStale });
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
    if (opts.rateLimit && !rateLimiter.allow(body.sessionId)) {
      return new Response(null, { status: 429 });
    }

    const { rejected } = sessionStore.apply(body);
    if (!rejected) await pushSessionUpdate(body.sessionId);
    return Response.json({ accepted: !rejected, rejected }, { status: 202 });
  }

  async function handleHeroes(): Promise<Response> {
    return Response.json(await getAllHeroMeta(deps.db));
  }

  async function handleMetaStatus(): Promise<Response> {
    const freshness = await getMetaFreshness(deps.db);
    const [lastAttempt] = deps.db.select().from(metaSync).orderBy(desc(metaSync.id)).limit(1).all();
    return Response.json({
      syncedAt: freshness.syncedAt,
      isStale: freshness.isStale,
      lastSync: lastAttempt ? { status: lastAttempt.status, finishedAt: lastAttempt.finishedAt, error: lastAttempt.error } : null,
    });
  }

  // Asíncrono, no bloquea: crea la fila de meta_sync (rápido) y responde de inmediato con el
  // syncId real; el trabajo lento (fetch a OpenDota + reintentos) sigue en segundo plano.
  async function handleMetaSync(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => ({}))) as { patch?: string };
    const patch = typeof body.patch === "string" ? body.patch : "";
    const heroIdsForMatchups = deps.db
      .select({ id: schema.heroes.id })
      .from(schema.heroes)
      .all()
      .map((row) => row.id);

    const syncId = beginMetaSync(deps.db);
    void runMetaSync(deps.db, deps.openDotaClient, syncId, { patch, heroIdsForMatchups });

    return Response.json({ syncId }, { status: 202 });
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
    return Response.json({ key: body.key, value: body.value }, { status: 200 });
  }

  // TSK-020 (fase 1b, S8): GET/PUT /api/hero-pool. `hero` (no `heroId`) es el nombre de campo del
  // contrato de dominio (SPEC.md §9.4/§9.5) -- se traduce a/desde `heroId` de la fila de SQLite
  // solo en este borde, igual que el resto de la API nunca filtra nombres de columna hacia fuera.
  interface HeroPoolEntry {
    hero: number;
    source: "manual" | "calculated";
    personalWinrate: number | null;
    personalGames: number;
    updatedAt: string;
  }

  function toHeroPoolEntry(row: HeroPoolWriteRow): HeroPoolEntry {
    return { hero: row.heroId, source: row.source, personalWinrate: row.personalWinrate, personalGames: row.personalGames, updatedAt: row.updatedAt };
  }

  interface HeroPoolPutEntry {
    hero: number;
    source: "manual" | "calculated";
    personalWinrate: number | null;
    personalGames: number;
  }

  function isValidHeroPoolPutEntry(value: unknown): value is HeroPoolPutEntry {
    if (typeof value !== "object" || value === null) return false;
    const entry = value as Record<string, unknown>;
    if (typeof entry.hero !== "number") return false;
    if (entry.source !== "manual" && entry.source !== "calculated") return false;
    if (entry.personalWinrate !== null && (typeof entry.personalWinrate !== "number" || entry.personalWinrate < 0 || entry.personalWinrate > 1)) {
      return false;
    }
    if (typeof entry.personalGames !== "number" || !Number.isInteger(entry.personalGames) || entry.personalGames < 0) return false;
    return true;
  }

  function isValidHeroPoolPutBody(value: unknown): value is { entries: HeroPoolPutEntry[] } {
    if (typeof value !== "object" || value === null) return false;
    const body = value as Record<string, unknown>;
    return Array.isArray(body.entries) && body.entries.every(isValidHeroPoolPutEntry);
  }

  async function handleHeroPoolGet(): Promise<Response> {
    return Response.json(getHeroPool(deps.db).map(toHeroPoolEntry));
  }

  // Reemplaza el pool completo en una sola transacción (S8). Todas las validaciones corren antes
  // de tocar la base de datos -- si algo falla, el pool guardado no se toca (§9.5).
  async function handleHeroPoolPut(request: Request): Promise<Response> {
    const body: unknown = await request.json().catch(() => null);
    if (!isValidHeroPoolPutBody(body)) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
    if (body.entries.length > 5) {
      return Response.json({ error: "too_many_entries" }, { status: 400 });
    }
    const heroIds = body.entries.map((entry) => entry.hero);
    if (new Set(heroIds).size !== heroIds.length) {
      return Response.json({ error: "duplicate_hero" }, { status: 400 });
    }
    const knownHeroIds = new Set(deps.db.select({ id: schema.heroes.id }).from(schema.heroes).all().map((row) => row.id));
    if (heroIds.some((id) => !knownHeroIds.has(id))) {
      return Response.json({ error: "unknown_hero" }, { status: 400 });
    }

    // El servidor siempre estampa su propio reloj -- un cliente no dicta `updatedAt` (mismo
    // principio que `applyDraftEvent`: el reloj se inyecta desde el lado de confianza, nunca desde
    // input externo).
    const updatedAt = new Date().toISOString();
    const rows: HeroPoolWriteRow[] = body.entries.map((entry) => ({
      heroId: entry.hero,
      source: entry.source,
      personalWinrate: entry.personalWinrate,
      personalGames: entry.personalGames,
      updatedAt,
    }));
    replaceHeroPool(deps.db, rows);

    return Response.json(rows.map(toHeroPoolEntry), { status: 200 });
  }

  // TSK-021: único endpoint de 1b que toca la red. Conecta getPlayerHeroes (TSK-018) con el
  // cálculo puro (TSK-019, S7) -- nunca escribe en SQLite, solo propone (PUT /api/hero-pool,
  // TSK-020, sigue siendo el único camino de escritura). Reglas duras: el accountId nunca se
  // ecoa en ningún error/log, y esta llamada vive fuera del pipeline de buildSuggestions -- no
  // toca el camino caliente del draft.
  async function handleHeroPoolCalculate(request: Request): Promise<Response> {
    const body: unknown = await request.json().catch(() => null);
    const accountId = typeof body === "object" && body !== null ? (body as Record<string, unknown>).accountId : undefined;
    if (typeof accountId !== "string" || !isValidSteamAccountId(accountId)) {
      return Response.json({ error: "invalid_account_id" }, { status: 400 });
    }
    const rawDays = typeof body === "object" && body !== null ? (body as Record<string, unknown>).days : undefined;
    // Number.isFinite (no solo typeof number) descarta Infinity -- "rawDays > 0" por sí solo lo
    // dejaba pasar (Infinity > 0 es true), colando date=Infinity en la URL hacia OpenDota.
    const days = Number.isFinite(rawDays) && (rawDays as number) > 0 ? (rawDays as number) : 90;

    if (heroPoolCalculationInProgress) {
      return Response.json({ error: "calculation_in_progress" }, { status: 409 });
    }

    heroPoolCalculationInProgress = true;
    try {
      let raw: unknown;
      try {
        raw = await deps.openDotaClient.getPlayerHeroes(accountId, { days });
      } catch {
        raw = null;
      }
      if (!Array.isArray(raw)) {
        return Response.json(
          { error: "opendota_unavailable", message: "OpenDota no respondió. El pool guardado (si existe) sigue funcionando." },
          { status: 502 },
        );
      }

      // Bucle de filtrado (nota de @redteam de TSK-018, evt-20260729-007): las primitivas de una
      // fila (isValidRawPlayerHero/mapPlayerHero) no descartan nada por sí solas -- este es el
      // orquestador que itera el array crudo, igual que syncHeroes/syncMatchups en sync.ts.
      const heroRows: HeroPoolInputRow[] = [];
      for (const item of raw) {
        if (isValidRawPlayerHero(item)) heroRows.push(mapPlayerHero(item));
      }

      const result = calculateProposedPool(heroRows, () => new Date().toISOString());
      return Response.json({
        proposed: result.proposed,
        baselineWinrate: result.baselineWinrate,
        consideredHeroes: result.consideredHeroes,
        windowDays: days,
      });
    } finally {
      heroPoolCalculationInProgress = false;
    }
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
      return handleMetaStatus();
    }
    if (request.method === "POST" && url.pathname === "/api/meta/sync") {
      return handleMetaSync(request);
    }
    if (request.method === "GET" && url.pathname === "/api/settings") {
      return handleSettingsGet();
    }
    if (request.method === "PUT" && url.pathname === "/api/settings") {
      return handleSettingsPut(request);
    }
    if (request.method === "GET" && url.pathname === "/api/hero-pool") {
      return handleHeroPoolGet();
    }
    if (request.method === "PUT" && url.pathname === "/api/hero-pool") {
      return handleHeroPoolPut(request);
    }
    if (request.method === "POST" && url.pathname === "/api/hero-pool/calculate") {
      return handleHeroPoolCalculate(request);
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
    message(ws: ServerWebSocket<WsData>, raw: string | Buffer) {
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
        // Al reconectar, siempre una instantánea completa -- nunca un delta (§3).
        ws.send(JSON.stringify(buildServerMessage("snapshot", state.lastSeq, state)));
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
