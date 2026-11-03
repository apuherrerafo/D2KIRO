// Espejo a mano de apps/engine/src/meta/patch-scope.ts (los dos procesos son independientes).
// Regla: una estadística de popularidad/winrate se agrega dentro de UN solo parche; nunca se suman
// parches distintos (p. ej. restos con patch "" de una sync antigua en una base ya existente).

import type { HeroPatchStat } from "./bot-drafter";

type Stat = Pick<HeroPatchStat, "patch">;

/**
 * Parche con el que se agrega: `preferred` si algún héroe tiene filas de él (mismo criterio que el motor); si no,
 * el no vacío con más filas (empate: el mayor en orden de texto). `null` si no hay ninguno.
 */
export function dominantNonEmptyPatch(statsByHero: Record<number, readonly Stat[]>, preferred?: string | null): string | null {
  const counts = new Map<string, number>();
  for (const rows of Object.values(statsByHero)) {
    for (const row of rows) {
      if (typeof row.patch !== "string" || row.patch.trim().length === 0) continue;
      counts.set(row.patch, (counts.get(row.patch) ?? 0) + 1);
    }
  }
  if (preferred && counts.has(preferred)) return preferred;
  let best: string | null = null;
  let bestCount = 0;
  for (const [patch, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && patch > best)) {
      best = patch;
      bestCount = count;
    }
  }
  return best;
}

/** Sólo las filas del parche dado. Parche `null`/ausente -> [] (sin dato; nunca se mezclan parches). */
export function statsInPatch<T extends Stat>(stats: readonly T[] | undefined, patch: string | null | undefined): T[] {
  if (!stats || !patch) return [];
  return stats.filter((row) => row.patch === patch);
}
