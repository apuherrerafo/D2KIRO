import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { heroes, heroMatchups, heroPatchStats, metaSync } from "../db/schema";
import type { OpenDotaClient } from "./opendota-client";
import { invalidateMetaSnapshotCache } from "./provider";
import { isValidRawHero, isValidRawHeroStatsRow, isValidRawMatchup } from "./validation";
import { mapHero, mapHeroStatsRow, mapMatchup, type HeroMatchupRow, type HeroPatchStatRow, type HeroRow } from "./mappers";

type Db<TSchema extends Record<string, unknown> = Record<string, never>> = BunSQLiteDatabase<TSchema>;
type Clock = () => string;
type Sleep = (ms: number) => Promise<void>;

// OpenDota sin API key limita a ~60 req/min. `syncMatchups` pide /heroes/{id}/matchups por cada
// héroe (~130) en serie -- sin pausa, agota el presupuesto a mitad de camino y devuelve 429
// (error real en prod 2026-08-30: "OpenDota respondió 429 en /heroes/72/matchups"). 1600 ms entre
// pedidos deja ~37.5/min, un margen de 37.5% bajo el límite; corre en segundo plano.
const MATCHUP_DELAY_MS = 1600;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface SyncMetaOptions {
  patch: string;
  // AP Solo Mid data/signal repair (Dota Judge root cause 3, matchup ingestion): opcional desde
  // este repair -- ver la nota junto a su uso en `runMetaSync` para por qué el llamador ya NO debe
  // pre-calcularlo consultando `heroes` ANTES de que esta función corra. Sigue aceptando un array
  // explícito (los tests lo usan como DI real para controlar exactamente qué IDs se piden, sin
  // depender del fixture de `/heroes`).
  heroIdsForMatchups?: number[];
  now?: Clock;
  // Pausa entre cada pedido de matchups (default MATCHUP_DELAY_MS). Los tests lo bajan a 0.
  matchupDelayMs?: number;
  matchupSleepImpl?: Sleep;
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
    // AP Solo Mid data/signal repair (Dota Judge root cause 3 -- matchup ingestion, confirmed:
    // `hero_matchups` había quedado en 0 filas pese a que `meta_sync` corrió `status=ok`). Los dos
    // llamadores reales (bootstrap.ts, routes/meta.ts) calculaban `heroIdsForMatchups` consultando
    // la tabla `heroes` ANTES de invocar este sync -- en la primera sincronización de una base
    // vacía eso da `[]`, así que `syncMatchups` nunca iteraba ningún héroe, incluso mientras
    // `syncHeroes` (arriba, dentro de esta misma llamada) recién estaba poblando esa tabla. Un
    // chequeo directo contra `meta_sync`/`hero_matchups` confirmó exactamente un sync histórico,
    // 0 filas de matchups, terminado en 671ms -- imposible para 127 héroes a 1600ms cada uno,
    // consistente con el loop de `syncMatchups` recibiendo un array vacío. Derivar la lista AQUÍ,
    // después de `syncHeroes`, la toma de la tabla ya poblada por esta misma corrida (o por una
    // anterior) en vez de un snapshot tomado antes de que hubiera algo que sincronizar. El campo
    // sigue aceptando un array explícito -- lo usan los tests para DI real (sync.test.ts).
    const heroIdsForMatchups =
      options.heroIdsForMatchups ?? db.select({ id: heroes.id }).from(heroes).all().map((row) => row.id);
    rowsWritten += await syncMatchups(
      db,
      client,
      heroIdsForMatchups,
      now,
      issues,
      options.matchupDelayMs ?? MATCHUP_DELAY_MS,
      options.matchupSleepImpl ?? sleep,
    );

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
  delayMs: number,
  sleepImpl: Sleep,
): Promise<number> {
  let written = 0;

  for (let i = 0; i < heroIds.length; i++) {
    const heroId = heroIds[i]!;
    if (i > 0 && delayMs > 0) await sleepImpl(delayMs); // ritmo para no gatillar el 429 de OpenDota
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
