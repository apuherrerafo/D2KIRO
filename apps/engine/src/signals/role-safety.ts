import type { HeroId, TeamSide } from "../draft/reducer";
import type { MetaSnapshot, SignalContribution, SignalScorer } from "./types";

// TSK-027 (feedback real de producto, journal.md evt-20260729-041): en tu propio draft, un
// support (pos 4/5) es un pick temprano más seguro que revelar un carry/mid sin información del
// rival -- decisión confirmada con el usuario, no inventada. Nunca se predice al rival (D12 de
// SPEC.md §9 sigue fuera de alcance) -- solo mira cuántos picks propios ya hiciste.
const SUPPORT_ROLE = "Support";
const EARLY_PICK_WINDOW = 2; // primeros 2 picks propios, confirmado con el usuario

function ownPicks(state: { localSide: TeamSide | "unknown"; picks: Record<TeamSide, HeroId[]> }): HeroId[] {
  return state.localSide === "unknown" ? [] : state.picks[state.localSide];
}

function isSupport(meta: MetaSnapshot, hero: HeroId): boolean {
  return (meta.heroes[hero]?.roles ?? []).includes(SUPPORT_ROLE);
}

export const roleSafetyScorer: SignalScorer = {
  id: "role_safety",
  score(state, candidate, meta): SignalContribution {
    const ownCount = ownPicks(state).length;

    // Fuera de la ventana de picks tempranos: no es "sin datos", es "ya no aplica evaluar esto"
    // -- mismo tipo de raw:null que counter/patch_meta/team_synergy ya usan para "sin base
    // suficiente", no el campo applicable (ese es para una función que el usuario no configuró).
    if (ownCount >= EARLY_PICK_WINDOW) {
      return {
        signal: "role_safety",
        raw: null,
        weighted: 0,
        explanation: "Ya pasaron tus primeros picks -- esta señal ya no aplica",
        sampleSize: 0,
      };
    }

    if (isSupport(meta, candidate)) {
      return {
        signal: "role_safety",
        raw: 1,
        weighted: 0,
        explanation: "Rol flexible para un pick temprano, sin info del rival todavía",
        sampleSize: 0,
      };
    }

    return {
      signal: "role_safety",
      raw: 0,
      weighted: 0,
      explanation: "No es un rol prioritario para un pick tan temprano",
      sampleSize: 0,
    };
  },
};
