"use client";

import { memo, useState } from "react";
import { DraftHeroSlot } from "@/components/draft-hero-slot/DraftHeroSlot";
import { SignalBreakdown } from "@/components/signal-breakdown/SignalBreakdown";
import { CONFIDENCE_LABELS } from "@/features/draft/constants";
import { BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";
import type { HeroId, Suggestion } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";

function cardClassName(isPrimary: boolean): string {
  const base = "flex flex-col gap-2 rounded-lg border p-4";
  if (isPrimary) return `${base} border-accent-primary bg-surface-raised`;
  return `${base} border-surface-border bg-surface-overlay`;
}

function toggleLabel(expanded: boolean): string {
  if (expanded) return "Ocultar señales";
  return "Ver señales";
}

function pickButtonClassName(isPrimary: boolean): string {
  if (isPrimary) return BUTTON_PRIMARY;
  return BUTTON_SECONDARY;
}

interface SuggestionCardProps {
  suggestion: Suggestion;
  heroMeta: HeroMeta | undefined;
  isPrimary: boolean;
  // TSK-054: ausente = sin botón de pick directo (uso en pruebas aisladas, o sin lado propio
  // identificado -- no hay a quién atribuirle el pick).
  onPick?: (hero: HeroId) => void;
}

// <Dominio><Cosa>: una sugerencia de pick, con sus señales expandibles (SignalBreakdown) — una
// sugerencia de confianza baja se muestra igual, marcada como tal, nunca se oculta.
export const SuggestionCard = memo(function SuggestionCard({ suggestion, heroMeta, isPrimary, onPick }: SuggestionCardProps) {
  const [expanded, setExpanded] = useState(false);

  function toggleExpanded() {
    setExpanded((current) => !current);
  }

  function handlePick() {
    onPick?.(suggestion.hero);
  }

  return (
    <div className={cardClassName(isPrimary)}>
      <div className="flex items-center gap-3">
        <DraftHeroSlot heroId={suggestion.hero} heroMeta={heroMeta} variant="pick" />
        <div className="flex flex-col gap-1">
          <span className="text-body text-content-primary">{suggestion.reason}</span>
          <span className="text-caption text-content-secondary">{CONFIDENCE_LABELS[suggestion.confidence]}</span>
        </div>
      </div>
      <div className="flex gap-2">
        {onPick && (
          <button type="button" onClick={handlePick} className={pickButtonClassName(isPrimary)}>
            Pickear
          </button>
        )}
        <button type="button" onClick={toggleExpanded} className={BUTTON_GHOST}>
          {toggleLabel(expanded)}
        </button>
      </div>
      {expanded && <SignalBreakdown signals={suggestion.signals} />}
    </div>
  );
});
