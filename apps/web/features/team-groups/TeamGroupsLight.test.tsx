import "@/test-support/happy-dom";

import { cleanup, fireEvent, render, waitFor, within, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { makeStore } from "@/lib/store";
import { installFakeEngine, party5Team, type RecordedRequest } from "@/test-support/team-fixtures";
import { TeamGroupsConfig } from "./TeamGroupsConfig";

// F4 on Canonical LIGHT: the scope, the "who am I editing" model and the honest save states. Inline data only.

let restore: () => void = () => undefined;
let requests: RecordedRequest[] = [];

afterEach(() => {
  cleanup();
  restore();
});

beforeEach(() => {
  requests = [];
});

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

function mount(team: ReturnType<typeof party5Team>, respond?: (request: RecordedRequest) => Response | null): RenderResult {
  const engine = installFakeEngine([team], respond);
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

const teamReads = () => requests.filter((request) => request.method === "GET" && request.path.endsWith("/api/team-groups"));

test("la pantalla usa el Light real de Canonical: .r3-page con un descendiente data-theme=light, y nunca un tema oscuro repintado", async () => {
  const view = mount(party5Team([1, 2, 3, 4, 5]));
  await view.findByRole("button", { name: /^Editar/ });
  const page = view.container.querySelector(".r3-page");
  expect(page).not.toBeNull();
  expect(page!.hasAttribute("data-theme")).toBe(false);
  expect(page!.querySelector('[data-theme="light"]')).not.toBeNull();
  expect(view.container.querySelector('[data-theme="dark"]')).toBeNull();
});

test("solo el jugador elegido tiene su panel visible; los demás siguen montados pero ocultos", async () => {
  const view = mount(party5Team([1, 2, 3, 4, 5]));
  await openSavedTeam(view);
  expect(view.getByTestId("member-editor-1").hasAttribute("hidden")).toBe(false);
  expect(view.getByTestId("member-editor-2").hasAttribute("hidden")).toBe(true);

  fireEvent.click(within(view.getByTestId("roster-player-2")).getByRole("button"));
  expect(view.getByTestId("member-editor-1").hasAttribute("hidden")).toBe(true);
  expect(view.getByTestId("member-editor-2").hasAttribute("hidden")).toBe(false);
  expect(within(view.getByTestId("roster-player-2")).getByRole("button").getAttribute("aria-pressed")).toBe("true");
  expect(within(view.getByTestId("roster-player-1")).getByRole("button").getAttribute("aria-pressed")).toBe("false");
});

test("la posición habitual de cada jugador se ve en la lista y en su panel, y es distinta de «tiene pool»", async () => {
  const view = mount(party5Team([1, 2, 3, 4, 5]));
  await openSavedTeam(view);
  expect(view.getByTestId("roster-player-3").textContent).toContain("Pos 3 · Offlane");
  expect(view.getByTestId("roster-player-3").textContent).toContain("1 de 5 posiciones con pool");
  const ana = within(view.getByTestId("pool-editor-11"));
  expect(ana.getByTestId("pool-seat-1").textContent).toContain("Habitual");
  expect(ana.getByTestId("pool-seat-2").textContent).not.toContain("Habitual");
});

test("el estado del equipo es honesto: guardado → cambios sin guardar → guardado, y un rechazo no lo da por guardado", async () => {
  const view = mount(party5Team([1, 2, 3, 4, 5]));
  await openSavedTeam(view);
  expect(view.getAllByTestId("team-state")[0]!.textContent).toBe("Todo guardado");

  await userEvent.setup().type(view.getByPlaceholderText("Nombre del equipo"), "!");
  expect(view.getAllByTestId("team-state")[0]!.textContent).toBe("Cambios sin guardar");

  fireEvent.click(view.getByRole("button", { name: "Guardar equipo" }));
  await waitFor(() => expect(view.getAllByTestId("team-state")[0]!.textContent).toBe("Todo guardado"));
  await view.findByTestId("team-save-message");
});

test("si el motor rechaza el equipo, sigue diciendo «Cambios sin guardar» y el borrador sigue ahí", async () => {
  const view = mount(party5Team([1, 2, 3, 4, 5]), (request) => {
    if (request.method === "PUT" && !request.path.includes("/pools/")) return json(409, { error: "use_position_pool_editor" });
    return null;
  });
  await openSavedTeam(view);
  await userEvent.setup().type(view.getByPlaceholderText("Nombre del equipo"), "!");
  fireEvent.click(view.getByRole("button", { name: "Guardar equipo" }));

  await view.findByTestId("team-save-failure");
  expect(view.getAllByTestId("team-state")[0]!.textContent).toBe("Cambios sin guardar");
  expect((view.getByPlaceholderText("Nombre del equipo") as HTMLInputElement).value).toBe("Mi equipo!");
});

test.each(["positions_required", "member_ids_required"])("409 %s ofrece «Recargar equipos»: vuelve a leer la lista y no toca el borrador", async (code) => {
  const view = mount(party5Team([1, 2, 3, 4, 5]), (request) => {
    if (request.method === "PUT" && !request.path.includes("/pools/")) return json(409, { error: code });
    return null;
  });
  await openSavedTeam(view);
  fireEvent.click(view.getByTestId("position-board-player-1"));
  fireEvent.click(view.getByTestId("position-board-move-2"));
  fireEvent.click(view.getByRole("button", { name: "Guardar equipo" }));
  await view.findByTestId("team-save-failure");

  const readsBefore = teamReads().length;
  fireEvent.click(within(view.getByTestId("team-save-failure")).getByRole("button", { name: "Recargar equipos" }));
  await waitFor(() => expect(teamReads().length).toBeGreaterThan(readsBefore));
  // Ana y Bruno siguen intercambiados en pantalla: recargar la lista no pisa lo que el usuario estaba haciendo.
  expect(view.getByTestId("position-board-seat-2").textContent).toContain("Ana");
});

test("un 409 de pool que no es de pestaña desactualizada no ofrece recargar", async () => {
  const view = mount(party5Team([1, 2, 3, 4, 5]), (request) => {
    if (request.method === "PUT" && !request.path.includes("/pools/")) return json(409, { error: "use_position_pool_editor" });
    return null;
  });
  await openSavedTeam(view);
  fireEvent.click(view.getByRole("button", { name: "Guardar equipo" }));
  const failure = await view.findByTestId("team-save-failure");
  expect(within(failure).queryByRole("button", { name: "Recargar equipos" })).toBeNull();
});

test("la lista antigua pendiente se ve en la lista de jugadores, sin abrir a cada uno", async () => {
  const view = mount(party5Team([null, null, null, null, null]));
  fireEvent.click(await view.findByRole("button", { name: /^Editar/ }));
  await view.findByTestId("roster-player-1");
  expect(view.getByTestId("roster-player-1").textContent).toContain("Lista antigua por confirmar");
  expect(view.getByTestId("roster-player-1").textContent).toContain("Sin posición");
});

test("en un equipo nuevo los pools ya no confunden: cada jugador nuevo explica que su lista se guarda como pool de su posición", async () => {
  const view = mount(party5Team([1, 2, 3, 4, 5]));
  await view.findByRole("button", { name: /^Editar/ });
  fireEvent.click(view.getByRole("button", { name: "Nuevo equipo" }));
  expect(view.getAllByTestId("team-state")[0]!.textContent).toBe("Equipo nuevo · aún sin guardar");
  expect(view.getByTestId("member-editor-1").textContent).toContain("Se guarda como pool de su posición");
});
