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

function pickButtonLabel(submitting: boolean): string {
  if (submitting) return "Enviando...";
  return "Pickear";
}

interface SuggestionCardProps {
  suggestion: Suggestion;
  heroMeta: HeroMeta | undefined;
  isPrimary: boolean;
  // TSK-054: ausente = sin botón de pick directo (uso en pruebas aisladas, o sin lado propio
  // identificado -- no hay a quién atribuirle el pick). TSK-070: puede devolver una promesa
  // (DraftView.handleQuickPick es async) o nada -- la tarjeta normaliza los dos casos con
  // Promise.resolve() para saber cuándo terminó, sin obligar al padre a exponer su propio flag.
  onPick?: (hero: HeroId) => void | Promise<void>;
}

// <Dominio><Cosa>: una sugerencia de pick, con sus señales expandibles (SignalBreakdown) — una
// sugerencia de confianza baja se muestra igual, marcada como tal, nunca se oculta.
export const SuggestionCard = memo(function SuggestionCard({ suggestion, heroMeta, isPrimary, onPick }: SuggestionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function toggleExpanded() {
    setExpanded((current) => !current);
  }

  // TSK-070: `submitting` se pone en true de forma síncrona, antes de que la promesa arranque --
  // un segundo clic durante el vuelo del primero queda bloqueado por el `disabled` del botón, sin
  // depender de ningún debounce por tiempo. Se apaga en el `finally`, tanto si el pick fue
  // aceptado como si el motor lo rechazó (DraftView.tsx sigue mostrando el motivo vía pickError).
  function handlePick() {
    if (submitting) return;
    setSubmitting(true);
    Promise.resolve(onPick?.(suggestion.hero)).finally(() => setSubmitting(false));
  }

  return (
    <div className={cardClassName(isPrimary)}>
      <div className="flex items-start gap-3">
        <DraftHeroSlot heroId={suggestion.hero} heroMeta={heroMeta} variant="pick" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* TSK-077 (spec §1.3): el impacto táctico real ("Aporta initiation...", "Fuerte
              contra X", "Rol flexible...") es lo primero que se lee, con el mayor peso visual de
              la tarjeta -- badge con borde/fondo de acento, no una línea de texto plano más. La
              confianza baja a caption muted, deja de competir con lo que importa. */}
          <span className="w-fit max-w-full rounded-md border border-accent-primary/40 bg-accent-primary/10 px-2.5 py-1.5 text-body font-semibold text-content-primary">
            {suggestion.reason}
          </span>
          <span className="text-caption text-content-muted">{CONFIDENCE_LABELS[suggestion.confidence]}</span>
        </div>
      </div>
      <div className="flex gap-2">
        {onPick && (
          <button type="button" onClick={handlePick} disabled={submitting} className={pickButtonClassName(isPrimary)}>
            {pickButtonLabel(submitting)}
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
