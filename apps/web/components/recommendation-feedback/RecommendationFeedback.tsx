"use client";

import { useState } from "react";
import {
  postRecommendationFeedback,
  type FeedbackNegativeReason,
  type FeedbackRating,
} from "@/features/draft-feedback";
import { BUTTON_COMPACT, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";

export const NEGATIVE_REASON_OPTIONS: { id: FeedbackNegativeReason; label: string }[] = [
  { id: "wrong_position", label: "Posición no encaja" },
  { id: "poor_hero", label: "Héroe débil o no viable" },
  { id: "questionable_counter", label: "Counter cuestionable" },
  { id: "unclear_explanation", label: "Explicación poco clara" },
  { id: "not_useful", label: "No es útil" },
  { id: "other", label: "Otro motivo" },
];

export interface RecommendationFeedbackProps {
  sessionId: string;
  heroId: number;
  targetPosition?: number | null;
  stateIdentity?: string | null;
  rulesetVersion?: string | null;
}

// In-memory set to prevent repeated submissions across re-renders in the session
const submittedFeedbackKeys = new Set<string>();

export function feedbackIdentityKey(sessionId: string, heroId: number, stateIdentity?: string | null): string {
  return `${sessionId}:${heroId}:${stateIdentity ?? "root"}`;
}

export function clearSubmittedFeedbackKeysForTesting(): void {
  submittedFeedbackKeys.clear();
}

export function RecommendationFeedback({
  sessionId,
  heroId,
  targetPosition,
  stateIdentity,
  rulesetVersion,
}: RecommendationFeedbackProps) {
  const identityKey = feedbackIdentityKey(sessionId, heroId, stateIdentity);
  const alreadySubmitted = submittedFeedbackKeys.has(identityKey);

  const [selectedRating, setSelectedRating] = useState<FeedbackRating | null>(null);
  const [reason, setReason] = useState<FeedbackNegativeReason | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(alreadySubmitted);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  if (submitted) {
    return (
      <div className="flex items-center gap-1.5 pt-1 text-caption text-signal-positive" data-testid="feedback-submitted-state">
        <span aria-hidden="true">✓</span>
        <span>{statusMessage ?? "Feedback registrado"}</span>
      </div>
    );
  }

  function handleSelectRating(rating: FeedbackRating) {
    setSelectedRating(rating);
    setStatusMessage(null);
    if (rating === "positive") {
      setReason(null);
    }
  }

  function handleCancel() {
    setSelectedRating(null);
    setReason(null);
    setComment("");
    setStatusMessage(null);
  }

  async function handleSubmit() {
    if (!selectedRating || submitting) return;

    setSubmitting(true);
    setStatusMessage(null);

    try {
      const result = await postRecommendationFeedback({
        sessionId,
        heroId,
        rating: selectedRating,
        targetPosition,
        reason: selectedRating === "negative" ? reason : null,
        comment,
        stateIdentity,
        rulesetVersion,
      });

      if (result.accepted) {
        submittedFeedbackKeys.add(identityKey);
        setSubmitted(true);
        setStatusMessage("Feedback guardado. ¡Gracias!");
      } else if (result.error === "duplicate_submission") {
        submittedFeedbackKeys.add(identityKey);
        setSubmitted(true);
        setStatusMessage("Ya enviaste feedback para esta recomendación.");
      } else if (result.error === "sensitive_data_rejected") {
        setStatusMessage("El comentario contiene datos no permitidos.");
      } else if (result.error === "comment_too_long") {
        setStatusMessage("Comentario demasiado largo (máximo 1000 caracteres).");
      } else {
        setStatusMessage("No se pudo enviar el feedback.");
      }
    } catch {
      setStatusMessage("No se pudo enviar el feedback.");
    } finally {
      setSubmitting(false);
    }
  }

  if (selectedRating === null) {
    return (
      <div className="flex items-center gap-2 pt-1" data-testid="recommendation-feedback-controls">
        <span className="text-caption text-content-muted">¿Te sirvió?</span>
        <button
          type="button"
          onClick={() => handleSelectRating("positive")}
          className={`${BUTTON_COMPACT} flex items-center gap-1`}
          aria-label="Recomendación útil"
          data-testid="feedback-thumb-up"
        >
          <span aria-hidden="true">👍</span>
          <span>Útil</span>
        </button>
        <button
          type="button"
          onClick={() => handleSelectRating("negative")}
          className={`${BUTTON_COMPACT} flex items-center gap-1`}
          aria-label="Recomendación a mejorar"
          data-testid="feedback-thumb-down"
        >
          <span aria-hidden="true">👎</span>
          <span>No útil</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-surface-border bg-surface-base p-2 text-caption mt-1" data-testid="feedback-form">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-content-primary">
          {selectedRating === "positive" ? "Feedback positivo" : "Feedback a mejorar"}
        </span>
        <button
          type="button"
          onClick={handleCancel}
          disabled={submitting}
          className="text-caption text-content-muted hover:text-content-primary"
          data-testid="feedback-cancel-btn"
        >
          Cancelar
        </button>
      </div>

      {selectedRating === "negative" && (
        <div className="flex flex-col gap-1">
          <span className="text-content-secondary">Motivo (opcional):</span>
          <select
            value={reason ?? ""}
            onChange={(e) => setReason((e.target.value as FeedbackNegativeReason) || null)}
            disabled={submitting}
            className="rounded border border-surface-border bg-surface-raised px-2 py-1 text-caption text-content-primary"
            data-testid="feedback-reason-select"
            aria-label="Motivo del feedback"
          >
            <option value="">Selecciona un motivo (opcional)</option>
            {NEGATIVE_REASON_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onInput={(e) => setComment((e.target as HTMLTextAreaElement).value)}
          placeholder="Comentario breve opcional..."
          maxLength={500}
          rows={2}
          disabled={submitting}
          className="rounded border border-surface-border bg-surface-raised px-2 py-1 text-caption text-content-primary placeholder:text-content-muted resize-none"
          data-testid="feedback-comment-input"
        />
      </div>

      {statusMessage && (
        <span className="text-caption text-signal-negative" data-testid="feedback-status-message">
          {statusMessage}
        </span>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className={`${BUTTON_PRIMARY} py-1 px-3 text-caption`}
          data-testid="feedback-submit-btn"
        >
          {submitting ? "Enviando..." : "Enviar feedback"}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={submitting}
          className={`${BUTTON_SECONDARY} py-1 px-2 text-caption`}
        >
          Descartar
        </button>
      </div>
    </div>
  );
}
