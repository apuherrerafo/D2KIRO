// Fase 3D · decisiones de PRESENTACIÓN (puras). Todo se deriva de campos reales del tablero; nada se calcula ni se promueve.

import type { TargetState } from "@/design/canonical/primitives";
import { teamPositionName } from "@/features/team-coach/constants";
import type { TeamCoachBoardData, TeamCoachCandidate, TeamCoachColumn, TeamPosition } from "@/features/team-coach/types";
import type { ColumnCandidate } from "./merge-candidates";

export type ColumnRelation = "mine" | "party";

/** En el Simulador la posición propia la declara la configuración (no existe "sin confirmar": eso es de Live). */
export function relationOf(position: TeamPosition, humanPosition: TeamPosition | null): ColumnRelation {
  if (humanPosition !== position) return "party";
  return "mine";
}

export const RELATION_LABEL: Record<ColumnRelation, string> = {
  mine: "Tu posición",
  party: "Posición de tu party",
};

export interface Recommendation {
  position: TeamPosition;
  heroId: number;
  /** Comparación de presentación contra la posición propia (G14: el motor no dice para quién es). */
  forMe: boolean;
  /** Solo `STRATEGIC` trae una razón; los otros `targetBasis` no se explican. */
  reason: string | null;
}

/** ELIGE AHORA existe solo si la decisión apunta a una columna VISIBLE; nunca se reasigna a otro héroe. */
export function recommendationOf(board: TeamCoachBoardData, visible: readonly TeamPosition[], humanPosition: TeamPosition | null): Recommendation | null {
  const { recommendedPosition, recommendedHeroId, targetBasis, reason } = board.currentDecision;
  if (recommendedPosition === null || recommendedHeroId === null) return null;
  if (!visible.includes(recommendedPosition)) return null;
  const column = board.positions.find((entry) => entry.position === recommendedPosition);
  const card = column?.top.find((entry) => entry.heroId === recommendedHeroId);
  if (card === undefined || !card.isPrimary || card.evidenceStrength === "WEAK") return null;
  return { position: recommendedPosition, heroId: recommendedHeroId, forMe: humanPosition === recommendedPosition, reason: targetBasis === "STRATEGIC" && reason !== "" ? reason : null };
}

export interface CardModel {
  /** Lo que dice el `StateTarget` (un solo `state`, D3). */
  state: TargetState;
  /** El héroe de la tarjeta es el que está abierto en el panel de análisis. */
  selected: boolean;
  /** Candidato abierto en el análisis: va a `StateTarget pressed` (D3.2), NUNCA a `state`. */
  pressed: boolean;
  /** Posición de la columna (`Pos3 Offlane`). */
  title: string;
  /** Puesto: el de `top` (general) o el del pool; nunca uno por el otro. */
  rankText: string;
  notch: string | undefined;
  note: string | undefined;
  isRecommended: boolean;
  /** "Plan de equipo": primario de su columna que no es el ELIGE AHORA. En Solo se oculta (el plan se calcula sobre 5 posiciones). */
  isPlan: boolean;
  /** WEAK que no quedó como `uncertain` (porque `selected` ganó): la marca se dice igual, como texto. */
  evidenceAsText: boolean;
  poolText: string | null;
}

interface CardInput {
  entry: ColumnCandidate;
  column: TeamCoachColumn;
  recommendation: Recommendation | null;
  selected: boolean;
  showPlan: boolean;
}

const EVIDENCE_NOTE = "Evidencia limitada";

function poolTextOf(candidate: TeamCoachCandidate, poolRank: number | null): string | null {
  if (candidate.poolMembership === "OUTSIDE_POOL") return "Fuera de tu pool";
  if (candidate.poolMembership !== "IN_POOL" && poolRank === null) return null;
  if (poolRank === null) return "En tu pool";
  return `En tu pool · #${poolRank} de tu pool`;
}

export function cardModelOf({ entry, column, recommendation, selected, showPlan }: CardInput): CardModel {
  const { candidate, generalRank, poolRank } = entry;
  const weak = candidate.evidenceStrength === "WEAK";
  const isRecommended = recommendation !== null && recommendation.position === column.position && recommendation.heroId === candidate.heroId && generalRank !== null;
  // Un solo `state` por tarjeta: recommended > selected > uncertain > rest. «Recomendado» nunca se pierde (D3): si además está seleccionada,
  // «seleccionado» se compone en el retrato. Lo que pierde canal (evidencia limitada bajo `selected`) se dice con texto.
  let state: TargetState = "rest";
  if (weak) state = "uncertain";
  if (isRecommended) state = "recommended";
  const forMe = recommendation?.forMe ?? false;
  return {
    state,
    selected,
    pressed: selected,
    title: teamPositionName(column.position),
    rankText: generalRank === null ? `#${poolRank ?? 0} de tu pool` : `#${generalRank} en el ranking`,
    notch: forMe ? "ELIGE AHORA" : `Para tu party · Pos ${column.position}`,
    note: weak ? EVIDENCE_NOTE : undefined,
    isRecommended,
    isPlan: showPlan && candidate.isPrimary && !isRecommended && generalRank !== null,
    evidenceAsText: weak && state !== "uncertain",
    poolText: poolTextOf(candidate, poolRank),
  };
}

export const LEVEL_LABEL: Record<"hard" | "medium", string> = { hard: "Fuerte", medium: "Ventaja posible" };

/** Fracción (fr) del bloque de columnas frente al panel de análisis, por cantidad de posiciones controladas (Solo / Party 2 / 3 / 5). */
export const COLUMNS_FR: Record<number, number> = { 1: 4, 2: 6, 3: 8, 4: 9, 5: 10 };
