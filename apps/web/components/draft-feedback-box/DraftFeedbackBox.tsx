"use client";

import { useState, type ChangeEvent } from "react";
import { postDraftFeedback } from "@/features/draft-feedback";
import { BUTTON_PRIMARY } from "@/features/draft/styles";
import type { DraftState, SuggestionSet } from "@/features/draft/types";

interface DraftFeedbackBoxProps {
  sessionId: string;
  draftState: DraftState;
  suggestions: SuggestionSet | null;
}

// <Dominio><Cosa>: caja de reporte de QA -- TSK-052. Manda el comentario junto con una foto exacta
// del draftState/suggestions del momento del envío (props ya frescas por el propio ciclo de
// render de React, no un valor cacheado) para que la revisión futura tenga contexto real.
export function DraftFeedbackBox({ sessionId, draftState, suggestions }: DraftFeedbackBoxProps) {
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedOk, setSubmittedOk] = useState(false);

  function handleCommentChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setComment(event.target.value);
    setSubmittedOk(false);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);

    // Un fallo de red es exactamente el tipo de cosa que este botón no puede dejar colgada en
    // "Enviando..." para siempre -- mismo hallazgo real que ya corrigió ManualEntryPanel.
    let result: Awaited<ReturnType<typeof postDraftFeedback>>;
    try {
      result = await postDraftFeedback(sessionId, comment, draftState, suggestions);
    } catch {
      setSubmitting(false);
      setError("No se pudo contactar al motor -- revisa que esté corriendo e inténtalo de nuevo.");
      return;
    }
    setSubmitting(false);
    if (!result.accepted) {
      setError("No se pudo guardar el reporte.");
      return;
    }
    setComment("");
    setSubmittedOk(true);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-surface-border bg-surface-raised p-4">
      <span className="text-heading text-content-primary">Reporte de QA</span>
      <span className="text-caption text-content-muted">
        Se guarda junto con el estado del draft y las sugerencias actuales, para revisarlo después con el contexto completo.
      </span>
      <textarea
        value={comment}
        onChange={handleCommentChange}
        placeholder="¿Qué está mal, o qué no tiene sentido?"
        className="min-h-20 rounded-md border border-surface-border bg-surface-base p-2 text-body text-content-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
      />
      {error && <span className="text-caption text-signal-negative">{error}</span>}
      {submittedOk && <span className="text-caption text-signal-positive">Reporte guardado.</span>}
      <button type="button" onClick={handleSubmit} disabled={submitting || comment.length === 0} className={`self-start ${BUTTON_PRIMARY}`}>
        {submitting ? "Enviando..." : "Enviar reporte"}
      </button>
    </div>
  );
}
