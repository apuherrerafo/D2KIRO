import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { metaSync, metaSyncRun } from "../db/schema";

// P0-05F -- distinguir un sync ACTIVO de uno ABANDONADO.
//
// Antes, "hay una fila `running`" bastaba para que el refresco automático se negara a correr. Si el
// proceso moría a mitad de sync (corte, redeploy, SIGTERM) la fila quedaba `running` para siempre y
// el motor no volvía a refrescar nunca (P0-05E, sync #3 truncado al 93%).
//
// Regla: una fila `running` está VIVA sólo si
//   (a) su dueño es este proceso Y este proceso realmente la tiene en vuelo, o
//   (b) su dueño es OTRO proceso pero su latido (heartbeat_at) es reciente.
// Cualquier otra cosa (dueño propio que ya no la ejecuta, latido viejo, fila legada sin latido) es
// huérfana y se cierra como `failed`. El reloj y el id del proceso se inyectan (mismo principio que S4/S13).

type Db<TSchema extends Record<string, unknown> = Record<string, never>> = BunSQLiteDatabase<TSchema>;
type Clock = () => string;

/** Identidad de este proceso. Distinta en cada arranque: un reinicio hace huérfano lo que dejó el proceso anterior. */
export const PROCESS_INSTANCE_ID: string = crypto.randomUUID();

// Peor caso real de UN pedido: 3 reintentos con esperas de hasta 120 s (opendota-client). El latido se
// toca antes y después de cada pedido, así que 10 min cubre ese peor caso con margen.
export const SYNC_HEARTBEAT_STALE_MS = 10 * 60 * 1000;

const inFlight = new Set<number>();

export function markSyncInFlight(syncId: number): void {
  inFlight.add(syncId);
}

export function markSyncSettled(syncId: number): void {
  inFlight.delete(syncId);
}

export interface RunningSyncView {
  syncId: number;
  ownerId: string | null;
  heartbeatAt: string | null;
}

export function isRunningSyncAlive(
  row: RunningSyncView,
  ctx: { ownerId: string; nowMs: number; staleAfterMs: number; isInFlight: (syncId: number) => boolean },
): boolean {
  if (row.ownerId === null || row.heartbeatAt === null) return false; // fila legada: nada prueba que viva
  if (row.ownerId === ctx.ownerId) return ctx.isInFlight(row.syncId);
  const heartbeatMs = Date.parse(row.heartbeatAt);
  if (!Number.isFinite(heartbeatMs)) return false;
  return ctx.nowMs - heartbeatMs <= ctx.staleAfterMs;
}

export interface SyncLockOptions {
  ownerId?: string;
  now?: Clock;
  staleAfterMs?: number;
}

function listRunning<TSchema extends Record<string, unknown>>(db: Db<TSchema>): RunningSyncView[] {
  const rows = db.select({ id: metaSync.id }).from(metaSync).where(eq(metaSync.status, "running")).all();
  return rows.map((row) => {
    const [run] = db.select().from(metaSyncRun).where(eq(metaSyncRun.syncId, row.id)).limit(1).all();
    return { syncId: row.id, ownerId: run?.ownerId ?? null, heartbeatAt: run?.heartbeatAt ?? null };
  });
}

/** Cierra como `failed` toda fila `running` huérfana. Devuelve cuántas cerró. Idempotente. */
export function reapAbandonedSyncs<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  options: SyncLockOptions = {},
): number {
  const now = options.now ?? (() => new Date().toISOString());
  const ctx = {
    ownerId: options.ownerId ?? PROCESS_INSTANCE_ID,
    nowMs: Date.parse(now()),
    staleAfterMs: options.staleAfterMs ?? SYNC_HEARTBEAT_STALE_MS,
    isInFlight: (syncId: number) => inFlight.has(syncId),
  };
  let reaped = 0;
  for (const row of listRunning(db)) {
    if (isRunningSyncAlive(row, ctx)) continue;
    db.update(metaSync)
      .set({
        finishedAt: now(),
        status: "failed",
        error: "abandoned: el proceso que lo inició ya no lo ejecuta (cerrado por recuperación)",
      })
      .where(eq(metaSync.id, row.syncId))
      .run();
    reaped++;
  }
  return reaped;
}

/** ¿Hay un sync realmente vivo? Cierra antes los huérfanos: `false` significa "se puede arrancar otro". */
export function hasActiveSync<TSchema extends Record<string, unknown>>(db: Db<TSchema>, options: SyncLockOptions = {}): boolean {
  reapAbandonedSyncs(db, options);
  return db.select({ id: metaSync.id }).from(metaSync).where(eq(metaSync.status, "running")).limit(1).all().length > 0;
}

export function touchSyncHeartbeat<TSchema extends Record<string, unknown>>(db: Db<TSchema>, syncId: number, now: Clock): void {
  db.update(metaSyncRun).set({ heartbeatAt: now() }).where(eq(metaSyncRun.syncId, syncId)).run();
}
