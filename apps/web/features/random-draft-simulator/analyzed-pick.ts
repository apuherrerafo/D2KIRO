import type { HeroId } from "./types";

// Fase 4A.2 · puente entre «analizar» (tablero Light) y «elegir» (BlindRoundPanel). Puro: decide si el candidato abierto en el análisis es un pick LEGAL ahora.
// No elige nada ni calcula legalidad por su cuenta: usa los mismos datos que el panel ya tiene (posiciones sin sellar, héroes no disponibles, si hay acción humana).
// Elegir sigue yendo por el MISMO `onLockPick` de siempre: este archivo no duplica la lógica de elección.

export type PickPosition = 1 | 2 | 3 | 4 | 5;

export interface AnalyzedCandidate {
  position: PickPosition;
  heroId: HeroId;
}

export type AnalyzedPick =
  | { kind: "hidden" }
  | { kind: "legal"; position: PickPosition; heroId: HeroId }
  | { kind: "blocked"; position: PickPosition; heroId: HeroId; reason: string };

export interface AnalyzedPickInput {
  analyzed: AnalyzedCandidate | null;
  /** Posiciones humanas de la ronda que siguen sin sellar. */
  availablePositions: readonly PickPosition[];
  /** Posiciones humanas de la ronda (selladas o no). */
  attemptPositions: readonly PickPosition[];
  /** Baneados, ya elegidos por cualquier lado y sellados en esta ronda. */
  unavailable: ReadonlySet<HeroId>;
  /** El motor dijo que ahora no hay acción humana. */
  noHumanAction: boolean;
}

export function analyzedPickOf({ analyzed, availablePositions, attemptPositions, unavailable, noHumanAction }: AnalyzedPickInput): AnalyzedPick {
  if (analyzed === null) return { kind: "hidden" };
  const { position, heroId } = analyzed;
  if (!attemptPositions.includes(position)) return { kind: "hidden" };
  if (noHumanAction) return { kind: "blocked", position, heroId, reason: "ahora no hay un pick humano abierto" };
  if (!availablePositions.includes(position)) return { kind: "blocked", position, heroId, reason: `Pos${position} ya está sellada en esta ronda` };
  if (unavailable.has(heroId)) return { kind: "blocked", position, heroId, reason: "ya no está disponible (baneado o elegido)" };
  return { kind: "legal", position, heroId };
}
