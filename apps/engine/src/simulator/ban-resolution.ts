import { isValidHeroId } from "../draft-protocol/hero-id";
import type { HeroId } from "../draft-protocol/types";
import { stableHash } from "./enemy-bot-utils";
import { MAX_PLAYER_BAN_PREFERENCES } from "./session-config";

// AP Ranked Roles V1 -- pre-draft ban resolution.
//
// Ranked All Pick bans are not interactive during the draft: the Player nominates up to four
// heroes, the other nine participants are simulated, and a resolution policy turns the ten
// preference sets into one resolved ban set. The kernel only ever receives that final set.
//
// This module does NOT claim to reproduce Valve's unpublished internal implementation. It enforces
// Simulator product policy:
//   1. Simulator resolves to 16 unique bans when the hero universe contains at least 16 heroes;
//   2. Player nominations influence that set (a hero nominated by several participants is banned once;
//      a participant with all four preference slots filled has at least one of them banned);
//   3. Deterministic seeded fill completes the remainder up to 16;
//   4. Same preferences + same seed => byte-identical output; a different seed => different
//      simulated preferences and meta fill (the Player's own preferences are never altered).
// Consensus bans (nominated by two or more participants) are ordered first.

export const TARGET_SIMULATOR_BANS = 16;

export interface BanPreferenceSet {
  playerId: string;
  /** Up to four entries, index 0 = strongest; `null` = empty slot (ignored). */
  preferences: (HeroId | null)[];
}

export interface BanResolutionPolicy {
  resolve(preferences: BanPreferenceSet[], seed: string, universe?: HeroUniverse): HeroId[];
}

/** Heroes known to the simulator. `metaOrder` lists heroes by how likely they are to be banned (most first). */
export interface HeroUniverse {
  allHeroIds: readonly HeroId[];
  metaOrder: readonly HeroId[];
}

export const SIMULATED_PLAYER_COUNT = 9;
/** Simulated players nominate from this many top heroes of `metaOrder` (biased toward the front). */
const SIMULATED_NOMINATION_POOL = 48;
/** Probability weights for how many of the 4 slots a simulated player fills: index = slots filled. */
const SIMULATED_FILL_WEIGHTS: readonly number[] = [0.05, 0.05, 0.1, 0.2, 0.6];

function seededRandom(seed: string): () => number {
  let state = stableHash(seed) | 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

function drawFillCount(random: () => number): number {
  const roll = random();
  let acc = 0;
  for (let count = 0; count < SIMULATED_FILL_WEIGHTS.length; count += 1) {
    acc += SIMULATED_FILL_WEIGHTS[count]!;
    if (roll < acc) return count;
  }
  return SIMULATED_FILL_WEIGHTS.length - 1;
}

/** Nine deterministic simulated preference sets. Same universe + seed => identical sets. */
export function simulateBanPreferences(universe: HeroUniverse, seed: string): BanPreferenceSet[] {
  const pool = universe.metaOrder.slice(0, SIMULATED_NOMINATION_POOL);
  const sets: BanPreferenceSet[] = [];
  for (let index = 0; index < SIMULATED_PLAYER_COUNT; index += 1) {
    const random = seededRandom(`${seed}:ban-sim:${index}`);
    const fill = drawFillCount(random);
    const chosen: HeroId[] = [];
    let attempts = 0;
    while (chosen.length < fill && chosen.length < pool.length && attempts < 200) {
      attempts += 1;
      // min of two uniform draws biases toward the front of the meta order without excluding the rest.
      const position = Math.floor(Math.min(random(), random()) * pool.length);
      const hero = pool[position]!;
      if (!chosen.includes(hero)) chosen.push(hero);
    }
    const preferences: (HeroId | null)[] = Array.from({ length: MAX_PLAYER_BAN_PREFERENCES }, (_, slot) => chosen[slot] ?? null);
    sets.push({ playerId: `sim-${index + 1}`, preferences });
  }
  return sets;
}

function fillBansFromMeta(
  bans: HeroId[],
  banned: Set<HeroId>,
  universe: HeroUniverse,
  seed: string,
  targetCount: number,
): void {
  if (bans.length >= targetCount) return;

  // 1. Preserve metaOrder as the preferred source
  const metaCandidates = universe.metaOrder.filter((hero) => !banned.has(hero));
  if (metaCandidates.length > 0) {
    const windowSize = Math.min(metaCandidates.length, Math.max(targetCount * 3, 40));
    const pool = metaCandidates.slice(0, windowSize);
    const rng = seededRandom(`${seed}:meta-ban-fill`);

    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }

    for (const hero of pool) {
      if (bans.length >= targetCount) break;
      if (!banned.has(hero)) {
        banned.add(hero);
        bans.push(hero);
      }
    }

    for (const hero of metaCandidates) {
      if (bans.length >= targetCount) break;
      if (!banned.has(hero)) {
        banned.add(hero);
        bans.push(hero);
      }
    }
  }

  // 2. After exhausting eligible metaOrder heroes, fall back to eligible universe.allHeroIds
  if (bans.length < targetCount) {
    const fallbackCandidates = universe.allHeroIds.filter((hero) => !banned.has(hero));
    if (fallbackCandidates.length > 0) {
      const pool = [...fallbackCandidates];
      const fallbackRng = seededRandom(`${seed}:all-hero-ban-fill`);

      for (let i = pool.length - 1; i > 0; i -= 1) {
        const j = Math.floor(fallbackRng() * (i + 1));
        [pool[i], pool[j]] = [pool[j]!, pool[i]!];
      }

      for (const hero of pool) {
        if (bans.length >= targetCount) break;
        if (!banned.has(hero)) {
          banned.add(hero);
          bans.push(hero);
        }
      }
    }
  }
}

export const defaultBanResolutionPolicy: BanResolutionPolicy = Object.freeze({
  resolve(preferences: BanPreferenceSet[], seed = "default", universe?: HeroUniverse): HeroId[] {
    const votes = new Map<HeroId, { count: number; bestRank: number }>();
    for (const set of preferences) {
      const seen = new Set<HeroId>();
      set.preferences.forEach((hero, rank) => {
        if (hero === null || seen.has(hero)) return;
        seen.add(hero);
        const current = votes.get(hero);
        if (!current) votes.set(hero, { count: 1, bestRank: rank });
        else votes.set(hero, { count: current.count + 1, bestRank: Math.min(current.bestRank, rank) });
      });
    }

    const targetCount = universe ? Math.min(TARGET_SIMULATOR_BANS, universe.allHeroIds.length) : TARGET_SIMULATOR_BANS;

    const bans: HeroId[] = [...votes.entries()]
      .filter(([, vote]) => vote.count >= 2)
      .sort(([heroA, a], [heroB, b]) => b.count - a.count || a.bestRank - b.bestRank || heroA - heroB)
      .map(([hero]) => hero);
    const banned = new Set(bans);

    // Guarantee: a participant with every slot filled has at least one preference banned. Stable order (by playerId).
    const full = [...preferences].sort((a, b) => a.playerId.localeCompare(b.playerId));
    for (const set of full) {
      const nominated = set.preferences.filter((hero): hero is HeroId => hero !== null);
      if (set.preferences.length < MAX_PLAYER_BAN_PREFERENCES || nominated.length < MAX_PLAYER_BAN_PREFERENCES) continue;
      if (nominated.some((hero) => banned.has(hero))) continue;
      const top = nominated[0]!;
      banned.add(top);
      bans.push(top);
    }

    // Nominated heroes with single votes: 50% chance (Dota 2 ranked all pick ban nomination rule)
    const singles = [...votes.entries()]
      .filter(([hero, vote]) => vote.count === 1 && !banned.has(hero))
      .sort(([heroA, a], [heroB, b]) => a.bestRank - b.bestRank || heroA - heroB);

    const singleRng = seededRandom(`${seed}:single-bans`);
    for (const [hero] of singles) {
      if (bans.length >= targetCount) break;
      if (singleRng() < 0.5) {
        banned.add(hero);
        bans.push(hero);
      }
    }

    // If universe is provided, fill up to targetCount from metaOrder with deterministic seed variation
    if (universe && bans.length < targetCount) {
      fillBansFromMeta(bans, banned, universe, seed, targetCount);
    }

    // Fallback when universe is not supplied: if someone nominated, ban at least the strongest
    if (bans.length === 0 && votes.size > 0) {
      const [strongest] = [...votes.entries()].sort(([heroA, a], [heroB, b]) => a.bestRank - b.bestRank || heroA - heroB);
      bans.push(strongest![0]);
    }
    return bans;
  },
});

export type BanResolutionResult =
  | { ok: true; bans: HeroId[] }
  | { ok: false; reason: "invalid_player_preferences" | "policy_failed" | "policy_invalid_output"; detail: string };

/** Player input is external: validated before it can influence anything. */
export function validatePlayerBanPreferences(
  value: unknown,
  universe: HeroUniverse,
): { ok: true; preferences: (HeroId | null)[] } | { ok: false; detail: string } {
  if (!Array.isArray(value)) return { ok: false, detail: "playerBanPreferences must be an array" };
  if (value.length > MAX_PLAYER_BAN_PREFERENCES) return { ok: false, detail: `at most ${MAX_PLAYER_BAN_PREFERENCES} ban preferences` };
  const known = new Set(universe.allHeroIds);
  const seen = new Set<number>();
  const preferences: (HeroId | null)[] = [];
  for (const entry of value) {
    if (entry === null) {
      preferences.push(null);
      continue;
    }
    if (!isValidHeroId(entry)) return { ok: false, detail: "ban preference is not a valid hero id" };
    if (!known.has(entry)) return { ok: false, detail: "ban preference names an unknown hero" };
    if (seen.has(entry)) return { ok: false, detail: "ban preferences must be unique" };
    seen.add(entry);
    preferences.push(entry);
  }
  return { ok: true, preferences };
}

/**
 * FAIL CLOSED. Any throw or malformed policy output becomes a `{ ok: false }` result -- the caller
 * must not start Round 1, must not substitute an empty or reduced ban set, and must offer a retry.
 * An empty ban set is valid only when every one of the ten participants nominated nobody.
 */
export function resolveSimulatorBans(input: {
  playerPreferences: (HeroId | null)[];
  universe: HeroUniverse;
  seed: string;
  policy?: BanResolutionPolicy;
}): BanResolutionResult {
  const { playerPreferences, universe, seed } = input;
  const policy = input.policy ?? defaultBanResolutionPolicy;
  const validated = validatePlayerBanPreferences(playerPreferences, universe);
  if (!validated.ok) return { ok: false, reason: "invalid_player_preferences", detail: validated.detail };

  const sets: BanPreferenceSet[] = [{ playerId: "player", preferences: validated.preferences }, ...simulateBanPreferences(universe, seed)];
  let bans: unknown;
  try {
    bans = policy.resolve(sets, seed, universe);
  } catch (error) {
    return { ok: false, reason: "policy_failed", detail: error instanceof Error ? error.message : "policy threw" };
  }
  if (!Array.isArray(bans)) return { ok: false, reason: "policy_invalid_output", detail: "policy did not return an array" };
  const expectedCount = Math.min(TARGET_SIMULATOR_BANS, universe.allHeroIds.length);
  if (bans.length !== expectedCount) {
    return { ok: false, reason: "policy_invalid_output", detail: `policy returned ${bans.length} bans; expected exactly ${expectedCount}` };
  }
  const known = new Set(universe.allHeroIds);
  const seen = new Set<number>();
  for (const hero of bans) {
    if (!isValidHeroId(hero) || !known.has(hero)) return { ok: false, reason: "policy_invalid_output", detail: "policy returned an invalid or unknown hero id" };
    if (seen.has(hero)) return { ok: false, reason: "policy_invalid_output", detail: "policy returned a duplicate hero id" };
    seen.add(hero);
  }
  return { ok: true, bans: bans as HeroId[] };
}
