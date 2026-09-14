import { canonicalHash } from "./hash";
import type { CmHeroEligibilitySnapshot, HeroId } from "./types";

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

function isOrderedUniquePositiveHeroIds(value: unknown): value is HeroId[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const seen = new Set<number>();
  for (const entry of value) {
    if (!Number.isInteger(entry) || (entry as number) <= 0) return false;
    if (seen.has(entry as number)) return false;
    seen.add(entry as number);
  }
  return true;
}

/**
 * Structural validation only (shape, types, uniqueness) -- does NOT verify contentHash integrity.
 * Exported separately so callers can distinguish "malformed" from "well-formed but tampered."
 */
export function parseCmHeroEligibilitySnapshot(raw: unknown): CmHeroEligibilitySnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (value.schema !== "cm-hero-eligibility/v1") return null;
  if (value.appId !== 570) return null;
  if (!isNonEmptyString(value.patch)) return null;
  if (!isNonEmptyString(value.buildId)) return null;
  if (!isStringRecord(value.depotManifests)) return null;
  if (!isStringRecord(value.sourceHashes)) return null;
  if (!isOrderedUniquePositiveHeroIds(value.heroIds)) return null;
  if (!isNonEmptyString(value.contentHash)) return null;
  return {
    schema: "cm-hero-eligibility/v1",
    appId: 570,
    patch: value.patch as string,
    buildId: value.buildId as string,
    depotManifests: value.depotManifests as Record<string, string>,
    sourceHashes: value.sourceHashes as Record<string, string>,
    heroIds: value.heroIds as HeroId[],
    contentHash: value.contentHash as string,
  };
}

/**
 * Recomputes contentHash over every field except contentHash itself and compares. A snapshot
 * whose stated contentHash doesn't match its own content is treated as corrupt -- same fail-closed
 * posture as a malformed file, never trusted partially.
 */
export function computeEligibilityContentHash(
  snapshot: Omit<CmHeroEligibilitySnapshot, "contentHash">,
): string {
  return canonicalHash({
    schema: snapshot.schema,
    appId: snapshot.appId,
    patch: snapshot.patch,
    buildId: snapshot.buildId,
    depotManifests: snapshot.depotManifests,
    sourceHashes: snapshot.sourceHashes,
    heroIds: snapshot.heroIds,
  });
}

export function verifyEligibilitySnapshotIntegrity(snapshot: CmHeroEligibilitySnapshot): boolean {
  return computeEligibilityContentHash(snapshot) === snapshot.contentHash;
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
