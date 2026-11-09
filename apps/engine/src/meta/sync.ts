import { eq, sql } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { heroes, heroMatchups, heroPatchStats, metaSync, metaSyncRun } from "../db/schema";
import type { OpenDotaClient } from "./opendota-client";
import { invalidateMetaSnapshotCache } from "./provider";
import { DEFAULT_SYNC_QUALITY_GATES, evaluateSyncQuality, type SyncQualityGates, type SyncQualityReport } from "./quality-gates";
import { DEFAULT_RULESET_TARGET_PATCH } from "./readiness";
import { markSyncInFlight, markSyncSettled, PROCESS_INSTANCE_ID, touchSyncHeartbeat } from "./sync-lock";
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

/**
 * Procedencia del rótulo de parche. OpenDota NO reporta parche en /heroStats ni en /matchups: el rótulo
 * lo estampa el proyecto. Por defecto es NO verificado; `verified: true` exige una `basis` con la evidencia.
 */
export interface PatchProvenance {
  verified: boolean;
  basis: string;
}

export const UNVERIFIED_PATCH_BASIS = "rótulo estampado por el proyecto al sincronizar; OpenDota no reporta parche";

export interface SyncMetaOptions {
  patch: string;
  // Sigue aceptando un array explícito -- lo usan los tests para DI real (controlan exactamente qué IDs
  // se piden, sin depender del fixture de `/heroes`). Si se omite, se deriva de los héroes en staging
  // de ESTA corrida (nunca de un snapshot de la tabla tomado antes: ver AP Solo Mid, causa raíz 3).
  heroIdsForMatchups?: number[];
  now?: Clock;
  // Pausa entre cada pedido de matchups (default MATCHUP_DELAY_MS). Los tests lo bajan a 0.
  matchupDelayMs?: number;
  matchupSleepImpl?: Sleep;
  /** P0-05F: umbrales de calidad (default de producción). Los tests con fixtures diminutos pasan PERMISSIVE_SYNC_GATES. */
  qualityGates?: SyncQualityGates;
  /** P0-05F: procedencia del rótulo `patch`. Default: no verificado. */
  patchProvenance?: PatchProvenance;
}

export interface SyncMetaResult {
  syncId: number;
  status: "ok" | "failed";
  rowsWritten: number;
  error: string | null;
}

export interface BeginMetaSyncOptions {
  ownerId?: string;
  patch?: string;
}

// Orquesta la sincronización de las 3 tablas de meta (S6) en TRES fases:
//   1. Ingesta temporal: todo lo que llega de OpenDota se valida y se junta en memoria (staging). Cero
//      escrituras a las tablas de meta. Si el proceso muere o un pedido falla aquí, lo publicado no se toca.
//   2. Quality gates (quality-gates.ts): cobertura, duplicados, conteos, errores de fuente, regresión
//      contra lo ya publicado. Si falla uno, no se publica nada y la fila queda `failed` con el motivo.
//   3. Publicación atómica: UNA transacción reemplaza heroes + hero_patch_stats + hero_matchups. O queda
//      el snapshot nuevo completo o el anterior completo -- nunca una mezcla (P0-05E: sync #3 truncado).
// Separado de syncMeta (aditivo, TSK-010) para que un llamador HTTP pueda insertar la fila y
// obtener el syncId real de inmediato, sin esperar el resto del trabajo.
export function beginMetaSync<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  now: Clock = () => new Date().toISOString(),
  options: BeginMetaSyncOptions = {},
): number {
  return db.transaction((tx) => {
    const startedAt = now();
    const [syncRow] = tx
      .insert(metaSync)
      .values({ source: "opendota", startedAt, status: "running", rowsWritten: 0 })
      .returning()
      .all();
    tx.insert(metaSyncRun)
      .values({
        syncId: syncRow!.id,
        ownerId: options.ownerId ?? PROCESS_INSTANCE_ID,
        heartbeatAt: startedAt,
        patchLabel: options.patch ?? null,
        patchVerified: 0,
        patchBasis: UNVERIFIED_PATCH_BASIS,
      })
      .run();
    return syncRow!.id;
  });
}

interface StagedMeta {
  heroes: HeroRow[];
  patchStats: HeroPatchStatRow[];
  matchups: HeroMatchupRow[];
}

export async function runMetaSync<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  client: OpenDotaClient,
  syncId: number,
  options: SyncMetaOptions,
): Promise<SyncMetaResult> {
  const now: Clock = options.now ?? (() => new Date().toISOString());
  const provenance: PatchProvenance = options.patchProvenance ?? { verified: false, basis: UNVERIFIED_PATCH_BASIS };
  const warnings: string[] = [];
  let report: SyncQualityReport | null = null;
  markSyncInFlight(syncId);

  try {
    // Procedencia: un rótulo igual al parche objetivo del ruleset NUNCA se estampa sobre datos de
    // OpenDota sin evidencia -- sería decir "estos números son de 7.41f" sin que nadie lo haya verificado.
    if (!provenance.verified && options.patch === DEFAULT_RULESET_TARGET_PATCH) {
      throw new Error(`patch_provenance: no se puede rotular datos de OpenDota como ${options.patch} sin procedencia verificada`);
    }
    if (provenance.verified && provenance.basis.trim().length === 0) {
      throw new Error("patch_provenance: patch verificado exige una basis con la evidencia");
    }

    const staged = await stageIngest(db, client, syncId, options, now, warnings);
    report = staged.report;
    if (!report.passed) throw new Error(`quality_gate: ${report.failures.join("; ")}`);

    const rowsWritten = publishAtomically(db, options.patch, staged.data);

    const errorSummary = warnings.length > 0 ? warnings.join("; ") : null;
    finish(db, syncId, now, { status: "ok", rowsWritten, error: errorSummary }, options.patch, provenance, report);
    return { syncId, status: "ok", rowsWritten, error: errorSummary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finish(db, syncId, now, { status: "failed", rowsWritten: 0, error: message }, options.patch, provenance, report);
    return { syncId, status: "failed", rowsWritten: 0, error: message };
  } finally {
    markSyncSettled(syncId);
    // La publicación es atómica, pero el cache en memoria se limpia en TODOS los caminos de salida
    // (ok, failed, excepción) -- imposible que un nuevo return path lo omita por accidente.
    invalidateMetaSnapshotCache();
  }
}

function finish<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  syncId: number,
  now: Clock,
  outcome: { status: "ok" | "failed"; rowsWritten: number; error: string | null },
  patch: string,
  provenance: PatchProvenance,
  report: SyncQualityReport | null,
): void {
  db.transaction((tx) => {
    tx.update(metaSync)
      .set({ finishedAt: now(), status: outcome.status, rowsWritten: outcome.rowsWritten, error: outcome.error })
      .where(eq(metaSync.id, syncId))
      .run();
    tx.update(metaSyncRun)
      .set({
        patchLabel: patch,
        patchVerified: provenance.verified ? 1 : 0,
        patchBasis: provenance.basis,
        qualityReport: report ? JSON.stringify(report) : null,
      })
      .where(eq(metaSyncRun.syncId, syncId))
      .run();
  });
}

export async function syncMeta<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  client: OpenDotaClient,
  options: SyncMetaOptions,
): Promise<SyncMetaResult> {
  const syncId = beginMetaSync(db, options.now, { patch: options.patch });
  return runMetaSync(db, client, syncId, options);
}

interface StagedIngest {
  data: StagedMeta;
  report: SyncQualityReport;
}

async function stageIngest<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  client: OpenDotaClient,
  syncId: number,
  options: SyncMetaOptions,
  now: Clock,
  warnings: string[],
): Promise<StagedIngest> {
  const gates = options.qualityGates ?? DEFAULT_SYNC_QUALITY_GATES;
  let sourceErrors = 0;
  const beat = (): void => touchSyncHeartbeat(db, syncId, now);

  // --- /heroes ---------------------------------------------------------------------------------
  beat();
  const rawHeroes = await client.getHeroes();
  const heroRows: HeroRow[] = [];
  let heroesReceived = 0;
  let heroesInvalid = 0;
  let heroDuplicates = 0;
  if (Array.isArray(rawHeroes)) {
    const seen = new Set<number>();
    heroesReceived = rawHeroes.length;
    for (const item of rawHeroes) {
      if (!isValidRawHero(item)) {
        heroesInvalid++;
        continue;
      }
      if (seen.has(item.id)) heroDuplicates++;
      seen.add(item.id);
      heroRows.push(mapHero(item, now()));
    }
  } else {
    sourceErrors++;
    warnings.push("Respuesta de /heroes no es un array");
  }
  if (heroesInvalid > 0) warnings.push(`${heroesInvalid} registro(s) inválido(s) descartados en /heroes`);
  const heroIdSet = new Set(heroRows.map((row) => row.id));

  // --- /heroStats ------------------------------------------------------------------------------
  beat();
  const rawStats = await client.getHeroStats();
  const statRows: HeroPatchStatRow[] = [];
  let statsReceived = 0;
  let statsInvalid = 0;
  let statsDuplicates = 0;
  const statHeroes = new Set<number>();
  if (Array.isArray(rawStats)) {
    const seenKeys = new Set<string>();
    statsReceived = rawStats.length;
    for (const item of rawStats) {
      if (!isValidRawHeroStatsRow(item)) {
        statsInvalid++;
        continue;
      }
      for (const row of mapHeroStatsRow(item, options.patch, now())) {
        const key = `${row.heroId}:${row.bracket}`;
        if (seenKeys.has(key)) statsDuplicates++;
        seenKeys.add(key);
        statRows.push(row);
      }
      statHeroes.add(item.id);
    }
  } else {
    sourceErrors++;
    warnings.push("Respuesta de /heroStats no es un array");
  }
  if (statsInvalid > 0) warnings.push(`${statsInvalid} registro(s) inválido(s) descartados en /heroStats`);
  let heroesCoveredInHeroes = 0;
  for (const id of statHeroes) if (heroIdSet.has(id)) heroesCoveredInHeroes++;
  const totalPicks = statRows.reduce((total, row) => total + row.picks, 0);

  // --- /heroes/{id}/matchups (en serie, con pacing) ----------------------------------------------
  const requestedIds = options.heroIdsForMatchups ?? heroRows.map((row) => row.id);
  const delayMs = options.matchupDelayMs ?? MATCHUP_DELAY_MS;
  const sleepImpl = options.matchupSleepImpl ?? sleep;
  const matchupRows: HeroMatchupRow[] = [];
  const seenPairs = new Set<string>();
  let heroesWithRows = 0;
  let matchupsInvalid = 0;
  let matchupsReceived = 0;
  let orphans = 0;
  let pairDuplicates = 0;

  for (let i = 0; i < requestedIds.length; i++) {
    const heroId = requestedIds[i]!;
    if (i > 0 && delayMs > 0) await sleepImpl(delayMs); // ritmo para no gatillar el 429 de OpenDota
    beat();
    const raw = await client.getMatchups(heroId);
    beat();
    if (!Array.isArray(raw)) {
      sourceErrors++;
      warnings.push(`Respuesta de /heroes/${heroId}/matchups no es un array`);
      continue;
    }
    let rowsForHero = 0;
    for (const item of raw) {
      if (!isValidRawMatchup(item)) {
        matchupsInvalid++;
        continue;
      }
      matchupsReceived++;
      const key = `${heroId}:${item.hero_id}`;
      if (seenPairs.has(key)) pairDuplicates++;
      seenPairs.add(key);
      if (!heroIdSet.has(item.hero_id)) orphans++;
      matchupRows.push(mapMatchup(heroId, item, now()));
      rowsForHero++;
    }
    if (rowsForHero > 0) heroesWithRows++;
  }
  if (matchupsInvalid > 0) warnings.push(`${matchupsInvalid} registro(s) inválido(s) descartados en matchups`);
  if (orphans > 0) warnings.push(`${orphans} fila(s) de matchup con rival inexistente descartadas`);

  const previousHeroes = Number(db.select({ count: sql<number>`count(*)` }).from(heroes).get()?.count ?? 0);
  const previousMatchups = Number(db.select({ count: sql<number>`count(*)` }).from(heroMatchups).get()?.count ?? 0);

  const report = evaluateSyncQuality(
    {
      sourceErrors,
      heroes: { received: heroesReceived, valid: heroRows.length, invalid: heroesInvalid, duplicateIds: heroDuplicates },
      patchStats: {
        received: statsReceived,
        invalid: statsInvalid,
        heroesCovered: statHeroes.size,
        heroesCoveredInHeroes,
        duplicateKeys: statsDuplicates,
        totalPicks,
      },
      matchups: {
        heroesRequested: requestedIds.length,
        heroesWithRows,
        invalidRows: matchupsInvalid,
        receivedRows: matchupsReceived,
        orphanRows: orphans,
        duplicatePairs: pairDuplicates,
      },
      previous: { heroes: previousHeroes, matchupRows: previousMatchups },
    },
    gates,
  );

  return {
    data: {
      heroes: heroRows,
      patchStats: statRows,
      // Se publican sólo los matchups cuyo rival existe: la tabla referencia heroes(id).
      matchups: matchupRows.filter((row) => heroIdSet.has(row.vsHeroId)),
    },
    report,
  };
}

// UNA transacción: si cualquier insert revienta, SQLite revierte las tres tablas y queda el snapshot anterior.
function publishAtomically<TSchema extends Record<string, unknown>>(db: Db<TSchema>, patch: string, data: StagedMeta): number {
  db.transaction((tx) => {
    if (data.heroes.length > 0) {
      tx.delete(heroes).run();
      for (const row of data.heroes) tx.insert(heroes).values(row).run();
    }
    if (data.patchStats.length > 0) {
      tx.delete(heroPatchStats).where(eq(heroPatchStats.patch, patch)).run();
      for (const row of data.patchStats) tx.insert(heroPatchStats).values(row).run();
    }
    if (data.matchups.length > 0) {
      tx.delete(heroMatchups).run();
      for (const row of data.matchups) tx.insert(heroMatchups).values(row).run();
    }
  });
  return data.heroes.length + data.patchStats.length + data.matchups.length;
}
