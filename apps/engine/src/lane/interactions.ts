import type { HeroLineProfile, LaneDimension } from "./profiles";

// Fase 6 (pro-drafter-spec-v1.md §2.2): Φ_k(A1,A2,E1,E2), la interacción por dimensión que el
// doc nombra pero nunca define.
//
// [SUPUESTO, ver plan Fase 5-8]: se define acá, por primera vez, como el promedio por bando en la
// dimensión k: Φ_k = (A1[k]+A2[k])/2 − (E1[k]+E2[k])/2 ∈ [-1,1]. Con pesos ω_k que suman 1, la
// suma ponderada en evaluate.ts (6.3) queda en [-1,1] antes del sigmoide -- coincide con el propio
// comentario del doc ("laneScore > 0.5 favorece al par propio").

export function interactionDelta(
  dimension: LaneDimension,
  ally: readonly [HeroLineProfile, HeroLineProfile],
  enemy: readonly [HeroLineProfile, HeroLineProfile],
): number {
  const allyAvg = (ally[0][dimension] + ally[1][dimension]) / 2;
  const enemyAvg = (enemy[0][dimension] + enemy[1][dimension]) / 2;
  return allyAvg - enemyAvg;
}
