import { desc } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "../../db/schema";
import { metaSync } from "../../db/schema";
import type { OpenDotaClient } from "../../meta/opendota-client";
import { getCachedMetaSnapshot, getMetaFreshness } from "../../meta/provider";
import { beginMetaSync, runMetaSync } from "../../meta/sync";
import { loadHeroPositions, type HeroPositions } from "../../signals/hero-positions";

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
}

export function createMetaRoutes<TSchema extends Record<string, unknown>>(deps: MetaRouteDeps<TSchema>) {
  async function status(): Promise<Response> {
    const freshness = await getMetaFreshness(deps.db);
    const [lastAttempt] = deps.db.select().from(metaSync).orderBy(desc(metaSync.id)).limit(1).all();
    return Response.json({
      syncedAt: freshness.syncedAt,
      isStale: freshness.isStale,
      lastSync: lastAttempt ? { status: lastAttempt.status, finishedAt: lastAttempt.finishedAt, error: lastAttempt.error } : null,
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
    const meta = await getCachedMetaSnapshot(deps.db);
    const heroPositions = deps.heroPositions ?? loadHeroPositions();
    return Response.json({ patchStats: meta.patchStats, heroPositions });
  }

  // Asíncrono, no bloquea: crea la fila de meta_sync (rápido) y responde de inmediato con el
  // syncId real; el trabajo lento (fetch a OpenDota + reintentos) sigue en segundo plano.
  async function sync(request: Request): Promise<Response> {
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

  return { status, heroStats, sync };
}
