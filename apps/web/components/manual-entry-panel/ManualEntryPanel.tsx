"use client";

import { useState } from "react";
import { HeroPicker } from "@/components/hero-picker/HeroPicker";
import { postManualEvent } from "@/features/draft/manual-entry";
import { BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";
import type { TeamSide } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";

type ManualAction = "pick" | "ban";

function actionButtonClassName(current: ManualAction, target: ManualAction): string {
  if (current === target) return BUTTON_PRIMARY;
  return BUTTON_SECONDARY;
}

function sideButtonClassName(current: TeamSide, target: TeamSide): string {
  if (current === target) return BUTTON_PRIMARY;
  return BUTTON_SECONDARY;
}

interface ManualEntryPanelProps {
  sessionId: string;
  lastSeq: number;
  heroes: HeroMeta[];
  onClose: () => void;
}

// <Dominio><Cosa>: panel de entrada manual -- mismo POST /api/session/manual, mismo
// DraftEventEnvelope que cualquier otro capturador, confidence: 1.0, nunca reinicia la sesión
// (regla dura del ticket).
export function ManualEntryPanel({ sessionId, lastSeq, heroes, onClose }: ManualEntryPanelProps) {
  const [side, setSide] = useState<TeamSide>("radiant");
  const [action, setAction] = useState<ManualAction>("pick");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectRadiant() {
    setSide("radiant");
  }
  function selectDire() {
    setSide("dire");
  }
  function selectPickAction() {
    setAction("pick");
  }
  function selectBanAction() {
    setAction("ban");
  }

  async function handleHeroSelect(heroId: number) {
    setSubmitting(true);
    setError(null);

    const payload =
      action === "pick"
        ? { type: "hero_picked" as const, hero: heroId, side }
        : { type: "hero_banned" as const, hero: heroId, side: "unknown" as const };

    // Un fallo de red aquí es precisamente el escenario que la entrada manual existe para cubrir
    // ("cuando la detección automática falla") -- sin este try/catch, el panel quedaba con
    // "Enviando..." colgado para siempre (hallazgo de @redteam durante esta misma revisión).
    let result: Awaited<ReturnType<typeof postManualEvent>>;
    try {
      result = await postManualEvent(sessionId, lastSeq, payload);
    } catch {
      setSubmitting(false);
      setError("No se pudo contactar al motor -- revisa que esté corriendo e inténtalo de nuevo.");
      return;
    }
    setSubmitting(false);
    if (!result.accepted) {
      setError(`No se pudo aplicar: ${result.rejected ?? "motivo desconocido"}`);
      return;
    }
    onClose();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4">
      <div className="flex items-center justify-between">
        <span className="text-heading text-content-primary">Entrada manual</span>
        <button type="button" onClick={onClose} className={BUTTON_GHOST}>
          Cerrar
        </button>
      </div>
      <span className="text-caption text-content-muted">
        Úsala cuando el capturador automático no detecte un pick/ban, o para corregir uno que detectó mal.
      </span>

      <div className="flex gap-2">
        <button type="button" onClick={selectPickAction} className={actionButtonClassName(action, "pick")}>
          Pick
        </button>
        <button type="button" onClick={selectBanAction} className={actionButtonClassName(action, "ban")}>
          Ban
        </button>
      </div>

      {action === "pick" && (
        <div className="flex gap-2">
          <button type="button" onClick={selectRadiant} className={sideButtonClassName(side, "radiant")}>
            Radiant
          </button>
          <button type="button" onClick={selectDire} className={sideButtonClassName(side, "dire")}>
            Dire
          </button>
        </div>
      )}

      {error && <span className="text-caption text-signal-negative">{error}</span>}

      <HeroPicker heroes={heroes} onSelect={handleHeroSelect} />

      {submitting && <span className="text-caption text-content-muted">Enviando...</span>}
    </div>
  );
}
