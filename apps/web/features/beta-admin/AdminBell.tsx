"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountAvatar } from "@/components/app-shell/AccountAvatar";
import { claimFreshRequests, readSoundEnabled, writeSoundEnabled, type PendingRequest } from "./admin-alerts";

// <Dominio><Cosa>: la campanita del administrador. Solo se monta si la sesión es de administrador (el servidor igual responde 403 al resto).
// Consulta las solicitudes pendientes cada 30 s MIENTRAS la app está abierta: con el navegador cerrado no hay aviso (no usamos Web Push).
// El sonido solo suena si el administrador lo activó antes y solo por solicitudes nuevas (ver admin-alerts.ts).

const POLL_MS = 30_000;
const TOAST_MS = 8_000;
const LOCK_NAME = "d2k-admin-alert";

type BellAction = "approve" | "reject";

async function fetchPending(): Promise<PendingRequest[] | null> {
  try {
    const response = await fetch("/api/beta-admin", { cache: "no-store" });
    if (!response.ok) return null;
    const data = (await response.json()) as { requests?: PendingRequest[] };
    return Array.isArray(data.requests) ? data.requests : null;
  } catch {
    return null;
  }
}

async function sendBellAction(action: BellAction, ref: string): Promise<boolean> {
  try {
    const response = await fetch("/api/beta-admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ref }) });
    return response.ok;
  } catch {
    return false;
  }
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Un tono corto de dos notas con Web Audio (sin archivos). Devuelve false si el navegador no deja sonar (aún no hubo un clic en la página).
let audio: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (audio !== null) return audio;
  try {
    audio = new AudioContext();
    return audio;
  } catch {
    return null;
  }
}

async function playChime(): Promise<boolean> {
  const context = audioContext();
  if (context === null) return false;
  try {
    if (context.state === "suspended") await context.resume();
    if (context.state !== "running") return false;
    const start = context.currentTime;
    [660, 880].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + index * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.18, start + index * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.16 + 0.22);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + index * 0.16);
      oscillator.stop(start + index * 0.16 + 0.25);
    });
    return true;
  } catch {
    return false;
  }
}

function readStoredSound(): boolean {
  const local = storage();
  return local !== null && readSoundEnabled(local);
}

function formatWhen(at: number): string {
  return new Date(at).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 7H4c0-1 2-2 2-7Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

function Badge({ count }: { count: number }) {
  if (count === 0) return null;
  return <span className="ap-bell-badge" data-testid="admin-bell-count">{count > 9 ? "9+" : count}</span>;
}

function RequestItem({ request, busy, onAction }: { request: PendingRequest; busy: boolean; onAction: (action: BellAction, ref: string) => void }) {
  function handleApprove() {
    onAction("approve", request.ref);
  }
  function handleReject() {
    onAction("reject", request.ref);
  }
  return (
    <li className="ap-bell-item" data-testid="admin-bell-item">
      <div className="ap-row-main">
        <AccountAvatar avatarUrl={request.avatarUrl} />
        <div className="ap-row-text">
          <span className="ap-row-name">{request.personaName}</span>
          <span className="ap-row-meta">{formatWhen(request.at)}</span>
        </div>
      </div>
      <p className="ap-bell-message" data-testid="admin-bell-message">{request.message ?? "Sin mensaje (pedido anterior al formulario)."}</p>
      <div className="ap-actions">
        <button type="button" className="ap-btn ap-btn--compact ap-btn--solid" disabled={busy} onClick={handleApprove} data-testid="admin-bell-approve">Aprobar</button>
        <button type="button" className="ap-btn ap-btn--compact" disabled={busy} onClick={handleReject} data-testid="admin-bell-reject">Rechazar</button>
      </div>
    </li>
  );
}

function SoundToggle({ enabled, blocked, onToggle }: { enabled: boolean; blocked: boolean; onToggle: () => void }) {
  return (
    <div className="ap-bell-sound">
      <button type="button" className="ap-btn ap-btn--compact" onClick={onToggle} aria-pressed={enabled} data-testid="admin-bell-sound">
        {enabled ? "Sonido activado" : "Activar sonido"}
      </button>
      <BlockedHint show={enabled && blocked} />
    </div>
  );
}

function BlockedHint({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="ap-hint" data-testid="admin-bell-sound-blocked">El navegador bloqueó el sonido: haz clic en cualquier parte de la página y volverá a sonar.</span>;
}

function Panel(props: { requests: PendingRequest[]; busy: boolean; failed: boolean; soundEnabled: boolean; soundBlocked: boolean; onAction: (action: BellAction, ref: string) => void; onToggleSound: () => void }) {
  const { requests, busy, failed, soundEnabled, soundBlocked, onAction, onToggleSound } = props;
  return (
    <div className="ap-bell-panel" role="dialog" aria-label="Solicitudes de acceso" data-testid="admin-bell-panel">
      <div className="ap-section-head">
        <h2 className="ap-h3">Solicitudes de acceso</h2>
        <Link href="/admin/invitaciones" className="ap-btn ap-btn--quiet">Ver invitados</Link>
      </div>
      <EmptyRequests show={requests.length === 0} />
      <FailedHint show={failed} />
      <ul className="ap-list">
        {requests.map((request) => (
          <RequestItem key={request.ref} request={request} busy={busy} onAction={onAction} />
        ))}
      </ul>
      <SoundToggle enabled={soundEnabled} blocked={soundBlocked} onToggle={onToggleSound} />
      <p className="ap-hint">Los avisos y el sonido funcionan solo con D2KIRO abierto en el navegador. Con el navegador cerrado no te llega nada.</p>
      <Link href="/admin/feedback" className="ap-btn ap-btn--quiet" data-testid="admin-bell-feedback-link">Bandeja de feedback</Link>
    </div>
  );
}

function EmptyRequests({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="ap-hint" data-testid="admin-bell-empty">No hay solicitudes pendientes.</p>;
}

function FailedHint({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="ap-hint" role="alert">No se pudo completar la acción. Inténtalo de nuevo.</p>;
}

function Toast({ request }: { request: PendingRequest | null }) {
  if (request === null) return null;
  return (
    <div className="ap-bell-toast" role="status" data-testid="admin-bell-toast">
      Nueva solicitud de acceso: <strong>{request.personaName}</strong>
    </div>
  );
}

export function AdminBell() {
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // La campanita solo se monta tras cargar la sesión en el navegador, así que leer localStorage al crear el estado no choca con el render del servidor.
  const [soundEnabled, setSoundEnabled] = useState(readStoredSound);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [toast, setToast] = useState<PendingRequest | null>(null);
  const soundRef = useRef(soundEnabled);
  const toastTimer = useRef<number | null>(null);

  const announce = useCallback(async (fresh: PendingRequest[]) => {
    if (fresh.length === 0) return;
    setToast(fresh[fresh.length - 1]);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
    if (!soundRef.current) return;
    setSoundBlocked(!(await playChime()));
  }, []);

  const handleList = useCallback(async (list: PendingRequest[] | null) => {
    if (list === null) return;
    setRequests(list);
    const local = storage();
    if (local === null) return;
    // Bajo candado entre pestañas: leer la marca, decidir y subirla es un solo paso.
    const claim = async () => claimFreshRequests(local, list);
    const fresh = "locks" in navigator ? await navigator.locks.request(LOCK_NAME, claim) : await claim();
    await announce(fresh);
  }, [announce]);

  const poll = useCallback(() => {
    void fetchPending().then(handleList);
  }, [handleList]);

  useEffect(() => {
    poll();
    const timer = window.setInterval(poll, POLL_MS);
    function handleVisible() {
      if (document.visibilityState === "visible") poll();
    }
    // Un clic en la página destraba el audio que el navegador había bloqueado.
    function handleGesture() {
      if (soundRef.current) void playChimeSilentUnlock();
    }
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("pointerdown", handleGesture);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("pointerdown", handleGesture);
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, [poll]);

  const handleToggleSound = useCallback(() => {
    const next = !soundRef.current;
    soundRef.current = next;
    setSoundEnabled(next);
    setSoundBlocked(false);
    const local = storage();
    if (local !== null) writeSoundEnabled(local, next);
    // Activarlo es un gesto del usuario: aquí el navegador sí deja crear el audio, y el tono de prueba confirma que suena.
    if (next) void playChime().then((ok) => setSoundBlocked(!ok));
  }, []);

  const handleAction = useCallback(async (action: BellAction, ref: string) => {
    setBusy(true);
    setFailed(!(await sendBellAction(action, ref)));
    const list = await fetchPending();
    if (list !== null) setRequests(list);
    setBusy(false);
  }, []);

  function handleActionPress(action: BellAction, ref: string) {
    void handleAction(action, ref);
  }
  function handleToggleOpen() {
    setOpen((value) => !value);
  }

  return (
    <div className="ap-bell">
      <button type="button" className="ap-bell-button" onClick={handleToggleOpen} aria-expanded={open} aria-label={`Solicitudes de acceso: ${requests.length} pendientes`} data-testid="admin-bell">
        <BellIcon />
        <Badge count={requests.length} />
      </button>
      <Toast request={open ? null : toast} />
      <PanelIfOpen open={open} requests={requests} busy={busy} failed={failed} soundEnabled={soundEnabled} soundBlocked={soundBlocked} onAction={handleActionPress} onToggleSound={handleToggleSound} />
    </div>
  );
}

function PanelIfOpen(props: { open: boolean; requests: PendingRequest[]; busy: boolean; failed: boolean; soundEnabled: boolean; soundBlocked: boolean; onAction: (action: BellAction, ref: string) => void; onToggleSound: () => void }) {
  const { open, ...panel } = props;
  if (!open) return null;
  return <Panel {...panel} />;
}

async function playChimeSilentUnlock(): Promise<void> {
  const context = audioContext();
  if (context === null || context.state !== "suspended") return;
  try {
    await context.resume();
  } catch {
    // sin permiso: se vuelve a intentar con el siguiente clic
  }
}
