"use client";

import { useCallback, useEffect, useState } from "react";
import { AppLink } from "@/components/app-shell/AppLink";
import { AppNotice } from "@/components/app-shell/AppNotice";

// <Dominio><Cosa>: lo que ve quien Steam ya verificó pero todavía no está en la beta. Cuatro estados, ninguno silencioso:
// formulario («¿Quién eres y de dónde nos conoces?»), pendiente, rechazada y aprobada. La identidad nunca sale de esta pantalla:
// el servidor la toma de la cookie sellada del inicio de sesión de Steam.

export type RequestStatus = "none" | "pending" | "rejected" | "invited";
const MIN_LENGTH = 10;
const MAX_LENGTH = 500;
const POLL_MS = 20_000;

interface StatusResponse {
  status: RequestStatus;
  message?: string | null;
}

type SubmitError = "too_short" | "rate_limited" | "cooldown" | "unavailable" | "network" | "expired";

async function fetchStatus(): Promise<StatusResponse | null> {
  try {
    const response = await fetch("/api/auth/access-request", { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as StatusResponse;
  } catch {
    return null;
  }
}

async function submitRequest(message: string, website: string): Promise<{ ok: true } | { ok: false; error: SubmitError }> {
  try {
    const response = await fetch("/api/auth/access-request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, website }) });
    if (response.ok) return { ok: true };
    if (response.status === 401) return { ok: false, error: "expired" };
    if (response.status === 400) return { ok: false, error: "too_short" };
    if (response.status === 429) {
      const body = (await response.json()) as { error?: string };
      return { ok: false, error: body.error === "cooldown" ? "cooldown" : "rate_limited" };
    }
    return { ok: false, error: "unavailable" };
  } catch {
    return { ok: false, error: "network" };
  }
}

const ERROR_TEXT: Record<SubmitError, string> = {
  too_short: `Cuéntanos un poco más: escribe entre ${MIN_LENGTH} y ${MAX_LENGTH} caracteres.`,
  rate_limited: "Hiciste demasiados intentos seguidos. Espera unos minutos e inténtalo de nuevo.",
  cooldown: "Tu solicitud anterior fue rechazada hace poco. Podrás volver a pedir acceso pasadas 24 horas.",
  unavailable: "No pudimos guardar tu solicitud. Inténtalo de nuevo en unos minutos.",
  network: "No hay conexión con D2KIRO. Revisa tu internet e inténtalo de nuevo.",
  expired: "Pasó demasiado tiempo desde que entraste con Steam. Vuelve a entrar con Steam y envía tu solicitud.",
};

function SubmitFailed({ error }: { error: SubmitError | null }) {
  if (error === null) return null;
  return (
    <AppNotice tone="error" title="No se envió tu solicitud" testId="access-request-error">
      <p>{ERROR_TEXT[error]}</p>
      <ExpiredAction show={error === "expired"} />
    </AppNotice>
  );
}

function ExpiredAction({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="ap-notice-actions">
      <AppLink href="/login" look="solid">
        Entrar con Steam
      </AppLink>
    </div>
  );
}

function RequestForm({ onSent }: { onSent: () => void }) {
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SubmitError | null>(null);
  const length = message.trim().length;

  const send = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await submitRequest(message, website);
    setBusy(false);
    if (result.ok) onSent();
    else setError(result.error);
  }, [message, website, onSent]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send();
  }
  function handleMessage(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setMessage(event.target.value);
  }
  function handleWebsite(event: React.ChangeEvent<HTMLInputElement>) {
    setWebsite(event.target.value);
  }

  return (
    <form className="ap-block" onSubmit={handleSubmit} data-testid="access-request-form">
      <label className="ap-field" htmlFor="access-request-message">
        <span className="ap-h3">¿Quién eres y de dónde nos conoces?</span>
        <span className="ap-hint">Por ejemplo: «Soy Ana, juego con Julio en el equipo» o «Te vi en el stream». Así el dueño sabe a quién está aprobando.</span>
        <textarea
          id="access-request-message"
          className="ap-input ap-textarea"
          value={message}
          onChange={handleMessage}
          maxLength={MAX_LENGTH}
          rows={4}
          required
          disabled={busy}
          data-testid="access-request-message"
        />
      </label>
      <span className="ap-hint" aria-live="polite" data-testid="access-request-count">{length}/{MAX_LENGTH}</span>
      <div className="ap-trap" aria-hidden="true">
        <label>
          No llenes este campo
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={handleWebsite} />
        </label>
      </div>
      <SubmitFailed error={error} />
      <button type="submit" className="ap-btn ap-btn--solid" disabled={busy || length < MIN_LENGTH} aria-busy={busy} data-testid="access-request-submit">
        {busy ? "Enviando…" : "Enviar solicitud"}
      </button>
    </form>
  );
}

function PendingView({ message }: { message: string | null }) {
  return (
    <AppNotice tone="info" title="Solicitud enviada: esperando aprobación" testId="access-request-pending">
      <p>El dueño de la beta ya puede ver tu solicitud. Cuando te apruebe, vuelve a entrar con Steam. Esta pantalla se actualiza sola.</p>
      <QuotedMessage message={message} />
      <div className="ap-notice-actions">
        <AppLink href="/login" look="solid">
          Ya me aprobaron, entrar
        </AppLink>
      </div>
    </AppNotice>
  );
}

function QuotedMessage({ message }: { message: string | null }) {
  if (message === null) return null;
  return <p className="ap-hint" data-testid="access-request-sent-message">Tu mensaje: «{message}»</p>;
}

function ApprovedView() {
  return (
    <AppNotice tone="success" title="¡Ya tienes acceso!" testId="access-request-approved">
      <p>El dueño aprobó tu solicitud. Entra con Steam para empezar.</p>
      <div className="ap-notice-actions">
        <AppLink href="/login" look="solid">
          Entrar con Steam
        </AppLink>
      </div>
    </AppNotice>
  );
}

function RejectedView({ onRetry }: { onRetry: () => void }) {
  return (
    <>
      <AppNotice tone="warning" title="Tu solicitud no fue aprobada" testId="access-request-rejected">
        <p>El dueño no pudo aprobar esta solicitud. Si crees que fue un error, escríbele por otro medio. Pasadas 24 horas puedes volver a pedirlo con más contexto.</p>
        <div className="ap-notice-actions">
          <button type="button" className="ap-btn" onClick={onRetry}>
            Escribir otra solicitud
          </button>
        </div>
      </AppNotice>
    </>
  );
}

export function AccessRequestPanel({ initial, initialMessage }: { initial: RequestStatus; initialMessage: string | null }) {
  const [status, setStatus] = useState<RequestStatus>(initial);
  const [message, setMessage] = useState<string | null>(initialMessage);
  const [editing, setEditing] = useState(false);

  const refresh = useCallback(async () => {
    const next = await fetchStatus();
    if (next === null) return;
    setStatus(next.status);
    setMessage(next.message ?? null);
  }, []);

  useEffect(() => {
    if (status !== "pending" && status !== "rejected") return;
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [status, refresh]);

  const handleSent = useCallback(() => {
    setEditing(false);
    void refresh();
  }, [refresh]);
  function handleRetry() {
    setEditing(true);
  }

  if (status === "invited") return <ApprovedView />;
  if (status === "pending") return <PendingView message={message} />;
  if (status === "rejected" && !editing) return <RejectedView onRetry={handleRetry} />;
  return <RequestForm onSent={handleSent} />;
}
