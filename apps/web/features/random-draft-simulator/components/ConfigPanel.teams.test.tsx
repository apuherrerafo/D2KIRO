import "@/test-support/happy-dom";

import { cleanup, fireEvent, render, waitFor, within, type RenderResult } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { TeamGroupPutBody } from "@/features/team-groups/types";
import { makeStore } from "@/lib/store";
import { installFakeEngine, party5Team, type RecordedRequest } from "@/test-support/team-fixtures";
import type { StartDraftConfig } from "../use-random-draft-session";
import { ConfigPanel } from "./ConfigPanel";

let restore: () => void = () => undefined;
let requests: RecordedRequest[] = [];
let started: StartDraftConfig[] = [];

beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    // sin storage: la pantalla no depende de él
  }
  started = [];
});

afterEach(() => {
  cleanup();
  restore();
});

function handleStart(config: StartDraftConfig): void {
  started.push(config);
}

async function mount(team: ReturnType<typeof party5Team>): Promise<RenderResult> {
  const engine = installFakeEngine([team]);
  restore = engine.restore;
  requests = engine.requests;
  const view = render(
    <Provider store={makeStore()}>
      <ConfigPanel onStart={handleStart} />
    </Provider>,
  );
  await view.findByRole("option", { name: /Mi equipo/ });
  return view;
}

/** Radiant, Party 5 (the default), the saved team, and the owner's own position. */
async function setUp(view: RenderResult, ownerPosition = "Posición 1 — Carry"): Promise<void> {
  fireEvent.click(within(view.getByRole("group", { name: "Tu lado" })).getByRole("button", { name: "Radiant" }));
  fireEvent.change(view.getByLabelText("Preset de equipo"), { target: { value: "7" } });
  fireEvent.click(within(view.getByRole("group", { name: "Tu posición personal" })).getByRole("button", { name: ownerPosition }));
  await view.findByTestId("match-positions");
}

function start(view: RenderResult): StartDraftConfig {
  fireEvent.click(view.getByRole("button", { name: "Iniciar Draft" }));
  const config = started.at(-1);
  if (!config) throw new Error("the draft did not start");
  return config;
}

const puts = () => requests.filter((request) => request.method === "PUT");

test("sin tocar nada, la partida usa las posiciones habituales del equipo guardado", async () => {
  const view = await mount(party5Team([1, 2, 3, 4, 5]));
  await setUp(view);
  const config = start(view);
  expect(config.teamGroupId).toBe(7);
  expect(config.teamAssignment).toEqual({ "11": 1, "12": 2, "13": 3, "14": 4, "15": 5 });
});

test("intercambiar dos jugadores vale para esta partida y NO modifica el equipo guardado", async () => {
  const view = await mount(party5Team([1, 2, 3, 4, 5]));
  await setUp(view);
  fireEvent.click(view.getByTestId("position-board-player-12")); // Bruno, Pos 2
  fireEvent.click(view.getByTestId("position-board-move-5")); // intercambia con Eli, Pos 5
  const config = start(view);
  expect(config.teamAssignment).toEqual({ "11": 1, "12": 5, "13": 3, "14": 4, "15": 2 });
  expect(puts()).toHaveLength(0);
});

test("la pantalla nunca manda pools calculados en el cliente: solo el equipo y quién juega dónde", async () => {
  const view = await mount(party5Team([1, 2, 3, 4, 5]));
  await setUp(view);
  const config = start(view);
  expect(config).not.toHaveProperty("playerPoolsByPosition");
});

test("guardar como habituales es una acción explícita: manda las posiciones nuevas conservando el orden de filas y los pools", async () => {
  const view = await mount(party5Team([1, 2, 3, 4, 5]));
  await setUp(view);
  fireEvent.click(view.getByTestId("position-board-player-12"));
  fireEvent.click(view.getByTestId("position-board-move-5"));
  expect(puts()).toHaveLength(0);

  fireEvent.click(view.getByTestId("match-positions-save"));
  await waitFor(() => expect(puts()).toHaveLength(1));
  const body = puts()[0]!.body as TeamGroupPutBody;
  expect(body.members.map((member) => [member.slot, member.position, member.name, member.heroPool])).toEqual([
    [1, 1, "Ana", [100]],
    [2, 5, "Bruno", [101]],
    [3, 3, "Carla", [102]],
    [4, 4, "Dani", [103]],
    [5, 2, "Eli", [104]],
  ]);
  // Guardar el intercambio no cambia quién es cada persona: cada miembro vuelve con su id.
  expect(body.members.map((member) => member.id)).toEqual([11, 12, 13, 14, 15]);
});

test("volver a las posiciones guardadas descarta el cambio de esta partida", async () => {
  const view = await mount(party5Team([1, 2, 3, 4, 5]));
  await setUp(view);
  fireEvent.click(view.getByTestId("position-board-player-12"));
  fireEvent.click(view.getByTestId("position-board-move-5"));
  fireEvent.click(view.getByTestId("match-positions-reset"));
  expect(view.queryByTestId("match-positions-reset")).toBeNull();
  expect(start(view).teamAssignment).toEqual({ "11": 1, "12": 2, "13": 3, "14": 4, "15": 5 });
});

test("sin cambios no se ofrece guardar (no hay nada que guardar)", async () => {
  const view = await mount(party5Team([1, 2, 3, 4, 5]));
  await setUp(view);
  expect(view.queryByTestId("match-positions-save")).toBeNull();
});

test("un equipo antiguo sin posiciones no se aplica: avisa, y solo cuenta lo que el usuario coloca para esta partida", async () => {
  const view = await mount(party5Team([null, null, null, null, null]));
  await setUp(view);
  expect(view.getByTestId("team-preset-no-pools").textContent).toContain("Sin posiciones confirmadas");
  expect(view.getByTestId("position-board-unplaced").textContent).toContain("Ana");
  expect(start(view).teamAssignment).toEqual({});

  fireEvent.click(view.getByTestId("position-board-player-13")); // Carla
  fireEvent.click(view.getByTestId("position-board-move-3"));
  expect(start(view).teamAssignment).toEqual({ "13": 3 });
  expect(puts()).toHaveLength(0);
});

test("la posición del dueño queda marcada: ahí usa su pool personal", async () => {
  const view = await mount(party5Team([1, 2, 3, 4, 5]));
  await setUp(view, "Posición 3 — Offlane");
  expect(view.getByTestId("position-board-owner-3").textContent).toContain("pool personal");
  expect(view.queryByTestId("position-board-owner-1")).toBeNull();
});

test("Solo: sin equipo no hay tablero ni asignación; basta elegir tu posición", async () => {
  const view = await mount(party5Team([1, 2, 3, 4, 5]));
  fireEvent.click(within(view.getByRole("group", { name: "Tu lado" })).getByRole("button", { name: "Dire" }));
  fireEvent.click(within(view.getByRole("group", { name: "Tamaño de party" })).getByRole("button", { name: "Solo (1)" }));
  fireEvent.click(within(view.getByRole("group", { name: "Tu posición personal" })).getByRole("button", { name: "Posición 4 — Support" }));
  expect(view.queryByTestId("match-positions")).toBeNull();
  const config = start(view);
  expect(config.partySize).toBe(1);
  expect(config.playerPosition).toBe(4);
  expect(config.teamAssignment).toBeUndefined();
});
