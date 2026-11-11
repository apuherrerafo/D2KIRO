import { AppLink } from "@/components/app-shell/AppLink";
import { AppNotice } from "@/components/app-shell/AppNotice";

// 404 dentro del shell: la navegación sigue ahí y la salida es una ruta real.
export default function NotFound() {
  return (
    <main className="ap-main ap-main--center" data-testid="not-found">
      <AppNotice tone="info" title="Esta página no existe">
        <p>El enlace puede estar viejo o mal escrito. Desde el inicio llegas a todo lo que hay en D2KIRO.</p>
        <div className="ap-notice-actions">
          <AppLink href="/" look="solid">
            Ir al inicio
          </AppLink>
        </div>
      </AppNotice>
    </main>
  );
}
