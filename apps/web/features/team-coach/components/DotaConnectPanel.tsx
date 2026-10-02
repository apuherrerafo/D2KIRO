"use client";

import { useState, type ReactNode } from "react";
import { GSI_CFG_EXAMPLE_PATHS, GSI_CFG_FOLDER, GSI_CONFIG_DOWNLOAD_ACTION, GSI_INSTALL_ONCE, GSI_LAUNCH_OPTION } from "../constants";
import { CHIP, CODE_BOX, PANEL, PRIMARY_BUTTON, SECONDARY_BUTTON, STATUS_PILL_BAD, STATUS_PILL_MUTED, STEP_NUMBER } from "../styles";
import type { GsiLinkView } from "../types";

// TSK-219 -- conectar Dota desde el sitio, sin terminal: un archivo que se instala una vez. El navegador no
// puede escribir en la carpeta de Dota, así que la página da la ruta exacta (copiable) y cómo llegar a
// ella desde Steam. El archivo lo genera el servidor (POST same-origin); la página nunca ve su token.

function CopyableText({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className={CODE_BOX}>{value}</code>
      <button type="button" className={CHIP} onClick={handleCopy} aria-label={`Copiar ${label}`}>
        <CopyLabel copied={copied} />
      </button>
    </div>
  );
}

function CopyLabel({ copied }: { copied: boolean }) {
  if (copied) return <>Copiado</>;
  return <>Copiar</>;
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={STEP_NUMBER}>{number}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="text-body font-semibold text-content-primary">{title}</span>
        {children}
      </div>
    </li>
  );
}

interface DownloadFormProps {
  label: string;
  onDownload(): void;
}

/** A real form POST: the browser saves the attachment and stays on this page. */
export function GsiDownloadForm({ label, onDownload }: DownloadFormProps) {
  function handleSubmit() {
    onDownload();
  }
  return (
    <form method="post" action={GSI_CONFIG_DOWNLOAD_ACTION} onSubmit={handleSubmit}>
      <button type="submit" className={PRIMARY_BUTTON} data-testid="gsi-download">
        {label}
      </button>
    </form>
  );
}

export interface DotaSetupStepsProps {
  downloadLabel: string;
  onDownload(): void;
}

export function DotaSetupSteps({ downloadLabel, onDownload }: DotaSetupStepsProps) {
  return (
    <div className="flex flex-col gap-3" data-testid="dota-setup-steps">
      <span className="text-body font-semibold text-content-primary">{GSI_INSTALL_ONCE}</span>
      <ol className="flex flex-col gap-4">
        <Step number={1} title="Descargá tu archivo de configuración">
          <GsiDownloadForm label={downloadLabel} onDownload={onDownload} />
          <span className="text-caption text-content-muted">Es personal: no lo compartas. Si lo perdés, descargá uno nuevo y el anterior deja de funcionar.</span>
        </Step>
        <Step number={2} title="Copialo en la carpeta de integraciones de Dota">
          <span className="text-caption text-content-secondary">
            En Steam: Biblioteca → clic derecho en Dota 2 → Administrar → Explorar archivos locales. Se abre la carpeta «dota 2 beta»; entrá a esta carpeta (si gamestate_integration no existe, creala):
          </span>
          <CopyableText value={GSI_CFG_FOLDER} label="la carpeta de integraciones" />
          <span className="text-caption text-content-muted">Tu biblioteca de Steam puede estar en otro disco. Por ejemplo:</span>
          <CopyableText value={GSI_CFG_EXAMPLE_PATHS[0]} label="la ruta de ejemplo en C:" />
          <CopyableText value={GSI_CFG_EXAMPLE_PATHS[1]} label="la ruta de ejemplo en D:" />
        </Step>
        <Step number={3} title="Activá la integración en Steam (una sola vez)">
          <span className="text-caption text-content-secondary">Steam → clic derecho en Dota 2 → Propiedades → General → Opciones de lanzamiento. Agregá:</span>
          <CopyableText value={GSI_LAUNCH_OPTION} label="la opción de lanzamiento" />
        </Step>
        <Step number={4} title="Reiniciá Dota 2">
          <span className="text-caption text-content-secondary">Dota lee el archivo al abrirse. Esta página cambia sola a «Dota conectado».</span>
        </Step>
      </ol>
    </div>
  );
}

function SetupError({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <div className="rounded-lg border border-signal-negative bg-surface-overlay p-3 text-caption text-signal-negative" role="alert" data-testid="gsi-setup-error">
      {message}
    </div>
  );
}

function AwaitingDownload({ awaiting }: { awaiting: boolean }) {
  if (!awaiting) return null;
  return <span className="text-caption text-content-muted" role="status">Preparando tu conexión...</span>;
}

export interface DotaConnectPanelProps {
  setupError: string | null;
  awaitingDownload: boolean;
  onDownload(): void;
}

/** No link yet: "Dota desconectado" + "Conectar Dota", which opens the one-time setup. */
export function DotaConnectPanel({ setupError, awaitingDownload, onDownload }: DotaConnectPanelProps) {
  const [open, setOpen] = useState(setupError !== null);
  function handleConnect() {
    setOpen(true);
  }
  return (
    <section className={PANEL} data-testid="dota-connect">
      <div className="flex flex-col gap-1">
        <span className="text-caption font-semibold text-content-muted">CONNECTION</span>
        <span className={STATUS_PILL_BAD} data-testid="dota-disconnected">● Dota desconectado</span>
      </div>
      <SetupError message={setupError} />
      <ConnectBody open={open} awaitingDownload={awaitingDownload} onConnect={handleConnect} onDownload={onDownload} />
    </section>
  );
}

function ConnectBody({ open, awaitingDownload, onConnect, onDownload }: { open: boolean; awaitingDownload: boolean; onConnect(): void; onDownload(): void }) {
  if (!open) {
    return (
      <button type="button" className={PRIMARY_BUTTON} onClick={onConnect} data-testid="dota-connect-button">
        Conectar Dota
      </button>
    );
  }
  return (
    <>
      <DotaSetupSteps downloadLabel="Descargar configuración D2KIRO" onDownload={onDownload} />
      <AwaitingDownload awaiting={awaitingDownload} />
    </>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
}

export interface DotaLinkControlsProps {
  link: GsiLinkView;
  /** Dota has never reported on this link yet: keep the setup open. */
  waitingForDota: boolean;
  setupError: string | null;
  awaitingDownload: boolean;
  onDownload(): void;
  onDisconnect(): void;
}

/** A link exists: setup stays open until Dota first reports; afterwards, re-download or disconnect. */
export function DotaLinkControls({ link, waitingForDota, setupError, awaitingDownload, onDownload, onDisconnect }: DotaLinkControlsProps) {
  function handleDisconnect() {
    onDisconnect();
  }
  return (
    <details className={PANEL} open={waitingForDota || setupError !== null} data-testid="dota-link-controls">
      <summary className="cursor-pointer text-body text-content-primary">
        <span className="font-semibold">Conexión con Dota</span>
        <span className={`ml-2 ${STATUS_PILL_MUTED}`}>vence el {formatDate(link.expiresAt)}</span>
      </summary>
      <WaitingHint waiting={waitingForDota} />
      <SetupError message={setupError} />
      <DotaSetupSteps downloadLabel="Descargar configuración de nuevo" onDownload={onDownload} />
      <AwaitingDownload awaiting={awaitingDownload} />
      <button type="button" className={SECONDARY_BUTTON} onClick={handleDisconnect} data-testid="dota-disconnect">
        Desconectar Dota
      </button>
    </details>
  );
}

function WaitingHint({ waiting }: { waiting: boolean }) {
  if (!waiting) return null;
  return <span className="text-caption text-content-secondary">Esperando Dota... ¿Ya instalaste el archivo? Reiniciá Dota 2 y esta página cambia sola.</span>;
}
