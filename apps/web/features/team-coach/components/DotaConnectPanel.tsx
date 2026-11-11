"use client";

import { useRef, useState, type ReactNode } from "react";
import { ActionPrimary, ActionQuiet, Glass } from "@/design/canonical/primitives";
import { LiveNotice } from "@/features/live-light";
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
import { LL_PILL_BAD, LL_PILL_MUTED, LL_PILL_WARN } from "../styles";
import type { LinkLifetime } from "../link-lifetime";
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
    <div className="ll-copy">
      <code className="ll-code">{value}</code>
      <ActionQuiet onPress={handleCopy}>
        <CopyLabel copied={copied} />
        <span className="cx-sr"> {label}</span>
      </ActionQuiet>
    </div>
  );
}

function CopyLabel({ copied }: { copied: boolean }) {
  if (copied) return <>Copiado</>;
  return <>Copiar</>;
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="ll-step">
      <span className="ll-step-number">{number}</span>
      <div className="ll-step-body">
        <span className="ll-value">{title}</span>
        {children}
      </div>
    </li>
  );
}

interface DownloadFormProps {
  action: string;
  label: string;
  testId: string;
  /** `primary` = el único compromiso espectral de la vista; `quiet` = acción secundaria. */
  variant: "primary" | "quiet";
  onDownload(): void;
}

/** A real form POST: the browser saves the attachment and stays on this page. */
export function GsiDownloadForm({ action, label, testId, variant, onDownload }: DownloadFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  function handleSubmit() {
    onDownload();
  }
  function handlePress() {
    formRef.current?.requestSubmit();
  }
  return (
    <form method="post" action={action} onSubmit={handleSubmit} ref={formRef}>
      <DownloadAction variant={variant} label={label} testId={testId} onPress={handlePress} />
    </form>
  );
}

function DownloadAction({ variant, label, testId, onPress }: { variant: "primary" | "quiet"; label: string; testId: string; onPress(): void }) {
  if (variant === "primary") return <ActionPrimary onPress={onPress} testId={testId}>{label}</ActionPrimary>;
  return <ActionQuiet onPress={onPress} testId={testId}>{label}</ActionQuiet>;
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
    <details className="ll-sub ll-stack" data-testid="advanced-connection">
      <summary>Opciones avanzadas de conexión (problemas de conexión)</summary>
      <div className="ll-stack">
        <span className="ll-text ll-text--muted" data-testid="advanced-connection-note">
          No es otro instalador: solo si el Companion figura conectado y Dota 2 sigue sin enviar datos.
        </span>
        <div className="ll-stack" data-testid="gsi-launch-option-help">
          <span className="ll-text">
            Steam → clic derecho en Dota 2 → Propiedades → General → Opciones de lanzamiento. Agrega lo siguiente y reinicia Dota 2:
          </span>
          <CopyableText value={GSI_LAUNCH_OPTION} label="la opción de lanzamiento" />
        </div>
        <details className="ll-sub ll-stack" data-testid="gsi-manual-install">
          <summary>Copiar el archivo de configuración a mano</summary>
          <ol className="ll-steps">
            <Step number={1} title="Descarga tu archivo de configuración">
              <span className="ll-text ll-text--muted">{GSI_INSTALL_ONCE}</span>
              <span className="ll-pill ll-pill--warn" data-testid="gsi-manual-rotates">
                Descargarlo genera una conexión nueva: la anterior deja de funcionar, incluida la del Companion ya instalado.
              </span>
              <GsiDownloadForm action={GSI_CONFIG_DOWNLOAD_ACTION} label={manualLabel} testId="gsi-download" variant="quiet" onDownload={onDownload} />
            </Step>
            <Step number={2} title="Cópialo en la carpeta de integraciones de Dota">
              <span className="ll-text">
                En Steam: Biblioteca → clic derecho en Dota 2 → Administrar → Explorar archivos locales. Se abre la carpeta «dota 2 beta»; entra a esta carpeta (si gamestate_integration no existe, créala):
              </span>
              <CopyableText value={GSI_CFG_FOLDER} label="la carpeta de integraciones" />
              <span className="ll-text ll-text--muted">Tu biblioteca de Steam puede estar en otro disco. Por ejemplo:</span>
              <CopyableText value={GSI_CFG_EXAMPLE_PATHS[0]} label="la ruta de ejemplo en C:" />
              <CopyableText value={GSI_CFG_EXAMPLE_PATHS[1]} label="la ruta de ejemplo en D:" />
            </Step>
          </ol>
        </details>
        <span className="ll-text ll-text--muted">
          ¿Quieres quitar D2KIRO de Dota en esta PC?{" "}
          <a href={GSI_UNINSTALLER_URL} download className="ll-link" data-testid="gsi-uninstaller-download">
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
    <div className="ll-host" data-testid="companion-install">
      <Glass className="ll-panel" edge surfaceLevel="4">
        <div className="ll-panel-inner">
          <span className="ll-value">D2KIRO Companion para Windows</span>
          <span className="ll-text">{COMPANION_ONCE}</span>
          <GsiDownloadForm action={COMPANION_INSTALLER_DOWNLOAD_ACTION} label="Instalar D2KIRO Companion" testId="companion-installer-download" variant="primary" onDownload={onDownload} />
          <span className="ll-text ll-text--muted">{COMPANION_SCOPE}</span>
          <span className="ll-text ll-text--muted">Es personal: no lo compartas. Si descargas uno nuevo, el anterior deja de funcionar.</span>
        </div>
      </Glass>
    </div>
  );
}

function InstallerOrNothing({ show, onDownload }: { show: boolean; onDownload(): void }) {
  if (!show) return null;
  return <CompanionInstall onDownload={onDownload} />;
}

export function DotaSetupSteps({ manualLabel, showInstaller, onDownload }: DotaSetupStepsProps) {
  return (
    <div className="ll-stack" data-testid="dota-setup-steps">
      <InstallerOrNothing show={showInstaller} onDownload={onDownload} />
      <AdvancedConnectionOptions manualLabel={manualLabel} onDownload={onDownload} />
    </div>
  );
}

function SetupError({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <LiveNotice tone="bad" testId="gsi-setup-error">
      <span className="ll-notice-body">{message}</span>
    </LiveNotice>
  );
}

function AwaitingDownload({ awaiting }: { awaiting: boolean }) {
  if (!awaiting) return null;
  return <span className="ll-text ll-text--muted" role="status">Preparando tu conexión...</span>;
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
    <section className="ll-host" data-testid="dota-connect">
      <Glass className="ll-panel" surfaceLevel="3">
        <div className="ll-panel-inner">
          <div className="ll-item">
            <span className="sl-caption">CONNECTION</span>
            <span className={LL_PILL_BAD} data-testid="dota-disconnected">● Dota desconectado</span>
          </div>
          <SetupError message={setupError} />
          <ConnectBody open={open} awaitingDownload={awaitingDownload} onConnect={handleConnect} onDownload={onDownload} />
        </div>
      </Glass>
    </section>
  );
}

function ConnectBody({ open, awaitingDownload, onConnect, onDownload }: { open: boolean; awaitingDownload: boolean; onConnect(): void; onDownload(): void }) {
  if (!open) {
    return (
      <ActionPrimary onPress={onConnect} testId="dota-connect-button">
        Conectar Dota
      </ActionPrimary>
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
  /** Remaining life of the link's credential; defaults to healthy. */
  lifetime?: LinkLifetime;
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
export function DotaLinkControls({ link, lifetime = "healthy", waitingForDota, companionActive, guidance, setupError, awaitingDownload, onDownload, onDisconnect }: DotaLinkControlsProps) {
  function handleDisconnect() {
    onDisconnect();
  }
  const expired = lifetime === "expired";
  const open = (waitingForDota && !companionActive) || setupError !== null || expired;
  // Guidance lives OUTSIDE the <details>: it must be readable while the setup is collapsed.
  return (
    <div className="ll-stack" data-testid="dota-link-section">
      <LifetimeNotice lifetime={lifetime} />
      <Guidance text={guidance} />
      <details className="ll-panel ll-fold" open={open} data-testid="dota-link-controls">
        <summary>
          <span>Conexión con Dota</span>
          <LinkExpiryPill lifetime={lifetime} expiresAt={link.expiresAt} />
        </summary>
        <SetupError message={setupError} />
        <DotaSetupSteps manualLabel="Descargar configuración de nuevo" showInstaller={!companionActive || expired} onDownload={onDownload} />
        <AwaitingDownload awaiting={awaitingDownload} />
        <div>
          <ActionQuiet onPress={handleDisconnect} testId="dota-disconnect">
            Desconectar Dota
          </ActionQuiet>
        </div>
      </details>
    </div>
  );
}

function LinkExpiryPill({ lifetime, expiresAt }: { lifetime: LinkLifetime; expiresAt: string }) {
  if (lifetime === "expired") return <span className={`ll-fold-aside ${LL_PILL_WARN}`}>vencida</span>;
  return <span className={`ll-fold-aside ${LL_PILL_MUTED}`}>vence el {formatDate(expiresAt)}</span>;
}

/** Expired: explicit, with the way out (the same pairing). Expiring soon: a discreet heads-up. Healthy: nothing. */
function LifetimeNotice({ lifetime }: { lifetime: LinkLifetime }) {
  if (lifetime === "healthy") return null;
  if (lifetime === "expiring") return <span className="ll-text ll-text--muted" role="status" data-testid="dota-link-expiring">La conexión vence pronto</span>;
  return (
    <LiveNotice tone="warn" testId="dota-link-expired" title="Conexión de D2KIRO vencida">
      <span className="ll-notice-body">Vuelve a vincular el Companion para continuar.</span>
    </LiveNotice>
  );
}

function Guidance({ text }: { text: string | null }) {
  if (text === null) return null;
  return <p className="ll-guidance" role="status" data-testid="dota-guidance">{text}</p>;
}
