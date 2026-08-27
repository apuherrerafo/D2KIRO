import type { HeroId } from "../draft/reducer";
import type { HeroMatchupStat } from "../signals/types";

// Mismo valor y misma razón que signals/counter.ts y drafter/team-opener.ts, declarado local --
// el proyecto nunca cruza-importa esta constante entre capas.
export const MIN_MATCHUP_GAMES = 200;

export type MatchupWinrateFn = (
  candidate: HeroId,
  rival: HeroId,
  position: 1 | 2 | 3 | 4 | 5,
) => number | null;

// Índice construido una sola vez al crear la función -- calculateDenialScore la invoca 5 veces
// por par (candidato, rival), y el pool de apertura es de ~110 candidatos.
export function createMetaMatchupWinrate(matchups: Record<HeroId, HeroMatchupStat[]>): MatchupWinrateFn {
  const index = new Map<HeroId, Map<HeroId, HeroMatchupStat>>();
  for (const [heroIdStr, rows] of Object.entries(matchups)) {
    const heroId = Number(heroIdStr) as HeroId;
    const byRival = new Map<HeroId, HeroMatchupStat>();
    for (const row of rows) byRival.set(row.vsHero, row);
    index.set(heroId, byRival);
  }

  // `position` se ignora por completo (_position) -- hero_matchups no tiene columna de posición y
  // OpenDota no la expone, hueco heredado desde 1b que denial-score.ts ya documenta. Se conserva
  // el parámetro porque la firma de calculateDenialScore lo exige.
  return function metaMatchupWinrate(candidate, rival, _position) {
    const row = index.get(candidate)?.get(rival);
    if (!row || row.games < MIN_MATCHUP_GAMES) return null;
    return row.wins / row.games;
  };
}
