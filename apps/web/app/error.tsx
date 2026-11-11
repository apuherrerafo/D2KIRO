"use client";

import { ErrorState } from "@/components/app-shell/ErrorState";

interface RouteErrorProps {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}

// Error boundary de cualquier ruta sin boundary propio. Vive dentro del shell, así que conserva la navegación.
export default function RouteError({ error, unstable_retry }: RouteErrorProps) {
  return <ErrorState what="esta pantalla" error={error} onRetry={unstable_retry} />;
}
