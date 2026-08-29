import type { HeroId } from "../draft/reducer";
import type { HeroMatchupStat } from "./types";

export const RELATIONSHIP_MIN_GAMES = 200;

export interface CounterEvidence {
  rival: HeroId;
  delta: number;
  /** Winrate crudo del candidato contra este rival (`wins / games`), sin shrink ni ajuste.
   *  Aditivo (TSK-184): permite derivar el baseline del candidato como `observedWinrate - delta`
   *  sin re-consultar el índice. Los consumidores previos lo ignoran. */
  observedWinrate: number;
  games: number;
  wilsonLower: number;
  wilsonUpper: number;
  confidence: number;
}

export interface RelationshipIndex {
  counterRows(candidate: HeroId, rivals: readonly HeroId[]): CounterEvidence[];
}

function baseline(rows: readonly HeroMatchupStat[]): number | null {
  const games = rows.reduce((total, row) => total + row.games, 0);
  if (games === 0) return null;
  return rows.reduce((total, row) => total + row.wins, 0) / games;
}

export interface WilsonInterval {
  lower: number;
  upper: number;
}

/** Conservative 95% Wilson interval for an observed proportion. */
export function wilsonInterval(wins: number, games: number, z = 1.96): WilsonInterval {
  if (games <= 0) return { lower: 0, upper: 0 };
  const p = Math.min(1, Math.max(0, wins / games));
  const z2 = z * z;
  const denominator = 1 + z2 / games;
  const centre = p + z2 / (2 * games);
  const margin = z * Math.sqrt((p * (1 - p)) / games + z2 / (4 * games * games));
  return {
    lower: Math.max(0, (centre - margin) / denominator),
    upper: Math.min(1, (centre + margin) / denominator),
  };
}

function intervalConfidence(interval: WilsonInterval): number {
  return Math.max(0, Math.min(1, 1 - (interval.upper - interval.lower)));
}

/**
 * Builds the in-memory, read-only relationship index used on the hot path.
 * Banned or unrevealed heroes are never passed by callers as rivals; this index
 * only evaluates explicit observed matchups and keeps the sample threshold here
 * as a single source of truth.
 */
export function createRelationshipIndex(
  matchups: Record<HeroId, HeroMatchupStat[]>,
  minGames = RELATIONSHIP_MIN_GAMES,
): RelationshipIndex {
  const rowsByCandidate = new Map<HeroId, Map<HeroId, HeroMatchupStat>>();
  const baselines = new Map<HeroId, number | null>();

  for (const [candidateKey, rows] of Object.entries(matchups)) {
    const candidate = Number(candidateKey) as HeroId;
    rowsByCandidate.set(candidate, new Map(rows.map((row) => [row.vsHero, row])));
    baselines.set(candidate, baseline(rows));
  }

  return {
    counterRows(candidate, rivals) {
      const byRival = rowsByCandidate.get(candidate);
      const base = baselines.get(candidate);
      if (!byRival || base === null || base === undefined) return [];

      return rivals.flatMap((rival) => {
        const row = byRival.get(rival);
        if (!row || row.games < minGames) return [];
        const interval = wilsonInterval(row.wins, row.games);
        return [{
          rival,
          delta: row.wins / row.games - base,
          observedWinrate: row.wins / row.games,
          games: row.games,
          wilsonLower: interval.lower,
          wilsonUpper: interval.upper,
          confidence: intervalConfidence(interval),
        }];
      });
    },
  };
}
