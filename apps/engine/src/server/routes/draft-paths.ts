import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { getAllDraftFeedback, insertDraftFeedback } from "../../db/queries";
import { buildDraftPaths } from "../../draft-paths/build-paths";
import { loadHeroCapabilities } from "../../draft-paths/capabilities";
import type { HeroCapabilities } from "../../draft-paths/types";
import { getCachedMetaSnapshot } from "../../meta/provider";
import type { SessionStore } from "../session";

const MAX_FEEDBACK_COMMENT_LENGTH = 4000;

// TSK-058: extraído de apps/engine/src/server/app.ts (hallazgo 2.1 de "Radiografía de
// dota2coach", parte 3/3). Draft-paths y draft-feedback comparten módulo a propósito: ambos son
// endpoints de solo-sesión de bajo tráfico (`/api/session/:id/...`), y separarlos habría sumado
// un cuarto archivo a este ticket, pasándose del límite de 3 archivos/tarea que el proyecto
// exige (`scripts/verify-simplicity.sh`). Mismo comportamiento exacto que antes de extraer,
// verificado con la suite de integración existente de app.test.ts.
export interface DraftPathsRouteDeps<TSchema extends Record<string, unknown>> {
  db: BunSQLiteDatabase<TSchema>;
  sessionStore: SessionStore;
  heroCapabilities?: HeroCapabilities[];
}

function isValidDraftFeedbackBody(value: unknown): value is { comment: string; draftState: unknown; suggestions: unknown } {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  if (typeof body.comment !== "string" || body.comment.length === 0 || body.comment.length > MAX_FEEDBACK_COMMENT_LENGTH) return false;
  if (typeof body.draftState !== "object" || body.draftState === null) return false;
  return body.suggestions === null || typeof body.suggestions === "object";
}

export function createDraftPathsRoutes<TSchema extends Record<string, unknown>>(deps: DraftPathsRouteDeps<TSchema>) {
  function parseSessionId(pathname: string): string | null {
    const match = /^\/api\/session\/([^/]+)\/draft-paths$/.exec(pathname);
    if (!match) return null;
    return decodeURIComponent(match[1]!);
  }

  async function get(sessionId: string): Promise<Response> {
    const state = deps.sessionStore.get(sessionId);
    const meta = await getCachedMetaSnapshot(deps.db);
    const capabilities = deps.heroCapabilities ?? loadHeroCapabilities();
    return Response.json(buildDraftPaths(state, meta, capabilities));
  }

  function parseFeedbackSessionId(pathname: string): string | null {
    const match = /^\/api\/session\/([^/]+)\/feedback$/.exec(pathname);
    if (!match) return null;
    return decodeURIComponent(match[1]!);
  }

  // Inbox append-only (TSK-050/051) -- sin `x-capture-token`, mismo criterio que
  // /api/session/manual: es una escritura local desde apps/web, no del capturador.
  async function feedbackPost(request: Request, sessionId: string): Promise<Response> {
    const body: unknown = await request.json().catch(() => null);
    if (!isValidDraftFeedbackBody(body)) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
    insertDraftFeedback(deps.db, {
      sessionId,
      comment: body.comment,
      draftState: body.draftState,
      suggestions: body.suggestions,
      createdAt: new Date().toISOString(),
    });
    return Response.json({ accepted: true }, { status: 202 });
  }

  async function feedbackGet(): Promise<Response> {
    return Response.json(getAllDraftFeedback(deps.db));
  }

  return { parseSessionId, get, parseFeedbackSessionId, feedbackPost, feedbackGet };
}
