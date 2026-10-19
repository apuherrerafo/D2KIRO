import type { MetaSnapshot } from "../signals/types";

/**
 * A per-call hero pool (a teammate's pool for the position being ranked) REPLACES the snapshot's pool for that call
 * only: a fresh object, never the cached snapshot, so another seat's or account's call can't see it. `hero_pool_fit`
 * then votes for exactly these heroes. Empty / absent leaves the snapshot untouched.
 */
export function withHeroPoolOverride(meta: MetaSnapshot, overrideHeroPool: readonly number[] | undefined): MetaSnapshot {
  if (!overrideHeroPool || overrideHeroPool.length === 0) return meta;
  return {
    ...meta,
    heroPool: overrideHeroPool.map((hero) => ({
      hero,
      source: "manual" as const,
      personalWinrate: null,
      personalGames: 0,
      updatedAt: new Date().toISOString(),
    })),
    personalBaselineWinrate: null,
  };
}
