import { AccountAvatar } from "@/components/app-shell/AccountAvatar";
import { AppLink } from "@/components/app-shell/AppLink";
import { AppNotice } from "@/components/app-shell/AppNotice";
import { AccessRequestPanel, type RequestStatus } from "@/features/access-request";
import { readAccessRequestNotice, type AccessRequestData } from "@/lib/access-request-session";
import { isAccountAllowedNow } from "@/lib/beta-access";
import { accessStatusOf, betaAccessFilePath } from "@/lib/beta-access-store";

export const dynamic = "force-dynamic";

// <Dominio><Cosa>: quien entra con Steam y todavía no está en la beta llega aquí. Steam ya confirmó quién es, pero NO se registra nada hasta que
// la persona escribe «¿Quién eres y de dónde nos conoces?» y envía su solicitud. No se abrió ninguna sesión. Si no hay aviso (otro dispositivo,
// cookie vencida), se le dice cómo empezar: entrar con Steam.

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

function PrivateProfileHint({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="ap-hint" data-testid="access-request-private-hint">
      No pudimos leer tu nombre público de Steam, así que el dueño verá «Jugador de Steam». Cuéntale quién eres en tu mensaje para que te reconozca.
    </p>
  );
}

function GenericNotice() {
  return (
    <AppNotice tone="info" title="D2KIRO está en beta privada" testId="access-request-status">
      <p>Entra con tu cuenta de Steam: si todavía no estás en la lista, podrás enviar tu solicitud con un mensaje para el dueño.</p>
      <div className="ap-notice-actions">
        <AppLink href="/login" look="solid">
          Entrar con Steam
        </AppLink>
      </div>
    </AppNotice>
  );
}

function currentStatus(accountId: number): { status: RequestStatus; message: string | null } {
  if (isAccountAllowedNow(accountId, process.env)) return { status: "invited", message: null };
  const found = accessStatusOf(betaAccessFilePath(process.env), accountId);
  if (found.kind === "pending") return { status: "pending", message: found.message };
  return { status: found.kind, message: null };
}

function AccessStatus({ notice }: { notice: AccessRequestData | null }) {
  if (notice === null || notice.accountId === undefined) return <GenericNotice />;
  const { status, message } = currentStatus(notice.accountId);
  return (
    <>
      <RequesterRow notice={notice} />
      <AccessRequestPanel initial={status} initialMessage={message} />
      <PrivateProfileHint show={notice.profileAvailable === false} />
    </>
  );
}

export default async function AccessDeniedPage() {
  const notice = await readAccessRequestNotice();
  return (
    <main className="ap-main ap-main--center" data-testid="access-denied">
      <h1 className="ap-title">Pide tu acceso a la beta</h1>
      <AccessStatus notice={notice} />
    </main>
  );
}
