import type { TeamCoachCandidate } from "./types";

// Fase 4A.2 · UNA sola definición de «qué tarjeta puede destacarse» para las dos superficies del tablero (Live: `TeamCoachBoard`; Simulador: `SimulatorLightBoard`).
// Antes la regla vivía copiada en dos sitios y podía divergir en silencio. Es presentación del contrato V6 (el motor ya solo recomienda con evidencia FUERTE):
// no calcula, no ordena y no puntúa nada.
// Cualquier tarjeta, en cualquier superficie, decide su énfasis llamando a ESTAS funciones; `eligibility.parity.test.ts` lo verifica.

type EvidenceCarrier = Pick<TeamCoachCandidate, "evidenceStrength">;
type PlanCarrier = Pick<TeamCoachCandidate, "evidenceStrength" | "isPrimary">;

/** Evidencia limitada: la tarjeta se muestra marcada y nunca se destaca como recomendada ni como «plan». */
export function hasLimitedEvidence(candidate: EvidenceCarrier): boolean {
  return candidate.evidenceStrength === "WEAK";
}

/** El héroe que apunta `currentDecision` solo se destaca (ELIGE AHORA / «Elige a X») si su evidencia es FUERTE. */
export function canHighlightAsRecommended(candidate: EvidenceCarrier): boolean {
  return !hasLimitedEvidence(candidate);
}

/** «Plan de equipo»: el primario de su columna, y solo con evidencia FUERTE. */
export function isPlannedCandidate(candidate: PlanCarrier): boolean {
  return candidate.isPrimary && !hasLimitedEvidence(candidate);
}
