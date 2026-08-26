import type { DraftState, HeroId, TeamSide } from "../draft/reducer";

export type DraftDecisionContext = "team_opening" | "blind_second_pick" | "response_pick" | "closing_pick";

export interface DraftDecisionPolicy {
  context: DraftDecisionContext;
  ownPickCount: number;
  visibleEnemyCount: number;
  usesRevealedCounterEvidence: boolean;
  closesComposition: boolean;
  headline: string;
}

function ownPicks(state: DraftState): HeroId[] {
  if (state.localSide === "unknown") return [];
  return state.picks[state.localSide];
}

function opposingPicks(state: DraftState): HeroId[] {
  if (state.localSide === "unknown") return [];
  const opposingSide: TeamSide = state.localSide === "radiant" ? "dire" : "radiant";
  return state.picks[opposingSide];
}

// All Pick no autoriza inferir picks ocultos: la política solo ve lo que está materializado en
// DraftState. `teamOpening` es el único contexto solicitado explícitamente antes de elegir el
// primer héroe; después, dos picks propios sin enemigos siguen siendo una ronda ciega.
export function deriveDecisionContext(state: DraftState, teamOpening: boolean): DraftDecisionContext {
  const own = ownPicks(state);
  const enemy = opposingPicks(state);
  if (teamOpening && own.length === 0 && enemy.length === 0) return "team_opening";
  if (enemy.length >= 4 && own.length >= 4) return "closing_pick";
  if (enemy.length >= 2 && own.length >= 2) return "response_pick";
  return "blind_second_pick";
}

// Política pura: no decide héroes ni mira planes internos del bot. Solo declara los hechos que
// puede consumir la recomendación en el instante actual de All Pick; así un cambio de fase no
// puede colar picks rivales que todavía no se revelaron.
export function deriveDecisionPolicy(state: DraftState, teamOpening: boolean): DraftDecisionPolicy {
  const ownPickCount = ownPicks(state).length;
  const visibleEnemyCount = opposingPicks(state).length;
  const context = deriveDecisionContext(state, teamOpening);

  if (context === "team_opening") {
    return {
      context,
      ownPickCount,
      visibleEnemyCount,
      usesRevealedCounterEvidence: false,
      closesComposition: false,
      headline: "Apertura de equipo: todavía no hay picks rivales revelados.",
    };
  }
  if (context === "blind_second_pick") {
    return {
      context,
      ownPickCount,
      visibleEnemyCount,
      usesRevealedCounterEvidence: false,
      closesComposition: false,
      headline: "Pick 2 ciego: combina el primer pick propio con sinergia y flexibilidad; todavía no hay picks rivales revelados.",
    };
  }
  if (context === "response_pick") {
    return {
      context,
      ownPickCount,
      visibleEnemyCount,
      usesRevealedCounterEvidence: true,
      closesComposition: false,
      headline: "Pick 3/4: responde a los dos picks rivales revelados y mantiene coherente la composición propia.",
    };
  }
  return {
    context,
    ownPickCount,
    visibleEnemyCount,
    usesRevealedCounterEvidence: true,
    closesComposition: true,
    headline: "Cierre: con cuatro picks rivales revelados, completa la composición y evalúa los contrapicks observables.",
  };
}
