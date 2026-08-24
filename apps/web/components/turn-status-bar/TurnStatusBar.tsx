"use client";

import { DraftTimer } from "@/components/draft-timer/DraftTimer";
import { CAPTAINS_MODE_RESERVE_TIME_MS } from "@/features/draft/constants";
import { LOCAL_SIDE_BADGE } from "@/features/draft/styles";
import type { DraftTurn, TeamSide } from "@/features/draft/types";

const TEAM_LABELS: Record<TeamSide, string> = { radiant: "Radiant", dire: "Dire" };
const ACTION_LABELS: Record<"ban" | "pick", string> = { ban: "Baneando...", pick: "Pickeando..." };

// Pura, exportada para probarla sin renderizar nada -- CAPTAINS_MODE_RESERVE_TIME_MS es el
// espejo del total real (constants.tsx); esto solo convierte "cuánto queda" en un porcentaje
// para la barra, nunca participa de ninguna validación.
export function reservePercent(remainingMs: number): number {
  if (CAPTAINS_MODE_RESERVE_TIME_MS <= 0) return 0;
  return Math.max(0, Math.min(100, (remainingMs / CAPTAINS_MODE_RESERVE_TIME_MS) * 100));
}

interface ReserveBarProps {
  side: TeamSide;
  remainingMs: number;
  isActive: boolean;
}

// Barra compacta, no un segundo DraftTimer completo (spec §2.4: "la reserva es contexto, el
// tiempo base es lo que de verdad apura") -- atenuada cuando ese lado no es el que actúa ahora.
function ReserveBar({ side, remainingMs, isActive }: ReserveBarProps) {
  const seconds = Math.ceil(remainingMs / 1000);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3 text-caption text-content-muted">
        <span>{TEAM_LABELS[side]}</span>
        <span className="tabular-nums">{seconds}s reserva</span>
      </div>
      <div className="h-1 w-24 overflow-hidden rounded-full bg-surface-overlay">
        <div
          className={`h-full rounded-full transition-[width] ${isActive ? "bg-accent-primary" : "bg-surface-border"}`}
          style={{ width: `${reservePercent(remainingMs)}%` }}
        />
      </div>
    </div>
  );
}

export interface TurnStatusBarProps {
  turn: DraftTurn;
  turnStartedAt: string;
  reserveRemainingMs: { radiant: number; dire: number };
  localSide: TeamSide | "unknown";
}

// <Dominio><Cosa>: franja de turno real (spec §2.4) -- lado activo + acción esperada + timer real
// (DraftTimer conectado a `turnStartedAt`, no al guion del simulador) + reserva de los dos
// equipos. El padre (DraftView.tsx) solo la monta cuando `draftState.turn !== null` -- nunca se
// renderiza un timer roto o en blanco cuando no hay tabla de turnos aplicable.
export function TurnStatusBar({ turn, turnStartedAt, reserveRemainingMs, localSide }: TurnStatusBarProps) {
  const isLocal = turn.side === localSide;
  return (
    <div className="flex flex-none flex-wrap items-center justify-between gap-4 border-b border-surface-border bg-surface-raised px-4 py-3">
      <div className="flex flex-col gap-1">
        <span className="text-heading text-content-primary">
          Turno de {TEAM_LABELS[turn.side]}
          {isLocal && <span className={LOCAL_SIDE_BADGE}>Tú</span>}
        </span>
        <span className="text-caption text-content-secondary">{ACTION_LABELS[turn.action]}</span>
      </div>
      <DraftTimer waitMs={turn.standardTimeMs} startedAt={turnStartedAt} />
      <div className="flex gap-4">
        <ReserveBar side="radiant" remainingMs={reserveRemainingMs.radiant} isActive={turn.side === "radiant"} />
        <ReserveBar side="dire" remainingMs={reserveRemainingMs.dire} isActive={turn.side === "dire"} />
      </div>
    </div>
  );
}
