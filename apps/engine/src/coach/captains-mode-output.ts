import type { HeroId, PerspectiveDraftView } from "../draft-protocol/types";
import type { RecommendationBasedOn, RecommendationDegradation, RecommendationSetV2 } from "../recommendation/types";
import type { TeamCoachStrength, TeamCoachSynergy } from "./card-context";
import { reorderByContext, type ContextReorderInput } from "./context-reorder";
import { RANKING_INVALIDATING_REASONS } from "./current-human-decision";
import { eligibilityInputOf, type EligibilityData } from "./eligibility-input";
import { buildHeroCard, extractHeroCandidates, type HeroCard, type HeroCandidate } from "./hero-card";
import { evaluateEligibility, type EvidenceStrength, type Ground, type GroundKind } from "./recommendation-eligibility";

// CONTRATO DE ELEGIBILIDAD en Captains Mode (dueño del producto, 2026-11-04).
//
// Captains Mode no pasa por el Coach de Ranked All Pick: su recomendación nacía del V2 crudo (`buildRecommendationSetV2`, estado del protocolo) y la
// pantalla pintaba el desglose de V6 ("posición y momento del pick", confianza alta) para cualquier héroe del top. Este módulo le aplica la MISMA regla
// que a las demás superficies, sin copiarla: `evaluateEligibility` (recommendation-eligibility.ts) decide qué héroe se muestra y con qué fuerza.
//
//   PICK -> el mismo contexto que la decisión V4 (bans, picks propios, rivales revelados -- en CM todo se ve) y el mismo `HeroCard` que el Coach:
//           sin fundamento no hay tarjeta; la frase y las etiquetas salen de los fundamentos (jamás de `position_fit`); solo un fundamento FUERTE
//           puede ser el héroe recomendado.
//   BAN  -> la pregunta cambia: no "¿qué me sirve a mí?" sino "¿qué le sirve al rival contra mí?". Se evalúa con el contexto en espejo (mis picks son
//           los "rivales revelados" y los picks del rival son los "aliados"), y solo cuentan los fundamentos relacionales con porqué: le gana a un
//           pick tuyo, o hace pareja con un pick suyo. Un héroe que solo es popular, o que V6 puntúa alto PARA TI, no es un ban sin fundamento.
//
// Pura: sin I/O, sin reloj. Nada aquí puntúa: el orden de los picks es el de V6 + bono de contexto, el de los bans es la fuerza del fundamento.

export const CAPTAINS_MODE_OUTPUT_SCHEMA = "recommendation-output/cm-v1" as const;
export const CAPTAINS_MODE_SHORTLIST_SIZE = 5;

/** Cuántos candidatos de V6 se piden para poder filtrar por elegibilidad sin quedarse sin héroes elegibles fuera del top. */
export const CAPTAINS_MODE_CANDIDATE_LIMIT = 200;

export interface CaptainsModeBanCard {
  heroId: HeroId;
  /** STRONG = le gana duro a un pick tuyo o hace pareja con uno suyo. WEAK = solo un counter medio. Solo STRONG puede ser el ban recomendado. */
  evidenceStrength: EvidenceStrength;
  /** Picks TUYOS a los que este héroe le gana (con el porqué curado): el rival lo usaría contra ti. */
  beatsYourPicks: TeamCoachStrength[];
  /** Picks del RIVAL con los que este héroe hace pareja (con el porqué curado). */
  pairsWithTheirPicks: TeamCoachSynergy[];
  score: number;
}

export interface CaptainsModeOutput {
  schema: typeof CAPTAINS_MODE_OUTPUT_SCHEMA;
  sessionId: string;
  /** Lo que se decide ahora. Null cuando no es el turno del jugador (no hay nada que recomendar). */
  actionKind: "PICK" | "BAN" | null;
  step: number | null;
  /** Solo en un PICK: los héroes elegibles, ya filtrados por el contrato. Vacío = ninguno es elegible (no hay relleno ni mensaje). */
  picks: HeroCard[];
  /** Solo en un BAN: los héroes con un fundamento relacional para banear. Vacío = ninguno. */
  bans: CaptainsModeBanCard[];
  /** El héroe recomendado ahora: solo si el primero de la lista tiene evidencia FUERTE. Null = ninguno se destaca (el WEAK aparece pero no se recomienda). */
  primaryHeroId: HeroId | null;
  degradations: readonly RecommendationDegradation[];
  basedOn: RecommendationBasedOn;
}

export interface BuildCaptainsModeOutputInput {
  set: RecommendationSetV2;
  view: PerspectiveDraftView;
  data: EligibilityData;
  shortlistSize?: number;
}

/** Los únicos fundamentos que justifican un ban: relaciones curadas con porqué contra lo que YA se ve. */
const BAN_GROUND_KINDS: ReadonlySet<GroundKind> = new Set<GroundKind>(["COUNTER_REVEALED", "SYNERGY_PAIR"]);

/** El contexto visto desde el rival: mis picks son sus "rivales revelados" y sus picks son sus "aliados ya elegidos". */
function mirrored(context: ContextReorderInput): ContextReorderInput {
  return { ...context, ownPicks: context.revealedEnemies, revealedEnemies: context.ownPicks, targetPosition: undefined };
}

function strengthOf(grounds: readonly Ground[]): EvidenceStrength {
  return grounds.some((ground) => ground.strength === "STRONG") ? "STRONG" : "WEAK";
}

function emptyOutput(input: BuildCaptainsModeOutputInput): CaptainsModeOutput {
  const { set } = input;
  return {
    schema: CAPTAINS_MODE_OUTPUT_SCHEMA,
    sessionId: set.sessionId,
    actionKind: set.decision.actionKind,
    step: set.decision.step,
    picks: [],
    bans: [],
    primaryHeroId: null,
    degradations: set.degradations,
    basedOn: set.basedOn,
  };
}

function pickCards(candidates: readonly HeroCandidate[], input: BuildCaptainsModeOutputInput, size: number): HeroCard[] {
  const eligibilityInput = eligibilityInputOf(input.view, input.data);
  return reorderByContext(candidates, eligibilityInput.context)
    .flatMap((candidate) => {
      const eligibility = evaluateEligibility(candidate, eligibilityInput);
      return eligibility.grounds.length > 0 ? [buildHeroCard(candidate, [], eligibility)] : [];
    })
    .slice(0, size);
}

function banCards(candidates: readonly HeroCandidate[], input: BuildCaptainsModeOutputInput, size: number): CaptainsModeBanCard[] {
  const eligibilityInput = eligibilityInputOf(input.view, input.data);
  // Sin composición: "te falta iniciar" es una razón para PICKEAR, no para banear.
  const mirror = { context: mirrored(eligibilityInput.context) };
  return candidates
    .flatMap((candidate, index) => {
      const eligibility = evaluateEligibility(candidate, mirror);
      const grounds = eligibility.grounds.filter((ground) => BAN_GROUND_KINDS.has(ground.kind));
      if (grounds.length === 0) return [];
      const card: CaptainsModeBanCard = {
        heroId: candidate.heroId,
        evidenceStrength: strengthOf(grounds),
        beatsYourPicks: grounds.some((ground) => ground.kind === "COUNTER_REVEALED") ? eligibility.context.strengths : [],
        pairsWithTheirPicks: grounds.some((ground) => ground.kind === "SYNERGY_PAIR") ? eligibility.context.synergies : [],
        score: candidate.score,
      };
      return [{ card, index }];
    })
    // La fuerza del fundamento manda; a igualdad, el orden de V6 (estable).
    .sort((a, b) => Number(b.card.evidenceStrength === "STRONG") - Number(a.card.evidenceStrength === "STRONG") || a.index - b.index)
    .map(({ card }) => card)
    .slice(0, size);
}

/**
 * La salida de Captains Mode: solo héroes con un fundamento verificable (`evaluateEligibility`), con su fuerza. Un ranking sin base confiable (sin meta,
 * sin universo legal) nunca se rescata con héroes sin fundamento. Sin elegibles: listas vacías, sin relleno.
 */
export function buildCaptainsModeOutput(input: BuildCaptainsModeOutputInput): CaptainsModeOutput {
  const { set } = input;
  const empty = emptyOutput(input);
  const kind = set.decision.actionKind;
  if (kind === null || set.recommendations.length === 0) return empty;
  if (set.degradations.some((degradation) => RANKING_INVALIDATING_REASONS.has(degradation.reason))) return empty;
  const size = input.shortlistSize ?? CAPTAINS_MODE_SHORTLIST_SIZE;
  const candidates = extractHeroCandidates(set, input.data.heroPositions);
  if (kind === "BAN") {
    const bans = banCards(candidates, input, size);
    return { ...empty, bans, primaryHeroId: bans[0]?.evidenceStrength === "STRONG" ? bans[0].heroId : null };
  }
  const picks = pickCards(candidates, input, size);
  return { ...empty, picks, primaryHeroId: picks[0]?.evidenceStrength === "STRONG" ? picks[0].heroId : null };
}
