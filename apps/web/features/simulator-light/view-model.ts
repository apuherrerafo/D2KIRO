// Fase 3D · decisiones de PRESENTACIÓN (puras). Todo se deriva de campos reales del tablero; nada se calcula ni se promueve.

import type { TargetState } from "@/design/canonical/primitives";
import { teamPositionName } from "@/features/team-coach/constants";
import { canHighlightAsRecommended, hasLimitedEvidence, isPlannedCandidate } from "@/features/team-coach/eligibility";
import type { TeamCoachBoardData, TeamCoachCandidate, TeamCoachColumn, TeamCoachTargetBasis, TeamPosition } from "@/features/team-coach/types";
import type { ColumnCandidate } from "./merge-candidates";

/** `mine-unconfirmed` = Live: el jugador declaró esa posición pero el motor todavía no ligó su héroe a ella. */
export type ColumnRelation = "mine" | "mine-unconfirmed" | "party";

/** En el Simulador la posición propia la declara la configuración (no existe "sin confirmar": eso es de Live). */
export function relationOf(position: TeamPosition, humanPosition: TeamPosition | null, mine: "mine" | "mine-unconfirmed" = "mine"): ColumnRelation {
  if (humanPosition !== position) return "party";
  return mine;
}

export const RELATION_LABEL: Record<ColumnRelation, string> = {
  mine: "Tu posición",
  "mine-unconfirmed": "Tu posición · declarada, sin confirmar",
  party: "Posición de tu party",
};

export interface Recommendation {
  position: TeamPosition;
  heroId: number;
  /** Comparación de presentación contra la posición propia (G14: el motor no dice para quién es). */
  forMe: boolean;
  /** Con qué criterio eligió el motor la posición (`STRATEGIC` / `DETERMINISTIC_DEFAULT` / `PHASE_FALLBACK`). Se dice tal cual; no se interpreta. */
  basis: TeamCoachTargetBasis | null;
  /** La razón que entrega el motor para ESTA decisión (verbatim). Es de la decisión del equipo, no del héroe que esté abierto en el panel. `null` = el motor no dijo nada. */
  reason: string | null;
}

/** ELIGE AHORA existe solo si la decisión apunta a una columna VISIBLE; nunca se reasigna a otro héroe. */
export function recommendationOf(board: TeamCoachBoardData, visible: readonly TeamPosition[], humanPosition: TeamPosition | null): Recommendation | null {
  const { recommendedPosition, recommendedHeroId, targetBasis, reason } = board.currentDecision;
  if (recommendedPosition === null || recommendedHeroId === null) return null;
  if (!visible.includes(recommendedPosition)) return null;
  const column = board.positions.find((entry) => entry.position === recommendedPosition);
  const card = column?.top.find((entry) => entry.heroId === recommendedHeroId);
  // Misma regla que Live (`features/team-coach/eligibility.ts`): una sola definición para las dos superficies.
  if (card === undefined || !canHighlightAsRecommended(card)) return null;
  return { position: recommendedPosition, heroId: recommendedHeroId, forMe: humanPosition === recommendedPosition, basis: targetBasis, reason: reason !== "" ? reason : null };
}

/** El motor puede decir «no hay pick humano ahora» (posición null + razón): se muestra como está, sin inventar una recomendación. */
export function noActionReasonOf(board: TeamCoachBoardData): string | null {
  const { recommendedPosition, recommendedHeroId, reason } = board.currentDecision;
  if (recommendedPosition !== null || recommendedHeroId !== null || reason === "") return null;
  return reason;
}

export interface OpenCandidate {
  position: TeamPosition;
  heroId: number;
}

/** Lo que el panel dice de la decisión del equipo, SEPARADO de las razones del héroe abierto. */
export type DecisionView =
  | { kind: "recommended"; heroId: number; position: TeamPosition; forMe: boolean; basis: TeamCoachTargetBasis | null; reason: string | null; /** El héroe abierto ES el recomendado. */ sameAsOpen: boolean }
  | { kind: "none"; reason: string };

/**
 * Pura. Si la decisión apunta a OTRO héroe u otra posición, `sameAsOpen` es false y la vista nombra a quién pertenece la explicación:
 * la razón de `currentDecision` nunca se atribuye al héroe abierto.
 */
export function decisionViewOf(recommendation: Recommendation | null, noActionReason: string | null, open: OpenCandidate): DecisionView | null {
  if (recommendation !== null) {
    const sameAsOpen = recommendation.position === open.position && recommendation.heroId === open.heroId;
    return { kind: "recommended", heroId: recommendation.heroId, position: recommendation.position, forMe: recommendation.forMe, basis: recommendation.basis, reason: recommendation.reason, sameAsOpen };
  }
  if (noActionReason !== null) return { kind: "none", reason: noActionReason };
  return null;
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
  const weak = hasLimitedEvidence(candidate);
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
    isPlan: showPlan && isPlannedCandidate(candidate) && !isRecommended && generalRank !== null,
    evidenceAsText: weak && state !== "uncertain",
    poolText: poolTextOf(candidate, poolRank),
  };
}

export const LEVEL_LABEL: Record<"hard" | "medium", string> = { hard: "Fuerte", medium: "Ventaja posible" };

/** Fracción (fr) del bloque de columnas frente al panel de análisis, por cantidad de posiciones controladas (Solo / Party 2 / 3 / 5). */
export const COLUMNS_FR: Record<number, number> = { 1: 4, 2: 6, 3: 8, 4: 9, 5: 10 };
