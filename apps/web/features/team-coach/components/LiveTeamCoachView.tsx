"use client";

import type { ComponentProps, ReactNode } from "react";
import { CompactBoard } from "@/components/draft-layout/DraftLayout";
import { useHeroCatalog } from "@/features/draft/use-hero-catalog";
import { protocolViewToDraftState } from "@/features/random-draft-simulator/protocol-client";
import { useLiveTeamCoachStore, type LiveEngineStatus } from "../live-store";
import type { TeamPosition } from "../types";
import { useLiveTeamCoach } from "../use-live-team-coach";
import { isCaptureDegraded, isDraftPartial, LiveCaptureStatusBar } from "./LiveCaptureStatusBar";
import { LiveManualEntry } from "./LiveManualEntry";
import { TeamCoachBoard } from "./TeamCoachBoard";

// /live-draft -- el draft REAL de Dota. Dota (Game State Integration -> Railway, TSK-219) es la fuente
// de lo que el juego informa: el Player no tiene que tocar nada en D2KIRO. Cuando la captura se degrada o
// es parcial, D2KIRO lo dice y NO recomienda sobre un draft incompleto: la entrada manual ya no es el
// fallback normal del Player (sólo queda detrás de `debugManualEntry`, para desarrollo).

function EngineNotice({ status }: { status: LiveEngineStatus }) {
  if (status === "ok" || status === "connecting") return null;
  if (status === "forbidden") {
    return (
      <div className="rounded-lg border border-signal-negative bg-surface-overlay p-3 text-caption text-signal-negative" role="alert" data-testid="live-forbidden">
        Esta sesión en vivo pertenece a otra cuenta. Vuelve a Draft en vivo desde el menú con tu propia cuenta.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-signal-negative bg-surface-overlay p-3 text-caption text-signal-negative" role="alert" data-testid="live-engine-unreachable">
      No se pudo contactar a D2KIRO. Reintentando...
    </div>
  );
}

export interface LiveTeamCoachViewProps {
  sessionId: string;
  /** Rendered under the title -- /live-draft puts the Dota connection controls here. */
  children?: ReactNode;
  /** Developer/debug only: shows manual entry and manual picks. Never the Player's fallback. */
  debugManualEntry?: boolean;
  /** The Dota link's credential has expired: the Companion pill says so instead of "sin señal". */
  linkExpired?: boolean;
}

export function LiveTeamCoachView({ sessionId, children, debugManualEntry = false, linkExpired = false }: LiveTeamCoachViewProps) {
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

  // Manual fallback through the board: a click reports an own pick for that position (same fact the capturer sends).
  function handleManualPick(position: TeamPosition, heroId: number) {
    void report({ type: "pick", side: captureStatus?.localSide ?? "radiant", heroId, position });
  }
  function handleRetry() {
    void refresh();
  }
  // A finished draft has no pick to make: not even by hand through the board.
  const pickHandler = debugManualEntry && degraded && !draftEnded ? handleManualPick : undefined;
  // No recommendation is built from an incomplete automatic draft (debug keeps the board for diagnosis).
  const hideBoard = isDraftPartial(captureStatus) && !draftEnded && !debugManualEntry;

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-surface-base p-4 md:p-6" data-testid="live-team-coach">
      <span className="text-heading text-content-primary">D2KIRO · Draft en vivo</span>
      {children}
      <EngineNotice status={engineStatus} />
      <LiveCaptureStatusBar status={captureStatus} heroCatalog={heroCatalog} linkExpired={linkExpired} />
      <LiveDraftBoard draftState={draftState} heroCatalog={heroCatalog} />
      <BoardUnlessPartial hidden={hideBoard}>
        <TeamCoachBoard
          board={board}
          status={boardStatus}
          heroCatalog={heroCatalog}
          selectedPosition={selectedPosition}
          onSelectPosition={selectPosition}
          onPickHero={pickHandler}
          onRetry={handleRetry}
          draftEnded={draftEnded}
        />
      </BoardUnlessPartial>
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
    </main>
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
  return <CompactBoard banned={draftState.banned} picks={draftState.picks} localSide={draftState.localSide} heroCatalog={heroCatalog} />;
}
