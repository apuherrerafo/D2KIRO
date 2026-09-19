import type { HeroId } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { Recommendation, RecommendationRoleImpact, RoleImpactStatus, RecommendationSetV2 } from "../recommendation/types";
import type { HeroPositions } from "../signals/hero-positions";
import type { SignalContribution, SignalId } from "../signals/types";

// AP Ranked Roles V1 / Wave 2 (task 17) -- HeroCard / HeroBadge and the per-hero projection of a
// RecommendationSetV2.
//
// Level 2 of the Coach ("which concrete heroes are good options?") is the existing V6 ranking. This
// file only RESHAPES it per hero: nothing is re-scored, re-ranked or re-inferred. A hero's score is
// the sum of its own `signalsByHero[hero][].weighted` (V6's CP10 invariant: score == sum of
// contributions), so it is exactly the number V6 assigned that hero -- also inside a compound
// (two-hero) recommendation, whose own `score` is the plain sum of the pair.
//
// BADGES are evidence, never identity heuristics, and use NO numeric threshold of this wave's own.
// They reuse the rules V6 already applies when it decides which signals to CITE (signals/mix.ts
// buildEvidence / buildReason): a signal counts when it voted with its own data (`raw !== null`) and
// contributed (`weighted > 0`); counter and synergy additionally require a positive `raw` (the
// existing `counterContributed` / `synergyContributed` rule). FLEX is the repo's own definition (the
// curated catalog registers the hero in two or more positions -- mix.ts flexibilityReason). No badge
// for anything Wave 3/4 owns (SAFE, GOOD_ON_SIDE, COUNTERS_BANNED); the pool badges are computed only
// when a pool is actually supplied, which Wave 2 never does.

export type Confidence = "alta" | "media" | "baja";

export type HeroBadge =
  | "COUNTER" // counter contributed with real matchup data (raw > 0)
  | "SYNERGY" // team_synergy contributed with real data (raw > 0)
  | "POSITION_FIT" // position_fit contributed with real data
  | "META" // patch_meta contributed with real data, and the meta snapshot is not stale
  | "FLEX" // the curated catalog registers the hero in 2+ positions
  | "YOUR_POOL" // Wave 3: only when a Hero Pool is supplied
  | "OUTSIDE_YOUR_POOL"; // Wave 3: only when a Hero Pool is supplied and the hero is not in it

export interface HeroCard {
  heroId: HeroId;
  /** Primary inferred position. Read `roleStatus` before presenting it as a fact. */
  position: Position;
  /** How much the position above is worth: an UNRESOLVED role must never be shown as certain. */
  roleStatus: RoleImpactStatus;
  confidence: Confidence;
  badges: HeroBadge[];
  /** One short phrase taken from the hero's strongest real signal -- never invented. */
  rationale: string;
  /** V6 score (internal ranking; the UI may not show it). */
  score: number;
  isFromPool: boolean;
}

const POSITIONS: readonly Position[] = [1, 2, 3, 4, 5];

const SIGNAL_BADGES: Partial<Record<SignalId, HeroBadge>> = {
  counter: "COUNTER",
  team_synergy: "SYNERGY",
  position_fit: "POSITION_FIT",
  patch_meta: "META",
};

/** Signals whose citation needs a positive `raw` (V6's existing counterContributed / synergyContributed). */
const NEEDS_POSITIVE_RAW: ReadonlySet<SignalId> = new Set<SignalId>(["counter", "team_synergy"]);

/**
 * The repo's definition of Flex: the curated catalog registers the hero in two or more positions
 * (signals/mix.ts flexibilityReason). Positions ordered by how often the hero played them. Empty when
 * not Flex, or when no curated evidence was supplied.
 */
export function curatedFlexPositions(heroId: HeroId, heroPositions: HeroPositions | undefined): Position[] {
  const shares = heroPositions?.[heroId] ?? [];
  if (shares.length < 2) return [];
  return [...shares].sort((a, b) => b.matches - a.matches || a.position - b.position).map((share) => share.position);
}

/** Primary inferred position: the resolved one when the engine has it, otherwise the most likely marginal. */
export function primaryPosition(impact: RecommendationRoleImpact): Position {
  if (impact.position !== null) return impact.position;
  let best: Position = 1;
  for (const position of POSITIONS) if (impact.marginals[position] > impact.marginals[best]) best = position;
  return best;
}

/** V6's own "informative signal" rule: voted with its own data and contributed. */
function votedWithData(signal: SignalContribution): boolean {
  return signal.raw !== null && signal.applicable !== false && signal.weighted > 0;
}

/**
 * Badges for ONE hero of a recommendation (a compound recommendation names two heroes -- pass the
 * one you want). Pure; the badge set is a function of the recommendation's own evidence only.
 */
export function deriveHeroBadges(
  recommendation: Recommendation,
  heroPool: readonly HeroId[],
  heroId: HeroId = recommendation.actions[0]!.hero,
  flexPositions: readonly Position[] = [],
): HeroBadge[] {
  const badges: HeroBadge[] = [];
  const metaStale = recommendation.risks.some((risk) => risk.kind === "degraded_meta");

  for (const signal of recommendation.signalsByHero[heroId] ?? []) {
    const badge = SIGNAL_BADGES[signal.signal];
    if (!badge || !votedWithData(signal)) continue;
    if (NEEDS_POSITIVE_RAW.has(signal.signal) && (signal.raw ?? 0) <= 0) continue;
    if (badge === "META" && metaStale) continue;
    badges.push(badge);
  }

  if (flexPositions.length >= 2) badges.push("FLEX");

  if (heroPool.length > 0) badges.push(heroPool.includes(heroId) ? "YOUR_POOL" : "OUTSIDE_YOUR_POOL");
  return badges;
}

// ---------------------------------------------------------------------------------------------
// Per-hero projection of a RecommendationSetV2
// ---------------------------------------------------------------------------------------------

export interface HeroCandidate {
  heroId: HeroId;
  score: number;
  confidence: Confidence;
  position: Position;
  roleStatus: RoleImpactStatus;
  /** 2+ curated positions when the hero is Flex by the repo's definition, else empty. */
  flexPositions: Position[];
  signals: readonly SignalContribution[];
  /** The best-ranked recommendation that names this hero (carries evidence/risks). */
  recommendation: Recommendation;
}

function scoreOf(signals: readonly SignalContribution[]): number {
  return signals.reduce((sum, signal) => sum + signal.weighted, 0);
}

/**
 * Distinct heroes named anywhere in the set, best V6 score first (ties keep set order). A compound
 * recommendation's `confidence` is already the lower of its two heroes' tiers (build.ts), which is
 * the honest per-hero label available here -- never upgraded.
 */
export function extractHeroCandidates(set: RecommendationSetV2, heroPositions?: HeroPositions): HeroCandidate[] {
  const seen = new Set<HeroId>();
  const out: HeroCandidate[] = [];
  for (const recommendation of set.recommendations) {
    for (const action of recommendation.actions) {
      if (seen.has(action.hero)) continue;
      seen.add(action.hero);
      const impact = recommendation.roleImpact[action.hero];
      const signals = recommendation.signalsByHero[action.hero] ?? [];
      out.push({
        heroId: action.hero,
        score: scoreOf(signals),
        confidence: recommendation.confidence,
        position: impact ? primaryPosition(impact) : 1,
        roleStatus: impact?.status ?? "UNRESOLVED",
        flexPositions: curatedFlexPositions(action.hero, heroPositions),
        signals,
        recommendation,
      });
    }
  }
  return out
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => b.candidate.score - a.candidate.score || a.index - b.index)
    .map(({ candidate }) => candidate);
}

/** The phrase of the hero's strongest REAL signal (data-backed, highest contribution). */
function rationaleOf(candidate: HeroCandidate): string {
  const backed = candidate.signals.filter(votedWithData).sort((a, b) => b.weighted - a.weighted);
  return backed[0]?.explanation ?? "Sin señal con datos propios suficientes.";
}

export function buildHeroCard(candidate: HeroCandidate, heroPool: readonly HeroId[]): HeroCard {
  return {
    heroId: candidate.heroId,
    position: candidate.position,
    roleStatus: candidate.roleStatus,
    confidence: candidate.confidence,
    badges: deriveHeroBadges(candidate.recommendation, heroPool, candidate.heroId, candidate.flexPositions),
    rationale: rationaleOf(candidate),
    score: candidate.score,
    isFromPool: heroPool.includes(candidate.heroId),
  };
}
