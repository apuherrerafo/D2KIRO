import "@/test-support/happy-dom";

import { cleanup, fireEvent, render, waitFor, within, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { makeStore } from "@/lib/store";
import { installFakeEngine, party5Team, type RecordedRequest } from "@/test-support/team-fixtures";
import { TeamGroupsConfig } from "./TeamGroupsConfig";
import type { TeamGroupPutBody } from "./types";

let restore: () => void = () => undefined;
let requests: RecordedRequest[] = [];

afterEach(() => {
  cleanup();
  restore();
});

beforeEach(() => {
  requests = [];
});

function mount(team: ReturnType<typeof party5Team>): RenderResult {
  const engine = installFakeEngine([team]);
  restore = engine.restore;
  requests = engine.requests;
  return render(
    <Provider store={makeStore()}>
      <TeamGroupsConfig />
    </Provider>,
  );
}

async function openSavedTeam(view: RenderResult): Promise<void> {
  fireEvent.click(await view.findByRole("button", { name: /^Editar/ }));
  await view.findByTestId("position-board");
}

function lastPut(): TeamGroupPutBody {
  const put = [...requests].reverse().find((request) => request.method === "PUT");
  if (!put) throw new Error("no PUT was sent");
  return put.body as TeamGroupPutBody;
}

const positionsBySlot = (body: TeamGroupPutBody) => body.members.map((member) => [member.slot, member.position]);

test("intercambiar dos jugadores en el editor cambia SU posición, no el orden de las filas ni sus pools", async () => {
  const view = mount(party5Team([1, 2, 3, 4, 5]));
  await openSavedTeam(view);
  fireEvent.click(view.getByTestId("position-board-player-1")); // Ana (Pos 1)
  fireEvent.click(view.getByTestId("position-board-move-2")); // ... con Bruno (Pos 2)
  fireEvent.click(view.getByRole("button", { name: "Guardar equipo" }));
  await waitFor(() => expect(requests.some((request) => request.method === "PUT")).toBe(true));

  const body = lastPut();
  expect(positionsBySlot(body)).toEqual([[1, 2], [2, 1], [3, 3], [4, 4], [5, 5]]);
  // Cada persona conserva su nombre y su pool: lo único que se movió fue la posición.
  expect(body.members.map((member) => [member.name, member.heroPool])).toEqual([["Ana", [100]], ["Bruno", [101]], ["Carla", [102]], ["Dani", [103]], ["Eli", [104]]]);
});

test("un equipo antiguo (sin posiciones) lo dice, no inventa posiciones, y guarda solo lo que el usuario colocó", async () => {
  const view = mount(party5Team([null, null, null, null, null]));
  await openSavedTeam(view);
  expect(view.getByTestId("team-legacy-positions").textContent).toContain("no sabemos quién juega dónde");
  expect(view.getByTestId("position-board-unplaced").textContent).toContain("Ana");

  fireEvent.click(view.getByTestId("position-board-player-3")); // Carla
  fireEvent.click(view.getByTestId("position-board-move-4")); // -> Pos 4
  fireEvent.click(view.getByRole("button", { name: "Guardar equipo" }));
  await waitFor(() => expect(requests.some((request) => request.method === "PUT")).toBe(true));

  expect(positionsBySlot(lastPut())).toEqual([[1, null], [2, null], [3, 4], [4, null], [5, null]]);
});

test("un equipo antiguo se confirma con un clic: nada se guarda hasta pulsar Guardar, y se guarda como lo confirmó el usuario", async () => {
  const view = mount(party5Team([null, null, null, null, null]));
  await openSavedTeam(view);
  fireEvent.click(view.getByTestId("team-confirm-list-order"));
  expect(requests.some((request) => request.method === "PUT")).toBe(false);
  expect(view.queryByTestId("team-legacy-positions")).toBeNull();
  expect(view.queryByTestId("team-confirm-list-order")).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Guardar equipo" }));
  await waitFor(() => expect(requests.some((request) => request.method === "PUT")).toBe(true));
  expect(positionsBySlot(lastPut())).toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]);
});

test("el atajo de confirmar no aparece si alguien ya está colocado, ni en un equipo ya confirmado", async () => {
  const mixed = mount(party5Team([null, 2, null, null, null]));
  await openSavedTeam(mixed);
  expect(mixed.queryByTestId("team-confirm-list-order")).toBeNull();
  cleanup();
  restore();

  const confirmed = mount(party5Team([1, 2, 3, 4, 5]));
  await openSavedTeam(confirmed);
  expect(confirmed.queryByTestId("team-confirm-list-order")).toBeNull();
});

test("un equipo ya confirmado no muestra el aviso de equipo antiguo", async () => {
  const view = mount(party5Team([1, 2, 3, 4, 5]));
  await openSavedTeam(view);
  expect(view.queryByTestId("team-legacy-positions")).toBeNull();
});

test("un equipo NUEVO de Party 5 arranca con posiciones visibles y editables, y se guardan explícitamente", async () => {
  const view = mount(party5Team([1, 2, 3, 4, 5]));
  await view.findByRole("button", { name: /^Editar/ });
  fireEvent.click(view.getByRole("button", { name: "Nuevo equipo" }));
  // happy-dom no entrega `fireEvent.change` de inputs de texto a React: se escribe como un usuario.
  await userEvent.setup().type(view.getByPlaceholderText("Nombre del equipo"), "Otro");
  // Party de 2 por defecto: cambiar a 5.
  fireEvent.change(view.getByRole("combobox"), { target: { value: "5" } });
  fireEvent.click(view.getByRole("button", { name: "Guardar equipo" }));
  await waitFor(() => expect(requests.some((request) => request.method === "POST")).toBe(true));
  const post = requests.find((request) => request.method === "POST")!.body as TeamGroupPutBody;
  expect(positionsBySlot(post)).toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]);
});

test("un equipo de Party 2 arranca sin posiciones para sus compañeros (no hay un orden que tomar como posición)", async () => {
  const view = mount(party5Team([1, 2, 3, 4, 5]));
  await view.findByRole("button", { name: /^Editar/ });
  fireEvent.click(view.getByRole("button", { name: "Nuevo equipo" }));
  await userEvent.setup().type(view.getByPlaceholderText("Nombre del equipo"), "Duo");
  fireEvent.click(view.getByRole("button", { name: "Guardar equipo" }));
  await waitFor(() => expect(requests.some((request) => request.method === "POST")).toBe(true));
  const post = requests.find((request) => request.method === "POST")!.body as TeamGroupPutBody;
  expect(post.partySize).toBe(2);
  expect(positionsBySlot(post)).toEqual([[1, null]]);
});

test("guardar devuelve el id de cada miembro: la persona es el id, no el nombre ni la fila", async () => {
  const view = mount(party5Team([1, 2, 3, 4, 5]));
  await openSavedTeam(view);
  fireEvent.click(view.getByTestId("position-board-player-1"));
  fireEvent.click(view.getByTestId("position-board-move-2"));
  fireEvent.click(view.getByRole("button", { name: "Guardar equipo" }));
  await waitFor(() => expect(requests.some((request) => request.method === "PUT")).toBe(true));
  expect(lastPut().members.map((member) => [member.id, member.heroPool])).toEqual([[11, [100]], [12, [101]], [13, [102]], [14, [103]], [15, [104]]]);
});

test("renombrar a un jugador mantiene su id y sus héroes; 'Es otra persona' lo reemplaza: sin id y sin héroes heredados", async () => {
  const view = mount(party5Team([1, 2, 3, 4, 5]));
  await openSavedTeam(view);
  const user = userEvent.setup();

  const renamed = view.getAllByPlaceholderText(/Nombre del jugador/)[0]!;
  await user.clear(renamed);
  await user.type(renamed, "Otro apodo");
  await user.click(within(view.getByTestId("roster-player-2")).getByRole("button"));
  await user.click(within(view.getByTestId("team-replace-member-2")).getByRole("button"));
  await user.type(view.getAllByPlaceholderText(/Nombre del jugador/)[1]!, "Persona nueva");

  fireEvent.click(view.getByRole("button", { name: "Guardar equipo" }));
  await waitFor(() => expect(requests.some((request) => request.method === "PUT")).toBe(true));
  const [first, second, ...rest] = lastPut().members;
  expect([first!.id, first!.name, first!.heroPool]).toEqual([11, "Otro apodo", [100]]);
  expect(second).toEqual({ slot: 2, position: 2, name: "Persona nueva", heroPool: [] });
  expect(rest.map((member) => member.id)).toEqual([13, 14, 15]);
});
