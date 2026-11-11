"use client";

import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { SimulatorLightBoard, SimulatorLightScope } from "@/features/simulator-light";
import { FreeThreatsView } from "@/features/team-coach/components/FreeThreatsView";
import { GoldenCardView } from "@/features/team-coach/components/GoldenCardView";
import { LIVE_DRAFT_ENDED_NOTE, LIVE_DRAFT_ENDED_TITLE, teamPositionName } from "@/features/team-coach/constants";
import type { LiveCaptureStatus, RequestStatus, TeamCoachBoardData, TeamPosition } from "@/features/team-coach/types";
import { LIVE_BLOCKED_COPY, LIVE_EMPTY_COLUMN_COPY, LIVE_FOOT_NOTE, liveHeadlineOf, liveLightViewOf, mineRelationOf } from "../view-model";
import { LiveSeatPicker } from "./LiveSeatPicker";

// <Dominio><Cosa>: el tablero de /live-draft en Canonical Light. NO es una tercera implementación: compone `SimulatorLightBoard` (el mismo tablero, las mismas
// tarjetas, el mismo panel de análisis, el mismo predicado de elegibilidad) y solo decide QUÉ columnas se le entregan y cómo se nombra la posición propia.
// Reglas de Live: el clic analiza y nada más; nunca se envía un pick a Dota; no hay timer; no hay recomendación sobre un draft incompleto.

function DraftEnded() {
  return (
    <p className="sl-note" data-testid="team-coach-draft-ended" role="status">
      <span>
        <strong>{LIVE_DRAFT_ENDED_TITLE}</strong>
        {" · "}
        {LIVE_DRAFT_ENDED_NOTE}
      </span>
    </p>
  );
}

function DraftEndedSlot({ draftEnded }: { draftEnded: boolean }) {
  if (!draftEnded) return null;
  return <DraftEnded />;
}

function PriorityElsewhere({ position }: { position: TeamPosition | null }) {
  if (position === null) return null;
  return (
    <p className="sl-party" data-testid="live-light-priority-elsewhere">
      Prioridad del equipo ahora: {teamPositionName(position)}. No es tu posición: tu columna queda como lectura, sin pick destacado.
    </p>
  );
}

interface LiveFooterProps {
  board: TeamCoachBoardData;
  heroCatalog: Map<number, HeroMeta>;
  draftEnded: boolean;
  priorityElsewhere: TeamPosition | null;
}

function hasFooterContent({ board, draftEnded, priorityElsewhere }: LiveFooterProps): boolean {
  if (draftEnded || priorityElsewhere !== null) return true;
  return (board.goldenCard ?? null) !== null || (board.freeThreats ?? []).length > 0;
}

// Aviso de draft terminado, prioridad del equipo, card dorada y ADVERTIR. Solo lectura (sin botón de elegir); con el draft terminado, ni dorada ni ADVERTIR.
// Sin nada que decir no se dibuja ni el contenedor (antes dejaba una barra vacía).
function LiveFooter(props: LiveFooterProps) {
  const { board, heroCatalog, draftEnded, priorityElsewhere } = props;
  if (!hasFooterContent(props)) return null;
  return (
    <SimulatorLightScope>
      <DraftEndedSlot draftEnded={draftEnded} />
      <PriorityElsewhere position={priorityElsewhere} />
      <AuxViews board={board} draftEnded={draftEnded} heroCatalog={heroCatalog} />
    </SimulatorLightScope>
  );
}

function AuxViews({ board, heroCatalog, draftEnded }: Pick<LiveFooterProps, "board" | "heroCatalog" | "draftEnded">) {
  if (draftEnded) return null;
  return (
    <>
      <GoldenCardView goldenCard={board.goldenCard} heroCatalog={heroCatalog} />
      <FreeThreatsView threats={board.freeThreats} heroCatalog={heroCatalog} />
    </>
  );
}

function Notice({ testId, children }: { testId: string; children: string }) {
  return (
    <SimulatorLightScope>
      <p className="sl-placeholder" data-testid={testId} role="status">{children}</p>
    </SimulatorLightScope>
  );
}

export interface LiveLightBoardProps {
  sessionId: string;
  board: TeamCoachBoardData | null;
  status: RequestStatus;
  captureStatus: LiveCaptureStatus | null;
  heroCatalog: Map<number, HeroMeta>;
  /** El draft terminó (Dota salió de la selección de héroes): la última lectura queda como referencia. */
  draftEnded?: boolean;
  fetchImpl?: typeof fetch;
  onRetry?: () => void;
}

export function LiveLightBoard({ sessionId, board, status, captureStatus, heroCatalog, draftEnded = false, fetchImpl, onRetry }: LiveLightBoardProps) {
  if (board === null && draftEnded) {
    return (
      <SimulatorLightScope>
        <DraftEnded />
      </SimulatorLightScope>
    );
  }
  if (board === null) {
    // `idle` con captura ya leída = el motor no recomienda ahora (captura incompleta / 409): se dice, no se queda «calculando» para siempre.
    if (status === "idle" && captureStatus !== null) return <Notice testId="live-light-blocked">{LIVE_BLOCKED_COPY}</Notice>;
    return <SimulatorLightBoard board={null} humanPosition={null} onRetry={onRetry} status={status} />;
  }
  const view = liveLightViewOf({ board, localPlayer: captureStatus?.localPlayer, teamContext: captureStatus?.teamContext, draftEnded });
  if (view.kind === "ended-without-seat") {
    return (
      <SimulatorLightScope>
        <DraftEnded />
      </SimulatorLightScope>
    );
  }
  if (view.kind === "pick-seat") {
    return (
      <SimulatorLightScope>
        <h2 className="sl-title">Team Coach</h2>
        <LiveSeatPicker fetchImpl={fetchImpl} sessionId={sessionId} />
      </SimulatorLightScope>
    );
  }
  if (view.kind === "missing-column") {
    return <Notice testId="live-light-missing-column">{`El motor no entregó la columna de ${teamPositionName(view.position)} para este draft. No se muestra otra en su lugar.`}</Notice>;
  }
  return (
    <>
      <SimulatorLightBoard
        board={view.board}
        emptyCopy={LIVE_EMPTY_COLUMN_COPY}
        footNote={LIVE_FOOT_NOTE}
        humanPosition={view.humanPosition}
        mineRelation={mineRelationOf(view.seat)}
        onRetry={onRetry}
        partyText={liveHeadlineOf(view.mode, view.humanPosition, view.seat)}
        status={status}
      />
      <LiveFooter board={view.board} draftEnded={draftEnded} heroCatalog={heroCatalog} priorityElsewhere={view.priorityElsewhere} />
    </>
  );
}
