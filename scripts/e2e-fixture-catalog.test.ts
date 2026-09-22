import { describe, expect, test } from "bun:test";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { CURATED_HERO_IDS } from "../apps/engine/src/signals/curated-hero-ids";
import {
  FIXTURE_HERO_ID_BY_NAME,
  FIXTURE_HERO_IDS,
  FIXTURE_HERO_NAME_BY_ID,
  buildFixtureRawHeroes,
  buildFixtureRawHeroStats,
} from "../e2e/fixtures/hero-catalog";

describe("E2E fixture catalog drift guard", () => {
  test("exhaustively covers every hero in CURATED_HERO_IDS (127 heroes)", () => {
    expect(FIXTURE_HERO_IDS.length).toBe(CURATED_HERO_IDS.size);
    for (const heroId of CURATED_HERO_IDS) {
      expect(FIXTURE_HERO_NAME_BY_ID.has(heroId)).toBe(true);
      const name = FIXTURE_HERO_NAME_BY_ID.get(heroId);
      expect(name).toBeDefined();
      expect(typeof name).toBe("string");
      expect(name!.length).toBeGreaterThan(0);
      expect(FIXTURE_HERO_ID_BY_NAME.get(name!)).toBe(heroId);
    }
  });

  test("contains zero orphaned hero IDs absent from CURATED_HERO_IDS", () => {
    for (const heroId of FIXTURE_HERO_IDS) {
      expect(CURATED_HERO_IDS.has(heroId)).toBe(true);
    }
  });

  test("exhaustively matches frozen S1.sqlite snapshot heroes", () => {
    const s1Path = resolve(__dirname, "..", "eval", "snapshots", "S1.sqlite");
    const db = new Database(s1Path, { readonly: true });
    try {
      const dbHeroes = db
        .prepare("SELECT id, name, localized_name, primary_attr, attack_type, roles FROM heroes ORDER BY id ASC")
        .all() as Array<{
        id: number;
        name: string;
        localized_name: string;
        primary_attr: string;
        attack_type: string;
        roles: string;
      }>;
      expect(dbHeroes.length).toBe(127);
      for (const row of dbHeroes) {
        expect(FIXTURE_HERO_NAME_BY_ID.has(row.id)).toBe(true);
        expect(FIXTURE_HERO_NAME_BY_ID.get(row.id)).toBe(row.localized_name);
        expect(FIXTURE_HERO_ID_BY_NAME.get(row.localized_name)).toBe(row.id);
      }
    } finally {
      db.close();
    }
  });

  test("buildFixtureRawHeroes and buildFixtureRawHeroStats cover full 127 heroes with valid fields", () => {
    const rawHeroes = buildFixtureRawHeroes();
    expect(rawHeroes.length).toBe(127);
    for (const raw of rawHeroes) {
      expect(raw.id).toBeGreaterThan(0);
      expect(raw.name).toStartWith("npc_dota_hero_");
      expect(raw.localized_name.length).toBeGreaterThan(0);
      expect(["str", "agi", "int", "all"]).toContain(raw.primary_attr);
      expect(["Melee", "Ranged"]).toContain(raw.attack_type);
      expect(Array.isArray(raw.roles)).toBe(true);
      expect(raw.roles.length).toBeGreaterThan(0);
    }

    const rawStats = buildFixtureRawHeroStats();
    expect(rawStats.length).toBe(127);
    for (const stat of rawStats) {
      expect(stat.id).toBeGreaterThan(0);
      for (let tier = 1; tier <= 8; tier++) {
        expect(typeof stat[`${tier}_pick`]).toBe("number");
        expect(typeof stat[`${tier}_win`]).toBe("number");
        expect((stat[`${tier}_pick`] as number)).toBeGreaterThan(0);
        expect((stat[`${tier}_win`] as number)).toBeGreaterThan(0);
      }
    }
  });
});
