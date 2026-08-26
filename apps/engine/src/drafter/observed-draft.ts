import type { DraftState, HeroId } from "../draft/reducer";

/**
 * Hechos que el motor puede usar para justificar una sugerencia al usuario.
 * Los picks rivales de este contrato son exclusivamente los ya materializados
 * en DraftState; predicciones de composición pertenecen a capas separadas y
 * nunca se convierten en evidencia de contrapick.
 */
export interface ObservedDraftFacts {
  ownPicks: readonly HeroId[];
  revealedEnemyPicks: readonly HeroId[];
  bannedHeroes: readonly HeroId[];
}

export function observedDraftFacts(state: DraftState): ObservedDraftFacts {
  if (state.localSide === "unknown") {
    return { ownPicks: [], revealedEnemyPicks: [], bannedHeroes: state.banned };
  }

  const enemySide = state.localSide === "radiant" ? "dire" : "radiant";
  return {
    ownPicks: state.picks[state.localSide],
    revealedEnemyPicks: state.picks[enemySide],
    bannedHeroes: state.banned,
  };
}
