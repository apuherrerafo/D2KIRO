import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { heroes, heroMatchups, heroPatchStats, metaSync, metaSyncRun } from "../db/schema";
import { createMetaRoutes } from "../server/routes/meta";
import { createGlobalMetaRefresh } from "./global-refresh";
import { OpenDotaClient } from "./opendota-client";
import { invalidateMetaSnapshotCache } from "./provider";
import { beginMetaSync, MetaSyncAlreadyRunningError, runMetaSync, syncMeta, tryBeginMetaSync } from "./sync";
import { hasActiveSync, markSyncSettled, PROCESS_INSTANCE_ID, reapAbandonedSyncs, SYNC_HEARTBEAT_STALE_MS } from "./sync-lock";

// P0-05F. SQLite TEMPORAL EN ARCHIVO (no :memory:) con las migraciones reales, para que también quede
// probada la migración 0012. Cero red: fetch inyectado. Cero datos reales: universo sintético de 110
// héroes (> minHeroes de producción), así corren los quality gates REALES, no los permisivos.

const N = 110;
const BASE = "https://api.opendota.com/api";

let dir: string;
let sqlite: Database;
let db: ReturnType<typeof createDb>;

function createDb(raw: Database) {
  return drizzle(raw, { schema });
}

beforeEach(() => {
  released = false;
  dir = mkdtempSync(join(tmpdir(), "d2k-sync-"));
  sqlite = new Database(join(dir, "meta.sqlite"), { create: true });
  db = createDb(sqlite);
  migrate(db, { migrationsFolder: join(import.meta.dir, "../db/migrations") });
});

// Pedidos "colgados" (simulan un proceso que muere a mitad de ingesta). Al terminar la prueba se sueltan y se
// espera a que la corrida pendiente termine contra la base AÚN abierta; si no, el timeout del cliente la haría
// escribir sobre una base cerrada, fuera de la prueba que la creó.
let released = false;
const hangReleasers: Array<() => void> = [];
const pendingRuns: Array<Promise<unknown>> = [];

async function settlePendingSyncs(): Promise<void> {
  released = true; // los reintentos del cliente también fallan: el "proceso" ya no existe
  for (const release of hangReleasers.splice(0)) release();
  await Promise.allSettled(pendingRuns.splice(0));
  for (let i = 0; i < 100; i++) {
    const pending = sqlite.query("SELECT 1 FROM meta_sync WHERE status = 'running' LIMIT 1").get();
    if (!pending) break;
    await Bun.sleep(50);
  }
  await Bun.sleep(100);
}

afterEach(async () => {
  await settlePendingSyncs();
  invalidateMetaSnapshotCache();
  sqlite.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch {
    // Windows puede retener el handle un instante; es un directorio temporal del SO, no un fallo de la prueba.
  }
}, 30_000);

interface Universe {
  size: number;
  picksBase: number;
  hang?: { heroId: number };
  matchupsFor?: (heroId: number) => Response | Promise<Response>;
  heroesOverride?: unknown;
}

function heroList(size: number) {
  return Array.from({ length: size }, (_, i) => ({
    id: i + 1,
    name: `npc_dota_hero_h${i + 1}`,
    localized_name: `Hero ${i + 1}`,
    primary_attr: "agi",
    attack_type: "Melee",
    roles: ["Carry"],
  }));
}

function statsList(size: number, picksBase: number) {
  return Array.from({ length: size }, (_, i) => {
    const row: Record<string, number> = { id: i + 1 };
    for (let tier = 1; tier <= 8; tier++) {
      row[`${tier}_pick`] = picksBase + i + tier;
      row[`${tier}_win`] = Math.floor((picksBase + i + tier) / 2);
    }
    return row;
  });
}

function matchupList(size: number, heroId: number, picksBase: number) {
  return Array.from({ length: size }, (_, i) => i + 1)
    .filter((id) => id !== heroId)
    .map((id) => ({ hero_id: id, games_played: picksBase + id, wins: Math.floor((picksBase + id) / 2) }));
}

function clientFor(universe: Universe): OpenDotaClient {
  const fetchImpl = (async (url: string) => {
    const path = url.replace(BASE, "");
    if (path === "/heroes") return new Response(JSON.stringify(universe.heroesOverride ?? heroList(universe.size)), { status: 200 });
    if (path === "/heroStats") return new Response(JSON.stringify(statsList(universe.size, universe.picksBase)), { status: 200 });
    const match = /^\/heroes\/(\d+)\/matchups$/.exec(path);
    if (match) {
      const heroId = Number(match[1]);
      if (universe.hang?.heroId === heroId && released) throw new Error("proceso terminado");
      if (universe.hang?.heroId === heroId) {
        // el proceso "muere" aquí: no responde hasta que la prueba termina
        return new Promise<Response>((_resolve, reject) => {
          // Al terminar la prueba el "proceso" cae: la corrida pendiente falla rápido contra la base aún abierta.
          hangReleasers.push(() => reject(new Error("proceso terminado")));
        });
      }
      if (universe.matchupsFor) return universe.matchupsFor(heroId);
      return new Response(JSON.stringify(matchupList(universe.size, heroId, universe.picksBase)), { status: 200 });
    }
    return new Response("Not Found", { status: 404 });
  }) as unknown as typeof fetch;
  return new OpenDotaClient({ fetchImpl, sleepImpl: async () => {} });
}

function snapshotOfTables(): string {
  return JSON.stringify({
    heroes: db.select().from(heroes).orderBy(heroes.id).all(),
    stats: db.select().from(heroPatchStats).orderBy(heroPatchStats.heroId, heroPatchStats.bracket).all(),
    matchups: db.select().from(heroMatchups).orderBy(heroMatchups.heroId, heroMatchups.vsHeroId).all(),
  });
}

const OPTS = { patch: "7.41e", matchupDelayMs: 0 } as const;

async function publishBaseline(): Promise<string> {
  const result = await syncMeta(db, clientFor({ size: N, picksBase: 1000 }), OPTS);
  expect(result.status).toBe("ok");
  return snapshotOfTables();
}

test("migración 0012: crea meta_sync_run y una corrida ok la llena", async () => {
  await publishBaseline();
  const [run] = db.select().from(metaSyncRun).all();
  expect(run?.ownerId).toBe(PROCESS_INSTANCE_ID);
  expect(JSON.parse(run!.qualityReport!).passed).toBe(true);
  expect(db.select().from(heroMatchups).all()).toHaveLength(N * (N - 1));
});

test("interrupción al 93%: lo publicado no cambia, la fila queda running, el reinicio la cierra y se recupera", async () => {
  const before = await publishBaseline();

  const hangAt = Math.floor(N * 0.93);
  const syncId = beginMetaSync(db, undefined, { patch: "7.41e" });
  pendingRuns.push(runMetaSync(db, clientFor({ size: N, picksBase: 5000, hang: { heroId: hangAt } }), syncId, OPTS));
  await Bun.sleep(150); // deja correr hasta el pedido colgado

  // El proceso "murió" a mitad de la ingesta: NINGUNA tabla de meta se tocó (antes quedaba una mezcla 119/8).
  expect(snapshotOfTables()).toBe(before);
  expect(db.select().from(metaSync).where(eq(metaSync.id, syncId)).get()?.status).toBe("running");

  // Mismo proceso, latido fresco: el sync ESTÁ vivo -> no se toca.
  expect(reapAbandonedSyncs(db)).toBe(0);
  expect(hasActiveSync(db)).toBe(true);

  // Reinicio: otro proceso (otro ownerId) y el latido del muerto ya venció -> huérfano.
  const later = () => new Date(Date.now() + SYNC_HEARTBEAT_STALE_MS + 60_000).toISOString();
  markSyncSettled(syncId);
  expect(reapAbandonedSyncs(db, { ownerId: "proceso-nuevo", now: later })).toBe(1);
  const closed = db.select().from(metaSync).where(eq(metaSync.id, syncId)).get();
  expect(closed?.status).toBe("failed");
  expect(closed?.error).toContain("abandoned");

  // El refresco automático YA NO está bloqueado por el zombie...
  let ran = 0;
  const refresh = createGlobalMetaRefresh({
    getState: async () => ({ isStale: true, isRunning: hasActiveSync(db) }),
    runSync: async () => {
      ran++;
      const id = beginMetaSync(db, undefined, { patch: "7.41e" });
      await runMetaSync(db, clientFor({ size: N, picksBase: 5000 }), id, OPTS);
    },
  });
  expect(await refresh.refreshIfNeeded()).toBe(true);
  expect(ran).toBe(1);
  // ...y la recuperación publicó el snapshot COMPLETO nuevo.
  expect(snapshotOfTables()).not.toBe(before);
  expect(db.select().from(heroMatchups).all()).toHaveLength(N * (N - 1));
  expect(db.select().from(heroPatchStats).where(eq(heroPatchStats.heroId, 1)).all().find((r) => r.bracket === "herald")?.picks).toBe(5001);
});

test("el bloqueo de antes: una fila running legada (sin latido) ya no frena el refresco", async () => {
  db.insert(metaSync).values({ source: "opendota", startedAt: "2026-09-19T20:45:06.790Z", status: "running", rowsWritten: 0 }).run();
  expect(hasActiveSync(db)).toBe(false);
  expect(db.select().from(metaSync).get()?.status).toBe("failed");
});

test("un sync de OTRO proceso con latido fresco se respeta (activo != abandonado)", async () => {
  const syncId = beginMetaSync(db, undefined, { patch: "7.41e", ownerId: "otro-proceso" });
  expect(reapAbandonedSyncs(db)).toBe(0);
  expect(db.select().from(metaSync).where(eq(metaSync.id, syncId)).get()?.status).toBe("running");
  const stale = () => new Date(Date.now() + SYNC_HEARTBEAT_STALE_MS + 1000).toISOString();
  expect(reapAbandonedSyncs(db, { now: stale })).toBe(1);
});

test("429 agotado: falla, no se publica nada, y el siguiente intento sano recupera", async () => {
  const before = await publishBaseline();

  const result = await syncMeta(
    db,
    clientFor({ size: N, picksBase: 5000, matchupsFor: () => new Response("{}", { status: 429 }) }),
    OPTS,
  );

  expect(result.status).toBe("failed");
  expect(result.error).toContain("429");
  expect(snapshotOfTables()).toBe(before);

  const recovered = await syncMeta(db, clientFor({ size: N, picksBase: 5000 }), OPTS);
  expect(recovered.status).toBe("ok");
  expect(snapshotOfTables()).not.toBe(before);
});

test("quality gate de cobertura: matchups de sólo la mitad de los héroes -> failed y snapshot intacto", async () => {
  const before = await publishBaseline();

  const result = await syncMeta(
    db,
    clientFor({
      size: N,
      picksBase: 5000,
      matchupsFor: (heroId) => new Response(JSON.stringify(heroId % 2 === 0 ? matchupList(N, heroId, 5000) : []), { status: 200 }),
    }),
    OPTS,
  );

  expect(result.status).toBe("failed");
  expect(result.error).toContain("quality_gate");
  expect(result.error).toContain("matchups");
  expect(snapshotOfTables()).toBe(before);
  const [, lastRun] = db.select().from(metaSyncRun).orderBy(metaSyncRun.syncId).all();
  expect(JSON.parse(lastRun!.qualityReport!).passed).toBe(false);
});

test("quality gate de fuente: una respuesta de matchups que no es array NO se registra como ok", async () => {
  const before = await publishBaseline();
  const result = await syncMeta(
    db,
    clientFor({
      size: N,
      picksBase: 5000,
      matchupsFor: (heroId) =>
        new Response(JSON.stringify(heroId === 7 ? { error: "rate" } : matchupList(N, heroId, 5000)), { status: 200 }),
    }),
    OPTS,
  );
  expect(result.status).toBe("failed");
  expect(result.error).toContain("fuente");
  expect(snapshotOfTables()).toBe(before);
});

test("quality gate de conteos: cobertura completa pero muchas menos filas que lo publicado se rechaza", async () => {
  const before = await publishBaseline();
  const result = await syncMeta(
    db,
    clientFor({
      size: N,
      picksBase: 5000,
      matchupsFor: (heroId) => new Response(JSON.stringify(matchupList(N, heroId, 5000).slice(0, 5)), { status: 200 }),
    }),
    OPTS,
  );
  expect(result.status).toBe("failed");
  expect(result.error).toContain("publicadas");
  expect(snapshotOfTables()).toBe(before);
});

test("rollback: si la publicación revienta a mitad de la transacción, queda el snapshot anterior completo", async () => {
  const before = await publishBaseline();
  // Un id de héroe repetido pasa por staging (gates permisivos) y revienta con PK duplicada AL INSERTAR,
  // cuando heroes ya fue borrado dentro de la transacción: sólo un rollback real deja la tabla intacta.
  const dup = heroList(N);
  dup.push({ ...dup[0]! });
  const result = await syncMeta(db, clientFor({ size: N, picksBase: 5000, heroesOverride: dup }), {
    ...OPTS,
    qualityGates: {
      minHeroes: 0, maxInvalidRatio: 1, minPatchStatsCoverage: 0, minMatchupCoverage: 0, maxOrphanMatchupRatio: 1,
      maxSourceErrors: Infinity, maxDuplicates: Infinity, minHeroesVsPrevious: 0, minMatchupRowsVsPrevious: 0,
    },
  });
  expect(result.status).toBe("failed");
  expect(snapshotOfTables()).toBe(before);
});

test("duplicados: un id de héroe repetido falla el gate por defecto", async () => {
  const before = await publishBaseline();
  const dup = heroList(N);
  dup.push({ ...dup[0]! });
  const result = await syncMeta(db, clientFor({ size: N, picksBase: 5000, heroesOverride: dup }), OPTS);
  expect(result.status).toBe("failed");
  expect(result.error).toContain("duplicado");
  expect(snapshotOfTables()).toBe(before);
});

test("procedencia: el rótulo queda NO verificado y separado de la fecha de sync", async () => {
  await publishBaseline();
  const [run] = db.select().from(metaSyncRun).all();
  expect(run?.patchLabel).toBe("7.41e");
  expect(run?.patchVerified).toBe(0);
  expect(run?.patchBasis).toContain("OpenDota no reporta parche");

  const body = await createMetaRoutes({ db, openDotaClient: clientFor({ size: N, picksBase: 1 }) }).status().then((r) => r.json());
  expect(body.syncedAt).toBeTruthy();
  expect(body.patchProvenance).toEqual({ label: "7.41e", verified: false, basis: run!.patchBasis });
});

test("procedencia: datos de OpenDota sin evidencia NUNCA se rotulan como el parche objetivo (7.41f)", async () => {
  const before = snapshotOfTables();
  const result = await syncMeta(db, clientFor({ size: N, picksBase: 1000 }), { ...OPTS, patch: "7.41f" });
  expect(result.status).toBe("failed");
  expect(result.error).toContain("patch_provenance");
  expect(snapshotOfTables()).toBe(before);
  expect(db.select().from(heroPatchStats).all()).toHaveLength(0);
});

test("procedencia: con evidencia explícita sí se admite el rótulo, y queda registrada", async () => {
  const result = await syncMeta(db, clientFor({ size: N, picksBase: 1000 }), {
    ...OPTS,
    patch: "7.41f",
    patchProvenance: { verified: true, basis: "export con ventana de fechas del parche 7.41f, verificado por el operador" },
  });
  expect(result.status).toBe("ok");
  const [run] = db.select().from(metaSyncRun).all();
  expect(run?.patchVerified).toBe(1);
});

test("status sin procedencia registrada (base anterior a 0012) declara no verificado, no asume", async () => {
  const body = await createMetaRoutes({ db, openDotaClient: clientFor({ size: N, picksBase: 1 }) }).status().then((r) => r.json());
  expect(body.patchProvenance.verified).toBe(false);
  expect(body.patchProvenance.label).toBeNull();
});

// ---- P0-05F cierre: concurrencia ---------------------------------------------------------------------

function countingClient(universe: Universe, counter: { heroesCalls: number }): OpenDotaClient {
  const inner = clientFor(universe);
  const original = inner.getHeroes.bind(inner);
  inner.getHeroes = (async () => {
    counter.heroesCalls++;
    return original();
  }) as typeof inner.getHeroes;
  return inner;
}

test("lock atómico: la segunda adquisición devuelve null y la base rechaza una segunda fila running", async () => {
  const first = tryBeginMetaSync(db, undefined, { patch: "7.41e" });
  expect(first).not.toBeNull();
  expect(tryBeginMetaSync(db, undefined, { patch: "7.41e" })).toBeNull();
  expect(() => beginMetaSync(db, undefined, { patch: "7.41e" })).toThrow(MetaSyncAlreadyRunningError);
  expect(db.select().from(metaSync).where(eq(metaSync.status, "running")).all()).toHaveLength(1);
  // Garantía a nivel de datos, sin pasar por nuestro código:
  expect(() =>
    sqlite.exec("INSERT INTO meta_sync (source, started_at, status, rows_written) VALUES ('x', 'y', 'running', 0)"),
  ).toThrow(/UNIQUE/);
  // La prueba nunca ejecuta esa ingesta: se libera el lock a mano para que nada quede "running".
  markSyncSettled(first!);
  db.update(metaSync).set({ status: "failed", finishedAt: "x" }).where(eq(metaSync.id, first!)).run();
});

test("refresco automático + endpoint manual a la vez: una sola ingesta, la duplicada recibe 409", async () => {
  const counter = { heroesCalls: 0 };
  const routes = createMetaRoutes({
    db,
    openDotaClient: countingClient({ size: N, picksBase: 1, hang: { heroId: 1 } }, counter),
    metaSyncPolicy: { enabled: true, reason: "test" },
  });
  const jsonRequest = () => new Request("http://x/api/meta/sync", { method: "POST", body: "{}" });

  const first = await routes.sync(jsonRequest());
  expect(first.status).toBe(202);
  await Bun.sleep(100); // la ingesta 1 queda colgada en su primer pedido de matchups (héroe 1; el pacing real de 1,6 s impide llegar más lejos), con su fila running viva

  // 2º clic manual
  const second = await routes.sync(jsonRequest());
  expect(second.status).toBe(409);
  expect((await second.json()).error).toBe("sync_in_progress");

  // Refresco automático: getState pudo leer "no corriendo" antes de que el manual tomara el lock; runSync igual no arranca otra.
  let autoStarted = false;
  const refresh = createGlobalMetaRefresh({
    getState: async () => ({ isStale: true, isRunning: false }),
    runSync: async () => {
      const id = tryBeginMetaSync(db, undefined, { patch: "7.41e" });
      if (id === null) return;
      autoStarted = true;
      await runMetaSync(db, countingClient({ size: N, picksBase: 1 }, counter), id, OPTS);
    },
  });
  await refresh.refreshIfNeeded();

  expect(autoStarted).toBe(false);
  expect(counter.heroesCalls).toBe(1); // UNA sola ingesta tocó la fuente
  expect(db.select().from(metaSync).all()).toHaveLength(1);
});

test("endpoint manual sin autorización: 403, no crea fila y no toca la fuente", async () => {
  const counter = { heroesCalls: 0 };
  const routes = createMetaRoutes({
    db,
    openDotaClient: countingClient({ size: N, picksBase: 1 }, counter),
    metaSyncPolicy: { enabled: false, reason: "sin autorización" },
  });
  const response = await routes.sync(new Request("http://x/api/meta/sync", { method: "POST", body: "{}" }));
  expect(response.status).toBe(403);
  expect((await response.json()).error).toBe("meta_sync_disabled");
  await Bun.sleep(50);
  expect(counter.heroesCalls).toBe(0);
  expect(db.select().from(metaSync).all()).toHaveLength(0);
});

// ---- P0-05F cierre: consistencia snapshot <-> meta_sync.ok -------------------------------------------

test("caída durante la publicación: si no se puede registrar el ok, el snapshot se revierte entero y no queda ok", async () => {
  const before = await publishBaseline();
  // Simula la caída DESPUÉS de insertar héroes/stats/matchups y justo al registrar el `ok`.
  sqlite.exec(`CREATE TRIGGER fail_ok BEFORE UPDATE ON meta_sync WHEN NEW.status = 'ok'
    BEGIN SELECT RAISE(ABORT, 'caída simulada al registrar ok'); END;`);

  const result = await syncMeta(db, clientFor({ size: N, picksBase: 5000 }), OPTS);

  expect(result.status).toBe("failed");
  expect(result.error).toContain("caída simulada");
  expect(snapshotOfTables()).toBe(before); // héroes, stats y matchups: el snapshot anterior, completo
  const rows = db.select().from(metaSync).orderBy(metaSync.id).all();
  expect(rows.map((r) => r.status)).toEqual(["ok", "failed"]); // ningún ok sin sus datos
  expect(db.select().from(metaSync).where(eq(metaSync.status, "running")).all()).toHaveLength(0);
});

test("publicación y ok van juntos: cuando termina ok, quality_report y procedencia ya están escritos", async () => {
  await publishBaseline();
  const [row] = db.select().from(metaSync).all();
  const [run] = db.select().from(metaSyncRun).all();
  expect(row?.status).toBe("ok");
  expect(row?.rowsWritten).toBe(N + N * 8 + N * (N - 1));
  expect(JSON.parse(run!.qualityReport!).passed).toBe(true);
  expect(run?.patchVerified).toBe(0);
});
