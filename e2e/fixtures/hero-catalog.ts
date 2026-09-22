// R1 S7 (Blocker 1) / Wave 5: deterministic hero catalog fixture for the self-contained E2E bootstrap.
//
// All 127 real Dota 2 hero id/name pairs (the exact hero universe certified across this repo:
// apps/engine/src/signals/curated-hero-ids.ts, hero-positions.json, capabilities.ts and
// hero-counters.json), loaded from the frozen S1 snapshot (eval/snapshots/S1.sqlite) and shaped
// exactly like OpenDota's real /heroes response (RawHero from apps/engine/src/meta/validation.ts)
// so the E2E bootstrap can run through the SAME mapHero/mapHeroStatsRow production code the real
// meta sync uses, with zero network calls and full 127-hero coverage.
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { RawHero, RawHeroStatsRow } from "../../apps/engine/src/meta/validation";

interface FixtureHero {
  id: number;
  name: string;
  localizedName: string;
  primaryAttr: "str" | "agi" | "int" | "all";
  attackType: "Melee" | "Ranged";
  roles: string[];
}

function resolveS1SnapshotPath(): string {
  const localRelative = resolve(__dirname, "..", "..", "eval", "snapshots", "S1.sqlite");
  if (existsSync(localRelative)) return localRelative;
  const cwdRelative = resolve(process.cwd(), "eval", "snapshots", "S1.sqlite");
  if (existsSync(cwdRelative)) return cwdRelative;
  throw new Error(`Deterministic S1 snapshot not found at ${localRelative} or ${cwdRelative}`);
}

function loadFixtureHeroes(): FixtureHero[] {
  const dbPath = resolveS1SnapshotPath();
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare("SELECT id, name, localized_name, primary_attr, attack_type, roles FROM heroes ORDER BY id ASC")
      .all() as Array<{
      id: number;
      name: string;
      localized_name: string;
      primary_attr: string;
      attack_type: string;
      roles: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      localizedName: r.localized_name,
      primaryAttr: r.primary_attr as FixtureHero["primaryAttr"],
      attackType: r.attack_type as FixtureHero["attackType"],
      roles: typeof r.roles === "string" ? JSON.parse(r.roles) : (r.roles as string[]),
    }));
  } finally {
    db.close();
  }
}

const FIXTURE_HEROES: FixtureHero[] = loadFixtureHeroes();

export const FIXTURE_HERO_IDS: readonly number[] = FIXTURE_HEROES.map((hero) => hero.id);

// The browser certification scenarios need to connect a hero button's accessible name back to
// the deterministic server-side fixture id when asserting an actual ProtocolKernel transition.
// This remains test data only: the product never imports this fixture and no UI state is mutated.
export const FIXTURE_HERO_ID_BY_NAME: ReadonlyMap<string, number> = new Map(
  FIXTURE_HEROES.map((hero) => [hero.localizedName, hero.id]),
);

export const FIXTURE_HERO_NAME_BY_ID: ReadonlyMap<number, string> = new Map(
  FIXTURE_HEROES.map((hero) => [hero.id, hero.localizedName]),
);

export function buildFixtureRawHeroes(): RawHero[] {
  return FIXTURE_HEROES.map((hero) => ({
    id: hero.id,
    name: hero.name,
    localized_name: hero.localizedName,
    primary_attr: hero.primaryAttr,
    attack_type: hero.attackType,
    roles: hero.roles,
  }));
}

// Deterministic pick/win counts per bracket tier (1-8) -- no randomness, so two clean E2E runs
// produce byte-identical patch_meta signals. Picks grow with tier number, winrate hovers close to
// 50% with a small, deterministic per-hero skew so heroes are actually distinguishable.
export function buildFixtureRawHeroStats(): RawHeroStatsRow[] {
  return FIXTURE_HEROES.map((hero, index) => {
    const row: RawHeroStatsRow = { id: hero.id };
    for (let tier = 1; tier <= 8; tier += 1) {
      const picks = 200 + tier * 150 + index * 7;
      const skew = ((index * 13 + tier * 5) % 21) - 10; // deterministic -10..+10
      const wins = Math.round(picks * (0.5 + skew / 200));
      row[`${tier}_pick`] = picks;
      row[`${tier}_win`] = wins;
    }
    return row;
  });
}
