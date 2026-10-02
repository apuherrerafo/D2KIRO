"use client";

import type { ReactNode } from "react";
import { CompactBoard } from "@/components/draft-layout/DraftLayout";
import { useHeroCatalog } from "@/features/draft/use-hero-catalog";
import { protocolViewToDraftState } from "@/features/random-draft-simulator/protocol-client";
import { useLiveTeamCoachStore, type LiveEngineStatus } from "../live-store";
import type { TeamPosition } from "../types";
import { useLiveTeamCoach } from "../use-live-team-coach";
import { isCaptureDegraded, LiveCaptureStatusBar } from "./LiveCaptureStatusBar";
import { LiveManualEntry } from "./LiveManualEntry";
import { TeamCoachBoard } from "./TeamCoachBoard";

// /live-draft -- el draft REAL de Dota. Dota (Game State Integration -> Railway, TSK-219) es la fuente
// de lo que el juego informa: el Player no tiene que tocar nada en D2KIRO. Cuando la captura se degrada o
// es parcial, el mismo tablero acepta clics y la entrada manual queda abierta, sobre la MISMA sesión.

function EngineNotice({ status }: { status: LiveEngineStatus }) {
  if (status === "ok" || status === "connecting") return null;
  if (status === "forbidden") {
    return (
      <div className="rounded-lg border border-signal-negative bg-surface-overlay p-3 text-caption text-signal-negative" role="alert" data-testid="live-forbidden">
        Esta sesión en vivo pertenece a otra cuenta. Volvé a Draft en vivo desde el menú con tu propia cuenta.
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
}

export function LiveTeamCoachView({ sessionId, children }: LiveTeamCoachViewProps) {
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
  const draftState = snapshot ? protocolViewToDraftState(snapshot.view, "") : null;
  const unavailable = new Set<number>(draftState ? [...draftState.banned, ...draftState.picks.radiant, ...draftState.picks.dire] : []);

  // Manual fallback through the board: a click reports an own pick for that position (same fact the capturer sends).
  function handleManualPick(position: TeamPosition, heroId: number) {
    void report({ type: "pick", side: captureStatus?.localSide ?? "radiant", heroId, position });
  }
  function handleRetry() {
    void refresh();
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-surface-base p-4 md:p-6" data-testid="live-team-coach">
      <span className="text-heading text-content-primary">D2KIRO · Draft en vivo</span>
      {children}
      <EngineNotice status={engineStatus} />
      <LiveCaptureStatusBar status={captureStatus} heroCatalog={heroCatalog} />
      <LiveDraftBoard draftState={draftState} heroCatalog={heroCatalog} />
      <TeamCoachBoard
        board={board}
        status={boardStatus}
        heroCatalog={heroCatalog}
        selectedPosition={selectedPosition}
        onSelectPosition={selectPosition}
        onPickHero={degraded ? handleManualPick : undefined}
        onRetry={handleRetry}
      />
      <LiveManualEntry
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
