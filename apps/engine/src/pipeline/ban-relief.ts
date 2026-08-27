import { deriveFlexDistribution } from "../intent/position-prior";
import { MIN_MATCHUP_GAMES, type MatchupWinrateFn } from "./meta-matchup";
import type { HeroId } from "../draft/reducer";
import type { HeroPositions } from "../signals/hero-positions";
import type { HeroMatchupStat } from "../signals/types";

// 1 / UNIFORM_PROBABILITY de intent/position-prior.ts. Un candidato sin dato de posición cae en
// la uniforme (0.2 en las cinco) y este factor lo devuelve exactamente a 1.0 -- el alivio plano de
// team-opener.ts, ni más ni menos. Un hueco de datos nunca penaliza.
export const POSITION_OVERLAP_GAIN = 5;

// Calibrado con el benchmark de sensibilidad de TSK-136: el término de entropía debe mover la
// frontera de apertura cuando cambian los bans, sin convertirse en un filtro duro. El valor es
// propio de la apertura; DEFAULT_BETA=0.5 del camino normal no se modifica.
export const BETA_OPENING = 0.5;

// banRelief(c, b, p): cuánto alivia banear `b` a un candidato `c` que quiere jugar la posición
// `p`, ponderado por cuánto se solapan las posiciones reales de `c` y `b`.
export function createBanReliefWinrate(
  matchups: Record<HeroId, HeroMatchupStat[]>,
  heroPositions: HeroPositions,
): MatchupWinrateFn {
  const index = new Map<HeroId, Map<HeroId, HeroMatchupStat>>();
  for (const [heroIdStr, rows] of Object.entries(matchups)) {
    const heroId = Number(heroIdStr) as HeroId;
    const byRival = new Map<HeroId, HeroMatchupStat>();
    for (const row of rows) byRival.set(row.vsHero, row);
    index.set(heroId, byRival);
  }

  const distributionCache = new Map<HeroId, ReturnType<typeof deriveFlexDistribution>>();
  function distributionOf(heroId: HeroId) {
    const cached = distributionCache.get(heroId);
    if (cached) return cached;
    const distribution = deriveFlexDistribution(heroId, heroPositions);
    distributionCache.set(heroId, distribution);
    return distribution;
  }

  return function banReliefWinrate(candidate, banned, position) {
    const row = index.get(candidate)?.get(banned);
    if (!row || row.games < MIN_MATCHUP_GAMES) return null;

    const relief = Math.max(0, 0.5 - row.wins / row.games);
    const positionProbability = distributionOf(candidate).probabilities[position];
    return POSITION_OVERLAP_GAIN * positionProbability * relief;
  };
}

/**
 * TeamOpening nunca obtiene ventaja de "pelear contra" un héroe baneado: ese matchup no existe
 * en el mapa. Esta función es el contrato explícito para el término directo y siempre devuelve
 * cero cuando el rival es un ban (incluidos datos adversos de la matriz).
 */
export function createTeamOpeningMatchupWinrate(
  _matchups: Record<HeroId, HeroMatchupStat[]>,
  _heroPositions: HeroPositions,
): MatchupWinrateFn {
  return () => 0;
}

/** Opportunity window: el ban elimina una respuesta adversa previamente observada. */
export function createOpportunityWindowScore(
  matchups: Record<HeroId, HeroMatchupStat[]>,
  heroPositions: HeroPositions,
): MatchupWinrateFn {
  return createBanReliefWinrate(matchups, heroPositions);
}

// commitment(c) = 1 - H(c)/log2(5), en [0,1]. Un héroe con una sola posición >=200 partidas da 1;
// sin entrada en hero-positions.json cae en la uniforme y da exactamente 0. Nunca negativo, nunca
// > 1 -- la entropía de Shannon sobre 5 símbolos está acotada por log2(5) por definición.
export function createPositionalCommitment(heroPositions: HeroPositions): (heroId: HeroId) => number {
  const cache = new Map<HeroId, number>();
  return function positionalCommitment(heroId) {
    const cached = cache.get(heroId);
    if (cached !== undefined) return cached;
    const { entropy } = deriveFlexDistribution(heroId, heroPositions);
    const commitment = 1 - entropy / Math.log2(5);
    cache.set(heroId, commitment);
    return commitment;
  };
}
