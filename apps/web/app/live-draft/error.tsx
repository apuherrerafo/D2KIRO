"use client";

import { ErrorState } from "@/components/app-shell/ErrorState";

interface DraftErrorBoundaryProps {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}

// Error boundary de la vista de draft en vivo (web.md: cada feature tiene el suyo). Red de seguridad final: si una
// excepción de render se cuela pese a la validación de mensajes (validation.ts), el jugador ve el estado `error`
// con su acción de recuperación, nunca una pantalla en blanco.
export default function DraftErrorBoundary({ error, unstable_retry }: DraftErrorBoundaryProps) {
  return <ErrorState what="la vista de draft" error={error} onRetry={unstable_retry} testId="draft-error-state" />;
}
