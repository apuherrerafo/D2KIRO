"use client";

import { useState, type DragEvent } from "react";
import { BUTTON_COMPACT } from "@/features/draft/styles";
import { SEAT_LABELS } from "@/features/team-groups/constants";
import { SEATS } from "@/features/team-groups/position-assignment";
import type { Seat } from "@/features/team-groups/types";

// Who plays where. Drag a nickname onto another position to swap them; on touch / keyboard, tap the player and then
// the position. The board only REPORTS moves (onPlace) -- whether they are for one match or saved is the caller's call.

export interface PositionBoardPlayer {
  key: number;
  name: string;
  position: Seat | null;
}

export interface PositionBoardProps {
  players: readonly PositionBoardPlayer[];
  /** The owner's own seat, if known: marked, because it always plays from the owner's personal hero pool. */
  ownerSeat?: Seat | null;
  onPlace: (key: number, seat: Seat | null) => void;
}

const DRAG_TYPE = "text/plain";
const CELL = "flex min-h-24 flex-col gap-2 rounded-lg border bg-surface-overlay p-3";
const CHIP =
  "cursor-grab rounded-md border px-3 py-2 text-body text-content-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary active:scale-[0.98]";

function chipClass(selected: boolean): string {
  if (selected) return `${CHIP} border-accent-primary bg-surface-raised`;
  return `${CHIP} border-surface-border bg-surface-raised hover:border-accent-primary`;
}

function cellClass(isDropTarget: boolean): string {
  if (isDropTarget) return `${CELL} border-accent-primary`;
  return `${CELL} border-surface-border`;
}

function displayName(player: PositionBoardPlayer): string {
  const name = player.name.trim();
  if (name.length > 0) return name;
  return `Jugador ${player.key}`;
}

interface PlayerChipProps {
  player: PositionBoardPlayer;
  selected: boolean;
  onSelect: (key: number) => void;
  onDragStartKey: (key: number, event: DragEvent<HTMLButtonElement>) => void;
  onDragEndKey: () => void;
}

function PlayerChip({ player, selected, onSelect, onDragStartKey, onDragEndKey }: PlayerChipProps) {
  function handleClick() {
    onSelect(player.key);
  }
  function handleDragStart(event: DragEvent<HTMLButtonElement>) {
    onDragStartKey(player.key, event);
  }
  return (
    <button
      type="button"
      draggable
      aria-pressed={selected}
      onClick={handleClick}
      onDragStart={handleDragStart}
      onDragEnd={onDragEndKey}
      className={chipClass(selected)}
      data-testid={`position-board-player-${player.key}`}
    >
      {displayName(player)}
    </button>
  );
}

interface MoveHereProps {
  label: string;
  onMove: () => void;
  testId: string;
}

function MoveHere({ label, onMove, testId }: MoveHereProps) {
  return (
    <button type="button" onClick={onMove} className={BUTTON_COMPACT} data-testid={testId}>
      {label}
    </button>
  );
}

interface SeatCellProps {
  seat: Seat;
  occupant: PositionBoardPlayer | undefined;
  isOwnerSeat: boolean;
  selected: PositionBoardPlayer | undefined;
  dragging: boolean;
  onSelect: (key: number) => void;
  onDragStartKey: (key: number, event: DragEvent<HTMLButtonElement>) => void;
  onDragEndKey: () => void;
  onDropOnSeat: (seat: Seat, event: DragEvent<HTMLDivElement>) => void;
  onMoveSelected: (seat: Seat) => void;
}

function SeatCell({ seat, occupant, isOwnerSeat, selected, dragging, onSelect, onDragStartKey, onDragEndKey, onDropOnSeat, onMoveSelected }: SeatCellProps) {
  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
  }
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    onDropOnSeat(seat, event);
  }
  function handleMove() {
    onMoveSelected(seat);
  }
  const selectedIsHere = selected !== undefined && occupant?.key === selected.key;
  const canReceive = selected !== undefined && !selectedIsHere;
  const actionLabel = occupant === undefined ? "Poner aquí" : `Intercambiar con ${displayName(occupant)}`;

  return (
    <div onDragOver={handleDragOver} onDrop={handleDrop} className={cellClass(dragging)} data-testid={`position-board-seat-${seat}`} data-seat={seat}>
      <span className="text-caption font-semibold text-content-secondary">{SEAT_LABELS[seat]}</span>
      {isOwnerSeat && (
        <span className="text-caption text-signal-positive" data-testid={`position-board-owner-${seat}`}>
          Tu posición — usas tu pool personal
        </span>
      )}
      {occupant && <PlayerChip player={occupant} selected={selectedIsHere} onSelect={onSelect} onDragStartKey={onDragStartKey} onDragEndKey={onDragEndKey} />}
      {!occupant && <span className="text-caption text-content-muted">Libre</span>}
      {canReceive && <MoveHere label={actionLabel} onMove={handleMove} testId={`position-board-move-${seat}`} />}
    </div>
  );
}

interface UnplacedTrayProps {
  players: readonly PositionBoardPlayer[];
  selected: PositionBoardPlayer | undefined;
  dragging: boolean;
  onSelect: (key: number) => void;
  onDragStartKey: (key: number, event: DragEvent<HTMLButtonElement>) => void;
  onDragEndKey: () => void;
  onDropOnTray: (event: DragEvent<HTMLDivElement>) => void;
  onUnplaceSelected: () => void;
}

function UnplacedTray({ players, selected, dragging, onSelect, onDragStartKey, onDragEndKey, onDropOnTray, onUnplaceSelected }: UnplacedTrayProps) {
  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
  }
  const canUnplace = selected !== undefined && selected.position !== null;
  if (players.length === 0 && !canUnplace && !dragging) return null;
  return (
    <div onDragOver={handleDragOver} onDrop={onDropOnTray} className={cellClass(dragging)} data-testid="position-board-unplaced">
      <span className="text-caption font-semibold text-content-secondary">Sin posición</span>
      <span className="text-caption text-content-muted">Sin posición no se aplica ningún pool de héroes. Colócalos arriba.</span>
      <div className="flex flex-wrap gap-2">
        {players.map((player) => (
          <PlayerChip key={player.key} player={player} selected={selected?.key === player.key} onSelect={onSelect} onDragStartKey={onDragStartKey} onDragEndKey={onDragEndKey} />
        ))}
      </div>
      {canUnplace && <MoveHere label="Quitar de su posición" onMove={onUnplaceSelected} testId="position-board-unplace" />}
    </div>
  );
}

export function PositionBoard({ players, ownerSeat = null, onPlace }: PositionBoardProps) {
  const [selectedKey, setSelectedKey] = useState<number | null>(null);
  const [draggedKey, setDraggedKey] = useState<number | null>(null);
  const selected = players.find((player) => player.key === selectedKey);
  const unplaced = players.filter((player) => player.position === null);

  function place(key: number, seat: Seat | null) {
    onPlace(key, seat);
    setSelectedKey(null);
    setDraggedKey(null);
  }

  function handleSelect(key: number) {
    setSelectedKey(selectedKey === key ? null : key);
  }

  function handleDragStartKey(key: number, event: DragEvent<HTMLButtonElement>) {
    event.dataTransfer.setData(DRAG_TYPE, String(key));
    event.dataTransfer.effectAllowed = "move";
    setDraggedKey(key);
    setSelectedKey(null);
  }

  function handleDragEndKey() {
    setDraggedKey(null);
  }

  function keyFromDrop(event: DragEvent<HTMLElement>): number | null {
    if (draggedKey !== null) return draggedKey;
    const fromTransfer = Number(event.dataTransfer.getData(DRAG_TYPE));
    if (Number.isInteger(fromTransfer) && players.some((player) => player.key === fromTransfer)) return fromTransfer;
    return null;
  }

  function handleDropOnSeat(seat: Seat, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const key = keyFromDrop(event);
    if (key !== null) place(key, seat);
  }

  function handleDropOnTray(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const key = keyFromDrop(event);
    if (key !== null) place(key, null);
  }

  function handleMoveSelected(seat: Seat) {
    if (selectedKey !== null) place(selectedKey, seat);
  }

  function handleUnplaceSelected() {
    if (selectedKey !== null) place(selectedKey, null);
  }

  const dragging = draggedKey !== null;

  return (
    <div className="flex flex-col gap-3" role="group" aria-label="Posiciones del equipo" data-testid="position-board">
      <span className="text-caption text-content-muted">Arrastra un jugador a otra posición para intercambiarlos, o toca al jugador y luego la posición.</span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
        {SEATS.map((seat) => (
          <SeatCell
            key={seat}
            seat={seat}
            occupant={players.find((player) => player.position === seat)}
            isOwnerSeat={ownerSeat === seat}
            selected={selected}
            dragging={dragging}
            onSelect={handleSelect}
            onDragStartKey={handleDragStartKey}
            onDragEndKey={handleDragEndKey}
            onDropOnSeat={handleDropOnSeat}
            onMoveSelected={handleMoveSelected}
          />
        ))}
      </div>
      <UnplacedTray
        players={unplaced}
        selected={selected}
        dragging={dragging}
        onSelect={handleSelect}
        onDragStartKey={handleDragStartKey}
        onDragEndKey={handleDragEndKey}
        onDropOnTray={handleDropOnTray}
        onUnplaceSelected={handleUnplaceSelected}
      />
    </div>
  );
}
