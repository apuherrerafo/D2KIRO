"use client";

import type { ReactNode } from "react";
import { GSI_SETUP_ERRORS } from "../constants";
import { useLiveTeamCoachStore } from "../live-store";
import type { GsiLinkView } from "../types";
import { useGsiLink, type UseGsiLinkResult } from "../use-gsi-link";
import { DotaConnectPanel, DotaLinkControls } from "./DotaConnectPanel";
import { LiveDiagnosticsPanel } from "./LiveDiagnosticsPanel";
import { LiveTeamCoachView } from "./LiveTeamCoachView";

// TSK-219 -- /live-draft on the deployed site. The Player's account has (or not) a Dota link:
//   no link  -> "Dota desconectado" + "Conectar Dota" -> one-time cfg download + install steps
//   link     -> the live Team Coach on that link's session; it updates by itself as Dota reports.
// Manual entry stays available inside the live view (partial capture, reconnects, corrections).

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col gap-4 bg-surface-base p-4 md:p-6" data-testid="live-dota">
      <span className="text-heading text-content-primary">D2KIRO · Draft en vivo</span>
      {children}
    </main>
  );
}

export interface LiveDotaViewProps {
  /** ?setup=<code> after a failed cfg download. */
  setupError?: string | null;
  fetchImpl?: typeof fetch;
}

export function LiveDotaView({ setupError = null, fetchImpl }: LiveDotaViewProps) {
  const gsi = useGsiLink({ fetchImpl });
  const message = setupError === null ? null : GSI_SETUP_ERRORS[setupError] ?? GSI_SETUP_ERRORS.unavailable ?? null;
  function handleDownload() {
    gsi.expectNewLink();
  }
  function handleRetry() {
    void gsi.reload();
  }

  if (gsi.state.status === "loading") {
    return (
      <Shell>
        <span className="text-body text-content-muted" role="status">Cargando...</span>
      </Shell>
    );
  }
  if (gsi.state.status === "failed") {
    return (
      <Shell>
        <div className="flex flex-col gap-2 rounded-lg border border-signal-negative bg-surface-overlay p-3" role="alert" data-testid="live-dota-unreachable">
          <span className="text-caption text-signal-negative">No se pudo contactar a D2KIRO.</span>
          <button type="button" className="self-start text-caption text-accent-primary underline" onClick={handleRetry}>
            Reintentar
          </button>
        </div>
      </Shell>
    );
  }
  if (gsi.state.link === null) {
    return (
      <Shell>
        <DotaConnectPanel setupError={message} awaitingDownload={gsi.awaitingDownload} onDownload={handleDownload} />
        <LiveDiagnosticsPanel engine="ok" dotaLink={false} status={null} />
      </Shell>
    );
  }
  return <LinkedLiveView link={gsi.state.link} gsi={gsi} setupError={message} onDownload={handleDownload} />;
}

interface LinkedLiveViewProps {
  link: GsiLinkView;
  gsi: UseGsiLinkResult;
  setupError: string | null;
  onDownload(): void;
}

function LinkedLiveView({ link, gsi, setupError, onDownload }: LinkedLiveViewProps) {
  const captureStatus = useLiveTeamCoachStore((state) => state.captureStatus);
  const engineStatus = useLiveTeamCoachStore((state) => state.engineStatus);
  // Only the status of THIS link's session counts (the store may still hold a previous one).
  const linkStatus = captureStatus !== null && captureStatus.sessionId === link.sessionId ? captureStatus : null;
  // Dota has not reported on this link yet (status not loaded, or no GSI update ever): keep the setup open.
  const waitingForDota = linkStatus === null || linkStatus.gsi === null || linkStatus.gsi === undefined;
  function handleDisconnect() {
    void gsi.disconnect();
  }
  return (
    <LiveTeamCoachView sessionId={link.sessionId}>
      <DotaLinkControls
        link={link}
        waitingForDota={waitingForDota}
        setupError={setupError}
        awaitingDownload={gsi.awaitingDownload}
        onDownload={onDownload}
        onDisconnect={handleDisconnect}
      />
      <LiveDiagnosticsPanel engine={engineStatus} dotaLink status={linkStatus} />
    </LiveTeamCoachView>
  );
}
