import { describe, expect, test } from "bun:test";
import { parseKeyValues } from "./kv-parser";
import { buildCmHeroEligibilitySnapshot, deriveEligibleHeroIds, parseNpcHeroEntries } from "./npc-heroes";

// Representative fixture in the real npc_heroes.txt shape -- NOT real Valve data (this
// environment has no Steam depot/VPK access, S3.4). Deliberately includes every edge case the
// eligibility rule (HeroID > 0 && Enabled == 1 && CMEnabled == 1) needs to handle: the templated
// base entry with no HeroID, an explicitly disabled hero, a hero explicitly excluded from CM but
// otherwise enabled, and the common case (both flags absent -> default enabled).
const FIXTURE_NPC_HEROES_TXT = `
"DOTAHeroes"
{
  "Version" "1"

  "npc_dota_hero_base"
  {
    "BaseClass" "npc_dota_hero"
    // no HeroID on the template entry -- real files have this
  }

  "npc_dota_hero_antimage"
  {
    "HeroID" "1"
    "Ability1" "antimage_mana_break"
  }

  "npc_dota_hero_axe"
  {
    "HeroID" "2"
  }

  "npc_dota_hero_disabled_test"
  {
    "HeroID" "9001"
    "Enabled" "0"
  }

  "npc_dota_hero_cm_excluded_test"
  {
    "HeroID" "9002"
    "CMEnabled" "0"
  }

  "npc_dota_hero_duplicate_ref"
  {
    "HeroID" "1"
  }
}
`;

describe("parseNpcHeroEntries + deriveEligibleHeroIds -- S3.4 (fixture, not real Valve data)", () => {
  test("extrae todas las entradas npc_dota_hero_*, incluida la plantilla base sin HeroID", () => {
    const entries = parseNpcHeroEntries(parseKeyValues(FIXTURE_NPC_HEROES_TXT));
    const names = entries.map((e) => e.internalName);
    expect(names).toContain("npc_dota_hero_base");
    expect(names).toContain("npc_dota_hero_antimage");
    const base = entries.find((e) => e.internalName === "npc_dota_hero_base")!;
    expect(base.heroId).toBeNull();
  });

  test("Enabled/CMEnabled ausentes por defecto a true (convención real de Valve)", () => {
    const entries = parseNpcHeroEntries(parseKeyValues(FIXTURE_NPC_HEROES_TXT));
    const axe = entries.find((e) => e.internalName === "npc_dota_hero_axe")!;
    expect(axe.enabled).toBe(true);
    expect(axe.cmEnabled).toBe(true);
  });

  test("regla efectiva: HeroID > 0 && Enabled == 1 && CMEnabled == 1", () => {
    const entries = parseNpcHeroEntries(parseKeyValues(FIXTURE_NPC_HEROES_TXT));
    const eligible = deriveEligibleHeroIds(entries);
    expect(eligible).toContain(1);
    expect(eligible).toContain(2);
    expect(eligible).not.toContain(9001); // Enabled 0
    expect(eligible).not.toContain(9002); // CMEnabled 0
  });

  test("plantilla base (heroId null) nunca aparece como elegible, sin lanzar", () => {
    const entries = parseNpcHeroEntries(parseKeyValues(FIXTURE_NPC_HEROES_TXT));
    const eligible = deriveEligibleHeroIds(entries);
    expect(eligible.every((id) => id > 0)).toBe(true);
  });

  test("heroIds resultante está ordenado y sin duplicados aunque dos entradas compartan HeroID", () => {
    const entries = parseNpcHeroEntries(parseKeyValues(FIXTURE_NPC_HEROES_TXT));
    const eligible = deriveEligibleHeroIds(entries); // antimage y duplicate_ref comparten HeroID 1
    expect(eligible).toEqual([...eligible].sort((a, b) => a - b));
    expect(new Set(eligible).size).toBe(eligible.length);
    expect(eligible.filter((id) => id === 1)).toHaveLength(1);
  });
});

describe("buildCmHeroEligibilitySnapshot", () => {
  test("produce un snapshot bien formado y con integridad verificable", async () => {
    const { verifyEligibilitySnapshotIntegrity } = await import("../../apps/engine/src/draft-protocol/eligibility");
    const entries = parseNpcHeroEntries(parseKeyValues(FIXTURE_NPC_HEROES_TXT));
    const snapshot = buildCmHeroEligibilitySnapshot(entries, {
      patch: "7.41e",
      buildId: "test-build-0001",
      depotManifests: { "570": "fixture-manifest-hash" },
      sourceHashes: { npc_heroes: "fixture-source-hash" },
    });
    expect(snapshot.schema).toBe("cm-hero-eligibility/v1");
    expect(snapshot.heroIds).toEqual([1, 2]);
    expect(verifyEligibilitySnapshotIntegrity(snapshot)).toBe(true);
  });

  test("el snapshot resultante es aceptado por el kernel real (acceptCmHeroEligibilitySnapshot) cuando el patch está en rango", async () => {
    const { acceptCmHeroEligibilitySnapshot } = await import("../../apps/engine/src/draft-protocol/eligibility");
    const entries = parseNpcHeroEntries(parseKeyValues(FIXTURE_NPC_HEROES_TXT));
    const snapshot = buildCmHeroEligibilitySnapshot(entries, {
      patch: "7.41e",
      buildId: "test-build-0001",
      depotManifests: { "570": "fixture-manifest-hash" },
      sourceHashes: { npc_heroes: "fixture-source-hash" },
    });
    expect(acceptCmHeroEligibilitySnapshot(snapshot)).not.toBeNull();
  });

  test("un snapshot manipulado después de construido falla la verificación de integridad", async () => {
    const { verifyEligibilitySnapshotIntegrity } = await import("../../apps/engine/src/draft-protocol/eligibility");
    const entries = parseNpcHeroEntries(parseKeyValues(FIXTURE_NPC_HEROES_TXT));
    const snapshot = buildCmHeroEligibilitySnapshot(entries, {
      patch: "7.41e",
      buildId: "test-build-0001",
      depotManifests: { "570": "fixture-manifest-hash" },
      sourceHashes: { npc_heroes: "fixture-source-hash" },
    });
    // Content changed (an extra hero id) but contentHash left stale -- exactly the tamper case
    // verifyEligibilitySnapshotIntegrity exists to catch.
    const tampered = { ...snapshot, heroIds: [...snapshot.heroIds, 999] };
    expect(verifyEligibilitySnapshotIntegrity(tampered)).toBe(false);
  });
});
