import { AppLink } from "@/components/app-shell/AppLink";
import { AppNotice } from "@/components/app-shell/AppNotice";

export default function AccessDeniedPage() {
  return (
    <main className="ap-main ap-main--center" data-testid="access-denied">
      <h1 className="ap-title">Acceso no disponible</h1>
      <AppNotice tone="info" title="Esta beta privada todavía no está habilitada para tu cuenta">
        <p>Steam confirmó quién eres, pero tu cuenta no está en la lista de invitados. No se abrió ninguna sesión.</p>
        <div className="ap-notice-actions">
          <AppLink href="/login" look="outline">
            Probar con otra cuenta
          </AppLink>
        </div>
      </AppNotice>
    </main>
  );
}
