import type { SignalContribution, SignalScorer } from "./types";

const OUT_OF_POOL_RAW = 0.2;
const IN_POOL_NO_WINRATE_RAW = 0.5;
const DEFAULT_BASELINE = 0.5;
const SHRINK_K = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Comodidad relativa al propio jugador, no winrate absoluto (SPEC.md §9.3, D10): un 45% general
// que va 55% con un héroe recibe el mismo empujón que un 55% general que va 65%.
function comfortRaw(personalWinrate: number, personalGames: number, baseline: number): number {
  const personalWins = personalWinrate * personalGames;
  const shrunk = (personalWins + SHRINK_K * baseline) / (personalGames + SHRINK_K);
  return clamp(0.5 + (shrunk - baseline) * 2, 0.5, 1.0);
}

export const heroPoolFitScorer: SignalScorer = {
  id: "hero_pool_fit",
  score(_state, candidate, meta): SignalContribution {
    const heroPool = meta.heroPool ?? [];

    // Pool nunca configurado (ausente o vacío) -- "esta señal no aplica", no "hay hueco de datos".
    if (heroPool.length === 0) {
      return {
        signal: "hero_pool_fit",
        raw: null,
        weighted: 0,
        explanation: "Configura tu pool de héroes para que las sugerencias tengan en cuenta con qué juegas cómodo",
        sampleSize: 0,
        applicable: false,
      };
    }

    const entry = heroPool.find((e) => e.hero === candidate);

    if (!entry) {
      return {
        signal: "hero_pool_fit",
        raw: OUT_OF_POOL_RAW,
        weighted: 0,
        explanation: "Fuera de tu pool de héroes",
        sampleSize: 0,
        applicable: true,
      };
    }

    if (entry.personalWinrate === null) {
      return {
        signal: "hero_pool_fit",
        raw: IN_POOL_NO_WINRATE_RAW,
        weighted: 0,
        explanation: "En tu pool de héroes",
        sampleSize: 0,
        applicable: true,
      };
    }

    const baseline = meta.personalBaselineWinrate ?? DEFAULT_BASELINE;
    const raw = comfortRaw(entry.personalWinrate, entry.personalGames, baseline);
    return {
      signal: "hero_pool_fit",
      raw,
      weighted: 0,
      explanation: `En tu pool: ${(entry.personalWinrate * 100).toFixed(0)}% en ${entry.personalGames} partidas`,
      sampleSize: entry.personalGames,
      applicable: true,
    };
  },
};
