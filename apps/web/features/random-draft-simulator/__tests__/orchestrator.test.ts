// Feature: random-draft-simulator
// Property 7: La Pick_Phase sigue exactamente la distribución 2-2-1
// Property 16: Reproducibilidad completa dado el mismo (draftSeed, personalBanList)
// Validates: Requirements 3.1, 8.5

import { test, expect } from "bun:test";
import { initDraft, type OrchestratorConfig } from "../orchestrator";
import type { MetaHeroEntry, MetaSnapshot } from "../bot-drafter";
import type { HeroId } from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SEED_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const HERO_POOL_SIZE = 130;

function randomValidSeed(): string {
  return Array.from(
    { length: 8 },
    () => SEED_CHARS[Math.floor(Math.random() * SEED_CHARS.length)],
  ).join("");
}

const ROLES = ["carry", "support", "mid", "offlane", "soft_support"];

function buildMetaSnapshot(): MetaSnapshot {
  const heroes: Record<HeroId, MetaHeroEntry> = {};
  const patchStats: MetaSnapshot["patchStats"] = {};

  for (let id = 1; id <= HERO_POOL_SIZE; id++) {
    heroes[id] = { id, localizedName: `Hero ${id}`, roles: [ROLES[id % ROLES.length]!] };
    patchStats![id] = [
      { patch: "7.37d", bracket: "all", picks: 100 + id, wins: 40 + (id % 60) },
    ];
  }

  return { heroes, patchStats };
}

function baseConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
  const pool = Array.from({ length: HERO_POOL_SIZE }, (_, i) => i + 1);
  return {
    draftSeed: randomValidSeed(),
    userSide: "radiant",
    personalBanList: [],
    meta: buildMetaSnapshot(),
    metaBanPool: pool.slice().reverse(),
    patch: "7.37d",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Property 7: distribución exacta 2-2-1
// Validates: Requirements 3.1
// ---------------------------------------------------------------------------

test("Property 7: initDraft produce 3 rondas con distribución de botPicks 2-2-1 (100 casos)", () => {
  // Feature: random-draft-simulator, Property 7: La Pick_Phase sigue exactamente la distribución 2-2-1
  const expectedLengths = [2, 2, 1];

  for (let caseIndex = 0; caseIndex < 100; caseIndex++) {
    const userSide = caseIndex % 2 === 0 ? "radiant" : "dire";
    const result = initDraft(baseConfig({ userSide }));

    expect(result.rounds).toHaveLength(3);
    result.rounds.forEach((round, i) => {
      expect(round.round).toBe((i + 1) as 1 | 2 | 3);
      expect(round.botPicks.length).toBe(expectedLengths[i]);
    });
  }
});

// ---------------------------------------------------------------------------
// Property 16: reproducibilidad completa dado el mismo (draftSeed, personalBanList)
// Validates: Requirements 8.5
// ---------------------------------------------------------------------------

test("Property 16: mismo draftSeed y personalBanList producen el mismo OrchestratorResult (100 casos)", () => {
  // Feature: random-draft-simulator, Property 16: Reproducibilidad completa dado el mismo (draftSeed, personalBanList)
  for (let caseIndex = 0; caseIndex < 100; caseIndex++) {
    const draftSeed = randomValidSeed();
    const personalBanList: HeroId[] = Array.from({ length: caseIndex % 5 }, (_, i) => i + 1);

    const config = baseConfig({ draftSeed, personalBanList });
    const first = initDraft(config);
    const second = initDraft(config);

    expect(second).toEqual(first);
  }
});

// ---------------------------------------------------------------------------
// Extra: nunca hay picks duplicados entre bans resueltos y botPicks de todas las rondas
// ---------------------------------------------------------------------------

test("initDraft nunca repite un héroe entre resolvedBans y los botPicks pre-calculados", () => {
  const result = initDraft(baseConfig());
  const allBotPicks = result.rounds.flatMap((round) => round.botPicks);
  const bannedSet = new Set(result.resolvedBans);

  for (const heroId of allBotPicks) {
    expect(bannedSet.has(heroId)).toBe(false);
  }
  expect(new Set(allBotPicks).size).toBe(allBotPicks.length);
});
