import { desc, eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { metaSync, metaSyncRun } from "../../db/schema";
import type { OpenDotaClient } from "../../meta/opendota-client";
import { getCachedMetaSnapshot, getMetaFreshness, getMetaReadiness } from "../../meta/provider";
import { runMetaSync, tryBeginMetaSync, UNVERIFIED_PATCH_BASIS } from "../../meta/sync";
import { resolveMetaSyncPolicy, type MetaSyncPolicy } from "../../meta/sync-policy";
import { loadHeroPositions, type HeroPositions } from "../../signals/hero-positions";

// TSK-068: única fuente de verdad del lado del motor para "qué parche está activo" -- OpenDota no
// expone esta dimensión en /heroStats (patch es un rótulo que el proyecto le asigna a mano al
// sincronizar, nunca un dato que venga en la respuesta). Espejado a mano en
// apps/web/app/draft/live-config.ts (mismo patrón que el espejo de SignalId, web.md) -- los dos
// procesos son independientes a propósito, actualizar el parche real es un cambio en los dos
// lados a la vez.
export const CURRENT_PATCH = "7.41e";

// TSK-058: extraído de apps/engine/src/server/app.ts (hallazgo 2.1 de "Radiografía de
// dota2coach", parte 3/3 -- ver TSK-056 para contexto completo). Mismo comportamiento exacto,
// verificado con la suite de integración existente de app.test.ts.
export interface MetaRouteDeps<TSchema extends Record<string, unknown>> {
  db: BunSQLiteDatabase<TSchema>;
  openDotaClient: OpenDotaClient;
  // TSK-063: mismo patrón que heroCapabilities en AppDeps -- inyectable para que las pruebas usen
  // un fixture propio en vez del hero-positions.json real (costura S10, testing-seams.md: ese
  // archivo se regenera por parche, un test atado a su contenido se rompería en silencio).
  heroPositions?: HeroPositions;
  // P0-05F: autorización para sincronizar con OpenDota (inyectable en pruebas). Default: lee el entorno del proceso.
  metaSyncPolicy?: MetaSyncPolicy;
}

export interface PatchProvenanceView {
  label: string | null;
  verified: boolean;
  basis: string;
}

// Procedencia del último sync `ok`. Bases anteriores a la migración 0012 no tienen la tabla: sin dato,
// se declara "no verificado", nunca se asume.
function lastOkPatchProvenance<TSchema extends Record<string, unknown>>(db: BunSQLiteDatabase<TSchema>): PatchProvenanceView {
  try {
    const [row] = db
      .select({ label: metaSyncRun.patchLabel, verified: metaSyncRun.patchVerified, basis: metaSyncRun.patchBasis })
      .from(metaSyncRun)
      .innerJoin(metaSync, eq(metaSync.id, metaSyncRun.syncId))
      .where(eq(metaSync.status, "ok"))
      .orderBy(desc(metaSync.id))
      .limit(1)
      .all();
    if (row) return { label: row.label, verified: row.verified === 1, basis: row.basis ?? UNVERIFIED_PATCH_BASIS };
  } catch {
    // tabla ausente en una base sin migrar
  }
  return { label: null, verified: false, basis: "sin procedencia registrada (sync anterior a P0-05F)" };
}

export function createMetaRoutes<TSchema extends Record<string, unknown>>(deps: MetaRouteDeps<TSchema>) {
  async function status(): Promise<Response> {
    const freshness = await getMetaFreshness(deps.db);
    const readiness = await getMetaReadiness(deps.db);
    const [lastAttempt] = deps.db.select().from(metaSync).orderBy(desc(metaSync.id)).limit(1).all();
    return Response.json({
      // P0-05F: la FECHA de sync y el PARCHE son ejes distintos. `syncedAt` dice cuándo se bajó el dato;
      // `patchProvenance` dice qué rótulo de parche lleva y si alguien lo verificó (OpenDota no lo reporta).
      patchProvenance: lastOkPatchProvenance(deps.db),
      syncedAt: freshness.syncedAt,
      lastUpdatedAt: freshness.syncedAt,
      isStale: freshness.isStale,
      lastSync: lastAttempt ? { status: lastAttempt.status, finishedAt: lastAttempt.finishedAt, error: lastAttempt.error } : null,
      readiness,
    });
  }

  // Solo lectura, mismo dato que ya usa buildSuggestions internamente -- no toca el camino
  // caliente (nadie llama a esto durante un draft en curso) ni el reductor. Existe para que
  // apps/web pueda mostrar pick rate real fuera del motor (random-draft-simulator, Bot_Drafter y
  // Meta_Ban_Pool) sin duplicar la agregación de hero_patch_stats en el frontend.
  //
  // TSK-063: heroPositions se sumó a esta misma respuesta (en vez de un endpoint nuevo) para que
  // el bot del simulador pueda razonar sobre posición real en vez de roles[] mal etiquetados --
  // mismo dato curado que ya usa position_fit (hero-positions.json), sin abrir superficie HTTP
  // nueva. Sigue sin auth, sigue sin tocar SQLite, mismo criterio de seguridad ya documentado.
  async function heroStats(): Promise<Response> {
    const meta = await getCachedMetaSnapshot(deps.db, null);
    const heroPositions = deps.heroPositions ?? loadHeroPositions();
    // currentPatch (aditivo): el simulador web agrega dentro del MISMO parche que el motor (ver meta/patch-scope.ts).
    return Response.json({ patchStats: meta.patchStats, heroPositions, currentPatch: CURRENT_PATCH });
  }

  // Asíncrono, no bloquea: crea la fila de meta_sync (rápido) y responde de inmediato con el
  // syncId real; el trabajo lento (fetch a OpenDota + reintentos) sigue en segundo plano.
  //
  // TSK-068 (auditoría de inteligencia del motor, fase 1): sin CURRENT_PATCH, un sync sin `patch`
  // explícito en el body (el único camino real -- apps/web nunca manda uno, ver engine-api.ts)
  // guardaba hero_patch_stats.patch = "" -- un rótulo que ninguna sesión de draft podía volver a
  // matchear contra su propio state.patch ("7.41e", bootstrap-session.ts), dejando patch_meta en
  // raw: null siempre, sin importar cuántas veces se sincronizara. Un `patch` vacío explícito en
  // el body cuenta igual que ausente -- ninguno de los dos es "el usuario eligió un parche real".
  async function sync(request: Request): Promise<Response> {
    const policy = deps.metaSyncPolicy ?? resolveMetaSyncPolicy();
    if (!policy.enabled) {
      return Response.json({ error: "meta_sync_disabled", reason: policy.reason }, { status: 403 });
    }
    const body = (await request.json().catch(() => ({}))) as { patch?: string };
    const patch = typeof body.patch === "string" && body.patch.length > 0 ? body.patch : CURRENT_PATCH;

    // AP Solo Mid data/signal repair: `heroIdsForMatchups` ya NO se pre-calcula acá -- un
    // snapshot de `heroes` tomado ANTES de que `runMetaSync` corra `syncHeroes` da `[]` en la
    // primera sincronización de una base vacía, dejando `hero_matchups` permanentemente vacío
    // (confirmado: `meta_sync` con `status=ok` y `hero_matchups` en 0 filas). Se omite el campo
    // para que `runMetaSync` lo derive él mismo, después de sincronizar héroes.
    // Adquisición atómica (cierra huérfanos y toma el lock en una sola operación): una solicitud duplicada
    // NO arranca otra ingesta.
    const syncId = tryBeginMetaSync(deps.db, undefined, { patch });
    if (syncId === null) return Response.json({ error: "sync_in_progress" }, { status: 409 });
    void runMetaSync(deps.db, deps.openDotaClient, syncId, { patch });

    return Response.json({ syncId }, { status: 202 });
  }

  return { status, heroStats, sync };
}
