import { canonicalHash, functionalIdentityHash, type CanonicalValue } from "./hash";
import type { CmHeroEligibilitySnapshot, DraftProtocolState, PerspectiveDraftView } from "./types";

// R1 S1 -- Blocker 5 (independent architecture review): named, purpose-specific hash APIs.
// hash.ts's canonicalHash/functionalIdentityHash are generic primitives that accept ANY
// CanonicalValue -- nothing about their signature stops a caller from hashing full authoritative
// state (which can contain currently-HIDDEN information) and treating the result as something
// safe to hand to a client as a cheap "state fingerprint". That is a real leak: the hero ID space
// is small (~126 heroes), so a hash of a single hidden heroId is trivially brute-forceable by the
// opponent, defeating the entire hidden-information design in perspective.ts.
//
// These four functions are the sanctioned public surface for hashing draft-protocol values. Each
// name states exactly what may be hashed and, by construction, what may safely be done with the
// result -- there is no single ambiguous "hash(x)" a caller could misuse across those boundaries.

/**
 * Hash of the FULL authoritative DraftProtocolState, including any currently-hidden information
 * (e.g. an opponent's sealed-but-unrevealed Ranked All Pick selection). NEVER send this value to
 * a client/perspective consumer -- see the module doc above. Server-side only: replay-determinism
 * assertions, internal audit/logging, test equality checks.
 */
export function authoritativeStateHash(state: DraftProtocolState): string {
  return functionalIdentityHash(state as unknown as CanonicalValue);
}

/**
 * Hash of a PerspectiveDraftView -- already redacted for one viewer (HIDDEN slots structurally
 * carry no heroId, per types.ts). Safe to compute for, and expose to, the viewer it was projected
 * for: used for the hidden-twin equality property and any future client-side view caching/dedup.
 */
export function perspectiveStateHash(view: PerspectiveDraftView): string {
  return functionalIdentityHash(view as unknown as CanonicalValue);
}

/**
 * Hash of a ruleset's own canonical manifest (phases/capacities/timers/collision policy for AP,
 * the 24-step sequence + clock contract for CM). This is the exact mechanism RulesetIdentity.
 * rulesHash/sourceManifestHash are precomputed with as module constants in rulesets/*.ts; exposed
 * here as a named, reusable primitive for any future caller that needs to hash an
 * arbitrary manifest-shaped value the same way (e.g. verifying a manifest before trusting it) --
 * never for hashing draft state.
 */
export function rulesHash(manifest: CanonicalValue): string {
  return canonicalHash(manifest);
}

/**
 * Hash of a CmHeroEligibilitySnapshot's content (every field except contentHash itself) -- the
 * same mechanism computeEligibilityContentHash/verifyEligibilitySnapshotIntegrity (eligibility.ts)
 * already use to seal a snapshot's integrity. Exposed under this name so eligibility hashing is
 * never confused with, or accidentally substituted for, state or perspective hashing.
 */
export function eligibilityHash(snapshot: Omit<CmHeroEligibilitySnapshot, "contentHash">): string {
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
