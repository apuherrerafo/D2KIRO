"use client";

import { useEffect } from "react";
import { AppLink } from "./AppLink";
import { AppNotice } from "./AppNotice";

interface ErrorStateProps {
  /** Qué parte del producto falló, en palabras del jugador ("la vista de draft"). */
  what: string;
  error: Error & { digest?: string };
  onRetry: () => void;
  testId?: string;
}

// <Dominio><Cosa>: red de seguridad de una pantalla. Si una excepción de render se cuela pese a la validación de los
// mensajes, el jugador ve qué pasó y cómo seguir -- nunca una pantalla en blanco. Reintentar vuelve a pintar la misma ruta.
export function ErrorState({ what, error, onRetry, testId = "error-state" }: ErrorStateProps) {
  useEffect(() => {
    console.error(`[error-boundary] ${what}:`, error);
  }, [what, error]);

  return (
    <main className="ap-main ap-main--center" data-testid={testId}>
      <AppNotice tone="error" title="Algo salió mal">
        <p>No pudimos mostrar {what}. Tu pool, tus equipos y tu cuenta no se tocaron.</p>
        <div className="ap-notice-actions">
          <button type="button" className="ap-btn ap-btn--solid" onClick={onRetry}>
            Reintentar
          </button>
          <AppLink href="/" look="quiet">
            Volver al inicio
          </AppLink>
        </div>
      </AppNotice>
    </main>
  );
}
