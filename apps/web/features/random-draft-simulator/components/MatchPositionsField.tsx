"use client";

import { PositionBoard } from "@/components/position-board/PositionBoard";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";
import type { Seat } from "@/features/team-groups/types";
import type { MatchPositions } from "../use-match-positions";

// "Quién juega dónde" para ESTA partida. Arrancar con las posiciones habituales del equipo; cambiarlas aquí no
// modifica el equipo guardado salvo que el usuario lo pida con el botón de guardar.

export interface MatchPositionsFieldProps {
  teamName: string;
  match: MatchPositions;
  /** La posición personal del dueño: ahí se usa su pool personal, no el de quien esté sentado. */
  ownerSeat: Seat | null;
}

function MatchPositionsActions({ match }: { match: MatchPositions }) {
  if (!match.changed) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={match.reset} className={BUTTON_SECONDARY} data-testid="match-positions-reset">
        Volver a las posiciones guardadas
      </button>
      <button type="button" onClick={match.saveAsUsual} disabled={match.saving} className={BUTTON_PRIMARY} data-testid="match-positions-save">
        Guardar como posiciones habituales
      </button>
    </div>
  );
}

export function MatchPositionsField({ teamName, match, ownerSeat }: MatchPositionsFieldProps) {
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Posiciones para esta partida" data-testid="match-positions">
      <span className="text-caption text-content-secondary">Posiciones para esta partida — {teamName}</span>
      <span className="text-caption text-content-muted">Cambiar quién juega dónde aquí solo vale para esta partida: el equipo guardado no se modifica a menos que lo guardes.</span>
      <PositionBoard players={match.players} ownerSeat={ownerSeat} onPlace={match.place} />
      <MatchPositionsActions match={match} />
      {match.message && (
        <span className="text-caption text-content-secondary" role="status" data-testid="match-positions-message">
          {match.message}
        </span>
      )}
    </div>
  );
}
