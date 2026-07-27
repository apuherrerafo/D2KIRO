"use client";

import { useState } from "react";
import { DraftHeroSlot } from "@/components/draft-hero-slot/DraftHeroSlot";
import { SignalBreakdown } from "@/components/signal-breakdown/SignalBreakdown";
import { CONFIDENCE_LABELS } from "@/features/draft/constants";
import { BUTTON_GHOST } from "@/features/draft/styles";
import type { Suggestion } from "@/features/draft/types";
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

interface SuggestionCardProps {
  suggestion: Suggestion;
  heroMeta: HeroMeta | undefined;
  isPrimary: boolean;
}

// <Dominio><Cosa>: una sugerencia de pick, con sus señales expandibles (SignalBreakdown) — una
// sugerencia de confianza baja se muestra igual, marcada como tal, nunca se oculta.
export function SuggestionCard({ suggestion, heroMeta, isPrimary }: SuggestionCardProps) {
  const [expanded, setExpanded] = useState(false);

  function toggleExpanded() {
    setExpanded((current) => !current);
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
      <button type="button" onClick={toggleExpanded} className={BUTTON_GHOST}>
        {toggleLabel(expanded)}
      </button>
      {expanded && <SignalBreakdown signals={suggestion.signals} />}
    </div>
  );
}
