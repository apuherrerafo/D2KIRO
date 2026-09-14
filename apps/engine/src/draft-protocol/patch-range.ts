// R1 S1 -- Blocker 4B (independent architecture review): patch compatibility check for
// LOAD_CM_ELIGIBILITY. A snapshot's own contentHash integrity says nothing about whether it was
// captured for a patch this ruleset is actually verified against -- a perfectly well-formed,
// perfectly self-consistent snapshot for the WRONG patch must still be rejected. Pure, no I/O.
//
// Dota patch strings in this repo (see RulesetIdentity.applicableFromPatch/verifiedThroughPatch)
// take the shape "<major>.<minor>[<letter-suffix>]", e.g. "7.35d", "7.40", "7.41e". A missing
// suffix sorts before any letter suffix (the base release precedes its own hotfixes: 7.41 <
// 7.41a < 7.41b), which plain string comparison of the suffix already gives for free ("" < "a").

interface ParsedPatch {
  major: number;
  minor: number;
  suffix: string;
}

const PATCH_PATTERN = /^(\d+)\.(\d+)([a-z]*)$/;

function parsePatch(patch: string): ParsedPatch | null {
  const match = PATCH_PATTERN.exec(patch.trim());
  if (!match) return null;
  const [, majorStr, minorStr, suffix] = match;
  return { major: Number(majorStr), minor: Number(minorStr), suffix: suffix ?? "" };
}

function comparePatch(a: ParsedPatch, b: ParsedPatch): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.suffix === b.suffix) return 0;
  return a.suffix < b.suffix ? -1 : 1;
}

/**
 * Fail-closed: a malformed patch string on ANY side (the candidate, or the ruleset's own declared
 * range) is never "compatible" -- there is no partial/best-effort comparison, only a clean
 * in-range/out-of-range/unparseable-therefore-rejected result.
 */
export function isPatchWithinRange(patch: string, fromPatch: string, throughPatch: string): boolean {
  const candidate = parsePatch(patch);
  const from = parsePatch(fromPatch);
  const through = parsePatch(throughPatch);
  if (!candidate || !from || !through) return false;
  return comparePatch(candidate, from) >= 0 && comparePatch(candidate, through) <= 0;
}
