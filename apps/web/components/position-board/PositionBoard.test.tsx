import "@/test-support/happy-dom";

import { cleanup, fireEvent, render, type RenderResult } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test } from "bun:test";
import { placePlayer } from "@/features/team-groups/position-assignment";
import type { Seat } from "@/features/team-groups/types";
import { PositionBoard, type PositionBoardPlayer, type PositionBoardVariant } from "./PositionBoard";

afterEach(cleanup);

const TEAM: PositionBoardPlayer[] = [
  { key: 1, name: "Ana", position: 1 },
  { key: 2, name: "Bruno", position: 2 },
  { key: 3, name: "Carla", position: 3 },
  { key: 4, name: "Dani", position: 4 },
  { key: 5, name: "Eli", position: 5 },
];

const NAMES = TEAM.map((player) => player.name);

// Stateful host: the board only reports moves, so the test owns the state the way the editor / setup screen do.
function Host({ initial = TEAM, ownerSeat = null, variant }: { initial?: PositionBoardPlayer[]; ownerSeat?: Seat | null; variant?: PositionBoardVariant }) {
  const [players, setPlayers] = useState<PositionBoardPlayer[]>(initial);
  function handlePlace(key: number, seat: Seat | null) {
    setPlayers((current) => placePlayer(current, key, seat));
  }
  return <PositionBoard players={players} ownerSeat={ownerSeat} onPlace={handlePlace} variant={variant} />;
}

// What the user SEES: in which position cell each nickname is (null = not in any position cell).
function seatsByName(view: RenderResult): Record<string, number | null> {
  const seen: Record<string, number | null> = {};
  for (const name of NAMES) {
    const cell = [1, 2, 3, 4, 5].find((seat) => view.getByTestId(`position-board-seat-${seat}`).textContent?.includes(name));
    if (cell !== undefined || view.container.textContent?.includes(name)) seen[name] = cell ?? null;
  }
  return seen;
}

function fakeDataTransfer() {
  const data = new Map<string, string>();
  return { setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? "", effectAllowed: "move" };
}

test("mostrar el tablero: cada jugador aparece en su posición, con el nombre de la posición", () => {
  const view = render(<Host />);
  expect(view.getByTestId("position-board-seat-1").textContent).toContain("Pos 1 — Carry");
  expect(view.getByTestId("position-board-seat-1").textContent).toContain("Ana");
  expect(view.getByTestId("position-board-seat-5").textContent).toContain("Pos 5 — Hard support");
  expect(view.getByTestId("position-board-seat-5").textContent).toContain("Eli");
  expect(view.queryByTestId("position-board-unplaced")).toBeNull();
});

test("arrastrar un nickname a otra posición intercambia a los dos jugadores", () => {
  const view = render(<Host />);
  const dataTransfer = fakeDataTransfer();
  fireEvent.dragStart(view.getByTestId("position-board-player-2"), { dataTransfer });
  fireEvent.drop(view.getByTestId("position-board-seat-5"), { dataTransfer });
  expect(seatsByName(view)).toEqual({ Ana: 1, Bruno: 5, Carla: 3, Dani: 4, Eli: 2 });
});

test("sin arrastrar: tocar al jugador y luego la posición intercambia igual (móvil / teclado)", () => {
  const view = render(<Host />);
  fireEvent.click(view.getByTestId("position-board-player-1"));
  expect(view.getByTestId("position-board-move-3").textContent).toBe("Intercambiar con Carla");
  fireEvent.click(view.getByTestId("position-board-move-3"));
  expect(seatsByName(view)).toEqual({ Ana: 3, Bruno: 2, Carla: 1, Dani: 4, Eli: 5 });
  // La selección se limpia: ya no hay botones de mover.
  expect(view.queryByTestId("position-board-move-2")).toBeNull();
});

test("tocar de nuevo al jugador seleccionado cancela la selección", () => {
  const view = render(<Host />);
  fireEvent.click(view.getByTestId("position-board-player-1"));
  fireEvent.click(view.getByTestId("position-board-player-1"));
  expect(view.queryByTestId("position-board-move-2")).toBeNull();
  expect(seatsByName(view)).toEqual({ Ana: 1, Bruno: 2, Carla: 3, Dani: 4, Eli: 5 });
});

test("un jugador sin posición confirmada aparece aparte, y colocarlo no mueve a nadie más", () => {
  const legacy: PositionBoardPlayer[] = [
    { key: 1, name: "Ana", position: null },
    { key: 2, name: "Bruno", position: 2 },
  ];
  const view = render(<Host initial={legacy} />);
  expect(view.getByTestId("position-board-unplaced").textContent).toContain("Ana");
  expect(view.getByTestId("position-board-seat-1").textContent).toContain("Libre");
  fireEvent.click(view.getByTestId("position-board-player-1"));
  expect(view.getByTestId("position-board-move-4").textContent).toBe("Poner aquí");
  fireEvent.click(view.getByTestId("position-board-move-4"));
  expect(seatsByName(view)).toEqual({ Ana: 4, Bruno: 2 });
  expect(view.queryByTestId("position-board-unplaced")).toBeNull();
});

test("mover a una posición ocupada desde 'sin posición' manda al ocupante a 'sin posición' (nadie desaparece)", () => {
  const view = render(<Host initial={[{ key: 1, name: "Ana", position: null }, { key: 2, name: "Bruno", position: 2 }]} />);
  fireEvent.click(view.getByTestId("position-board-player-1"));
  fireEvent.click(view.getByTestId("position-board-move-2"));
  expect(seatsByName(view)).toEqual({ Ana: 2, Bruno: null });
  expect(view.getByTestId("position-board-unplaced").textContent).toContain("Bruno");
});

test("se puede quitar a alguien de su posición (botón y arrastrando a 'sin posición')", () => {
  const view = render(<Host />);
  fireEvent.click(view.getByTestId("position-board-player-3"));
  fireEvent.click(view.getByTestId("position-board-unplace"));
  expect(seatsByName(view).Carla).toBeNull();

  const dataTransfer = fakeDataTransfer();
  fireEvent.dragStart(view.getByTestId("position-board-player-4"), { dataTransfer });
  fireEvent.drop(view.getByTestId("position-board-unplaced"), { dataTransfer });
  expect(seatsByName(view).Dani).toBeNull();
});

test("la posición del dueño se marca: ahí se usa su pool personal, no el de quien esté sentado", () => {
  const view = render(<Host ownerSeat={3} />);
  expect(view.getByTestId("position-board-owner-3").textContent).toContain("pool personal");
  expect(view.queryByTestId("position-board-owner-2")).toBeNull();
});

test("un nickname vacío se muestra con un nombre genérico, no como un botón en blanco", () => {
  const view = render(<Host initial={[{ key: 7, name: "  ", position: 1 }]} />);
  expect(view.getByTestId("position-board-player-7").textContent).toBe("Jugador 7");
});

test("soltar algo que no es un jugador del tablero no cambia nada", () => {
  const view = render(<Host />);
  const dataTransfer = fakeDataTransfer();
  dataTransfer.setData("text/plain", "999");
  fireEvent.drop(view.getByTestId("position-board-seat-2"), { dataTransfer });
  expect(seatsByName(view)).toEqual({ Ana: 1, Bruno: 2, Carla: 3, Dani: 4, Eli: 5 });
});

test("la variante canónica cambia cómo se ve, no cómo se comporta: mismos testids y el mismo intercambio", () => {
  const view = render(<Host variant="canonical" />);
  expect(view.getByTestId("position-board").className).toBe("tg-board");
  fireEvent.click(view.getByTestId("position-board-player-1"));
  fireEvent.click(view.getByTestId("position-board-move-2"));
  expect(seatsByName(view)).toEqual({ Ana: 2, Bruno: 1, Carla: 3, Dani: 4, Eli: 5 });
});

test("sin variante el tablero conserva su presentación de siempre (el simulador no cambia)", () => {
  const view = render(<Host />);
  expect(view.getByTestId("position-board").className).toBe("flex flex-col gap-3");
  expect(view.getByTestId("position-board-seat-1").className).toContain("bg-surface-overlay");
  expect(view.container.innerHTML).not.toContain("tg-");
});
