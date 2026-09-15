import { readFileSync } from "node:fs";
import { join } from "node:path";
import { acceptCmHeroEligibilitySnapshot } from "./eligibility";
import type { CmHeroEligibilitySnapshot, ProtocolCommand } from "./types";

// R1 S3 (final trust-boundary repair) -- THE TRUSTED SERVER/OPERATOR BOUNDARY for CM hero
// eligibility.
//
// WHY THIS MODULE EXISTS. `acceptCmHeroEligibilitySnapshot` (eligibility.ts) verifies that a
// snapshot is well-formed, self-consistent and claims OFFICIAL_DEPOT provenance. What it cannot
// verify -- what no pure function can -- is WHO IS MAKING THE CLAIM. Every field a snapshot
// carries (buildId, depotId, manifestId, sourceHash, heroIds) plus its own contentHash is
// computable by whoever writes the JSON, so a client that can reach a route accepting
// LOAD_CM_ELIGIBILITY can mint an "official" snapshot certifying any hero list it likes
// (verified: a payload with invented ids and heroIds [777, 888, 999] used to be accepted through
// POST /api/session/protocol/:id/command). Structural validation constrains the SHAPE of a claim,
// never its truth.
//
// So the authority is not the payload -- it is the boundary the payload crossed. A snapshot is
// trusted when it comes from the server/operator side (a local artifact an operator approved and
// placed on disk, a deployment bootstrap step, a future startup hook), and untrusted when it
// arrives in a request body. That distinction is what this module owns, and it is the same
// discipline every other curated input in this repo already follows (invariantes.md, "los datos
// curados se validan en el borde AL CARGARLOS"): loadHeroPositions/loadHeroCounters/
// loadCalibration all read an artifact the server side put there, never a client body.
//
// Moving the load server-side does NOT relax a single check: parseTrustedEligibilityArtifact
// still runs the full acceptCmHeroEligibilitySnapshot gate (OFFICIAL_DEPOT, appId 570, buildId /
// manifestId / sourceHash cross-consistency, fixed sourcePath, canonical contentHash, sorted
// unique positive heroIds), and the kernel still applies its own patch-range gate on top.
//
// NOT DONE HERE, deliberately: verifying a manifestId against Steam over the network. There is no
// depot in this environment, and a runtime network call from the engine would violate the "cero
// red en el camino caliente" invariant. Absent a real artifact the answer stays
// ELIGIBILITY_UNVERIFIED and Captain's Mode stays fail-closed -- which is exactly today's
// behaviour, so this repair changes no observable product behaviour.

/**
 * Commands that may NEVER be accepted from a client-facing route, however well-formed the JSON
 * is. These are not gameplay facts an adapter observed; they promote data to TRUSTED, and only
 * the server/operator side may do that.
 *
 * Deliberately a set of exactly one. RECORD_RESOLVED_BANS / BAN_RESOLUTION_COMPLETE /
 * CONFIRM_FIRST_PICK_SIDE are also `ProtocolAdminCommand`s, but their semantics are genuinely
 * "the adapter observed this happen", and the kernel validates each one against canonical state
 * -- a client asserting them can only describe its own draft, never widen what the kernel will
 * certify as legal. Privileging them too would be cargo-culting the category instead of the
 * actual trust property.
 */
const TRUSTED_SERVER_ONLY_COMMAND_TYPES = new Set<ProtocolCommand["type"]>(["LOAD_CM_ELIGIBILITY"]);

export function isTrustedServerOnlyCommand(type: ProtocolCommand["type"]): boolean {
  return TRUSTED_SERVER_ONLY_COMMAND_TYPES.has(type);
}

/**
 * Where an operator drops the approved artifact. `apps/engine/data/` is gitignored in full, so
 * this file is never committed and never arrives through a PR -- it is placed by whoever operates
 * the deployment, which is the whole point. Absent by default => CM fail-closed by default.
 *
 * Produced by `bun scripts/cm-eligibility/build-snapshot.ts --vpk <pak01_dir.vpk> --patch ...
 * --build-id ... --depot-id ... --manifest-id ...` on a machine that actually has the Dota 2
 * depot; that script refuses to emit OFFICIAL_DEPOT provenance without all four identifiers, and
 * its demo mode emits DEMO_FIXTURE, which this loader rejects.
 */
export const DEFAULT_TRUSTED_ELIGIBILITY_ARTIFACT_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "data",
  "cm-hero-eligibility.json",
);

/**
 * Full validation of an artifact the SERVER side obtained. Pure: exported separately from the
 * disk read so tests use inline fixtures and never the real artifact (same seam discipline as
 * parseHeroPositions/parseCalibration). Returns null on any failure -- malformed, non-official
 * provenance, or tampered hash are all indistinguishable to the caller, exactly as
 * acceptCmHeroEligibilitySnapshot intends.
 */
export function parseTrustedEligibilityArtifact(raw: unknown): CmHeroEligibilitySnapshot | null {
  return acceptCmHeroEligibilitySnapshot(raw);
}

/**
 * Reads the approved artifact from disk. Missing file, unreadable file, invalid JSON or a
 * snapshot that fails any check all degrade to `null` -- never throws, so a bad artifact can
 * never stop the engine from booting. `null` means "no certified eligibility", which leaves
 * Captain's Mode fail-closed rather than falling back to the global hero catalog.
 */
export function loadTrustedEligibilityArtifact(
  path: string = DEFAULT_TRUSTED_ELIGIBILITY_ARTIFACT_PATH,
): CmHeroEligibilitySnapshot | null {
  try {
    return parseTrustedEligibilityArtifact(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return null;
  }
}
