import type { Position, RoleBelief } from "../draft-protocol/roles/role-belief";
import type { HeroId } from "../draft-protocol/types";
import type { PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import type { RecommendationSetV2 } from "../recommendation/types";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import { credibleHeroesForPosition, demoteRevealedHardCountered, extractHeroCandidates, revealedEnemyHeroes } from "./hero-card";

// Wave 3 task 20 -- this deliberately consumes its OWN RecommendationSetV2.  It never sees the
// team set, so deriving "your position" by filtering the team shortlist is structurally impossible.
export interface PersonalHeroView {
  position: Position;
  positionLabel: string;
  /** Own picks already fill this position in EVERY feasible assignment: there is nothing left to recommend for it. */
  seatCovered: boolean;
  heroes: { heroId: HeroId; rank: number; score: number; isFromPool: boolean }[];
}

const POSITION_LABEL: Record<Position, string> = {
  1: "TU CARRY AHORA",
  2: "TU MID AHORA",
  3: "TU OFFLANE AHORA",
  4: "TU SUPPORT AHORA",
  5: "TU HARD SUPPORT AHORA",
};

const ALL_POSITIONS: readonly Position[] = [1, 2, 3, 4, 5];

/**
 * Dota-Judge RB-1: the personal ranking's candidate universe, decided BEFORE ranking. Heroes the curated evidence
 * credibly places at `position` (`isCredibleForPosition`). It is built from the position alone -- never from the
 * team shortlist -- and handed to V6 as its `candidateHeroIds`, so the ranking cannot surface an off-role hero.
 */
export function personalCandidateUniverse(position: Position, heroPositions: HeroPositions): HeroId[] {
  return credibleHeroesForPosition(position, heroPositions);
}

/**
 * Is `position` already filled by the Player's own visible picks -- i.e. can those picks NOT all be seated (one
 * distinct position each, only positions their public belief allows) without using it? Purely structural: a hero
 * "can play" a position when its belief gives that position any probability. It reads the same public role beliefs
 * the Coach already shows, at most 5 heroes. When no seating exists at all (contradictory evidence) the answer is
 * "not covered": doubt never hides a ranking.
 */
export function isPersonalSeatCovered(ownRoleBeliefs: ReadonlyMap<HeroId, RoleBelief> | undefined, position: Position): boolean {
  if (!ownRoleBeliefs || ownRoleBeliefs.size === 0) return false;
  const options = [...ownRoleBeliefs.values()].map((belief) => ALL_POSITIONS.filter((candidate) => belief.probabilities[candidate] > 0));
  const canSeat = (index: number, used: ReadonlySet<Position>, allowed: (candidate: Position) => boolean): boolean => {
    if (index === options.length) return true;
    return options[index]!.some((candidate) => allowed(candidate) && !used.has(candidate) && canSeat(index + 1, new Set([...used, candidate]), allowed));
  };
  const anySeating = canSeat(0, new Set(), () => true);
  if (!anySeating) return false;
  return !canSeat(0, new Set(), (candidate) => candidate !== position);
}

export interface PersonalPositionRecommendationDeps {
  buildRecommendationSet(context: PerspectiveRecommendationContext, position: Position): Promise<RecommendationSetV2>;
  heroPositions?: HeroPositions;
  /** Curated counters: the same categorical revealed-hard-counter demotion the team shortlist applies (RB-4). */
  heroCounters?: ReadonlyMap<HeroId, readonly CuratedCounter[]>;
  /** The Coach's beliefs about the Player's own visible picks; absent -> the seat is never considered covered. */
  ownRoleBeliefs?: ReadonlyMap<HeroId, RoleBelief>;
  shortlistSize?: number;
}

export async function buildPersonalPositionRecommendation(
  context: PerspectiveRecommendationContext,
  playerPersonalPosition: Position,
  heroPool: readonly HeroId[],
  deps: PersonalPositionRecommendationDeps,
): Promise<{ recommendationSet: RecommendationSetV2 | null; view: PersonalHeroView }> {
  const positionLabel = POSITION_LABEL[playerPersonalPosition];
  if (isPersonalSeatCovered(deps.ownRoleBeliefs, playerPersonalPosition)) {
    return { recommendationSet: null, view: { position: playerPersonalPosition, positionLabel, seatCovered: true, heroes: [] } };
  }
  const recommendationSet = await deps.buildRecommendationSet(context, playerPersonalPosition);
  const pool = new Set(heroPool);
  const candidates = demoteRevealedHardCountered(extractHeroCandidates(recommendationSet, deps.heroPositions), revealedEnemyHeroes(context.view), deps.heroCounters);
  const heroes = candidates
    .slice(0, deps.shortlistSize ?? 5)
    .map((candidate, index) => ({
      heroId: candidate.heroId,
      rank: index + 1,
      score: candidate.score,
      // Server-backed calls receive the account's approved pool through V6's meta overlay. The
      // direct pool parameter keeps this pure helper testable; the signal is the authoritative
      // fallback when that overlay is intentionally not duplicated into Coach state.
      isFromPool: pool.has(candidate.heroId) || candidate.signals.some((signal) => signal.signal === "hero_pool_fit" && signal.explanation.startsWith("En tu pool")),
    }));
  return { recommendationSet, view: { position: playerPersonalPosition, positionLabel, seatCovered: false, heroes } };
}
