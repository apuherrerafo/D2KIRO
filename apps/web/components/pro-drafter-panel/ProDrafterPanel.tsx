"use client";

import { useState } from "react";
import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import type { DraftState, HeroId } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { BUTTON_SECONDARY } from "@/features/draft/styles";
import { buildProDrafterRequest, ENGINE_VERSION_LABELS, PRO_SIGNAL_LABELS, toProDrafterView } from "@/features/pro-drafter/types";
import type { ProEngineVersion, ProSuggestion } from "@/features/pro-drafter/types";
import { usePostProRecommendationsMutation } from "@/lib/engine-api";

interface ProDrafterPanelProps {
  draftState: DraftState;
  heroCatalog: Map<HeroId, HeroMeta>;
}

function heroName(hero: HeroMeta | undefined, heroId: HeroId): string {
  if (hero) return hero.localizedName;
  return `Héroe ${heroId}`;
}

function formatRaw(raw: number | null): string {
  if (raw === null) return "sin dato";
  return raw.toFixed(2);
}

function engineBadgeClassName(engineVersion: ProEngineVersion): string {
  if (engineVersion === "pro-drafter") return "border-signal-positive text-signal-positive";
  return "border-signal-warning text-signal-warning";
}

export interface ProDrafterEngineBadgeProps {
  engineVersion: ProEngineVersion;
  cacheHit: boolean;
}

// Fase 3 (sesión Gobernanza 2.0): transparencia en tiempo real de qué motor generó la sugerencia
// -- nunca calla si el resultado en pantalla vino de v5 (fallback real, o el flag del motor está
// apagado y esta URL responde con el shape legacy, ver toProDrafterView en features/pro-drafter).
// Exportado en Fase 4 (consolidación del Simulador): CopilotPanel (random-draft-simulator) lo
// reutiliza tal cual -- mismo componente real, nunca una réplica visual distinta (mismo criterio
// que ya aplicaba SuggestionCard/ComparisonNote en ese panel).
export function ProDrafterEngineBadge({ engineVersion, cacheHit }: ProDrafterEngineBadgeProps) {
  return (
    <div className="flex items-center gap-2">
      <span className={`rounded-full border px-2 py-0.5 text-caption ${engineBadgeClassName(engineVersion)}`}>
        {ENGINE_VERSION_LABELS[engineVersion]}
      </span>
      {cacheHit && (
        <span className="rounded-full border border-surface-border px-2 py-0.5 text-caption text-content-muted">Caché</span>
      )}
    </div>
  );
}

export interface ProSuggestionRowProps {
  suggestion: ProSuggestion;
  heroCatalog: Map<HeroId, HeroMeta>;
}

// Exportado en Fase 4 -- mismo criterio que ProDrafterEngineBadge arriba.
export function ProSuggestionRow({ suggestion, heroCatalog }: ProSuggestionRowProps) {
  const hero = heroCatalog.get(suggestion.hero);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-surface-border bg-surface-overlay p-3">
      <div className="flex items-center gap-2">
        <HeroIcon imgUrl={hero?.imgUrl ?? ""} alt={heroName(hero, suggestion.hero)} size={36} />
        <div className="flex flex-1 items-center justify-between gap-2">
          <span className="text-body text-content-primary">
            #{suggestion.rank} {heroName(hero, suggestion.hero)}
          </span>
          <span className="text-caption text-content-muted">score {suggestion.score.toFixed(3)}</span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        {suggestion.signals.map((signal) => (
          <div key={signal.signal} className="flex justify-between text-caption text-content-secondary">
            <span>{PRO_SIGNAL_LABELS[signal.signal]}</span>
            <span>{formatRaw(signal.raw)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Panel experimental cerrado por defecto, mismo patrón que DraftPathsCoverFlow (Fase 2,
// features/draft-paths/): la llamada al motor solo se dispara al abrir, nunca eager. A diferencia
// de DraftPathsCoverFlow (RTK Query `skip`), acá es una `mutation` (POST con body) -- se dispara a
// mano en `handleOpen`, mismo efecto de "cerrado = cero request" sin depender de `skip`.
export function ProDrafterPanel({ draftState, heroCatalog }: ProDrafterPanelProps) {
  const [isOpen, setOpen] = useState(false);
  const [triggerRecommendations, { data, isLoading, error }] = usePostProRecommendationsMutation();
  // Retrocompatibilidad real (server/app.ts:258-260): `data` puede llegar en el shape v5 legacy
  // si ENABLE_PRO_DRAFTER está apagado del lado del motor -- toProDrafterView normaliza las dos
  // formas posibles antes de que este componente toque un solo campo.
  const view = data ? toProDrafterView(data) : null;

  function handleOpen() {
    setOpen(true);
    void triggerRecommendations(buildProDrafterRequest(draftState));
  }

  function handleClose() {
    setOpen(false);
  }

  if (!isOpen) {
    return (
      <button type="button" onClick={handleOpen} className={BUTTON_SECONDARY}>
        Top 3 experimental (Pro-Drafter)
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-heading text-content-primary">Pro-Drafter (experimental)</span>
          {view && <ProDrafterEngineBadge engineVersion={view.engineVersion} cacheHit={view.cacheHit} />}
        </div>
        <button type="button" onClick={handleClose} className={BUTTON_SECONDARY}>
          Cerrar
        </button>
      </div>
      {isLoading && <span className="text-body text-content-secondary">Calculando...</span>}
      {error && <span className="text-body text-signal-negative">No se pudo calcular la recomendación experimental.</span>}
      {view && view.suggestions.length === 0 && <span className="text-body text-content-secondary">Sin candidatos para el estado actual del draft.</span>}
      {view && view.suggestions.length > 0 && (
        <div className="flex flex-col gap-2">
          {view.suggestions.map((suggestion) => (
            <ProSuggestionRow key={suggestion.hero} suggestion={suggestion} heroCatalog={heroCatalog} />
          ))}
        </div>
      )}
    </div>
  );
}
