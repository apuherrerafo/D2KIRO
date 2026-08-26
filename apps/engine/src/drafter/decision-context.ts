import type { DraftState, HeroId, TeamSide } from "../draft/reducer";

export type DraftDecisionContext = "team_opening" | "blind_second_pick" | "response_pick" | "closing_pick";

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
  if (enemy.length >= 2) return "response_pick";
  return "blind_second_pick";
}
