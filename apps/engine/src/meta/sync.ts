import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { heroes, heroMatchups, heroPatchStats, metaSync } from "../db/schema";
import type { OpenDotaClient } from "./opendota-client";
import { invalidateMetaSnapshotCache } from "./provider";
import { isValidRawHero, isValidRawHeroStatsRow, isValidRawMatchup } from "./validation";
import { mapHero, mapHeroStatsRow, mapMatchup, type HeroMatchupRow, type HeroPatchStatRow, type HeroRow } from "./mappers";

type Db<TSchema extends Record<string, unknown> = Record<string, never>> = BunSQLiteDatabase<TSchema>;
type Clock = () => string;

export interface SyncMetaOptions {
  patch: string;
  heroIdsForMatchups: number[];
  now?: Clock;
}

export interface SyncMetaResult {
  syncId: number;
  status: "ok" | "failed";
  rowsWritten: number;
  error: string | null;
}

// Orquesta la sincronización de las 3 tablas de meta (S6). Cada tabla se escribe en su propia
// transacción — una escritura parcial nunca deja el cache a medias. Si una etapa falla (429
// agotado, red caída, forma inesperada), el cache viejo de las tablas ya sincronizadas antes de
// la falla sigue sirviendo; sólo se pierde lo que faltaba por escribir en esta corrida.
// Separado de syncMeta (aditivo, TSK-010) para que un llamador HTTP pueda insertar la fila y
// obtener el syncId real de inmediato, sin esperar el resto del trabajo (fetch a OpenDota,
// reintentos con backoff) para responder -- syncMeta sigue haciendo exactamente lo mismo que
// antes, solo que ahora en 2 pasos en vez de 1.
export function beginMetaSync<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  now: Clock = () => new Date().toISOString(),
): number {
  const [syncRow] = db
    .insert(metaSync)
    .values({ source: "opendota", startedAt: now(), status: "running", rowsWritten: 0 })
    .returning()
    .all();
  return syncRow!.id;
}

export async function runMetaSync<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  client: OpenDotaClient,
  syncId: number,
  options: SyncMetaOptions,
): Promise<SyncMetaResult> {
  const now: Clock = options.now ?? (() => new Date().toISOString());
  const issues: string[] = [];
  let rowsWritten = 0;

  try {
    rowsWritten += await syncHeroes(db, client, now, issues);
    rowsWritten += await syncPatchStats(db, client, options.patch, now, issues);
    rowsWritten += await syncMatchups(db, client, options.heroIdsForMatchups, now, issues);

    const errorSummary = issues.length > 0 ? issues.join("; ") : null;
    db.update(metaSync)
      .set({ finishedAt: now(), status: "ok", rowsWritten, error: errorSummary })
      .where(eq(metaSync.id, syncId))
      .run();

    return { syncId, status: "ok", rowsWritten, error: errorSummary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.update(metaSync)
      .set({ finishedAt: now(), status: "failed", rowsWritten, error: message })
      .where(eq(metaSync.id, syncId))
      .run();

    return { syncId, status: "failed", rowsWritten, error: message };
  } finally {
    // TSK-059 / Req 2.1: cada tabla (heroes/patchStats/matchups) escribe en su propia
    // transacción -- si la falla ocurrió a mitad de camino, alguna ya pudo haberse commiteado
    // antes de la excepción. Mover a `finally` garantiza estructuralmente que el cache se limpia
    // en TODOS los caminos de salida (ok, failed, y cualquier excepción re-lanzada), haciendo
    // imposible que un nuevo return path lo omita por accidente.
    invalidateMetaSnapshotCache();
  }
}

export async function syncMeta<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  client: OpenDotaClient,
  options: SyncMetaOptions,
): Promise<SyncMetaResult> {
  const syncId = beginMetaSync(db, options.now);
  return runMetaSync(db, client, syncId, options);
}

async function syncHeroes<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  client: OpenDotaClient,
  now: Clock,
  issues: string[],
): Promise<number> {
  const raw = await client.getHeroes();
  if (!Array.isArray(raw)) {
    issues.push("Respuesta de /heroes no es un array — sincronización de heroes omitida");
    return 0;
  }

  const rows: HeroRow[] = [];
  let invalid = 0;
  for (const item of raw) {
    if (isValidRawHero(item)) rows.push(mapHero(item, now()));
    else invalid++;
  }
  if (invalid > 0) issues.push(`${invalid} registro(s) inválido(s) descartados en /heroes`);
  if (rows.length === 0) return 0;

  db.transaction((tx) => {
    tx.delete(heroes).run();
    for (const row of rows) tx.insert(heroes).values(row).run();
  });

  return rows.length;
}

async function syncPatchStats<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  client: OpenDotaClient,
  patch: string,
  now: Clock,
  issues: string[],
): Promise<number> {
  const raw = await client.getHeroStats();
  if (!Array.isArray(raw)) {
    issues.push("Respuesta de /heroStats no es un array — sincronización de patch stats omitida");
    return 0;
  }

  const rows: HeroPatchStatRow[] = [];
  let invalid = 0;
  for (const item of raw) {
    if (isValidRawHeroStatsRow(item)) rows.push(...mapHeroStatsRow(item, patch, now()));
    else invalid++;
  }
  if (invalid > 0) issues.push(`${invalid} registro(s) inválido(s) descartados en /heroStats`);
  if (rows.length === 0) return 0;

  db.transaction((tx) => {
    tx.delete(heroPatchStats).where(eq(heroPatchStats.patch, patch)).run();
    for (const row of rows) tx.insert(heroPatchStats).values(row).run();
  });

  return rows.length;
}

async function syncMatchups<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  client: OpenDotaClient,
  heroIds: number[],
  now: Clock,
  issues: string[],
): Promise<number> {
  let written = 0;

  for (const heroId of heroIds) {
    const raw = await client.getMatchups(heroId);
    if (!Array.isArray(raw)) {
      issues.push(`Respuesta de /heroes/${heroId}/matchups no es un array — omitido`);
      continue;
    }

    const rows: HeroMatchupRow[] = [];
    let invalid = 0;
    for (const item of raw) {
      if (isValidRawMatchup(item)) rows.push(mapMatchup(heroId, item, now()));
      else invalid++;
    }
    if (invalid > 0) issues.push(`${invalid} registro(s) inválido(s) descartados en matchups de héroe ${heroId}`);
    if (rows.length === 0) continue;

    db.transaction((tx) => {
      tx.delete(heroMatchups).where(eq(heroMatchups.heroId, heroId)).run();
      for (const row of rows) tx.insert(heroMatchups).values(row).run();
    });

    written += rows.length;
  }

  return written;
}
