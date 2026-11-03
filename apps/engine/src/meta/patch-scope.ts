// Estadística por parche: nunca se suman parches distintos.
//
// `hero_patch_stats` puede contener filas de más de un parche a la vez (p. ej. restos de una sync
// antigua con `patch = ""`, que la sync diaria nunca refresca porque sólo reescribe su propio
// parche). Sumar todo mezcla una foto vieja con el meta actual. Este módulo es el único lugar que
// decide "qué parche cuenta" para los agregados de picks; es función pura, sin I/O.

import type { HeroPatchBracketStat } from "../signals/types";

type StatsByHero = Record<number, readonly Pick<HeroPatchBracketStat, "patch" | "picks">[]>;

/**
 * Parche con el que se agrega. Orden de decisión:
 * 1. `preferred` si algún héroe tiene filas de ese parche.
 * 2. Si no, el parche NO vacío con más filas (empate: el mayor en orden de texto, determinista).
 * 3. Sin ningún parche no vacío -> `null` (sin dato: nunca se inventa uno).
 */
export function resolveAggregationPatch(statsByHero: StatsByHero, preferred?: string | null): string | null {
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

/** Picks totales de un héroe en UN solo parche (todos los brackets de ese parche). */
export function totalPicksInPatch(rows: readonly Pick<HeroPatchBracketStat, "patch" | "picks">[] | undefined, patch: string | null): number {
  if (!rows || patch === null) return 0;
  let total = 0;
  for (const row of rows) if (row.patch === patch) total += row.picks;
  return total;
}

/** Orden del pool de baneos: picks desc dentro de un solo parche; empate por id asc. */
export function orderHeroesByPicks(allHeroIds: readonly number[], statsByHero: StatsByHero, preferredPatch?: string | null): number[] {
  const patch = resolveAggregationPatch(statsByHero, preferredPatch);
  const picks = (id: number): number => totalPicksInPatch(statsByHero[id], patch);
  return [...allHeroIds].sort((a, b) => picks(b) - picks(a) || a - b);
}
