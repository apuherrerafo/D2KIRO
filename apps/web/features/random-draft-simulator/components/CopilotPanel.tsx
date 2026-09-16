"use client";

import { useEffect } from "react";
import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import { SuggestionCard } from "@/components/suggestion-card/SuggestionCard";
import { BUTTON_GHOST } from "@/features/draft/styles";
import { CONFIDENCE_LABELS } from "@/features/draft/constants";
import type { DraftDecisionContext, HeroId, Suggestion } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { PreviewStatus } from "../store";
import { NOT_COMPUTED, type RecommendationPosition, type RecommendationSetV2, type RecommendationV2 } from "../protocol-client";

// R1 S5 (independent architecture review, blockers 1 + 8) -- this panel is the ONE human-facing
// Copilot for the R1 ProtocolSession-backed simulator. It renders RecommendationSet/v2 ONLY:
// no /api/suggestions/preview, no Pro-Drafter (`/api/v1/draft/pro-recommendations`), regardless of
// ENABLE_PRO_DRAFTER -- that flag has no effect on this component at all. The functions below are
// a pure presentational adapter (RecommendationSet/v2 -> view model): they never score, rank,
// reinfer roles, or reconstruct a DraftState -- every field they read was already computed by the
// engine (recommendation.score/confidence/legacy/roleImpact, verbatim).

interface PreviewStatusNoticeProps {
  previewStatus: PreviewStatus;
  hasRecommendations: boolean;
  onRetry: () => void;
}

// Máquina explícita del Copilot (nunca "actualizando" indefinido): "loading" mientras se calcula,
// "failed" ofrece reintentar en vez de quedarse congelado en silencio, "ready"/"idle" no agregan
// texto propio -- el cuerpo de abajo ya decide qué mostrar con las recomendaciones que tenga.
function PreviewStatusNotice({ previewStatus, hasRecommendations, onRetry }: PreviewStatusNoticeProps) {
  if (previewStatus === "failed") {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-signal-negative bg-surface-raised p-3">
        <span className="text-caption text-signal-negative">No se pudo calcular la recomendación.</span>
        <button type="button" onClick={onRetry} className={BUTTON_GHOST}>
          Reintentar
        </button>
      </div>
    );
  }
  if (previewStatus === "loading" || !hasRecommendations) {
    return <span className="text-caption text-content-muted">Calculando recomendación...</span>;
  }
  return null;
}

interface DegradationsNoticeProps {
  degradations: RecommendationSetV2["degradations"];
}

function DegradationsNotice({ degradations }: DegradationsNoticeProps) {
  if (degradations.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-signal-warning bg-surface-raised p-3">
      {degradations.map((degradation) => (
        <span key={`${degradation.reason}:${degradation.detail}`} className="text-caption text-signal-warning">
          {degradation.detail}
        </span>
      ))}
    </div>
  );
}

const DECISION_CONTEXT_LABELS: Record<DraftDecisionContext, string> = {
  team_opening: "Apertura de equipo",
  blind_second_pick: "Pick 2 — información ciega",
  response_pick: "Pick 3/4 — respuesta a rivales revelados",
  closing_pick: "Cierre — composición y riesgos",
  no_signal_available: "No hay señales disponibles para votar",
};

function DecisionContextNotice({ decisionContext }: { decisionContext: RecommendationSetV2["decisionContext"] }) {
  if (decisionContext === "no_action") return null;
  return <span className="text-caption font-semibold text-accent-primary">{DECISION_CONTEXT_LABELS[decisionContext]}</span>;
}

// R1 S7 -- terminología en castellano consistente con el resto del producto (web.md, Fase 3):
// "hard support, support, offlane, midlane, carry", nunca "pos 1/2/3/4/5" a secas.
const POSITION_LABELS: Record<RecommendationPosition, string> = {
  1: "Carry",
  2: "Midlane",
  3: "Offlane",
  4: "Support",
  5: "Hard support",
};

const RISK_LABELS: Record<string, string> = {
  low_evidence: "Evidencia limitada",
  unresolved_role: "Rol aún no resuelto",
  degraded_meta: "Meta desactualizado",
};

/** Posición sugerida para el héroe de una recomendación de un solo héroe -- lee `roleImpact`
 * (S4, ya calculado por el motor) verbatim, nunca reinfiere el rol acá. Compuesta (2+ héroes) ya
 * muestra su propia posición por héroe en `CompoundRecommendationCard`. */
function RoleImpactNotice({ recommendation }: { recommendation: RecommendationV2 }) {
  if (recommendation.actions.length !== 1) return null;
  const impact = recommendation.roleImpact[recommendation.actions[0].hero];
  if (!impact || impact.status === "UNRESOLVED" || impact.position === null) return null;
  return <span className="text-caption text-content-muted">Posición sugerida: {POSITION_LABELS[impact.position]}</span>;
}

/** `risks` (S5) nunca se calló hasta ahora -- venía en el wire, pero ningún componente lo leía. */
function RecommendationRisksNotice({ risks }: { risks: RecommendationV2["risks"] }) {
  if (risks.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-signal-warning/50 bg-signal-warning/10 p-2">
      {risks.map((risk) => (
        <span key={`${risk.kind}:${risk.detail}`} className="text-caption text-signal-warning">
          {RISK_LABELS[risk.kind] ?? risk.kind}: {risk.detail}
        </span>
      ))}
    </div>
  );
}

function heroLabel(heroId: HeroId, heroCatalog: Map<number, HeroMeta>): string {
  return heroCatalog.get(heroId)?.localizedName ?? `Héroe ${heroId}`;
}

/** R1 S6, ahora visible -- `deferred` sólo trae dato real para `recommendations[0]`, y sólo para
 * los estados donde el motor encontró algo concreto que decir (PLAUSIBLE_RESPONSE / MATERIALIZED /
 * un delta calculado). Todo sentinel "no hay nada que mostrar" (NOT_COMPUTED, NO_LEGAL_RESPONSE,
 * COLLISION_PENDING, DRAFT_COMPLETE, OWN_ACTION_UNAVAILABLE, SIMULATION_UNAVAILABLE,
 * STILL_CONTESTABLE, NOT_APPLICABLE) se omite en silencio -- nunca una tarjeta vacía, nunca un
 * "72% de probabilidad" que esta señal no puede respaldar (ningún número acá es una probabilidad
 * calibrada, son puntajes V6 reutilizados desde la perspectiva del rival). */
function OpponentIntelligenceNotice({ deferred, heroCatalog }: { deferred: RecommendationSetV2["deferred"]; heroCatalog: Map<number, HeroMeta> }) {
  const lines: string[] = [];
  const { opponentResponse, steal, lookahead } = deferred;

  if (opponentResponse !== NOT_COMPUTED && opponentResponse.status === "PLAUSIBLE_RESPONSE" && opponentResponse.action) {
    lines.push(`Respuesta rival plausible: ${heroLabel(opponentResponse.action.hero, heroCatalog)}.`);
  }

  if (steal !== NOT_COMPUTED && steal.status === "MATERIALIZED" && steal.heroId !== null) {
    lines.push(`Este pick le quita ${heroLabel(steal.heroId, heroCatalog)} al rival, que ya lo consideraba fuerte.`);
  }

  if (lookahead !== NOT_COMPUTED && lookahead.resultingEvaluation && lookahead.resultingEvaluation.opponentResponseScore !== null) {
    const { ourActionScore, opponentResponseScore } = lookahead.resultingEvaluation;
    lines.push(`Después de este pick, el modelo considera al rival con fuerza ${opponentResponseScore.toFixed(0)} frente a tu ${ourActionScore.toFixed(0)}.`);
  }

  if (lines.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 rounded-md border border-surface-border bg-surface-overlay p-2" data-testid="opponent-intelligence">
      <span className="text-caption font-semibold text-content-primary">Lectura del rival (1 jugada)</span>
      {lines.map((line) => (
        <span key={line} className="text-caption text-content-secondary">{line}</span>
      ))}
    </div>
  );
}

/** Pure presentational projection: a single-action Recommendation already carries its own honest
 * V1 shape (`legacy`, populated by build.ts verbatim from the same V6 Suggestion) -- this only
 * reshapes it plus the sibling score/confidence fields into what SuggestionCard already renders.
 * A compound Recommendation (legacy: null) has no single-hero shape to project into -- see
 * CompoundRecommendationCard below instead. */
function toSuggestionViewModel(recommendation: RecommendationV2, rank: Suggestion["rank"]): Suggestion | null {
  if (!recommendation.legacy) return null;
  return {
    hero: recommendation.legacy.hero,
    rank,
    score: recommendation.score,
    signals: recommendation.legacy.signals,
    reason: recommendation.legacy.reason,
    confidence: recommendation.confidence,
    evidenceCoverage: recommendation.legacy.evidenceCoverage,
    guessingIndex: recommendation.legacy.guessingIndex,
  };
}

interface CompoundRecommendationCardProps {
  recommendation: RecommendationV2;
  heroCatalog: Map<number, HeroMeta>;
  isPrimary: boolean;
}

// <Dominio><Cosa>: una recomendación de 2 héroes simultáneos (rondas 1/2 de Ranked All Pick, party
// con más de un slot propio abierto) -- V6 no tiene un score de "sinergia del par" (build.ts's
// score es la suma pura de los dos scores independientes), así que esta tarjeta muestra cada héroe
// con su propio impacto de rol, nunca un número inventado que sugiera un cálculo conjunto que no
// existe.
function CompoundRecommendationCard({ recommendation, heroCatalog, isPrimary }: CompoundRecommendationCardProps) {
  const base = "flex flex-col gap-2 rounded-lg border p-3";
  const className = isPrimary ? `${base} border-accent-primary bg-surface-raised` : `${base} border-surface-border bg-surface-overlay`;
  return (
    <div className={className}>
      <div className="flex items-center justify-between">
        <span className="text-caption font-semibold text-content-primary">Dupla sugerida</span>
        <span className="text-caption text-content-muted">{CONFIDENCE_LABELS[recommendation.confidence]}</span>
      </div>
      <div className="flex items-center gap-4">
        {recommendation.actions.map((action) => {
          const heroMeta = heroCatalog.get(action.hero);
          const impact = recommendation.roleImpact[action.hero];
          return (
            <div key={action.hero} className="flex items-center gap-2">
              <HeroIcon imgUrl={heroMeta?.imgUrl ?? ""} alt={heroMeta?.localizedName ?? `Héroe ${action.hero}`} size={40} />
              <div className="flex flex-col">
                <span className="text-caption text-content-primary">{heroMeta?.localizedName ?? `Héroe ${action.hero}`}</span>
                {impact && impact.position !== null && (
                  <span className="text-caption text-content-muted">Posición {impact.position}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface RecommendationListProps {
  recommendationSet: RecommendationSetV2 | null;
  heroCatalog: Map<number, HeroMeta>;
}

function RecommendationList({ recommendationSet, heroCatalog }: RecommendationListProps) {
  if (!recommendationSet) return null;
  const { recommendations } = recommendationSet;
  if (recommendations.length === 0) return null;

  const singleActionSuggestions = recommendations
    .map((recommendation, index) => toSuggestionViewModel(recommendation, (Math.min(index + 1, 6)) as Suggestion["rank"]))
    .filter((suggestion): suggestion is Suggestion => suggestion !== null);

  if (singleActionSuggestions.length > 0) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {singleActionSuggestions.map((suggestion) => (
          <SuggestionCard key={suggestion.hero} suggestion={suggestion} heroMeta={heroCatalog.get(suggestion.hero)} isPrimary={suggestion.rank === 1} compact />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {recommendations.map((recommendation, index) => (
        <CompoundRecommendationCard
          key={recommendation.actions.map((action) => action.hero).join(",")}
          recommendation={recommendation}
          heroCatalog={heroCatalog}
          isPrimary={index === 0}
        />
      ))}
    </div>
  );
}

export interface CopilotPanelProps {
  recommendations: RecommendationSetV2 | null;
  heroCatalog: Map<number, HeroMeta>;
  previewStatus?: PreviewStatus;
  onRetryPreview?: () => void;
  onSuggestedHeroIdsChange?: (heroIds: ReadonlySet<HeroId>) => void;
}

function noop() {
  // Sin sesión del simulador todavía conectada a un retry real (p. ej. Draft en Vivo, que no pasa
  // onRetryPreview) -- botón inerte en vez de un handler faltante.
}

export function CopilotPanel({ recommendations, heroCatalog, previewStatus = "idle", onRetryPreview = noop, onSuggestedHeroIdsChange }: CopilotPanelProps) {
  const suggestedHeroKey = recommendations?.recommendations.flatMap((r) => r.actions.map((a) => a.hero)).join(",") ?? "";

  // La cuadrícula y el Copilot deben reflejar exactamente la misma respuesta -- mismo criterio que
  // ya usaba la variante Pro-Drafter de este panel antes de esta migración.
  useEffect(() => {
    if (!onSuggestedHeroIdsChange) return;
    const heroIds = recommendations?.recommendations.flatMap((r) => r.actions.map((a) => a.hero)) ?? [];
    onSuggestedHeroIdsChange(new Set(heroIds));
    // suggestedHeroKey estabiliza el conjunto derivado y evita un efecto infinito.
  }, [onSuggestedHeroIdsChange, suggestedHeroKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasRecommendations = (recommendations?.recommendations.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4">
      <span className="text-heading text-content-primary">Copilot</span>
      <PreviewStatusNotice previewStatus={previewStatus} hasRecommendations={hasRecommendations} onRetry={onRetryPreview} />
      {recommendations && <DegradationsNotice degradations={recommendations.degradations} />}
      {recommendations && <DecisionContextNotice decisionContext={recommendations.decisionContext} />}
      {recommendations && !hasRecommendations && previewStatus === "ready" && (
        <span className="text-caption text-content-muted">Sin candidatos para el estado actual del draft.</span>
      )}
      {recommendations && hasRecommendations && (
        <div className="flex flex-col gap-2">
          <RoleImpactNotice recommendation={recommendations.recommendations[0]} />
          <RecommendationRisksNotice risks={recommendations.recommendations[0].risks} />
          <OpponentIntelligenceNotice deferred={recommendations.deferred} heroCatalog={heroCatalog} />
        </div>
      )}
      <RecommendationList recommendationSet={recommendations} heroCatalog={heroCatalog} />
    </div>
  );
}
