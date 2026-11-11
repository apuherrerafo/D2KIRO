"use client";

import { teamPositionName } from "@/features/team-coach/constants";
import type { TeamPosition } from "@/features/team-coach/types";
import { useLiveHumanPosition } from "@/features/team-coach/use-live-human-position";
import { LIVE_PICK_SEAT_COPY } from "../view-model";

// <Dominio><Cosa>: Solo sin posición declarada. Reutiliza el flujo Live existente (`PUT /api/live/human-position` vía `useLiveHumanPosition`): el motor
// valida y responde, y lo que se pinta después es lo que el MOTOR informa (nunca lo clicado). Declarar no ejecuta nada en Dota.

const POSITIONS: readonly TeamPosition[] = [1, 2, 3, 4, 5];

interface SeatChoiceProps {
  position: TeamPosition;
  disabled: boolean;
  onSelect(position: TeamPosition): void;
}

function SeatChoice({ position, disabled, onSelect }: SeatChoiceProps) {
  function handleClick() {
    onSelect(position);
  }
  return (
    <button aria-label={`Soy ${teamPositionName(position)}`} className="sl-seat-btn" data-testid={`live-light-seat-${position}`} disabled={disabled} onClick={handleClick} type="button">
      Pos {position}
    </button>
  );
}

function SeatNotice({ notice }: { notice: string | null }) {
  if (notice === null) return null;
  return <p className="sl-note" data-failed="true" data-testid="live-light-seat-notice" role="alert">{notice}</p>;
}

export interface LiveSeatPickerProps {
  sessionId: string;
  fetchImpl?: typeof fetch;
}

export function LiveSeatPicker({ sessionId, fetchImpl }: LiveSeatPickerProps) {
  const { applying, notice, select } = useLiveHumanPosition({ sessionId, fetchImpl });
  return (
    <div aria-label="Elige tu posición" className="sl-seat" data-testid="live-light-pick-seat" role="group">
      <p className="sl-placeholder">{LIVE_PICK_SEAT_COPY}</p>
      <div className="sl-seat-row">
        {POSITIONS.map((position) => (
          <SeatChoice disabled={applying} key={position} onSelect={select} position={position} />
        ))}
      </div>
      <SeatNotice notice={notice} />
    </div>
  );
}
