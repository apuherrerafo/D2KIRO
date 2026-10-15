"use client";

import { teamPositionName } from "../constants";
import { CHIP, CHIP_ACTIVE, PANEL } from "../styles";
import type { LiveLocalPlayer, TeamPosition } from "../types";
import { useLiveHumanPosition } from "../use-live-human-position";

// /live-draft -- "Soy Pos N": la posición que el propio jugador declara. Junto con el héroe que Dota informa como suyo,
// es lo que liga ESE héroe a ESA posición. Ningún compañero se liga por estar en un pool o por jugarse "normalmente"
// en una posición: sin evidencia de quién es, queda sin vincular. Lo que se muestra como activo es lo que el MOTOR informa.

const POSITIONS: readonly TeamPosition[] = [1, 2, 3, 4, 5];

type SeatState = "unknown" | "undeclared" | "waiting_hero" | "bound" | "unbound";

function seatState(localPlayer: LiveLocalPlayer | undefined): SeatState {
  if (localPlayer === undefined) return "unknown";
  if (localPlayer.position === null) return "undeclared";
  if (localPlayer.bound) return "bound";
  if (localPlayer.heroId === null) return "waiting_hero";
  return "unbound";
}

const SEAT_TEXT: Readonly<Record<SeatState, string>> = Object.freeze({
  unknown: "Tu posición: verificando con el motor…",
  undeclared: "Sin declarar: el Team Coach no sabe cuál de los héroes del draft es el tuyo, así que no liga a nadie a una posición.",
  waiting_hero: "Esperando que Dota informe tu héroe. Hasta entonces ninguna posición se da por tomada.",
  bound: "Tu héroe quedó ligado a tu posición. Los demás héroes de tu equipo siguen sin posición asignada hasta que algo lo diga.",
  unbound: "Dota ya informó tu héroe, pero todavía no está entre los picks de tu equipo (o esa posición ya la tomó otra fuente).",
});

interface SeatButtonProps {
  position: TeamPosition;
  selected: boolean;
  disabled: boolean;
  onSelect(position: TeamPosition): void;
}

function SeatButton({ position, selected, disabled, onSelect }: SeatButtonProps) {
  function handleClick() {
    onSelect(position);
  }
  const className = selected ? CHIP_ACTIVE : CHIP;
  return (
    <button type="button" className={className} aria-pressed={selected} aria-label={`Soy ${teamPositionName(position)}`} disabled={disabled} onClick={handleClick} data-testid={`live-seat-${position}`}>
      Pos {position}
    </button>
  );
}

function SeatNotice({ notice }: { notice: string | null }) {
  if (notice === null) return null;
  return <span className="text-caption text-signal-warning" role="alert" data-testid="live-seat-notice">{notice}</span>;
}

export interface LiveLocalPositionPanelProps {
  sessionId: string;
  /** What the engine's live status says the seat is (undefined: no status for this session read yet). */
  localPlayer: LiveLocalPlayer | undefined;
  fetchImpl?: typeof fetch;
}

export function LiveLocalPositionPanel({ sessionId, localPlayer, fetchImpl }: LiveLocalPositionPanelProps) {
  const { applying, notice, select } = useLiveHumanPosition({ sessionId, fetchImpl });
  const declared = localPlayer?.position ?? null;
  const state = seatState(localPlayer);

  function handleClear() {
    select(null);
  }

  return (
    <div className={PANEL} role="group" aria-label="Tu posición" data-testid="live-seat">
      <span className="text-caption font-semibold text-content-muted">Tu posición en este draft</span>
      <div className="flex flex-wrap items-center gap-2">
        {POSITIONS.map((position) => (
          <SeatButton key={position} position={position} selected={declared === position} disabled={applying} onSelect={select} />
        ))}
        <button type="button" className={CHIP} disabled={applying || declared === null} onClick={handleClear} data-testid="live-seat-clear">
          Sin declarar
        </button>
      </div>
      <span className="text-caption text-content-secondary" role="status" data-testid="live-seat-status" data-state={state}>{SEAT_TEXT[state]}</span>
      <SeatNotice notice={notice} />
    </div>
  );
}
