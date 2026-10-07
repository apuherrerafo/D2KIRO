"use client";

import { useState, type ReactNode } from "react";
import {
  COMPANION_INSTALLER_DOWNLOAD_ACTION,
  COMPANION_ONCE,
  COMPANION_SCOPE,
  GSI_CFG_EXAMPLE_PATHS,
  GSI_CFG_FOLDER,
  GSI_CONFIG_DOWNLOAD_ACTION,
  GSI_INSTALL_ONCE,
  GSI_LAUNCH_OPTION,
  GSI_UNINSTALLER_URL,
} from "../constants";
import { CHIP, CODE_BOX, PANEL, PRIMARY_BUTTON, SECONDARY_BUTTON, STATUS_PILL_BAD, STATUS_PILL_MUTED, STEP_NUMBER } from "../styles";
import type { GsiLinkView } from "../types";

// Conectar Dota desde el sitio, sin terminal. El camino normal es UN solo instalador: D2KIRO Companion.
// El instalador GSI legacy (/api/live/gsi-installer) sigue en el backend pero ya no se ofrece aca; el cfg
// a mano y -gamestateintegration viven solo en "Opciones avanzadas de conexion". El servidor genera las
// descargas (POST same-origin); la pagina nunca ve el token.

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
  action: string;
  label: string;
  testId: string;
  className: string;
  onDownload(): void;
}

/** A real form POST: the browser saves the attachment and stays on this page. */
export function GsiDownloadForm({ action, label, testId, className, onDownload }: DownloadFormProps) {
  function handleSubmit() {
    onDownload();
  }
  return (
    <form method="post" action={action} onSubmit={handleSubmit}>
      <button type="submit" className={className} data-testid={testId}>
        {label}
      </button>
    </form>
  );
}

export interface AdvancedConnectionOptionsProps {
  manualLabel: string;
  onDownload(): void;
}

/**
 * "Opciones avanzadas de conexión": troubleshooting only, closed by default. Nothing in here is a second
 * required installer -- the Companion is the one install. The launch option and the raw cfg are for a PC
 * where the Companion is connected but Dota still sends nothing.
 */
export function AdvancedConnectionOptions({ manualLabel, onDownload }: AdvancedConnectionOptionsProps) {
  return (
    <details className="flex flex-col gap-3" data-testid="advanced-connection">
      <summary className="cursor-pointer text-caption text-content-secondary">Opciones avanzadas de conexión (problemas de conexión)</summary>
      <div className="mt-3 flex flex-col gap-4">
        <span className="text-caption text-content-muted" data-testid="advanced-connection-note">
          No es otro instalador: solo si el Companion figura conectado y Dota 2 sigue sin enviar datos.
        </span>
        <div className="flex flex-col gap-2" data-testid="gsi-launch-option-help">
          <span className="text-caption text-content-secondary">
            Steam → clic derecho en Dota 2 → Propiedades → General → Opciones de lanzamiento. Agregá lo siguiente y reiniciá Dota 2:
          </span>
          <CopyableText value={GSI_LAUNCH_OPTION} label="la opción de lanzamiento" />
        </div>
        <details className="flex flex-col gap-3" data-testid="gsi-manual-install">
          <summary className="cursor-pointer text-caption text-content-secondary">Copiar el archivo de configuración a mano</summary>
          <ol className="mt-3 flex flex-col gap-4">
            <Step number={1} title="Descargá tu archivo de configuración">
              <span className="text-caption text-content-muted">{GSI_INSTALL_ONCE}</span>
              <span className="text-caption text-signal-warning" data-testid="gsi-manual-rotates">
                Descargarlo genera una conexión nueva: la anterior deja de funcionar, incluida la del Companion ya instalado.
              </span>
              <GsiDownloadForm action={GSI_CONFIG_DOWNLOAD_ACTION} label={manualLabel} testId="gsi-download" className={SECONDARY_BUTTON} onDownload={onDownload} />
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
          </ol>
        </details>
        <span className="text-caption text-content-muted">
          ¿Querés quitar D2KIRO de Dota en esta PC?{" "}
          <a href={GSI_UNINSTALLER_URL} download className="text-accent-primary underline" data-testid="gsi-uninstaller-download">
            Descargar el desinstalador
          </a>
        </span>
      </div>
    </details>
  );
}

export interface DotaSetupStepsProps {
  manualLabel: string;
  /** False once the Companion is detected: the installer is replaced by status, never shown again. */
  showInstaller: boolean;
  onDownload(): void;
}

/** D2KIRO Companion: the ONE install (Windows). The page never sees the link inside it. */
function CompanionInstall({ onDownload }: { onDownload(): void }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent-primary bg-surface-overlay p-3" data-testid="companion-install">
      <span className="text-body font-semibold text-content-primary">D2KIRO Companion para Windows</span>
      <span className="text-caption text-content-secondary">{COMPANION_ONCE}</span>
      <GsiDownloadForm action={COMPANION_INSTALLER_DOWNLOAD_ACTION} label="Instalar D2KIRO Companion" testId="companion-installer-download" className={PRIMARY_BUTTON} onDownload={onDownload} />
      <span className="text-caption text-content-muted">{COMPANION_SCOPE}</span>
      <span className="text-caption text-content-muted">Es personal: no lo compartas. Si descargás uno nuevo, el anterior deja de funcionar.</span>
    </div>
  );
}

function InstallerOrNothing({ show, onDownload }: { show: boolean; onDownload(): void }) {
  if (!show) return null;
  return <CompanionInstall onDownload={onDownload} />;
}

export function DotaSetupSteps({ manualLabel, showInstaller, onDownload }: DotaSetupStepsProps) {
  return (
    <div className="flex flex-col gap-3" data-testid="dota-setup-steps">
      <InstallerOrNothing show={showInstaller} onDownload={onDownload} />
      <AdvancedConnectionOptions manualLabel={manualLabel} onDownload={onDownload} />
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
      <DotaSetupSteps manualLabel="Descargar configuración D2KIRO" showInstaller onDownload={onDownload} />
      <AwaitingDownload awaiting={awaitingDownload} />
    </>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
}

export interface DotaLinkControlsProps {
  link: GsiLinkView;
  /** Dota has never reported on this link yet. */
  waitingForDota: boolean;
  /** The Companion on the Player's PC is beating: the installer is replaced by status. */
  companionActive: boolean;
  /** One line of state-based guidance ("Companion conectado · abre Dota 2"); null when there is nothing to add. */
  guidance: string | null;
  setupError: string | null;
  awaitingDownload: boolean;
  onDownload(): void;
  onDisconnect(): void;
}

/** Setup stays open only while nothing is detected (no Companion, no Dota report). Afterwards it collapses to status. */
export function DotaLinkControls({ link, waitingForDota, companionActive, guidance, setupError, awaitingDownload, onDownload, onDisconnect }: DotaLinkControlsProps) {
  function handleDisconnect() {
    onDisconnect();
  }
  const open = (waitingForDota && !companionActive) || setupError !== null;
  return (
    <details className={PANEL} open={open} data-testid="dota-link-controls">
      <summary className="cursor-pointer text-body text-content-primary">
        <span className="font-semibold">Conexión con Dota</span>
        <span className={`ml-2 ${STATUS_PILL_MUTED}`}>vence el {formatDate(link.expiresAt)}</span>
      </summary>
      <Guidance text={guidance} />
      <SetupError message={setupError} />
      <DotaSetupSteps manualLabel="Descargar configuración de nuevo" showInstaller={!companionActive} onDownload={onDownload} />
      <AwaitingDownload awaiting={awaitingDownload} />
      <button type="button" className={SECONDARY_BUTTON} onClick={handleDisconnect} data-testid="dota-disconnect">
        Desconectar Dota
      </button>
    </details>
  );
}

function Guidance({ text }: { text: string | null }) {
  if (text === null) return null;
  return <span className="text-caption text-content-secondary" data-testid="dota-guidance">{text}</span>;
}
