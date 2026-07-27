import type { DraftState, HeroId, TeamSide } from "../draft/reducer";
import type { HeroMatchupStat, MetaSnapshot, SignalContribution, SignalScorer } from "./types";

const MIN_MATCHUP_GAMES = 200;
const MAX_NAMED_ENEMIES = 2;

function opposingSide(state: DraftState): TeamSide | null {
  if (state.localSide === "radiant") return "dire";
  if (state.localSide === "dire") return "radiant";
  return null;
}

function overallWinrate(matchups: HeroMatchupStat[]): number | null {
  const totalGames = matchups.reduce((sum, m) => sum + m.games, 0);
  if (totalGames === 0) return null;
  const totalWins = matchups.reduce((sum, m) => sum + m.wins, 0);
  return totalWins / totalGames;
}

function heroName(meta: MetaSnapshot, hero: HeroId): string {
  return meta.heroes[hero]?.localizedName ?? `héroe ${hero}`;
}

interface EnemyDelta {
  vsHero: HeroId;
  delta: number;
  games: number;
}

function buildExplanation(meta: MetaSnapshot, deltas: EnemyDelta[]): string {
  const strongAgainst = deltas
    .filter((d) => d.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, MAX_NAMED_ENEMIES)
    .map((d) => heroName(meta, d.vsHero));
  if (strongAgainst.length === 0) return "Sin ventaja de contrapick conocida en este draft";
  return `Fuerte contra ${strongAgainst.join(" y ")}`;
}

export const counterScorer: SignalScorer = {
  id: "counter",
  score(state, candidate, meta): SignalContribution {
    const enemySide = opposingSide(state);
    const knownEnemies = enemySide ? state.picks[enemySide] : [];
    const candidateMatchups = meta.matchups[candidate] ?? [];
    const baseline = overallWinrate(candidateMatchups);

    const deltas: EnemyDelta[] = [];
    if (baseline !== null) {
      for (const enemy of knownEnemies) {
        const row = candidateMatchups.find((m) => m.vsHero === enemy);
        if (!row || row.games < MIN_MATCHUP_GAMES) continue;
        deltas.push({ vsHero: enemy, delta: row.wins / row.games - baseline, games: row.games });
      }
    }

    if (deltas.length === 0) {
      return {
        signal: "counter",
        raw: null,
        weighted: 0,
        explanation: "Sin datos suficientes de enfrentamientos para este candidato",
        sampleSize: 0,
      };
    }

    // `weighted` queda en 0: la mezcla de pesos y la redistribución cuando otras señales dan
    // `null` es responsabilidad del motor (ticket aparte, C3 etapa MEZCLA), no de este scorer.
    return {
      signal: "counter",
      raw: deltas.reduce((sum, d) => sum + d.delta, 0) / deltas.length,
      weighted: 0,
      explanation: buildExplanation(meta, deltas),
      sampleSize: deltas.reduce((sum, d) => sum + d.games, 0),
    };
  },
};
