import type { HeroId } from "./types";

// R1 S1 -- Blocker 4C (independent architecture review): centralized HeroId runtime validation.
// `HeroId` is `number` at the type level, which is no guarantee at all once a value has crossed a
// trust boundary (a ProtocolCommand built from untrusted JSON). Every command carrying a heroId
// must run through this before it touches game logic or a canonical hash -- rejects NaN,
// Infinity, -Infinity, non-integers, and non-positive values, the exact set of "numbers" that
// JSON.stringify silently mangles (NaN/Infinity -> null) or that would otherwise slip past a
// naive `!== ` / `.includes()` comparison (NaN !== NaN, so an unguarded "already taken" check
// would never catch a repeated NaN heroId). Same discipline as the pre-existing
// isValidHeroId pattern in apps/engine/src/knn/corpus.ts / lane/profiles.ts / signals/
// hero-positions.ts -- centralized here because draft-protocol is deliberately independent of
// those modules (see types.ts header).
export function isValidHeroId(value: unknown): value is HeroId {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
