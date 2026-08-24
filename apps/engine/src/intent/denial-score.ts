import type { FlexInferenceResult } from "./flex-inference";
import type { HeroId } from "../draft/reducer";

// Fase 7 (pro-drafter-spec-v1.md §2.3): DenialScore(h*,F) = Σ_p P(Pos_F=p)·MatchupWinrate(h*,F,p)
// + β·EarlyPressure(h*)·H(F).
//
// [SUPUESTO, ver plan Fase 5-8]: `MatchupWinrate` por posición depende de datos que el proyecto
// no sincroniza hoy (STRATZ, mismo hueco abierto desde Fase 1b) -- el doc lo hereda, no lo
// resuelve. Acá se recibe inyectado y nullable tal cual la interfaz del doc: una posición sin
// dato se EXCLUYE de la suma, nunca se trata como winrate 0 (mismo criterio que `raw: null` en el
// resto del motor). Numéricamente, excluir un término y sumarle `probabilidad × 0` dan el mismo
// número en esta fórmula -- no hay redistribución de masa de probabilidad como en mix.ts, así que
// la diferencia real es semántica (nunca fabricar un winrate falso) y de costo (nunca llamar al
// resto del cálculo con un dato que no existe).

const POSITIONS = [1, 2, 3, 4, 5] as const;

export function calculateDenialScore(
  candidateHero: HeroId,
  flexHero: FlexInferenceResult,
  matchupWinrate: (candidate: HeroId, rival: HeroId, position: 1 | 2 | 3 | 4 | 5) => number | null,
  earlyPressure: (heroId: HeroId) => number,
  beta: number,
): number {
  let matchupTerm = 0;
  for (const position of POSITIONS) {
    const winrate = matchupWinrate(candidateHero, flexHero.rivalHeroId, position);
    if (winrate === null) continue; // sin dato -- excluido, nunca 0 disfrazado de dato real
    matchupTerm += flexHero.distribution.probabilities[position] * winrate;
  }

  const pressureTerm = beta * earlyPressure(candidateHero) * flexHero.distribution.entropy;

  return matchupTerm + pressureTerm;
}
