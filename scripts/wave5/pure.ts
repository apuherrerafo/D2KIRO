// WAVE 5 -- pure helpers of the certification tooling (no engine imports, no I/O), so they can be unit-tested.

/** FNV-1a: tiny deterministic index source. Never touches any engine RNG. */
export function seededIndex(key: string, modulo: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % Math.max(modulo, 1);
}

/** Nearest-rank percentile of an ASCENDING-sorted sample (p in 0..100). NaN for an empty sample. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

export type PositionShares = Record<number, readonly { position: number; matches: number }[] | undefined>;

/**
 * Independent necessary-condition check: can `heroes` be given DISTINCT positions, each one curated for that hero?
 * (tiny backtracking, <= 5 heroes). Used to prove that an empty Coach shortlist is the engine being right, not broken.
 */
export function hasDistinctPositionAssignment(heroes: readonly number[], positions: PositionShares): boolean {
  const options = heroes.map((hero) => (positions[hero] ?? []).map((share) => share.position));
  const used = new Set<number>();
  const assign = (index: number): boolean => {
    if (index === options.length) return true;
    for (const position of options[index]!) {
      if (used.has(position)) continue;
      used.add(position);
      if (assign(index + 1)) return true;
      used.delete(position);
    }
    return false;
  };
  return assign(0);
}
