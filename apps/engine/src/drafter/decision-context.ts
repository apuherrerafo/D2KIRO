import { observedDraftFacts } from "./observed-draft";
import type { DraftState } from "../draft/reducer";
import type { PerspectiveDraftView } from "../draft-protocol/types";

export type DraftDecisionContext = "team_opening" | "blind_second_pick" | "response_pick" | "closing_pick" | "no_signal_available";

export interface DraftDecisionPolicy {
  context: DraftDecisionContext;
  ownPickCount: number;
  visibleEnemyCount: number;
  usesRevealedCounterEvidence: boolean;
  closesComposition: boolean;
  headline: string;
}

// All Pick no autoriza inferir picks ocultos: la política solo ve lo que está materializado en
// DraftState. `teamOpening` es el único contexto solicitado explícitamente antes de elegir el
// primer héroe; después, dos picks propios sin enemigos siguen siendo una ronda ciega.
export function deriveDecisionContext(state: DraftState, teamOpening: boolean): DraftDecisionContext {
  const { ownPicks: own, revealedEnemyPicks: enemy } = observedDraftFacts(state);
  if (teamOpening && own.length === 0 && enemy.length === 0) return "team_opening";
  if (enemy.length >= 4 && own.length >= 4) return "closing_pick";
  if (enemy.length >= 2 && own.length >= 2) return "response_pick";
  return "blind_second_pick";
}

// Política pura: no decide héroes ni mira planes internos del bot. Solo declara los hechos que
// puede consumir la recomendación en el instante actual de All Pick; así un cambio de fase no
// puede colar picks rivales que todavía no se revelaron.
export function deriveDecisionPolicy(state: DraftState, teamOpening: boolean): DraftDecisionPolicy {
  const { ownPicks, revealedEnemyPicks } = observedDraftFacts(state);
  const ownPickCount = ownPicks.length;
  const visibleEnemyCount = revealedEnemyPicks.length;
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

// AP Ranked Roles V1 / Wave 2 (task 15) -- the same decision moments, derived from the ONLY thing
// the Coach may legally look at: a PerspectiveDraftView. Parallel to (never a replacement for)
// `deriveDecisionContext(DraftState)` above, which legacy/V6 consumers keep using unchanged.
//
// `HIDDEN` enemy slots carry no hero id and are never counted: only REVEALED enemy picks make an
// enemy "visible". Own picks count once sealed (KNOWN) -- the Player knows their own selections
// before the round reveals, which is exactly what makes the second pick of a round "blind".
export function deriveDecisionContextFromView(view: PerspectiveDraftView): DraftDecisionContext {
  const ownPicksConfirmed = view.ownPicks.filter((slot) => slot.visibility !== "HIDDEN").length;
  const revealedEnemyPicks = view.enemyPicks.filter((slot) => slot.visibility === "REVEALED").length;
  if (revealedEnemyPicks >= 4) return "closing_pick";
  if (revealedEnemyPicks >= 2) return "response_pick";
  if (view.rankedAp?.phase === "PICK_ROUND_1" && ownPicksConfirmed === 0) return "team_opening";
  return "blind_second_pick";
}
