"use client";

import "./globals.css";
import "@/design/round-3a-labs.css";
import "@/design/round-3b-labs.css";
import "@/design/canonical/tokens.css";
import "@/design/canonical/primitives/primitives.css";
import "@/components/app-shell/app-shell.css";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}

// Último recurso: falló el propio layout. Reemplaza al layout raíz, así que trae su <html> y su propio alcance
// Canonical Light (sin barra de navegación: esa es justo la parte que pudo romperse).
export default function GlobalError({ error, unstable_retry }: GlobalErrorProps) {
  console.error("[global-error]", error);
  return (
    <html lang="es">
      <body>
        <div className="r3-page ap-root">
          <div className="ap-light" data-theme="light">
            <main className="ap-main ap-main--center" data-testid="global-error">
              <h1 className="ap-title">Algo salió mal</h1>
              <p className="ap-lede">D2KIRO no pudo cargar. Tu pool, tus equipos y tu cuenta no se tocaron.</p>
              <button type="button" className="ap-btn ap-btn--solid" onClick={unstable_retry}>
                Reintentar
              </button>
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
