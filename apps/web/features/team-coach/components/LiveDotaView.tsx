"use client";

import type { ReactNode } from "react";
import { ActionQuiet } from "@/design/canonical/primitives";
import { LiveNotice, LivePage } from "@/features/live-light";
import { GSI_SETUP_ERRORS } from "../constants";
import { liveLightViewOf } from "@/features/live-light/view-model";
import { useLiveTeamCoachStore } from "../live-store";
import type { GsiLinkView } from "../types";
import { linkLifetime } from "../link-lifetime";
import { useGsiLink, type UseGsiLinkResult } from "../use-gsi-link";
import { activeCompanion, companionGuidance } from "./LiveCaptureStatusBar";
import { DotaConnectPanel, DotaLinkControls } from "./DotaConnectPanel";
import { LiveDiagnosticsPanel } from "./LiveDiagnosticsPanel";
import { LiveLocalPositionPanel } from "./LiveLocalPositionPanel";
import { LivePartyPresetPanel } from "./LivePartyPresetPanel";
import { LiveTeamCoachView } from "./LiveTeamCoachView";

// TSK-219 -- /live-draft on the deployed site. The Player's account has (or not) a Dota link:
//   no link  -> "Dota desconectado" + "Conectar Dota" -> one-time cfg download + install steps
//   link     -> the live Team Coach on that link's session; it updates by itself as Dota reports.
// Normal setup = one Companion install; once the Companion is detected the setup collapses to status.
// Manual entry is not the Player fallback any more (see LiveTeamCoachView.debugManualEntry).

function Shell({ children }: { children: ReactNode }) {
  return (
    <LivePage testId="live-dota">
      {children}
    </LivePage>
  );
}

export interface LiveDotaViewProps {
  /** ?setup=<code> after a failed cfg download. */
  setupError?: string | null;
  fetchImpl?: typeof fetch;
  /** Injectable clock for link expiry (tests). */
  now?: () => number;
}

export function LiveDotaView({ setupError = null, fetchImpl, now = Date.now }: LiveDotaViewProps) {
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
        <p className="ll-text ll-text--muted" role="status">Cargando...</p>
      </Shell>
    );
  }
  if (gsi.state.status === "failed") {
    return (
      <Shell>
        <LiveNotice tone="bad" testId="live-dota-unreachable">
          <span className="ll-notice-body">No se pudo contactar a D2KIRO.</span>
          <div>
            <ActionQuiet onPress={handleRetry}>Reintentar</ActionQuiet>
          </div>
        </LiveNotice>
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
  return <LinkedLiveView link={gsi.state.link} gsi={gsi} setupError={message} onDownload={handleDownload} fetchImpl={fetchImpl} now={now} />;
}

interface LinkedLiveViewProps {
  link: GsiLinkView;
  gsi: UseGsiLinkResult;
  setupError: string | null;
  onDownload(): void;
  fetchImpl?: typeof fetch;
  now: () => number;
}

function LinkedLiveView({ link, gsi, setupError, onDownload, fetchImpl, now }: LinkedLiveViewProps) {
  const captureStatus = useLiveTeamCoachStore((state) => state.captureStatus);
  const engineStatus = useLiveTeamCoachStore((state) => state.engineStatus);
  const board = useLiveTeamCoachStore((state) => state.board);
  // Only the status of THIS link's session counts (the store may still hold a previous one).
  const linkStatus = captureStatus !== null && captureStatus.sessionId === link.sessionId ? captureStatus : null;
  // Dota has not reported on this link yet (status not loaded, or no GSI update ever): keep the setup open.
  const waitingForDota = linkStatus === null || linkStatus.gsi === null || linkStatus.gsi === undefined;
  const companionActive = activeCompanion(linkStatus) !== null;
  const lifetime = linkLifetime(link.expiresAt, now());
  function handleDisconnect() {
    void gsi.disconnect();
  }
  // The installer / expired link stay ABOVE the board only while the Player must act on them; once the Companion is up
  // the same controls move below the Coach as quiet status.
  const needsSetup = (waitingForDota && !companionActive) || setupError !== null || lifetime === "expired";
  // Solo without a declared seat: the board itself offers Pos 1-5, so this panel steps aside (one selector visible).
  const draftEnded = linkStatus?.draftPhase === "ended";
  const boardOffersSeat = board !== null && liveLightViewOf({ board, localPlayer: linkStatus?.localPlayer, teamContext: linkStatus?.teamContext, draftEnded }).kind === "pick-seat";
  const linkControls = (
    <DotaLinkControls
      link={link}
      lifetime={lifetime}
      waitingForDota={waitingForDota}
      companionActive={companionActive}
      guidance={companionGuidance(linkStatus)}
      setupError={setupError}
      awaitingDownload={gsi.awaitingDownload}
      onDownload={onDownload}
      onDisconnect={handleDisconnect}
    />
  );
  const controls = (
    <div className="ll-controls" data-testid="live-controls">
      <LiveLocalPositionPanel sessionId={link.sessionId} localPlayer={linkStatus?.localPlayer} fetchImpl={fetchImpl} hidden={boardOffersSeat} />
      <LivePartyPresetPanel sessionId={link.sessionId} teamContext={linkStatus?.teamContext} fetchImpl={fetchImpl} />
    </div>
  );
  return (
    <LiveTeamCoachView sessionId={link.sessionId} linkExpired={lifetime === "expired"} setup={needsSetup ? linkControls : null} controls={controls}>
      {needsSetup ? null : linkControls}
      <LiveDiagnosticsPanel engine={engineStatus} dotaLink status={linkStatus} />
    </LiveTeamCoachView>
  );
}
