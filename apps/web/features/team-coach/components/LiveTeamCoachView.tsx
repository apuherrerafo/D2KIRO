"use client";

import type { ComponentProps, ReactNode } from "react";
import { CompactBoard } from "@/components/draft-layout/DraftLayout";
import { useHeroCatalog } from "@/features/draft/use-hero-catalog";
import { LiveLightBoard, LiveNotice, LivePage } from "@/features/live-light";
import { SimulatorLightScope } from "@/features/simulator-light";
import { protocolViewToDraftState } from "@/features/random-draft-simulator/protocol-client";
import { useLiveTeamCoachStore, type LiveEngineStatus } from "../live-store";
import { useLiveTeamCoach } from "../use-live-team-coach";
import { isCaptureDegraded, isRecommendationBlocked, LiveCaptureStatusBar } from "./LiveCaptureStatusBar";
import { LiveManualEntry } from "./LiveManualEntry";

// /live-draft -- el draft REAL de Dota. Dota (Game State Integration -> Railway, TSK-219) es la fuente
// de lo que el juego informa: el Player no tiene que tocar nada en D2KIRO. Cuando la captura se degrada o
// es parcial, D2KIRO lo dice y NO recomienda sobre un draft incompleto: la entrada manual ya no es el
// fallback normal del Player (sólo queda detrás de `debugManualEntry`, para desarrollo).

function EngineNotice({ status }: { status: LiveEngineStatus }) {
  if (status === "ok" || status === "connecting") return null;
  if (status === "forbidden") {
    return (
      <LiveNotice tone="bad" testId="live-forbidden">
        <span className="ll-notice-body">Esta sesión en vivo pertenece a otra cuenta. Vuelve a Draft en vivo desde el menú con tu propia cuenta.</span>
      </LiveNotice>
    );
  }
  return (
    <LiveNotice tone="bad" testId="live-engine-unreachable">
      <span className="ll-notice-body">No se pudo contactar a D2KIRO. Reintentando...</span>
    </LiveNotice>
  );
}

export interface LiveTeamCoachViewProps {
  sessionId: string;
  /** Rendered under the title ONLY while the connection needs the Player's attention (installer open, expired link). */
  setup?: ReactNode;
  /** Compact row between the capture status and the board: the Player's position and the Party preset. */
  controls?: ReactNode;
  /** Rendered under the Coach -- quiet connection details and diagnostics, never ahead of the board. */
  children?: ReactNode;
  /** Developer/debug only: shows manual entry and manual picks. Never the Player's fallback. */
  debugManualEntry?: boolean;
  /** The Dota link's credential has expired: the Companion pill says so instead of "sin señal". */
  linkExpired?: boolean;
}

export function LiveTeamCoachView({ sessionId, setup, controls, children, debugManualEntry = false, linkExpired = false }: LiveTeamCoachViewProps) {
  const { heroes: heroCatalog } = useHeroCatalog();
  const { selectPosition, report, refresh } = useLiveTeamCoach(sessionId);
  const engineStatus = useLiveTeamCoachStore((state) => state.engineStatus);
  const captureStatus = useLiveTeamCoachStore((state) => state.captureStatus);
  const snapshot = useLiveTeamCoachStore((state) => state.snapshot);
  const board = useLiveTeamCoachStore((state) => state.board);
  const boardStatus = useLiveTeamCoachStore((state) => state.boardStatus);
  const selectedPosition = useLiveTeamCoachStore((state) => state.selectedPosition);
  const manualError = useLiveTeamCoachStore((state) => state.manualError);

  const degraded = isCaptureDegraded(captureStatus);
  const draftEnded = captureStatus?.draftPhase === "ended";
  const draftState = snapshot ? protocolViewToDraftState(snapshot.view, "") : null;
  const unavailable = new Set<number>(draftState ? [...draftState.banned, ...draftState.picks.radiant, ...draftState.picks.dire] : []);

  function handleRetry() {
    void refresh();
  }
  // No recommendation is built from an incomplete automatic draft. The engine refuses it on its own routes too, debug
  // or not: the board would never load, so it is hidden. (Only an older engine that gives no verdict keeps the debug board.)
  const hideBoard = isRecommendationBlocked(captureStatus) && !draftEnded && (!debugManualEntry || captureStatus?.recommendation !== undefined);

  return (
    <LivePage testId="live-team-coach">
      {setup}
      <EngineNotice status={engineStatus} />
      <LiveCaptureStatusBar status={captureStatus} heroCatalog={heroCatalog} linkExpired={linkExpired} />
      {controls}
      <LiveDraftBoard draftState={draftState} heroCatalog={heroCatalog} />
      <BoardUnlessPartial hidden={hideBoard}>
        <LiveLightBoard
          sessionId={sessionId}
          board={board}
          status={boardStatus}
          captureStatus={captureStatus}
          heroCatalog={heroCatalog}
          onRetry={handleRetry}
          draftEnded={draftEnded}
        />
      </BoardUnlessPartial>
      {children}
      <DebugManualEntry
        enabled={debugManualEntry}
        heroCatalog={heroCatalog}
        unavailableHeroIds={unavailable}
        bans={draftState?.banned ?? []}
        ownPicks={ownPicksOf(draftState)}
        enemyPicks={enemyPicksOf(draftState)}
        localSide={captureStatus?.localSide ?? null}
        position={selectedPosition}
        onSelectPosition={selectPosition}
        draftStarted={captureStatus?.draftPhase === "hero_selection"}
        open={degraded}
        error={manualError}
        onReport={report}
      />
    </LivePage>
  );
}

function BoardUnlessPartial({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  if (hidden) return null;
  return <>{children}</>;
}

function DebugManualEntry({ enabled, ...props }: { enabled: boolean } & ComponentProps<typeof LiveManualEntry>) {
  if (!enabled) return null;
  return <LiveManualEntry {...props} />;
}

type LiveDraftState = ReturnType<typeof protocolViewToDraftState>;

function ownPicksOf(draftState: LiveDraftState | null): number[] {
  if (draftState === null) return [];
  return draftState.localSide === "dire" ? [...draftState.picks.dire] : [...draftState.picks.radiant];
}

function enemyPicksOf(draftState: LiveDraftState | null): number[] {
  if (draftState === null) return [];
  return draftState.localSide === "dire" ? [...draftState.picks.radiant] : [...draftState.picks.dire];
}

function LiveDraftBoard({ draftState, heroCatalog }: { draftState: ReturnType<typeof protocolViewToDraftState> | null; heroCatalog: ReturnType<typeof useHeroCatalog>["heroes"] }) {
  if (!draftState) return null;
  // Picks y bans confirmados, en la misma franja Canonical Light del Simulador. Sin timer: Live no inventa uno (no hay `centerContent`).
  return (
    <SimulatorLightScope testId="live-light-draft-strip" variant="strip">
      <CompactBoard banned={draftState.banned} picks={draftState.picks} localSide={draftState.localSide} heroCatalog={heroCatalog} />
    </SimulatorLightScope>
  );
}
