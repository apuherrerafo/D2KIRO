"use client";

import { CAPTURE_NOT_ENABLED, DOTA_NOT_RUNNING, GSI_LAUNCH_OPTION, OVERWOLF_LOST } from "../constants";
import { PANEL, PRIMARY_BUTTON, SECONDARY_BUTTON, STATUS_PILL_BAD, STATUS_PILL_MUTED, STATUS_PILL_OK, STATUS_PILL_WARN } from "../styles";
import type { LiveCaptureStatus } from "../types";
import { useCapturePairing, type CapturePairingView } from "../use-capture-pairing";

// "Conectar captura automática" -- el draft completo (bans, picks propios y rivales) llega solo desde la app
// D2KIRO Live Capture de Overwolf; el Player no carga nada a mano. Este panel hace tres cosas: pedir el código
// de un solo uso, mostrar si el adaptador ya emparejó, y -- lo que importa ANTES de poner la cola -- decir con
// una sola frase si la captura automática está lista.

export type CaptureReadiness = "not_paired" | "waiting_adapter" | "lost" | "dota_not_running" | "needs_launch_option" | "ready" | "capturing";

/** One honest answer to "will the next draft be captured by itself?". Pure: it reads only the engine's status. */
export function captureReadiness(paired: boolean, status: LiveCaptureStatus | null): CaptureReadiness {
  if (!paired) return "not_paired";
  const overwolf = status?.overwolf;
  if (overwolf === null || overwolf === undefined) return "waiting_adapter";
  if (status?.captureDetail === OVERWOLF_LOST) return "lost";
  if (!overwolf.connected) return "waiting_adapter";
  if (overwolf.authoritative) return "capturing";
  if (status?.captureDetail === CAPTURE_NOT_ENABLED) return "needs_launch_option";
  if (status?.captureDetail === DOTA_NOT_RUNNING) return "dota_not_running";
  return "ready";
}

interface ReadinessCopy {
  className: string;
  title: string;
  hint: string;
}

const READINESS_COPY: Readonly<Record<CaptureReadiness, ReadinessCopy>> = Object.freeze({
  not_paired: { className: STATUS_PILL_MUTED, title: "● Captura automática sin conectar", hint: "Conectala una sola vez: después cada draft se captura solo." },
  waiting_adapter: { className: STATUS_PILL_WARN, title: "● Captura automática esperando a Overwolf...", hint: "Abrí Overwolf y la app D2KIRO Live Capture. Esta página cambia sola." },
  lost: { className: STATUS_PILL_WARN, title: "● Captura automática perdida", hint: "Overwolf dejó de informar. Revisá que Overwolf y la app D2KIRO Live Capture sigan abiertos." },
  dota_not_running: { className: STATUS_PILL_WARN, title: "● Overwolf conectado · Dota 2 no está abierto", hint: "Abrí Dota 2: la captura queda lista sola." },
  needs_launch_option: { className: STATUS_PILL_BAD, title: "● Overwolf conectado · falta la opción de lanzamiento", hint: `Agregá ${GSI_LAUNCH_OPTION} a las Launch Options de Dota 2 (Steam → Dota 2 → Propiedades) y reiniciá Dota.` },
  ready: { className: STATUS_PILL_OK, title: "● Captura automática lista", hint: "Ya podés poner la cola: el draft se captura solo." },
  capturing: { className: STATUS_PILL_OK, title: "● Capturando el draft automáticamente", hint: "Bans y picks llegan solos desde Overwolf." },
});

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function PairingCode({ pairing, origin }: { pairing: CapturePairingView; origin: string }) {
  if (pairing.code === null) return null;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-accent-primary bg-surface-overlay p-3" data-testid="capture-pairing-code-box">
      <span className="text-caption text-content-secondary">Tu código de un solo uso (vence a las {formatTime(pairing.code.expiresAt)}):</span>
      <span className="select-all font-mono text-heading tracking-widest text-content-primary" data-testid="capture-pairing-code">{pairing.code.code}</span>
      <ol className="flex list-decimal flex-col gap-1 pl-4 text-caption text-content-secondary">
        <li>Abrí Overwolf y la app <b>D2KIRO Live Capture</b>.</li>
        <li>Pegá este sitio: <span className="select-all font-mono text-content-primary" data-testid="capture-pairing-origin">{origin}</span></li>
        <li>Escribí el código y tocá <b>Conectar</b>. Esta página cambia sola a «lista».</li>
      </ol>
    </div>
  );
}

function PairingActions({ paired, pairing, onStart, onUnpair }: { paired: boolean; pairing: CapturePairingView; onStart(): void; onUnpair(): void }) {
  function handleStart() {
    onStart();
  }
  function handleUnpair() {
    onUnpair();
  }
  let startLabel = "Conectar captura automática";
  let startClass = PRIMARY_BUTTON;
  if (paired || pairing.code !== null) {
    startLabel = "Generar código nuevo";
    startClass = SECONDARY_BUTTON;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={startClass} onClick={handleStart} disabled={pairing.busy} data-testid="capture-pairing-start">
        {startLabel}
      </button>
      <UnpairButton paired={paired} busy={pairing.busy} onUnpair={handleUnpair} />
    </div>
  );
}

function UnpairButton({ paired, busy, onUnpair }: { paired: boolean; busy: boolean; onUnpair(): void }) {
  if (!paired) return null;
  return (
    <button type="button" className={SECONDARY_BUTTON} onClick={onUnpair} disabled={busy} data-testid="capture-pairing-unpair">
      Desvincular captura
    </button>
  );
}

function ActionFailed({ failed }: { failed: boolean }) {
  if (!failed) return null;
  return (
    <span className="text-caption text-signal-negative" role="alert" data-testid="capture-pairing-error">
      No se pudo completar. Probá de nuevo en unos segundos.
    </span>
  );
}

export interface CaptureAutoPanelProps {
  status: LiveCaptureStatus | null;
  fetchImpl?: typeof fetch;
  /** The site the adapter must talk to; defaults to this page's own origin. */
  origin?: string;
}

export function CaptureAutoPanel({ status, fetchImpl, origin }: CaptureAutoPanelProps) {
  const pairing = useCapturePairing({ fetchImpl });
  if (pairing.status === "loading") return null;
  const siteOrigin = origin ?? window.location.origin;
  const readiness = captureReadiness(pairing.paired, status);
  const copy = READINESS_COPY[readiness];
  function handleStart() {
    void pairing.start();
  }
  function handleUnpair() {
    void pairing.unpair();
  }
  return (
    <section className={PANEL} data-testid="capture-auto" data-readiness={readiness}>
      <div className="flex flex-col gap-1">
        <span className="text-caption font-semibold text-content-muted">CAPTURA AUTOMÁTICA · OVERWOLF</span>
        <span className={copy.className} role="status" data-testid="capture-auto-readiness">{copy.title}</span>
        <span className="text-caption text-content-secondary">{copy.hint}</span>
      </div>
      <PairingCode pairing={pairing} origin={siteOrigin} />
      <ActionFailed failed={pairing.actionFailed} />
      <PairingActions paired={pairing.paired} pairing={pairing} onStart={handleStart} onUnpair={handleUnpair} />
    </section>
  );
}
