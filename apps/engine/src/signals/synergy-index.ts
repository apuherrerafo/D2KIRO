import type { HeroId } from "../draft/reducer";
import { wilsonInterval } from "./relationship-index";

export const SYNERGY_MIN_GAMES = 100;

export interface SynergyStat {
  withHero: HeroId;
  games: number;
  wins: number;
  expectedWinrate: number;
}

export interface SynergyEvidence {
  ally: HeroId;
  synergyScore: number;
  games: number;
  winrateTogether: number;
  expectedWinrate: number;
  confidence: number;
}

export interface SynergyIndex {
  synergyRows(candidate: HeroId, allies: readonly HeroId[]): SynergyEvidence[];
}

function confidence(wins: number, games: number): number {
  const interval = wilsonInterval(wins, games);
  return Math.max(0, Math.min(1, 1 - (interval.upper - interval.lower)));
}

/** Builds an in-memory index for confirmed ally combinations only. */
export function createSynergyIndex(
  synergies: Record<HeroId, SynergyStat[]>,
  minGames = SYNERGY_MIN_GAMES,
): SynergyIndex {
  const rowsByCandidate = new Map<HeroId, Map<HeroId, SynergyStat>>();
  for (const [candidateKey, rows] of Object.entries(synergies)) {
    rowsByCandidate.set(Number(candidateKey) as HeroId, new Map(rows.map((row) => [row.withHero, row])));
  }

  return {
    synergyRows(candidate, allies) {
      const byAlly = rowsByCandidate.get(candidate);
      if (!byAlly) return [];
      return allies.flatMap((ally) => {
        const row = byAlly.get(ally);
        if (!row || row.games < minGames) return [];
        const winrateTogether = row.wins / row.games;
        return [{
          ally,
          synergyScore: winrateTogether - row.expectedWinrate,
          games: row.games,
          winrateTogether,
          expectedWinrate: row.expectedWinrate,
          confidence: confidence(row.wins, row.games),
        }];
      });
    },
  };
}
