"use client";

import { ComparisonNote } from "@/components/comparison-note/ComparisonNote";
import { ProDrafterEngineBadge, ProSuggestionRow } from "@/components/pro-drafter-panel/ProDrafterPanel";
import { SuggestionCard } from "@/components/suggestion-card/SuggestionCard";
import { isProDrafterEnabled } from "@/app/draft/live-config";
import { DEGRADATION_LABELS } from "@/features/draft/constants";
import type { DraftState, SuggestionSet } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { useCopilotProDrafter } from "../use-copilot-pro-drafter";

interface UpdatingNoticeProps {
  hasSuggestions: boolean;
}

// Req. 6.5: "Sin sugerencias disponibles" con indicador de actualizando -- se muestra mientras
// no llegó ningún SuggestionSet todavía, o mientras el último conocido quedó atrás del draftState
// (basedOnSeq !== lastSeq: hubo un pick/ban y el motor todavía no empujó las sugerencias nuevas
// por WebSocket). Es la misma señal que ya usa DEGRADED_DRAFT_STATE en features/draft, aplicada
// acá sin re-inventar un timer de 500ms en el frontend -- el motor ya corta a los 500ms (S3).
function UpdatingNotice({ hasSuggestions }: UpdatingNoticeProps) {
  if (hasSuggestions) return null;
  return <span className="text-caption text-content-muted">Sin sugerencias disponibles -- actualizando...</span>;
}

interface DegradedNoticeProps {
  degraded: SuggestionSet["degraded"];
}

function DegradedNotice({ degraded }: DegradedNoticeProps) {
  if (degraded.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-signal-warning bg-surface-raised p-3">
      {degraded.map((flag) => (
        <span key={flag} className="text-caption text-signal-warning">
          {DEGRADATION_LABELS[flag]}
        </span>
      ))}
    </div>
  );
}

function selectFreshSuggestions(draftState: DraftState | null, suggestions: SuggestionSet | null): SuggestionSet | null {
  if (!draftState || !suggestions) return null;
  if (suggestions.basedOnSeq !== draftState.lastSeq) return null;
  return suggestions;
}

export interface CopilotPanelProps {
  draftState: DraftState | null;
  suggestions: SuggestionSet | null;
  heroCatalog: Map<number, HeroMeta>;
}

interface CopilotPanelBodyProps {
  draftState: DraftState | null;
  suggestions: SuggestionSet | null;
  heroCatalog: Map<number, HeroMeta>;
}

// v5 puro -- comportamiento sin cambios respecto a antes de Fase 4, es lo que se sigue mostrando
// con ENABLE_PRO_DRAFTER apagado del lado del cliente (default, dark-launch intacto).
function V5CopilotBody({ draftState, suggestions, heroCatalog }: CopilotPanelBodyProps) {
  const fresh = selectFreshSuggestions(draftState, suggestions);
  const primary = fresh?.suggestions.find((s) => s.rank === 1);
  const alternatives = fresh?.suggestions.filter((s) => s.rank !== 1) ?? [];

  return (
    <>
      <UpdatingNotice hasSuggestions={fresh !== null} />
      {fresh && <DegradedNotice degraded={fresh.degraded} />}
      {primary && <SuggestionCard suggestion={primary} heroMeta={heroCatalog.get(primary.hero)} isPrimary />}
      {fresh?.comparison && <ComparisonNote comparison={fresh.comparison} heroMeta={heroCatalog.get(fresh.comparison.vsHero)} />}
      {alternatives.map((suggestion) => (
        <SuggestionCard key={suggestion.hero} suggestion={suggestion} heroMeta={heroCatalog.get(suggestion.hero)} isPrimary={false} />
      ))}
    </>
  );
}

// Fase 4 (consolidación del Simulador, sesión Gobernanza 2.0): Pro-Drafter en tiempo real -- se
// re-dispara solo con cada pick/ban nuevo (useCopilotProDrafter), nunca a mano. El badge comunica
// sin ambigüedad si lo que se ve salió del pipeline KNN/lane-sim/denial o cayó a v5 (fallback real,
// o retrocompatibilidad si el flag del motor está apagado -- ver toProDrafterView). Reutiliza
// ProDrafterEngineBadge/ProSuggestionRow tal cual (componente real, no una réplica visual
// distinta, mismo criterio que ya aplicaba SuggestionCard/ComparisonNote acá).
function ProDrafterCopilotBody({ draftState, heroCatalog }: CopilotPanelBodyProps) {
  const { view, isLoading, error } = useCopilotProDrafter(draftState, heroCatalog);

  return (
    <>
      <div className="flex items-center gap-2">
        {view && <ProDrafterEngineBadge engineVersion={view.engineVersion} cacheHit={view.cacheHit} />}
      </div>
      {isLoading && <span className="text-caption text-content-muted">Calculando...</span>}
      {error && <span className="text-caption text-signal-negative">No se pudo calcular la recomendación.</span>}
      {!isLoading && view && view.suggestions.length === 0 && (
        <span className="text-caption text-content-muted">Sin candidatos para el estado actual del draft.</span>
      )}
      {!isLoading &&
        view?.suggestions.map((suggestion) => <ProSuggestionRow key={suggestion.hero} suggestion={suggestion} heroCatalog={heroCatalog} />)}
    </>
  );
}

// <Dominio><Cosa>: sugerencias del Copilot durante la Blind_Round activa (Req. 6) -- mismas
// SuggestionCard/ComparisonNote que la vista de draft normal, para que el usuario practique con
// el componente real, no una réplica visual distinta. Con ENABLE_PRO_DRAFTER encendido del lado
// del cliente, cambia a la vista de Pro-Drafter en tiempo real (Fase 4) -- apagado (default), el
// árbol de render es exactamente el mismo que antes de esta fase. Early return, nunca un ternario
// de renderizado condicional (regla dura de web.md).
export function CopilotPanel({ draftState, suggestions, heroCatalog }: CopilotPanelProps) {
  if (isProDrafterEnabled()) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4">
        <span className="text-heading text-content-primary">Copilot</span>
        <ProDrafterCopilotBody draftState={draftState} suggestions={suggestions} heroCatalog={heroCatalog} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4">
      <span className="text-heading text-content-primary">Copilot</span>
      <V5CopilotBody draftState={draftState} suggestions={suggestions} heroCatalog={heroCatalog} />
    </div>
  );
}
