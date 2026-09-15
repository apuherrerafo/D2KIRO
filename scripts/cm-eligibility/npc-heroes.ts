// R1 S3.4 -- npc_heroes.txt -> CmHeroEligibilitySnapshot.
//
// Effective eligibility rule (frozen future authority, apps/engine/src/draft-protocol/
// eligibility.ts): HeroID > 0 && Enabled == 1 && CMEnabled == 1. This file reads the KV tree
// kv-parser.ts produces, applies exactly that rule, and assembles the canonical
// `cm-hero-eligibility/v1` artifact using the KERNEL'S OWN hashing function
// (computeEligibilityContentHash, apps/engine/src/draft-protocol/eligibility.ts) so the artifact
// this tool produces is guaranteed byte-compatible with what acceptCmHeroEligibilitySnapshot
// verifies at LOAD_CM_ELIGIBILITY time -- no second hash implementation to drift out of sync.
//
// Importing FROM apps/engine/src is fine here (this is the same "read the engine's code to
// measure/build something offline" posture scripts/eval already uses, invariantes.md/fase-9.md:
// "leer código del motor como import ... está permitido, escribir en él no"). The one-way rule is
// apps/** never importing scripts/**, not the reverse.

import { computeEligibilityContentHash } from "../../apps/engine/src/draft-protocol/eligibility";
import type { CmHeroEligibilitySnapshot, HeroId } from "../../apps/engine/src/draft-protocol/types";
import { kvChild, kvChildEntries, kvString, type KvNode } from "./kv-parser";

export interface NpcHeroEntry {
  internalName: string;
  heroId: HeroId | null;
  enabled: boolean;
  cmEnabled: boolean;
}

function parseKvBoolean(value: string | null, defaultValue: boolean): boolean {
  if (value === null) return defaultValue;
  return value === "1" || value.toLowerCase() === "true";
}

/**
 * Reads every `npc_dota_hero_*` block under the DOTAHeroes root. A block missing HeroID entirely
 * (e.g. the "npc_dota_hero_base" template entry real npc_heroes.txt files carry) yields
 * `heroId: null` and is never eligible -- never coerced to 0 or skipped silently, so a caller
 * auditing the full entry list can see exactly why it was excluded.
 *
 * Valve's real file leaves `Enabled`/`CMEnabled` ABSENT for the overwhelming majority of hero
 * blocks (their default is enabled) -- only heroes actively disabled or CM-excluded carry an
 * explicit `"0"`. Both default to true when absent, matching that convention.
 */
export function parseNpcHeroEntries(root: KvNode): NpcHeroEntry[] {
  const heroesNode = kvChild(root, "DOTAHeroes") ?? root; // tolerate being handed the DOTAHeroes node directly
  return kvChildEntries(heroesNode)
    .filter(([internalName]) => internalName.startsWith("npc_dota_hero_"))
    .map(([internalName, block]) => {
      const heroIdRaw = kvString(block, "HeroID");
      const heroId = heroIdRaw !== null && /^-?\d+$/.test(heroIdRaw) ? Number(heroIdRaw) : null;
      return {
        internalName,
        heroId,
        enabled: parseKvBoolean(kvString(block, "Enabled"), true),
        cmEnabled: parseKvBoolean(kvString(block, "CMEnabled"), true),
      };
    });
}

/** HeroID > 0 && Enabled == 1 && CMEnabled == 1 -- the one frozen effective rule, applied nowhere else. */
export function deriveEligibleHeroIds(entries: readonly NpcHeroEntry[]): HeroId[] {
  const eligible = entries
    .filter((entry) => entry.heroId !== null && entry.heroId > 0 && entry.enabled && entry.cmEnabled)
    .map((entry) => entry.heroId as HeroId);
  return [...new Set(eligible)].sort((a, b) => a - b);
}

export interface SnapshotSourceMetadata {
  patch: string;
  buildId: string;
  /** Must include a "570" key (Blocker 4B, eligibility.ts) -- the depot this content came from. */
  depotManifests: Record<string, string>;
  /** Must include an "npc_heroes" key (Blocker 4B) -- typically a hash of the raw file bytes. */
  sourceHashes: Record<string, string>;
}

/**
 * Assembles a complete, self-consistent CmHeroEligibilitySnapshot (contentHash included) ready
 * for LOAD_CM_ELIGIBILITY. `heroIds.length === 0` still produces a well-formed object -- the
 * caller decides whether an empty-eligibility snapshot is acceptable to publish (it wouldn't be,
 * for real data; it's a legitimate edge case for a deliberately-empty test fixture).
 */
export function buildCmHeroEligibilitySnapshot(
  entries: readonly NpcHeroEntry[],
  metadata: SnapshotSourceMetadata,
): CmHeroEligibilitySnapshot {
  const heroIds = deriveEligibleHeroIds(entries);
  const withoutHash: Omit<CmHeroEligibilitySnapshot, "contentHash"> = {
    schema: "cm-hero-eligibility/v1",
    appId: 570,
    patch: metadata.patch,
    buildId: metadata.buildId,
    depotManifests: metadata.depotManifests,
    sourceHashes: metadata.sourceHashes,
    heroIds,
  };
  return { ...withoutHash, contentHash: computeEligibilityContentHash(withoutHash) };
}
