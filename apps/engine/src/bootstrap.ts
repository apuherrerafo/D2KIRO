import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { OpenDotaClient } from "./meta/opendota-client";
import { beginMetaSync, runMetaSync } from "./meta/sync";
import { createGlobalMetaRefresh } from "./meta/global-refresh";
import { getMetaFreshness } from "./meta/provider";
import { createApp } from "./server/app";
import { createTokenRateLimiter } from "./server/edge";
import { CURRENT_PATCH } from "./server/routes/meta";
import { heroes, metaSync } from "./db/schema";

// R1 S7 (final blocker repair, Blocker 1) -- the real process startup, factored out of index.ts so
// it has exactly ONE caller-supplied seam for TEST-ONLY capabilities, instead of index.ts reading
// `process.env` for them directly. `index.ts` (production/Railway/`bun run dev`, see
// apps/engine/package.json's "start"/"dev" scripts and scripts/start-railway.sh) calls
// `runEngine()` with ZERO arguments -- both fields below stay unset for every process that file
// can ever start, unconditionally, with no `process.env` lookup anywhere in index.ts that could
// change that. `index.e2e.ts` (never wired to any production start path) is the only caller that
// supplies either field.
export interface EngineTestOverrides {
  cmEligibilityArtifactPath?: string;
  allowClientForcedBotSelection?: boolean;
}

export function runEngine(testOverrides: EngineTestOverrides = {}): void {
  const PORT = Number(process.env.ENGINE_PORT ?? 4000);

  // El token nunca vive en el repo, ni como literal ni como default de fallback (security.md). Si
  // no se provee por entorno, se genera uno al arrancar y se imprime una sola vez para que el
  // capturador (Overwolf/simulador) lo lea y lo use en esa misma corrida del motor.
  const captureToken = process.env.CAPTURE_TOKEN ?? crypto.randomUUID();
  if (!process.env.CAPTURE_TOKEN) {
    console.log(`[dota2coach] CAPTURE_TOKEN no configurado — generado para esta corrida: ${captureToken}`);
  }

  const openDotaClient = new OpenDotaClient();
  const globalMetaRefresh = createGlobalMetaRefresh({
    getState: async () => {
      const freshness = await getMetaFreshness(db);
      const hasRunningSync = db.select({ id: metaSync.id }).from(metaSync).where(eq(metaSync.status, "running")).limit(1).all().length > 0;
      return { isStale: freshness.isStale, isRunning: hasRunningSync };
    },
    runSync: async () => {
      const heroIdsForMatchups = db.select({ id: heroes.id }).from(heroes).all().map((hero) => hero.id);
      const syncId = beginMetaSync(db);
      await runMetaSync(db, openDotaClient, syncId, { patch: CURRENT_PATCH, heroIdsForMatchups });
    },
  });
  void globalMetaRefresh.start();

  const app = createApp({
    db,
    openDotaClient,
    captureToken,
    internalAuthSecret: process.env.INTERNAL_AUTH_SECRET,
    // Req 7.1/7.2 (.kiro/specs/engine-performance-optimizations): sin esto, createApp() recibe
    // tokenRateLimiter undefined y el límite de 200 eventos/seg por x-capture-token (edge.ts) nunca
    // se evalúa en producción -- el límite de 20/seg por sesión (rateLimiter, incondicional en
    // createApp) sigue intacto y no se ve afectado por este cambio, se suman en AND.
    tokenRateLimiter: createTokenRateLimiter(),
    cmEligibilityArtifactPath: testOverrides.cmEligibilityArtifactPath,
    allowClientForcedBotSelection: testOverrides.allowClientForcedBotSelection,
  });
  const server = app.start("127.0.0.1", PORT);

  console.log(`apps/engine escuchando en http://${server.hostname}:${server.port}`);
}
