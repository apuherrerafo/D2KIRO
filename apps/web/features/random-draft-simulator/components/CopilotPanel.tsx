import { ComparisonNote } from "@/components/comparison-note/ComparisonNote";
import { SuggestionCard } from "@/components/suggestion-card/SuggestionCard";
import { DEGRADATION_LABELS } from "@/features/draft/constants";
import type { DraftState, SuggestionSet } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";

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

// <Dominio><Cosa>: sugerencias del Copilot durante la Blind_Round activa (Req. 6) -- mismas
// SuggestionCard/ComparisonNote que la vista de draft normal, para que el usuario practique con
// el componente real, no una réplica visual distinta.
export function CopilotPanel({ draftState, suggestions, heroCatalog }: CopilotPanelProps) {
  const fresh = selectFreshSuggestions(draftState, suggestions);
  const primary = fresh?.suggestions.find((s) => s.rank === 1);
  const alternatives = fresh?.suggestions.filter((s) => s.rank !== 1) ?? [];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4">
      <span className="text-heading text-content-primary">Copilot</span>
      <UpdatingNotice hasSuggestions={fresh !== null} />
      {fresh && <DegradedNotice degraded={fresh.degraded} />}
      {primary && <SuggestionCard suggestion={primary} heroMeta={heroCatalog.get(primary.hero)} isPrimary />}
      {fresh?.comparison && <ComparisonNote comparison={fresh.comparison} heroMeta={heroCatalog.get(fresh.comparison.vsHero)} />}
      {alternatives.map((suggestion) => (
        <SuggestionCard key={suggestion.hero} suggestion={suggestion} heroMeta={heroCatalog.get(suggestion.hero)} isPrimary={false} />
      ))}
    </div>
  );
}
