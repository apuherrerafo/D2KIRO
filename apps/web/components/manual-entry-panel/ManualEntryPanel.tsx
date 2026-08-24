"use client";

import { useMemo, useState } from "react";
import { HeroPicker } from "@/components/hero-picker/HeroPicker";
import { describeRejection } from "@/features/draft/manual-entry";
import { useDraftStore } from "@/features/draft/store";
import { BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";
import type { HeroId, TeamSide } from "@/features/draft/types";
import { useSubmitDraftEvent } from "@/features/draft/use-submit-draft-event";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";

type ManualAction = "pick" | "ban";

function actionButtonClassName(current: ManualAction, target: ManualAction): string {
  if (current === target) return BUTTON_PRIMARY;
  return BUTTON_SECONDARY;
}

function sideButtonClassName(current: TeamSide | "unknown", target: TeamSide): string {
  if (current === target) return BUTTON_PRIMARY;
  return BUTTON_SECONDARY;
}

interface ManualEntryPanelProps {
  sessionId: string;
  heroes: HeroMeta[];
  // TSK-070: para que HeroPicker pueda deshabilitar héroes ya baneados/pickeados -- mismos campos
  // que DraftState.banned/picks, no el objeto completo.
  banned: HeroId[];
  picks: { radiant: HeroId[]; dire: HeroId[] };
  onClose: () => void;
}

// <Dominio><Cosa>: panel de entrada manual -- mismo POST /api/session/manual, mismo
// DraftEventEnvelope que cualquier otro capturador, confidence: 1.0, nunca reinicia la sesión
// (regla dura del ticket).
//
// RCA post-TSK-076 (TSK-079): `side`/`action` dejaron de ser useState local -- ahora leen y
// escriben `useDraftStore().inputMode`, la misma fuente de verdad que ya consumen HeroGrid (en la
// pantalla principal) y el quick-pick de SuggestionCard. Elegir "Ban" acá también cambia lo que
// hace un clic en HeroGrid mientras este panel esté abierto -- es exactamente el punto del
// modelo único: una sola respuesta a "qué pasa si toco un héroe ahora", no una por componente.
export function ManualEntryPanel({ sessionId, heroes, banned, picks, onClose }: ManualEntryPanelProps) {
  const inputMode = useDraftStore((s) => s.inputMode);
  const setInputMode = useDraftStore((s) => s.setInputMode);
  const submit = useSubmitDraftEvent(sessionId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // TSK-070: recalcula solo cuando banned/picks realmente cambian (llegan por WebSocket) -- evita
  // reconstruir el Set en cada tecla que el usuario escribe en el buscador de HeroPicker.
  const unavailableHeroIds = useMemo(() => new Set([...banned, ...picks.radiant, ...picks.dire]), [banned, picks]);

  function selectRadiant() {
    setInputMode({ side: "radiant" });
  }
  function selectDire() {
    setInputMode({ side: "dire" });
  }
  function selectPickAction() {
    setInputMode({ action: "pick" });
  }
  function selectBanAction() {
    setInputMode({ action: "ban" });
  }

  async function handleHeroSelect(heroId: number) {
    setSubmitting(true);
    setError(null);

    // Un fallo de red aquí es precisamente el escenario que la entrada manual existe para cubrir
    // ("cuando la detección automática falla") -- sin este try/catch, el panel quedaba con
    // "Enviando..." colgado para siempre (hallazgo de @redteam durante esta misma revisión).
    let result: Awaited<ReturnType<typeof submit>>;
    try {
      result = await submit(heroId);
    } catch {
      setSubmitting(false);
      setError("No se pudo contactar al motor -- revisa que esté corriendo e inténtalo de nuevo.");
      return;
    }
    setSubmitting(false);
    if (result === null) {
      setError("Elegí un lado (Radiant/Dire) antes de pickear.");
      return;
    }
    if (!result.accepted) {
      setError(describeRejection(result.rejected));
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
        <button type="button" onClick={selectPickAction} className={actionButtonClassName(inputMode.action, "pick")}>
          Pick
        </button>
        <button type="button" onClick={selectBanAction} className={actionButtonClassName(inputMode.action, "ban")}>
          Ban
        </button>
      </div>

      {inputMode.action === "pick" && (
        <div className="flex gap-2">
          <button type="button" onClick={selectRadiant} className={sideButtonClassName(inputMode.side, "radiant")}>
            Radiant
          </button>
          <button type="button" onClick={selectDire} className={sideButtonClassName(inputMode.side, "dire")}>
            Dire
          </button>
        </div>
      )}

      {error && <span className="text-caption text-signal-negative">{error}</span>}

      <HeroPicker heroes={heroes} unavailableHeroIds={unavailableHeroIds} onSelect={handleHeroSelect} />

      {submitting && <span className="text-caption text-content-muted">Enviando...</span>}
    </div>
  );
}
