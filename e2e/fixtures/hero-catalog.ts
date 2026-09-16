// R1 S7 (Blocker 1) -- deterministic hero catalog fixture for the self-contained E2E bootstrap.
//
// 50 real Dota 2 hero id/name pairs (the same ids already certified elsewhere in this repo --
// apps/engine/src/signals/hero-positions.json, capabilities.json and hero-counters.json all key
// on this exact id range), shaped exactly like OpenDota's real /heroes response (RawHero from
// apps/engine/src/meta/validation.ts) so the E2E bootstrap can run through the SAME mapHero/
// mapHeroStatsRow production code the real meta sync uses, with zero network calls.
//
// attack_type/primary_attr/roles are a reasonable approximation, not a patch-accurate snapshot --
// this file exists to give the engine a real, internally-consistent hero universe to compute
// signals over (position_fit/counter/archetype_fit all have real curated data for these ids), not
// to be a source of truth about current Dota balance.
import type { RawHero, RawHeroStatsRow } from "../../apps/engine/src/meta/validation";

interface FixtureHero {
  id: number;
  name: string;
  localizedName: string;
  primaryAttr: "str" | "agi" | "int";
  attackType: "Melee" | "Ranged";
  roles: string[];
}

const FIXTURE_HEROES: FixtureHero[] = [
  { id: 1, name: "npc_dota_hero_antimage", localizedName: "Anti-Mage", primaryAttr: "agi", attackType: "Melee", roles: ["Carry", "Escape"] },
  { id: 2, name: "npc_dota_hero_axe", localizedName: "Axe", primaryAttr: "str", attackType: "Melee", roles: ["Initiator", "Durable"] },
  { id: 3, name: "npc_dota_hero_bane", localizedName: "Bane", primaryAttr: "int", attackType: "Melee", roles: ["Support", "Disabler"] },
  { id: 4, name: "npc_dota_hero_bloodseeker", localizedName: "Bloodseeker", primaryAttr: "agi", attackType: "Melee", roles: ["Carry", "Nuker"] },
  { id: 5, name: "npc_dota_hero_crystal_maiden", localizedName: "Crystal Maiden", primaryAttr: "int", attackType: "Ranged", roles: ["Support", "Disabler"] },
  { id: 6, name: "npc_dota_hero_drow_ranger", localizedName: "Drow Ranger", primaryAttr: "agi", attackType: "Ranged", roles: ["Carry", "Disabler"] },
  { id: 7, name: "npc_dota_hero_earthshaker", localizedName: "Earthshaker", primaryAttr: "str", attackType: "Melee", roles: ["Initiator", "Disabler"] },
  { id: 8, name: "npc_dota_hero_juggernaut", localizedName: "Juggernaut", primaryAttr: "agi", attackType: "Melee", roles: ["Carry", "Pusher"] },
  { id: 9, name: "npc_dota_hero_mirana", localizedName: "Mirana", primaryAttr: "agi", attackType: "Ranged", roles: ["Carry", "Support"] },
  { id: 10, name: "npc_dota_hero_morphling", localizedName: "Morphling", primaryAttr: "agi", attackType: "Melee", roles: ["Carry", "Escape"] },
  { id: 11, name: "npc_dota_hero_nevermore", localizedName: "Shadow Fiend", primaryAttr: "agi", attackType: "Ranged", roles: ["Carry", "Nuker"] },
  { id: 12, name: "npc_dota_hero_phantom_lancer", localizedName: "Phantom Lancer", primaryAttr: "agi", attackType: "Melee", roles: ["Carry", "Pusher"] },
  { id: 13, name: "npc_dota_hero_puck", localizedName: "Puck", primaryAttr: "int", attackType: "Ranged", roles: ["Escape", "Nuker"] },
  { id: 14, name: "npc_dota_hero_pudge", localizedName: "Pudge", primaryAttr: "str", attackType: "Melee", roles: ["Disabler", "Durable"] },
  { id: 15, name: "npc_dota_hero_razor", localizedName: "Razor", primaryAttr: "agi", attackType: "Ranged", roles: ["Carry", "Durable"] },
  { id: 16, name: "npc_dota_hero_sand_king", localizedName: "Sand King", primaryAttr: "str", attackType: "Melee", roles: ["Initiator", "Disabler"] },
  { id: 17, name: "npc_dota_hero_storm_spirit", localizedName: "Storm Spirit", primaryAttr: "int", attackType: "Ranged", roles: ["Carry", "Escape"] },
  { id: 18, name: "npc_dota_hero_sven", localizedName: "Sven", primaryAttr: "str", attackType: "Melee", roles: ["Carry", "Initiator"] },
  { id: 19, name: "npc_dota_hero_tiny", localizedName: "Tiny", primaryAttr: "str", attackType: "Melee", roles: ["Carry", "Nuker"] },
  { id: 20, name: "npc_dota_hero_vengefulspirit", localizedName: "Vengeful Spirit", primaryAttr: "agi", attackType: "Melee", roles: ["Support", "Initiator"] },
  { id: 21, name: "npc_dota_hero_windrunner", localizedName: "Windranger", primaryAttr: "agi", attackType: "Ranged", roles: ["Support", "Disabler"] },
  { id: 22, name: "npc_dota_hero_zuus", localizedName: "Zeus", primaryAttr: "int", attackType: "Ranged", roles: ["Nuker", "Pusher"] },
  { id: 23, name: "npc_dota_hero_kunkka", localizedName: "Kunkka", primaryAttr: "str", attackType: "Melee", roles: ["Carry", "Disabler"] },
  { id: 25, name: "npc_dota_hero_lina", localizedName: "Lina", primaryAttr: "int", attackType: "Ranged", roles: ["Support", "Nuker"] },
  { id: 26, name: "npc_dota_hero_lion", localizedName: "Lion", primaryAttr: "int", attackType: "Ranged", roles: ["Support", "Disabler"] },
  { id: 27, name: "npc_dota_hero_shadow_shaman", localizedName: "Shadow Shaman", primaryAttr: "int", attackType: "Ranged", roles: ["Support", "Disabler"] },
  { id: 28, name: "npc_dota_hero_slardar", localizedName: "Slardar", primaryAttr: "str", attackType: "Melee", roles: ["Initiator", "Durable"] },
  { id: 29, name: "npc_dota_hero_tidehunter", localizedName: "Tidehunter", primaryAttr: "str", attackType: "Melee", roles: ["Initiator", "Durable"] },
  { id: 30, name: "npc_dota_hero_witch_doctor", localizedName: "Witch Doctor", primaryAttr: "int", attackType: "Ranged", roles: ["Support", "Nuker"] },
  { id: 31, name: "npc_dota_hero_lich", localizedName: "Lich", primaryAttr: "int", attackType: "Ranged", roles: ["Support", "Nuker"] },
  { id: 32, name: "npc_dota_hero_riki", localizedName: "Riki", primaryAttr: "agi", attackType: "Melee", roles: ["Carry", "Escape"] },
  { id: 33, name: "npc_dota_hero_enigma", localizedName: "Enigma", primaryAttr: "int", attackType: "Ranged", roles: ["Initiator", "Pusher"] },
  { id: 34, name: "npc_dota_hero_tinker", localizedName: "Tinker", primaryAttr: "int", attackType: "Ranged", roles: ["Nuker", "Pusher"] },
  { id: 35, name: "npc_dota_hero_sniper", localizedName: "Sniper", primaryAttr: "agi", attackType: "Ranged", roles: ["Carry", "Pusher"] },
  { id: 36, name: "npc_dota_hero_necrolyte", localizedName: "Necrophos", primaryAttr: "int", attackType: "Ranged", roles: ["Carry", "Nuker"] },
  { id: 37, name: "npc_dota_hero_warlock", localizedName: "Warlock", primaryAttr: "int", attackType: "Ranged", roles: ["Support", "Durable"] },
  { id: 38, name: "npc_dota_hero_beastmaster", localizedName: "Beastmaster", primaryAttr: "str", attackType: "Melee", roles: ["Initiator", "Durable"] },
  { id: 39, name: "npc_dota_hero_queenofpain", localizedName: "Queen of Pain", primaryAttr: "int", attackType: "Ranged", roles: ["Carry", "Nuker"] },
  { id: 40, name: "npc_dota_hero_venomancer", localizedName: "Venomancer", primaryAttr: "agi", attackType: "Melee", roles: ["Support", "Disabler"] },
  { id: 41, name: "npc_dota_hero_faceless_void", localizedName: "Faceless Void", primaryAttr: "agi", attackType: "Melee", roles: ["Carry", "Initiator"] },
  { id: 42, name: "npc_dota_hero_skeleton_king", localizedName: "Wraith King", primaryAttr: "str", attackType: "Melee", roles: ["Carry", "Durable"] },
  { id: 43, name: "npc_dota_hero_death_prophet", localizedName: "Death Prophet", primaryAttr: "int", attackType: "Ranged", roles: ["Carry", "Pusher"] },
  { id: 44, name: "npc_dota_hero_phantom_assassin", localizedName: "Phantom Assassin", primaryAttr: "agi", attackType: "Melee", roles: ["Carry", "Escape"] },
  { id: 45, name: "npc_dota_hero_pugna", localizedName: "Pugna", primaryAttr: "int", attackType: "Ranged", roles: ["Support", "Nuker"] },
  { id: 46, name: "npc_dota_hero_templar_assassin", localizedName: "Templar Assassin", primaryAttr: "agi", attackType: "Melee", roles: ["Carry", "Escape"] },
  { id: 47, name: "npc_dota_hero_viper", localizedName: "Viper", primaryAttr: "agi", attackType: "Ranged", roles: ["Carry", "Durable"] },
  { id: 48, name: "npc_dota_hero_luna", localizedName: "Luna", primaryAttr: "agi", attackType: "Melee", roles: ["Carry", "Pusher"] },
  { id: 49, name: "npc_dota_hero_dragon_knight", localizedName: "Dragon Knight", primaryAttr: "str", attackType: "Melee", roles: ["Carry", "Durable"] },
  { id: 50, name: "npc_dota_hero_dazzle", localizedName: "Dazzle", primaryAttr: "int", attackType: "Ranged", roles: ["Support", "Disabler"] },
  { id: 51, name: "npc_dota_hero_rattletrap", localizedName: "Clockwerk", primaryAttr: "str", attackType: "Melee", roles: ["Initiator", "Disabler"] },
];

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
