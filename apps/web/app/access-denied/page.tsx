import { AccountAvatar } from "@/components/app-shell/AccountAvatar";
import { AppLink } from "@/components/app-shell/AppLink";
import { AppNotice } from "@/components/app-shell/AppNotice";
import { readAccessRequestNotice, type AccessRequestData } from "@/lib/access-request-session";

export const dynamic = "force-dynamic";

// <Dominio><Cosa>: quien entra con Steam y todavía no está en la beta llega aquí. Steam ya confirmó quién es: su pedido se registró SOLO
// (no tiene que buscar ni mandar su SteamID) y no se abrió ninguna sesión. Si no hay aviso (otro dispositivo, cookie vencida), se le dice
// cómo pedir acceso: volver a entrar con Steam.

function RequesterRow({ notice }: { notice: AccessRequestData }) {
  return (
    <div className="ap-row" data-testid="access-request-who">
      <div className="ap-row-main">
        <AccountAvatar avatarUrl={notice.avatarUrl ?? null} />
        <div className="ap-row-text">
          <span className="ap-row-name">{notice.personaName}</span>
          <span className="ap-row-meta">Steam confirmó tu cuenta</span>
        </div>
      </div>
    </div>
  );
}

function NotRecordedNotice({ notice }: { notice: AccessRequestData }) {
  return (
    <>
      <RequesterRow notice={notice} />
      <AppNotice tone="warning" title="No pudimos registrar tu solicitud" testId="access-request-not-recorded">
        <p>Steam confirmó tu cuenta, pero esta vez no se guardó tu pedido. Avísale al dueño de la beta que quieres entrar e inténtalo de nuevo en unos minutos.</p>
        <div className="ap-notice-actions">
          <AppLink href="/login" look="solid">
            Reintentar con Steam
          </AppLink>
        </div>
      </AppNotice>
    </>
  );
}

function RequestedNotice({ notice }: { notice: AccessRequestData }) {
  if (notice.recorded === false) return <NotRecordedNotice notice={notice} />;
  return (
    <>
      <RequesterRow notice={notice} />
      <AppNotice tone="info" title="Ya pedimos acceso por ti" testId="access-request-status">
        <p>El dueño de la beta verá tu solicitud y te dará acceso. Cuando te avise, vuelve a entrar con Steam y listo. No se abrió ninguna sesión.</p>
        <div className="ap-notice-actions">
          <AppLink href="/login" look="solid">
            Ya me aprobaron, entrar
          </AppLink>
        </div>
      </AppNotice>
      <PrivateProfileHint show={notice.profileAvailable === false} />
    </>
  );
}

function PrivateProfileHint({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="ap-hint" data-testid="access-request-private-hint">
      No pudimos leer tu nombre público de Steam, así que el dueño verá «Jugador de Steam». Avísale quién eres para que te reconozca.
    </p>
  );
}

function GenericNotice() {
  return (
    <AppNotice tone="info" title="D2KIRO está en beta privada" testId="access-request-status">
      <p>Entra con tu cuenta de Steam: si todavía no estás en la lista, tu solicitud le llega al dueño sin que tengas que hacer nada más.</p>
      <div className="ap-notice-actions">
        <AppLink href="/login" look="solid">
          Entrar con Steam
        </AppLink>
      </div>
    </AppNotice>
  );
}

function AccessStatus({ notice }: { notice: AccessRequestData | null }) {
  if (notice === null) return <GenericNotice />;
  return <RequestedNotice notice={notice} />;
}

export default async function AccessDeniedPage() {
  const notice = await readAccessRequestNotice();
  return (
    <main className="ap-main ap-main--center" data-testid="access-denied">
      <h1 className="ap-title">Tu acceso está pendiente</h1>
      <AccessStatus notice={notice} />
    </main>
  );
}
