import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { applyDraftEvent, createIdleDraftState, type DraftState } from "../../draft/reducer";
import { getCachedMetaSnapshot, getMetaFreshness } from "../../meta/provider";
import { buildSuggestions, type SuggestionSet } from "../../signals/mix";
import { runSimulator, type DraftScript } from "../../simulator/player";
import simulatorScripts from "../../simulator/scripts.json";

// TSK-057: extraído de apps/engine/src/server/app.ts (hallazgo 2.1 de "Radiografía de
// dota2coach", parte 2/3 -- ver TSK-056 para contexto completo). Segundo store de sesiones en
// memoria, independiente de SessionStore (session.ts) -- el simulador nunca comparte sesiones
// con un draft real. Mismo comportamiento exacto, verificado con la suite de integración
// existente de app.test.ts.
const SIMULATOR_SESSION_TTL_MS = 45 * 60 * 1000;
const SIMULATOR_POST_WINDOW_MS = 60 * 1000;
const SIMULATOR_POST_LIMIT = 20;
const SIMULATOR_SCRIPT = simulatorScripts.captainsMode as DraftScript;

interface SimulatorSession {
  draftState: DraftState;
  suggestions: SuggestionSet | null;
  lastAccessedAt: number;
  running: boolean;
}

export interface SimulatorSessionRouteDeps<TSchema extends Record<string, unknown>> {
  db: BunSQLiteDatabase<TSchema>;
}

export function createSimulatorSessionRoutes<TSchema extends Record<string, unknown>>(deps: SimulatorSessionRouteDeps<TSchema>) {
  const sessions = new Map<string, SimulatorSession>();
  const postTimestamps: number[] = [];

  function cleanup(now = Date.now()): void {
    for (const [sessionId, session] of sessions) {
      if (!session.running && now - session.lastAccessedAt > SIMULATOR_SESSION_TTL_MS) {
        sessions.delete(sessionId);
      }
    }
  }

  function allowStart(now = Date.now()): boolean {
    while (postTimestamps.length > 0 && now - postTimestamps[0]! > SIMULATOR_POST_WINDOW_MS) {
      postTimestamps.shift();
    }
    if (postTimestamps.length >= SIMULATOR_POST_LIMIT) return false;
    postTimestamps.push(now);
    return true;
  }

  async function updateSession(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) return;

    const state = session.draftState;
    const meta = await getCachedMetaSnapshot(deps.db, null);
    const freshness = await getMetaFreshness(deps.db);
    const suggestions = buildSuggestions(state, meta, { metaIsStale: freshness.isStale });
    session.suggestions = suggestions;
    session.lastAccessedAt = Date.now();
  }

  function post(): Response {
    cleanup();
    if (!allowStart()) {
      return Response.json({ error: "too_many_simulator_sessions" }, { status: 429 });
    }

    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, {
      draftState: createIdleDraftState(sessionId),
      suggestions: null,
      lastAccessedAt: Date.now(),
      running: true,
    });

    // .catch() es obligatorio acá: sin él, un fallo transitorio dentro del emit (ej. SQLite/
    // Drizzle) queda como un rechazo de promesa sin manejar -- Bun (igual que Node) termina TODO
    // el proceso ante eso, tumbando también el motor de sugerencias real y las sesiones de
    // WebSocket activas, no solo esta sesión simulada. Confirmado de forma empírica antes de este
    // fix: un throw dentro de fails().finally(...) sin .catch() mata el proceso con exit code 1.
    void runSimulator(SIMULATOR_SCRIPT, {
      sessionId,
      speed: 2,
      emit: async (envelope) => {
        const session = sessions.get(sessionId);
        if (!session) return;
        session.draftState = applyDraftEvent(session.draftState, envelope).state;
        await updateSession(sessionId);
      },
    })
      .catch((error: unknown) => {
        console.error(`[simulator] sesión ${sessionId} falló:`, error);
      })
      .finally(() => {
        const session = sessions.get(sessionId);
        if (session) {
          session.running = false;
          session.lastAccessedAt = Date.now();
        }
      });

    return Response.json({ sessionId }, { status: 201 });
  }

  function parseStateSessionId(pathname: string): string | null {
    const match = /^\/api\/simulator\/sessions\/([^/]+)\/state$/.exec(pathname);
    if (!match) return null;
    return decodeURIComponent(match[1]!);
  }

  function stateGet(sessionId: string): Response {
    cleanup();
    const session = sessions.get(sessionId);
    if (!session) return Response.json({ error: "not_found" }, { status: 404 });
    session.lastAccessedAt = Date.now();
    return Response.json({ draftState: session.draftState, suggestions: session.suggestions });
  }

  return { post, stateGet, parseStateSessionId };
}
