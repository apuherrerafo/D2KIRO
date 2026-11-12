import { AppNotice } from "@/components/app-shell/AppNotice";
import { Glass } from "@/design/canonical/primitives/Glass";
import { LoginAction } from "./LoginAction";

export const LOGIN_ERROR_PARAM = "auth_failed";

export function isLoginFailure(errorParam: string | null): boolean {
  return errorParam === LOGIN_ERROR_PARAM;
}

function LoginFailureNotice({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <AppNotice tone="error" title="No pudimos confirmar tu cuenta de Steam" testId="login-error">
      <p>Steam no validó el acceso. No se abrió ninguna sesión. Inténtalo otra vez; si vuelve a pasar, revisa que tu perfil de Steam esté disponible.</p>
    </AppNotice>
  );
}

// <Dominio><Cosa>: la pantalla de acceso. Dice qué pasa al entrar (Steam confirma quién eres, D2KIRO no ve tu contraseña)
// y si el intento anterior falló. Una sola acción.
export function LoginPanel({ failed }: { failed: boolean }) {
  return (
    <Glass className="ap-login" surfaceLevel="3">
      <header className="ap-head">
        <p className="ap-kicker">D2KIRO · beta privada</p>
        <h1 className="ap-title">Entra con tu cuenta de Steam</h1>
        <p className="ap-lede">Tu pool de héroes, tus equipos y tus drafts quedan guardados en tu cuenta.</p>
      </header>
      <LoginFailureNotice show={failed} />
      <ol className="ap-steps">
        <li className="ap-step">Steam te pide confirmar que eres tú, en su propia página.</li>
        <li className="ap-step">D2KIRO nunca ve ni guarda tu contraseña de Steam.</li>
        <li className="ap-step">Vuelves aquí con tu sesión abierta.</li>
      </ol>
      <div className="ap-actions">
        <LoginAction />
      </div>
      <p className="ap-hint">El acceso es por invitación mientras dure la beta. Si todavía no estás en la lista, entra igual: tu solicitud le llega al dueño sola y te avisa cuando puedas pasar.</p>
    </Glass>
  );
}
