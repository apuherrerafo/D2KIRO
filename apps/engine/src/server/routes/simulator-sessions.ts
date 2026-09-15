import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

// Historical endpoint retained as an explicit compatibility tombstone. Its only script was a
// Captain's Mode sequence driven by simulator/player.ts + the legacy reducer, which made it a
// second protocol authority. R1 CM sessions must use /api/session/protocol and therefore cannot
// be created here. Keeping the 410 response is safer for old callers than silently changing the
// response shape or continuing to certify a legacy CM draft.

export interface SimulatorSessionRouteDeps<TSchema extends Record<string, unknown>> {
  db: BunSQLiteDatabase<TSchema>;
}

export function createSimulatorSessionRoutes<TSchema extends Record<string, unknown>>(
  _deps: SimulatorSessionRouteDeps<TSchema>,
) {
  function post(): Response {
    return Response.json(
      { error: "legacy_cm_simulator_retired", replacement: "/api/session/protocol" },
      { status: 410 },
    );
  }

  function parseStateSessionId(pathname: string): string | null {
    const match = /^\/api\/simulator\/sessions\/([^/]+)\/state$/.exec(pathname);
    return match ? decodeURIComponent(match[1]!) : null;
  }

  function stateGet(_sessionId: string): Response {
    return Response.json(
      { error: "legacy_cm_simulator_retired", replacement: "/api/session/protocol" },
      { status: 410 },
    );
  }

  return { post, stateGet, parseStateSessionId };
}
