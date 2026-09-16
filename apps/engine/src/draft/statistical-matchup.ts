import type { HeroId } from "./reducer";

/**
 * Stable semantic order for matchup rows. Database/insertion order is not evidence: a row is
 * identified first by the counter hero, with its functional sample fields breaking duplicate-ID
 * ties. Consumers use this before any score, evidence, or text is derived from the rows.
 */
export interface StatisticalMatchup {
  vsHero: HeroId;
  games: number;
  wins: number;
}

export function compareStatisticalMatchups(left: StatisticalMatchup, right: StatisticalMatchup): number {
  return left.vsHero - right.vsHero || left.games - right.games || left.wins - right.wins;
}

export function canonicalizeStatisticalMatchups<T extends StatisticalMatchup>(matchups: readonly T[]): T[] {
  return [...matchups].sort(compareStatisticalMatchups);
}
