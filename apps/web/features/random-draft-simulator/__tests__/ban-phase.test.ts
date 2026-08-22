// Feature: random-draft-simulator
// Property 5: Ban_Phase produce exactamente 16 bans sin duplicados (pool ≥ 16)
// Property 6: Ban_Phase es determinística dado el mismo seed y Personal_Ban_List
// Validates: Requirements 2.3, 2.4, 2.2, 8.5

import { test, expect } from "bun:test";
import { resolveBanPhase } from "../ban-phase";
import { createSeededRng } from "../seeded-rng";
import type { HeroId } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEED_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const HERO_POOL_SIZE = 130; // aproximación del pool real de héroes de Dota 2

function randomValidSeed(): string {
  return Array.from(
    { length: 8 },
    () => SEED_CHARS[Math.floor(Math.random() * SEED_CHARS.length)],
  ).join("");
}

function allHeroes(): HeroId[] {
  return Array.from({ length: HERO_POOL_SIZE }, (_, i) => i + 1);
}

/** Genera una Personal_Ban_List de 0-4 héroes tomados del pool. */
function randomPersonalBanList(pool: HeroId[], caseIndex: number): HeroId[] {
  const size = caseIndex % 5; // 0, 1, 2, 3, 4
  return pool.slice(0, size);
}

// ---------------------------------------------------------------------------
// Property 5: exactamente 16 bans sin duplicados (pool ≥ 16)
// Validates: Requirements 2.3, 2.4
// ---------------------------------------------------------------------------

test("Property 5: resolveBanPhase produce exactamente 16 bans sin duplicados (100 casos)", () => {
  // Feature: random-draft-simulator, Property 5: Ban_Phase produce exactamente 16 bans sin duplicados (pool >= 16)
  const pool = allHeroes();

  const results = Array.from({ length: 100 }, (_, caseIndex) => {
    const seed = randomValidSeed();
    const personalBanList = randomPersonalBanList(pool, caseIndex);
    const metaBanPool = pool.slice().reverse(); // orden desc simulado, distinto del pool base
    const rng = createSeededRng(seed);

    return resolveBanPhase({
      personalBanList,
      metaBanPool,
      allHeroIds: pool,
      rng,
    });
  });

  for (const { resolvedBans } of results) {
    expect(resolvedBans).toHaveLength(16);
    expect(new Set(resolvedBans).size).toBe(resolvedBans.length);
  }
});

// ---------------------------------------------------------------------------
// Property 6: determinística dado el mismo seed y Personal_Ban_List
// Validates: Requirements 2.2, 8.5
// ---------------------------------------------------------------------------

test("Property 6: mismo seed y personalBanList producen la misma resolución (100 casos)", () => {
  // Feature: random-draft-simulator, Property 6: Ban_Phase es determinística dado el mismo seed y Personal_Ban_List
  const pool = allHeroes();
  const metaBanPool = pool.slice().reverse();

  for (let caseIndex = 0; caseIndex < 100; caseIndex++) {
    const seed = randomValidSeed();
    const personalBanList = randomPersonalBanList(pool, caseIndex);

    const first = resolveBanPhase({
      personalBanList,
      metaBanPool,
      allHeroIds: pool,
      rng: createSeededRng(seed),
    });
    const second = resolveBanPhase({
      personalBanList,
      metaBanPool,
      allHeroIds: pool,
      rng: createSeededRng(seed),
    });

    expect(second.resolvedBans).toEqual(first.resolvedBans);
  }
});

// ---------------------------------------------------------------------------
// Req. 2.5: menos de 16 héroes únicos disponibles en total
// ---------------------------------------------------------------------------

test("Req 2.5: con menos de 16 héroes disponibles en total, banea todos sin alcanzar 16", () => {
  const smallPool: HeroId[] = [1, 2, 3, 4, 5];
  const result = resolveBanPhase({
    personalBanList: [],
    metaBanPool: smallPool,
    allHeroIds: smallPool,
    rng: createSeededRng(randomValidSeed()),
  });

  expect(result.resolvedBans.length).toBe(5);
  expect(new Set(result.resolvedBans).size).toBe(5);
});
