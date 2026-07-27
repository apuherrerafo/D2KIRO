import type { HeroId, TeamSide } from "../draft/reducer";
import type { MetaSnapshot, SignalContribution, SignalScorer } from "./types";

const FARM_PRIORITY_ROLE = "Carry";
const CARRY_SATURATION = 2; // "ya tiene dos héroes carry" (ticket) -- a partir de aquí penaliza.

function isCarry(meta: MetaSnapshot, hero: HeroId): boolean {
  return (meta.heroes[hero]?.roles ?? []).includes(FARM_PRIORITY_ROLE);
}

function ownPicks(state: { localSide: TeamSide | "unknown"; picks: Record<TeamSide, HeroId[]> }): HeroId[] {
  return state.localSide === "unknown" ? [] : state.picks[state.localSide];
}

export const roleGapScorer: SignalScorer = {
  id: "role_gap",
  score(state, candidate, meta): SignalContribution {
    const ownCarryCount = ownPicks(state).filter((hero) => isCarry(meta, hero)).length;
    const candidateIsCarry = isCarry(meta, candidate);

    if (!candidateIsCarry || ownCarryCount < CARRY_SATURATION) {
      return {
        signal: "role_gap",
        raw: 0,
        weighted: 0,
        explanation: candidateIsCarry
          ? "El equipo todavía no satura prioridad de farm"
          : "No compite por prioridad de farm con los carries del equipo",
        sampleSize: 0,
      };
    }

    // Penalización crece con cuántos carries "de más" sería este candidato, tope en -1.
    const overlap = ownCarryCount - CARRY_SATURATION + 1;
    return {
      signal: "role_gap",
      raw: -Math.min(1, overlap / (CARRY_SATURATION + 1)),
      weighted: 0,
      explanation: `El equipo ya tiene ${ownCarryCount} carries; este compite por el mismo farm`,
      sampleSize: 0,
    };
  },
};
