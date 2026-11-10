import { db } from "./db/client";
import { OpenDotaClient } from "./meta/opendota-client";
import { runMetaSync, tryBeginMetaSync } from "./meta/sync";
import { resolveMetaSyncPolicy } from "./meta/sync-policy";
import { createGlobalMetaRefresh } from "./meta/global-refresh";
import { getMetaFreshness } from "./meta/provider";
import { createApp } from "./server/app";
import { createTokenRateLimiter } from "./server/edge";
import { CURRENT_PATCH } from "./server/routes/meta";
import { hasActiveSync } from "./meta/sync-lock";

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
  allowTestClockControl?: boolean;
  /**
   * TEST-ONLY: no arrancar la sincronización automática con OpenDota. Este archivo nunca lee una variable de entorno para
   * esto: lo decide el llamador (solo index.e2e.ts, y solo cuando lo lanza el E2E). La base del E2E ya viene sembrada con datos fijos
   * (e2e/bootstrap-db.ts) pero sin una fila `meta_sync` "ok", así que el motor la creía vieja y descargaba el meta EN VIVO
   * a mitad de la corrida: los bans con semilla fija dependían del día (y de cuánto había avanzado la descarga), y la
   * prueba violaba "cero red real en cualquier prueba". Solo index.e2e.ts lo enciende.
   */
  disableGlobalMetaRefresh?: boolean;
}

/**
 * ¿Arranca la sincronización automática con OpenDota? Sólo con autorización explícita (producción de Railway o
 * META_SYNC=on, ver meta/sync-policy.ts) y nunca en el E2E. Un deploy a preview no sincroniza solo. Pura.
 */
export function shouldStartGlobalMetaRefresh(
  testOverrides: EngineTestOverrides,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return testOverrides.disableGlobalMetaRefresh !== true && resolveMetaSyncPolicy(env).enabled;
}

export function runEngine(testOverrides: EngineTestOverrides = {}): void {
  const PORT = Number(process.env.ENGINE_PORT ?? 4000);

  // El token nunca vive en el repo, ni como literal ni como default de fallback (security.md). Si
  // no se provee por entorno, se genera uno al arrancar y se imprime una sola vez para que el
  // capturador (Overwolf/simulador) lo lea y lo use en esa misma corrida del motor.
  const captureToken = process.env.CAPTURE_TOKEN ?? crypto.randomUUID();
  if (!process.env.CAPTURE_TOKEN) {
    // Es un bearer reutilizable para POST /ingest/draft-event: registrarlo expondría permisos de
    // ingesta a cualquiera con acceso a los logs de runtime (incluidos los de Railway).
    console.warn("[dota2coach] CAPTURE_TOKEN no configurado — se generó un token efímero, omitido de logs por seguridad.");
  }

  const openDotaClient = new OpenDotaClient();
  const globalMetaRefresh = createGlobalMetaRefresh({
    getState: async () => {
      const freshness = await getMetaFreshness(db);
      // P0-05F: una fila `running` huérfana (el proceso murió a mitad de sync) ya NO bloquea el refresco:
      // hasActiveSync la cierra como `failed` y sólo cuenta un sync realmente vivo.
      return { isStale: freshness.isStale, isRunning: hasActiveSync(db) };
    },
    runSync: async () => {
      // AP Solo Mid data/signal repair: `heroIdsForMatchups` ya NO se pre-calcula acá -- un
      // snapshot de `heroes` tomado ANTES de que `runMetaSync` corra `syncHeroes` da `[]` en la
      // primera sincronización de una base vacía, dejando `hero_matchups` permanentemente vacío
      // (ver la nota en `runMetaSync`, sync.ts). Se omite el campo para que `runMetaSync` lo
      // derive él mismo, después de sincronizar héroes.
      // Adquisición atómica: si otro sync ya corre (o lo tomó el endpoint manual entre getState y aquí), no se arranca otro.
      const syncId = tryBeginMetaSync(db, undefined, { patch: CURRENT_PATCH });
      if (syncId === null) return;
      await runMetaSync(db, openDotaClient, syncId, { patch: CURRENT_PATCH });
    },
  });
  if (shouldStartGlobalMetaRefresh(testOverrides)) void globalMetaRefresh.start();
  else if (testOverrides.disableGlobalMetaRefresh !== true) {
    console.warn(`[dota2coach] sincronización de meta con OpenDota desactivada: ${resolveMetaSyncPolicy().reason}.`);
  }

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
    allowTestClockControl: testOverrides.allowTestClockControl,
  });
  const server = app.start("127.0.0.1", PORT);

  console.log(`apps/engine escuchando en http://${server.hostname}:${server.port}`);
}
