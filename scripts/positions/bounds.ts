// Certification remediation (Phase A, A2) -- what the FLOOR-TRUNCATED legacy `hero-positions.json` can and cannot prove.
//
// The legacy collection step discarded every (hero, position) row below `MIN_POSITION_MATCHES` before saving, so for each
// hero the file holds the exact counts of the listed positions and NOTHING about the unlisted ones -- except that each of
// them is < the floor (that is why it was dropped). That is enough for a rigorous bound, and not more:
//
//   listedTotal            S = sum of the listed positions (exact)
//   unlistedPositions      k = 5 - listed.length            (each true count is in [0, floor-1])
//   true denominator       T in [S, S + k*(floor-1)]
//   true share of listed p    in [m_p / (S + k*(floor-1)),  m_p / S]        <- m_p / S is what the legacy code used
//
// The legacy share is therefore an UPPER bound. A DOMINANT position stays dominant for any T (a listed count >= floor
// beats every unlisted count < floor), so only admission-by-share (`share >= MID_CANDIDATE_MIN_SHARE`) can flip, and only
// downward: corrected shares are <= legacy shares, and the floor still excludes unlisted positions from admission -- the
// corrected candidate universe is a SUBSET of the legacy one. A share admission whose LOWER bound already clears the
// threshold is PROVEN; one whose interval straddles it is UNPROVEN: only the raw sub-floor counts can decide it.
//
// Pure: no I/O, no policy numbers of its own (every constant and the admission predicate come from the engine module).
import {
  isCredibleForPosition,
  MID_CANDIDATE_MIN_SHARE,
  MIN_POSITION_MATCHES,
  parseHeroPositions,
  type HeroPositions,
} from "../../apps/engine/src/signals/hero-positions";

export type Position = 1 | 2 | 3 | 4 | 5;
export const POSITIONS: readonly Position[] = [1, 2, 3, 4, 5];

export type AdmissionGrade =
  /** Admitted because it is the hero's dominant listed position -- provably unaffected by any denominator. */
  | "dominant"
  /** Admitted by share and the share stays >= threshold even at the widest possible denominator. */
  | "proven-by-share"
  /** Admitted by share on the legacy (upper-bound) share, but the share could be < threshold: needs the raw counts. */
  | "unproven-by-share"
  /** Not admitted even by the legacy rule (so no denominator can admit it). */
  | "not-admitted";

export interface PositionBound {
  hero: number;
  position: Position;
  matches: number;
  listedTotal: number;
  unlistedPositions: number;
  /** Legacy share (m/S): an upper bound of the true share. */
  shareUpper: number;
  /** Share at the widest possible denominator: a lower bound of the true share. */
  shareLower: number;
  grade: AdmissionGrade;
}

export function classifyLegacyPositions(legacy: unknown): PositionBound[] {
  const positions: HeroPositions = parseHeroPositions(legacy);
  const out: PositionBound[] = [];
  for (const heroKey of Object.keys(positions).map(Number).sort((a, b) => a - b)) {
    const shares = positions[heroKey]!;
    const listedTotal = shares.reduce((sum, share) => sum + share.matches, 0);
    const unlistedPositions = POSITIONS.length - shares.length;
    const widest = listedTotal + unlistedPositions * (MIN_POSITION_MATCHES - 1);
    const dominant = Math.max(...shares.map((share) => share.matches));
    for (const share of [...shares].sort((a, b) => a.position - b.position)) {
      const admitted = isCredibleForPosition(heroKey, share.position, positions);
      const shareLower = share.matches / widest;
      let grade: AdmissionGrade = "not-admitted";
      if (admitted) grade = share.matches === dominant ? "dominant" : shareLower >= MID_CANDIDATE_MIN_SHARE ? "proven-by-share" : "unproven-by-share";
      out.push({ hero: heroKey, position: share.position, matches: share.matches, listedTotal, unlistedPositions, shareUpper: share.matches / listedTotal, shareLower, grade });
    }
  }
  return out;
}

export interface UniverseSummary {
  position: Position;
  /** Legacy admission (the universe the certified Coach used). */
  legacy: number;
  /** Admissions that no denominator can overturn (dominant + proven-by-share): the guaranteed core of the corrected universe. */
  guaranteed: number;
  /** Admissions that only the raw sub-floor counts can confirm or remove. */
  unproven: number;
}

export function summarizeUniverse(bounds: readonly PositionBound[]): UniverseSummary[] {
  return POSITIONS.map((position) => {
    const admitted = bounds.filter((b) => b.position === position && b.grade !== "not-admitted");
    const unproven = admitted.filter((b) => b.grade === "unproven-by-share").length;
    return { position, legacy: admitted.length, guaranteed: admitted.length - unproven, unproven };
  });
}

/**
 * SENSITIVITY ENVELOPE, NOT DATA: the same floor-truncated positions with every hero's denominator set to its widest possible value
 * (`S + k*(floor-1)`), i.e. the most pessimistic share every listed position could have. Real corrected data lies between the legacy
 * shares (the other extreme) and this. Used only to measure how much a decision could move if the raw counts turned out worst-case;
 * anything generated from it must say so.
 */
export function withWidestDenominator(positions: HeroPositions): HeroPositions {
  const out: HeroPositions = {};
  for (const heroKey of Object.keys(positions).map(Number)) {
    const shares = positions[heroKey]!;
    const listedTotal = shares.reduce((sum, share) => sum + share.matches, 0);
    const widest = listedTotal + (POSITIONS.length - shares.length) * (MIN_POSITION_MATCHES - 1);
    out[heroKey] = shares.map((share) => ({ ...share, heroTotalMatches: widest }));
  }
  return out;
}
