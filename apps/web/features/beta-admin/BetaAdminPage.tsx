"use client";

import { useCallback, useEffect, useState } from "react";
import { AccountAvatar } from "@/components/app-shell/AccountAvatar";
import { AppLink } from "@/components/app-shell/AppLink";
import { AppNotice } from "@/components/app-shell/AppNotice";
import { PageHead } from "@/components/app-shell/PageHead";

// <Dominio><Cosa>: «Invitar amigos». Solo para el propietario (el servidor responde 403 a cualquier otra cuenta). Sin SteamID, sin consola:
// el amigo abre el enlace, entra con Steam y su pedido aparece aquí con su nombre y avatar; el propietario lo aprueba con un botón.

interface PublicEntry {
  ref: string;
  personaName: string;
  avatarUrl: string | null;
  at: number;
}

interface AdminData {
  shareUrl: string | null;
  requests: PublicEntry[];
  invited: PublicEntry[];
  fixedCount: number;
}

type AdminState = { kind: "loading" } | { kind: "forbidden" } | { kind: "error" } | { kind: "ready"; data: AdminData };
type Action = "approve" | "reject" | "revoke";

async function loadAdmin(): Promise<AdminState> {
  try {
    const response = await fetch("/api/beta-admin", { cache: "no-store" });
    if (response.status === 403 || response.status === 401) return { kind: "forbidden" };
    if (!response.ok) return { kind: "error" };
    return { kind: "ready", data: (await response.json()) as AdminData };
  } catch {
    return { kind: "error" };
  }
}

async function sendAction(action: Action, ref: string): Promise<boolean> {
  try {
    const response = await fetch("/api/beta-admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ref }) });
    return response.ok;
  } catch {
    return false;
  }
}

function formatDay(at: number): string {
  return new Date(at).toLocaleDateString("es", { day: "numeric", month: "short" });
}

interface EntryRowProps {
  entry: PublicEntry;
  primary: { action: Action; label: string } | null;
  secondary: { action: Action; label: string };
  busy: boolean;
  onAction: (action: Action, ref: string) => void;
}

function EntryRow({ entry, primary, secondary, busy, onAction }: EntryRowProps) {
  function handlePrimary() {
    if (primary !== null) onAction(primary.action, entry.ref);
  }
  function handleSecondary() {
    onAction(secondary.action, entry.ref);
  }
  return (
    <li className="ap-row" data-testid="beta-entry">
      <div className="ap-row-main">
        <AccountAvatar avatarUrl={entry.avatarUrl} />
        <div className="ap-row-text">
          <span className="ap-row-name">{entry.personaName}</span>
          <span className="ap-row-meta">{formatDay(entry.at)}</span>
        </div>
      </div>
      <div className="ap-actions">
        <PrimaryButton primary={primary} busy={busy} onPress={handlePrimary} />
        <button type="button" className="ap-btn" disabled={busy} onClick={handleSecondary}>{secondary.label}</button>
      </div>
    </li>
  );
}

function PrimaryButton({ primary, busy, onPress }: { primary: { label: string } | null; busy: boolean; onPress: () => void }) {
  if (primary === null) return null;
  return <button type="button" className="ap-btn ap-btn--solid" disabled={busy} onClick={onPress} data-testid="beta-approve">{primary.label}</button>;
}

function EntryList({ title, empty, entries, primary, secondary, busy, onAction }: Omit<EntryRowProps, "entry"> & { title: string; empty: string; entries: PublicEntry[] }) {
  return (
    <section className="ap-block" aria-label={title}>
      <h2 className="ap-h2">{title}</h2>
      <EmptyHint show={entries.length === 0} text={empty} />
      <ul className="ap-list">
        {entries.map((entry) => (
          <EntryRow key={entry.ref} entry={entry} primary={primary} secondary={secondary} busy={busy} onAction={onAction} />
        ))}
      </ul>
    </section>
  );
}

function EmptyHint({ show, text }: { show: boolean; text: string }) {
  if (!show) return null;
  return <p className="ap-hint">{text}</p>;
}

function ShareLink({ url }: { url: string | null }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    if (url === null) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  function handlePress() {
    void handleCopy();
  }
  if (url === null) return null;
  return (
    <section className="ap-block" aria-label="Enlace para tus amigos">
      <h2 className="ap-h2">1 · Pásales este enlace</h2>
      <div className="ap-row">
        <span className="ap-row-name" data-testid="beta-share-url">{url}</span>
        <button type="button" className="ap-btn" onClick={handlePress} data-testid="beta-copy-link">Copiar enlace</button>
      </div>
      <CopiedHint show={copied} />
      <p className="ap-hint">Tu amigo lo abre, entra con Steam y listo: su solicitud te llega aquí sola. No necesita buscar su SteamID.</p>
    </section>
  );
}

function CopiedHint({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="ap-hint" role="status">Enlace copiado.</p>;
}

function AdminBody({ data, busy, failed, onAction }: { data: AdminData; busy: boolean; failed: boolean; onAction: (action: Action, ref: string) => void }) {
  return (
    <>
      <ShareLink url={data.shareUrl} />
      <ActionFailed show={failed} />
      <EntryList
        title="2 · Solicitudes pendientes"
        empty="Nadie ha pedido acceso todavía."
        entries={data.requests}
        primary={{ action: "approve", label: "Aprobar" }}
        secondary={{ action: "reject", label: "Rechazar" }}
        busy={busy}
        onAction={onAction}
      />
      <EntryList
        title="Invitados aprobados"
        empty="Todavía no has aprobado a nadie desde aquí."
        entries={data.invited}
        primary={null}
        secondary={{ action: "revoke", label: "Quitar acceso" }}
        busy={busy}
        onAction={onAction}
      />
      <p className="ap-hint">Antes de aprobar, confirma por otro medio que es tu amigo: cualquiera puede ponerse el mismo nombre y avatar que otra persona.</p>
      <p className="ap-hint">Además hay {data.fixedCount} cuenta(s) fijas de la beta (la tuya incluida) que no se administran desde esta pantalla.</p>
    </>
  );
}

function ActionFailed({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <AppNotice tone="error" title="No se pudo completar la acción">
      <p>Vuelve a intentarlo. Si la solicitud ya no existe, la lista se actualiza sola.</p>
    </AppNotice>
  );
}

function AdminContent({ state, busy, failed, onAction }: { state: AdminState; busy: boolean; failed: boolean; onAction: (action: Action, ref: string) => void }) {
  if (state.kind === "loading") return <p className="ap-loading" role="status">Cargando solicitudes…</p>;
  if (state.kind === "forbidden") {
    return (
      <AppNotice tone="info" title="Solo el propietario de la beta puede invitar" testId="beta-admin-forbidden">
        <p>Esta pantalla es para quien administra la beta. Tu cuenta funciona con normalidad.</p>
        <div className="ap-notice-actions">
          <AppLink href="/settings">Volver a Mi cuenta</AppLink>
        </div>
      </AppNotice>
    );
  }
  if (state.kind === "error") {
    return (
      <AppNotice tone="error" title="No se pudo cargar la lista">
        <p>Recarga la página para reintentar.</p>
      </AppNotice>
    );
  }
  return <AdminBody data={state.data} busy={busy} failed={failed} onAction={onAction} />;
}

export function BetaAdminPage() {
  const [state, setState] = useState<AdminState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadAdmin().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAction = useCallback(async (action: Action, ref: string) => {
    setBusy(true);
    setFailed(!(await sendAction(action, ref)));
    setState(await loadAdmin());
    setBusy(false);
  }, []);

  function handleActionPress(action: Action, ref: string) {
    void handleAction(action, ref);
  }

  return (
    <main className="ap-main" data-testid="beta-admin-page">
      <PageHead kicker="Beta privada" title="Invitar amigos" lede="Tus amigos piden acceso con su cuenta de Steam y tú los apruebas desde aquí." />
      <AdminContent state={state} busy={busy} failed={failed} onAction={handleActionPress} />
    </main>
  );
}
