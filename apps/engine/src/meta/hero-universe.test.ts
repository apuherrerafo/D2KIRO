import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { heroes, heroPatchStats } from "../db/schema";
import { loadHeroUniverse } from "./hero-universe";
import { invalidateMetaSnapshotCache } from "./provider";

// Integración del cableado real de `heroUniverse` (SQLite en memoria + provider + cache reales).
// Cero red, ningún archivo real: todo fixture inline.

function createDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE heroes (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, localized_name TEXT NOT NULL,
      img_url TEXT NOT NULL, primary_attr TEXT NOT NULL, attack_type TEXT NOT NULL,
      roles TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE hero_patch_stats (
      hero_id INTEGER NOT NULL, patch TEXT NOT NULL, bracket TEXT NOT NULL,
      picks INTEGER NOT NULL, wins INTEGER NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (hero_id, patch, bracket)
    );
    CREATE TABLE hero_matchups (
      hero_id INTEGER NOT NULL, vs_hero_id INTEGER NOT NULL, games INTEGER NOT NULL,
      wins INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (hero_id, vs_hero_id)
    );
  `);
  return drizzle(sqlite);
}

type Db = ReturnType<typeof createDb>;
type StatRow = [heroId: number, patch: string, picks: number];

function seed(db: Db, heroIds: number[], stats: StatRow[]): void {
  for (const id of heroIds) {
    db.insert(heroes).values({ id, name: `npc_${id}`, localizedName: `Hero ${id}`, imgUrl: "/x.png", primaryAttr: "str", attackType: "Melee", roles: [], updatedAt: "t" }).run();
  }
  for (const [heroId, patch, picks] of stats) {
    db.insert(heroPatchStats).values({ heroId, patch, bracket: "all", picks, wins: Math.floor(picks / 2), updatedAt: "t" }).run();
  }
}

beforeEach(() => invalidateMetaSnapshotCache());
afterEach(() => invalidateMetaSnapshotCache());

// Referencia del comportamiento ANTERIOR: sumar todas las filas sin mirar el parche.
function legacyOrder(db: Db): number[] {
  const rows = db.select().from(heroPatchStats).all();
  const ids = db.select().from(heroes).all().map((h) => h.id);
  const total = (id: number): number => rows.filter((r) => r.heroId === id).reduce((s, r) => s + r.picks, 0);
  return [...ids].sort((a, b) => total(b) - total(a) || a - b);
}

describe("loadHeroUniverse (cableado real contra SQLite)", () => {
  test("producción: restos con patch vacío + parche vigente -> manda el vigente; antes mandaban los restos", async () => {
    const db = createDb();
    seed(db, [1, 2, 3], [
      [1, "", 9000], [1, "7.41e", 100],
      [2, "", 10], [2, "7.41e", 500],
      [3, "", 10], [3, "7.41e", 300],
    ]);
    expect(legacyOrder(db)).toEqual([1, 2, 3]); // anterior
    const universe = await loadHeroUniverse(db, "7.41e");
    expect(universe.allHeroIds.slice().sort()).toEqual([1, 2, 3]);
    expect(universe.metaOrder).toEqual([2, 3, 1]); // corregido
  });

  test("dos parches reales: sólo cuenta el vigente, el otro no pesa", async () => {
    const db = createDb();
    seed(db, [1, 2], [[1, "7.40", 99999], [1, "7.41e", 1], [2, "7.41e", 5]]);
    expect((await loadHeroUniverse(db, "7.41e")).metaOrder).toEqual([2, 1]);
  });

  test("cobertura parcial del parche vigente: el héroe sin filas cuenta 0, no se completa con otro parche", async () => {
    const db = createDb();
    seed(db, [1, 2], [[1, "7.40", 99999], [2, "7.41e", 5], [1, "7.41e", 0]]);
    // el héroe 1 tiene 0 picks en 7.41e (y 99999 en 7.40, que no debe aparecer)
    expect((await loadHeroUniverse(db, "7.41e")).metaOrder).toEqual([2, 1]);
  });

  test("el parche vigente no existe en los datos: usa UN solo parche real (el dominante), nunca mezcla ni usa el vacío", async () => {
    const db = createDb();
    seed(db, [1, 2, 3], [
      [1, "", 50000], [2, "", 1], [3, "", 1],
      [1, "7.40", 10], [2, "7.40", 30], [3, "7.40", 20],
      [1, "7.39", 99999], // un parche con menos filas no entra aunque pese mucho
    ]);
    expect((await loadHeroUniverse(db, "7.41e")).metaOrder).toEqual([2, 3, 1]);
  });

  test("sólo hay filas vacías: sin dato -> orden por id, nunca picks de un parche inventado", async () => {
    const db = createDb();
    seed(db, [3, 1, 2], [[1, "", 10], [2, "", 99999], [3, "", 5]]);
    expect((await loadHeroUniverse(db, "7.41e")).metaOrder).toEqual([1, 2, 3]);
  });

  test("base sin estadísticas: orden por id y sin excepción", async () => {
    const db = createDb();
    seed(db, [2, 1], []);
    expect((await loadHeroUniverse(db, "7.41e")).metaOrder).toEqual([1, 2]);
  });
});
