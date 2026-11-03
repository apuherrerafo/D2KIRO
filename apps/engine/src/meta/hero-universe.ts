// Universo de héroes del simulador (pool de baneos). Extraído de `createApp` para poder probar el
// cableado real contra SQLite sin levantar el servidor. Sin cambios de comportamiento más allá de
// agregar los picks dentro de UN solo parche (ver patch-scope.ts).

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { HeroUniverse } from "../simulator/ban-resolution";
import { getAllHeroMeta, getCachedMetaSnapshot } from "./provider";
import { orderHeroesByPicks } from "./patch-scope";

export async function loadHeroUniverse<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  preferredPatch: string,
): Promise<HeroUniverse> {
  const heroRows = await getAllHeroMeta(db);
  const meta = await getCachedMetaSnapshot<TSchema>(db, null);
  const allHeroIds = heroRows.map((hero) => hero.id);
  // Proxy for "how likely to be banned": no ban-rate data exists in this project, so pick volume orders the pool.
  const metaOrder = orderHeroesByPicks(allHeroIds, meta.patchStats ?? {}, preferredPatch);
  return { allHeroIds, metaOrder };
}
