"use client";

import { useEffect } from "react";
import { BUTTON_PRIMARY } from "@/features/draft/styles";

interface DraftErrorBoundaryProps {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}

// Error boundary nativo del App Router (.claude/rules/web.md: "cada feature tiene su propio
// error boundary") -- red de seguridad final: si una excepción de render se cuela pese a la
// validación de mensajes (validation.ts), esto sigue mostrando el estado `error` del ticket
// (mensaje + acción de recuperación), nunca una pantalla en blanco.
export default function DraftErrorBoundary({ error, unstable_retry }: DraftErrorBoundaryProps) {
  useEffect(() => {
    console.error("[draft] excepción de render no capturada:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface-base p-6">
      <span className="text-heading text-signal-negative">Ocurrió un error</span>
      <span className="text-body text-content-secondary">La vista de draft no pudo mostrarse correctamente.</span>
      <button type="button" onClick={unstable_retry} className={BUTTON_PRIMARY}>
        Reintentar
      </button>
    </div>
  );
}
