import { eligibilityHash } from "./identity-hash";
import { isValidHeroId } from "./hero-id";
import { deepClone } from "./immutable";
import type { CmHeroEligibilitySnapshot, HeroId } from "./types";

// Required keys, part of Blocker 4B's "required source identity" check: a snapshot must name the
// specific depot (by appId) and the specific source file (npc_heroes.txt, the frozen future
// authority named in the module doc above) it claims to be derived from -- an empty {} for either
// field structurally validates as a well-typed Record<string,string> but identifies no source at
// all.
const REQUIRED_DEPOT_MANIFEST_KEY = "570";
const REQUIRED_SOURCE_HASH_KEY = "npc_heroes";

// R1 S1 -- CM Hero Eligibility, canonical SNAPSHOT CONTRACT + validation + fail-closed
// integration. Frozen future authority: Steam app 570 official client data
// (game/dota/pak01_dir.vpk, scripts/npc/npc_heroes.txt), effective rule
// HeroID > 0 && Enabled == 1 && CMEnabled == 1.
//
// S1 scope deliberately stops at the contract + validator: no VPK extraction pipeline exists in
// this repo today and building one is out of scope for this slice. Without a snapshot loaded via
// the LOAD_CM_ELIGIBILITY command, the kernel serves NO certified Captain's Mode hero action --
// it never falls back to the global hero catalog (that would silently certify heroes that are
// disabled or not CM-legal). This follows the exact loader discipline already established for
// hero-positions.json/hero-counters.json/capabilities.json (invariantes.md, "Los datos curados se
// validan en el borde al cargarlos"): parse is exported separately from any future loader so
// tests use synthetic fixtures, corrupt input degrades rather than throws, and nothing here
// invents a fallback magnitude.

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}

/**
 * Blocker 4B: "required source identity" -- a `depotManifests`/`sourceHashes` record that is
 * merely well-typed (all-string values) is not enough; it must actually carry the specific keys
 * that identify WHICH depot/file this snapshot claims to be derived from. Without this, `{}`
 * would structurally validate as a legitimate "source identity" for nothing at all.
 */
function isStringRecordWithRequiredKey(value: unknown, requiredKey: string): value is Record<string, string> {
  if (!isStringRecord(value)) return false;
  return isNonEmptyString(value[requiredKey]);
}

function isOrderedUniquePositiveHeroIds(value: unknown): value is HeroId[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  let previous = -Infinity;
  for (const entry of value) {
    if (!isValidHeroId(entry)) return false;
    if (entry <= previous) return false; // strictly ascending -> ordered AND unique in one pass
    previous = entry;
  }
  return true;
}

/**
 * Structural validation only (shape, types, uniqueness, order, required source identity) -- does
 * NOT verify contentHash integrity. Exported separately so callers can distinguish "malformed"
 * from "well-formed but tampered." Blocker 2: every nested mutable field (depotManifests,
 * sourceHashes, heroIds) is deep-cloned into the returned value -- the caller's original `raw`
 * object must never be aliased by the parsed result, or mutating `raw` after acceptance would
 * silently corrupt whatever state this snapshot gets attached to.
 */
export function parseCmHeroEligibilitySnapshot(raw: unknown): CmHeroEligibilitySnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (value.schema !== "cm-hero-eligibility/v1") return null;
  if (value.appId !== 570) return null;
  if (!isNonEmptyString(value.patch)) return null;
  if (!isNonEmptyString(value.buildId)) return null;
  if (!isStringRecordWithRequiredKey(value.depotManifests, REQUIRED_DEPOT_MANIFEST_KEY)) return null;
  if (!isStringRecordWithRequiredKey(value.sourceHashes, REQUIRED_SOURCE_HASH_KEY)) return null;
  if (!isOrderedUniquePositiveHeroIds(value.heroIds)) return null;
  if (!isNonEmptyString(value.contentHash)) return null;
  return deepClone({
    schema: "cm-hero-eligibility/v1",
    appId: 570,
    patch: value.patch as string,
    buildId: value.buildId as string,
    depotManifests: value.depotManifests as Record<string, string>,
    sourceHashes: value.sourceHashes as Record<string, string>,
    heroIds: value.heroIds as HeroId[],
    contentHash: value.contentHash as string,
  });
}

/**
 * Recomputes contentHash over every field except contentHash itself and compares. A snapshot
 * whose stated contentHash doesn't match its own content is treated as corrupt -- same fail-closed
 * posture as a malformed file, never trusted partially.
 */
export function computeEligibilityContentHash(
  snapshot: Omit<CmHeroEligibilitySnapshot, "contentHash">,
): string {
  return eligibilityHash(snapshot);
}

export function verifyEligibilitySnapshotIntegrity(snapshot: CmHeroEligibilitySnapshot): boolean {
  try {
    return computeEligibilityContentHash(snapshot) === snapshot.contentHash;
  } catch {
    // The private canonical hash rejects non-finite numbers/undefined (Blocker 5) -- a snapshot that
    // trips that guard is exactly as untrustworthy as one with a mismatched hash. Fail closed,
    // never throw out of an integrity check.
    return false;
  }
}

/**
 * Single entry point combining structural validation + integrity verification. Returns null on
 * any failure (malformed shape OR hash mismatch) -- callers must treat null identically to
 * "no snapshot available" (ELIGIBILITY_UNVERIFIED), never distinguish malformed-vs-absent in a
 * way that would let one degrade less safely than the other.
 */
export function acceptCmHeroEligibilitySnapshot(raw: unknown): CmHeroEligibilitySnapshot | null {
  const parsed = parseCmHeroEligibilitySnapshot(raw);
  if (parsed === null) return null;
  if (!verifyEligibilitySnapshotIntegrity(parsed)) return null;
  return parsed;
}

export function isHeroEligible(snapshot: CmHeroEligibilitySnapshot, heroId: HeroId): boolean {
  return snapshot.heroIds.includes(heroId);
}
