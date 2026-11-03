import "@/test-support/happy-dom";

import { cleanup, fireEvent, render, waitFor, within, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { makeStore } from "@/lib/store";
import { installFakeEngine, party5Team, type RecordedRequest } from "@/test-support/team-fixtures";
import { TeamGroupsConfig } from "./TeamGroupsConfig";

// Hero Pools V2 (F4): the per-position pool editor against a fake engine. Inline data only.

const HEROES = [100, 101, 102, 103, 104, 105].map((id) => ({
  id, name: `npc_${id}`, localizedName: `Hero ${id}`, imgUrl: "", primaryAttr: "str", attackType: "melee", roles: [],
}));

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
  const catalog = (request: RecordedRequest): Response | null => (request.path.endsWith("/api/heroes") ? json(200, HEROES) : null);
  const engine = installFakeEngine([team], (request) => respond?.(request) ?? catalog(request));
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
  await view.findByTestId("pool-editor-11");
}

function editorOf(view: RenderResult, memberId: number) {
  return within(view.getByTestId(`pool-editor-${memberId}`));
}

// One player's panel is open at a time (the others stay mounted but hidden, so their unsaved edits survive).
function selectPlayer(view: RenderResult, slot: number): void {
  fireEvent.click(within(view.getByTestId(`roster-player-${slot}`)).getByRole("button"));
}

function seatButton(editor: ReturnType<typeof editorOf>, seat: number): HTMLElement {
  return within(editor.getByTestId(`pool-seat-${seat}`)).getByRole("button");
}

const poolPuts = () => requests.filter((request) => request.method === "PUT" && request.path.includes("/pools/"));

async function addHero(view: RenderResult, memberId: number, name: string): Promise<void> {
  const editor = editorOf(view, memberId);
  await userEvent.setup().type(editor.getByPlaceholderText("Buscar héroe..."), name);
  fireEvent.click(editor.getByRole("button", { name: new RegExp(name) }));
}

test("guardar un pool existente manda el pool de ESA persona y ESA posición con la versión leída", async () => {
  const view = mount(party5Team([1, 2, 3, 4, 5]));
  await openSavedTeam(view);

  const ana = editorOf(view, 11);
  fireEvent.click(ana.getByRole("button", { name: "Quitar Hero 100 del pool" }));
  await addHero(view, 11, "Hero 105");
  fireEvent.click(ana.getByRole("button", { name: "Guardar pool" }));

  await waitFor(() => expect(poolPuts()).toHaveLength(1));
  expect(poolPuts()[0]!.path).toEndWith("/api/team-groups/7/members/11/pools/1");
  expect(poolPuts()[0]!.body).toEqual({ heroPool: [105], expectedVersion: 1 });
  await ana.findByText("Pool guardado.");
});

test("una posición sin pool lo dice, no bloquea nada, y crearlo manda expectedVersion 0 solo a esa posición", async () => {
  const view = mount(party5Team([1, 2, 3, 4, 5]));
  await openSavedTeam(view);

  const ana = editorOf(view, 11);
  fireEvent.click(seatButton(ana, 2));
  expect(ana.getByTestId("pool-empty").textContent).toContain("Sin pool para esta posición");
  fireEvent.click(ana.getByRole("button", { name: "Más tarde" }));
  expect(ana.getByTestId("pool-empty").textContent).toContain("El draft no se bloquea");
  expect(poolPuts()).toHaveLength(0);

  fireEvent.click(ana.getByRole("button", { name: "Crear ahora" }));
  await addHero(view, 11, "Hero 104");
  fireEvent.click(ana.getByRole("button", { name: "Guardar pool" }));

  await waitFor(() => expect(poolPuts()).toHaveLength(1));
  expect(poolPuts()[0]!.path).toEndWith("/members/11/pools/2");
  expect(poolPuts()[0]!.body).toEqual({ heroPool: [104], expectedVersion: 0 });
});

test("409 stale_pool: se ve el error, no hay éxito falso y los cambios sin guardar siguen en pantalla", async () => {
  const view = mount(party5Team([1, 2, 3, 4, 5]), (request) => {
    if (request.path.endsWith("/api/heroes")) return json(200, HEROES);
    if (request.method === "PUT" && request.path.includes("/pools/")) return json(409, { error: "stale_pool" });
    return null;
  });
  await openSavedTeam(view);

  const ana = editorOf(view, 11);
  await addHero(view, 11, "Hero 105");
  fireEvent.click(ana.getByRole("button", { name: "Guardar pool" }));

  const failure = await ana.findByTestId("pool-failure");
  expect(failure.getAttribute("data-code")).toBe("stale_pool");
  expect(failure.textContent).toContain("No se sobrescribió nada");
  expect(ana.queryByTestId("pool-saved")).toBeNull();
  // El borrador sigue ahí (Hero 100 guardado + Hero 105 nuevo) y se puede reintentar o descartar.
  expect(ana.getByRole("button", { name: "Quitar Hero 105 del pool" })).toBeTruthy();
  expect(ana.getByRole("button", { name: "Descartar cambios" })).toBeTruthy();
  expect((ana.getByRole("button", { name: "Guardar pool" }) as HTMLButtonElement).disabled).toBe(false);
});

test("un fallo de red al guardar un pool también se ve y conserva el borrador", async () => {
  const view = mount(party5Team([1, 2, 3, 4, 5]), (request) => {
    if (request.path.endsWith("/api/heroes")) return json(200, HEROES);
    if (request.method === "PUT" && request.path.includes("/pools/")) return json(500, {});
    return null;
  });
  await openSavedTeam(view);

  const ana = editorOf(view, 11);
  fireEvent.click(ana.getByRole("button", { name: "Quitar Hero 100 del pool" }));
  fireEvent.click(ana.getByRole("button", { name: "Guardar pool" }));

  expect((await ana.findByTestId("pool-failure")).getAttribute("data-code")).toBe("unknown");
  expect(ana.queryByTestId("pool-saved")).toBeNull();
  expect(ana.getByText("Cambios sin guardar en este pool.")).toBeTruthy();
});

test.each(["use_position_pool_editor", "positions_required", "member_ids_required"])(
  "409 %s al guardar el equipo: se muestra con su recuperación y NO dice «Equipo guardado.»",
  async (code) => {
    const view = mount(party5Team([1, 2, 3, 4, 5]), (request) => {
      if (request.path.endsWith("/api/heroes")) return json(200, HEROES);
      if (request.method === "PUT" && !request.path.includes("/pools/")) return json(409, { error: code });
      return null;
    });
    await openSavedTeam(view);

    fireEvent.click(view.getByRole("button", { name: "Guardar equipo" }));

    const failure = await view.findByTestId("team-save-failure");
    expect(failure.getAttribute("data-code")).toBe(code);
    expect(view.queryByText("Equipo guardado.")).toBeNull();
    expect(view.queryByTestId("team-save-message")).toBeNull();
    // El borrador del tablero no se perdió.
    expect(view.getByTestId("position-board-player-1")).toBeTruthy();
  },
);

test("la lista antigua se muestra como pendiente y NO se escribe nada hasta que el usuario la confirma en una posición", async () => {
  const view = mount(party5Team([null, null, null, null, null]));
  fireEvent.click(await view.findByRole("button", { name: /^Editar/ }));
  await view.findByTestId("pool-editor-11");

  const ana = editorOf(view, 11);
  expect(ana.getByTestId("pool-legacy-notice").textContent).toContain("No se usa en ninguna recomendación hasta que confirmes");
  expect(poolPuts()).toHaveLength(0);

  fireEvent.click(seatButton(ana, 3));
  fireEvent.click(ana.getByRole("button", { name: "Confirmar como pool de Pos 3 — Offlane" }));

  await waitFor(() => expect(poolPuts()).toHaveLength(1));
  expect(poolPuts()[0]!.path).toEndWith("/members/11/pools/3");
  expect(poolPuts()[0]!.body).toEqual({ heroPool: [100], expectedVersion: 0 });
});

test("un 409 al confirmar la lista antigua se ve y no la da por confirmada", async () => {
  const view = mount(party5Team([null, null, null, null, null]), (request) => {
    if (request.path.endsWith("/api/heroes")) return json(200, HEROES);
    if (request.method === "PUT" && request.path.includes("/pools/")) return json(409, { error: "stale_pool" });
    return null;
  });
  fireEvent.click(await view.findByRole("button", { name: /^Editar/ }));
  await view.findByTestId("pool-editor-11");

  const ana = editorOf(view, 11);
  fireEvent.click(ana.getByRole("button", { name: /Confirmar como pool de/ }));

  expect((await ana.findByTestId("pool-failure")).getAttribute("data-code")).toBe("stale_pool");
  expect(ana.queryByTestId("pool-saved")).toBeNull();
  expect(ana.getByTestId("pool-legacy-notice")).toBeTruthy();
});

test("cambiar posiciones en el tablero no escribe pools, no mueve la lista de nadie y cada persona conserva el pool de SU posición", async () => {
  const view = mount(party5Team([1, 2, 3, 4, 5]));
  await openSavedTeam(view);

  fireEvent.click(view.getByTestId("position-board-player-1")); // Ana (Pos 1)
  fireEvent.click(view.getByTestId("position-board-move-2")); // ... con Bruno (Pos 2)
  fireEvent.click(view.getByRole("button", { name: "Guardar equipo" }));
  await waitFor(() => expect(requests.some((request) => request.method === "PUT")).toBe(true));

  expect(poolPuts()).toHaveLength(0);
  const put = requests.find((request) => request.method === "PUT")!.body as { members: Array<{ name: string; position: number; heroPool: number[] }> };
  expect(put.members.map((member) => [member.name, member.position, member.heroPool])).toEqual([
    ["Ana", 2, [100]], ["Bruno", 1, [101]], ["Carla", 3, [102]], ["Dani", 4, [103]], ["Eli", 5, [104]],
  ]);

  // Ana sigue teniendo SOLO su pool de Pos 1; en Pos 2 (donde la pusieron) no hereda el de Bruno ni el suyo.
  const ana = editorOf(view, 11);
  expect(ana.getByTestId("pool-seat-1").textContent).toContain("1 héroe");
  expect(ana.getByTestId("pool-seat-2").textContent).toContain("Sin pool");
  fireEvent.click(seatButton(ana, 2));
  expect(ana.getByTestId("pool-empty")).toBeTruthy();
  expect(ana.queryByRole("button", { name: "Quitar Hero 101 del pool" })).toBeNull();
  selectPlayer(view, 2);
  const bruno = editorOf(view, 12);
  expect(bruno.getByTestId("pool-seat-2").textContent).toContain("1 héroe");
  expect(bruno.getByRole("button", { name: "Quitar Hero 101 del pool" })).toBeTruthy();
});

test("los cambios sin guardar de un pool no pasan a otra posición ni a otra persona", async () => {
  const view = mount(party5Team([1, 2, 3, 4, 5]));
  await openSavedTeam(view);

  const ana = editorOf(view, 11);
  fireEvent.click(ana.getByRole("button", { name: "Quitar Hero 100 del pool" }));
  fireEvent.click(seatButton(ana, 2));
  expect(ana.getByTestId("pool-empty")).toBeTruthy();
  fireEvent.click(seatButton(ana, 1));
  expect(ana.getByText("Cambios sin guardar en este pool.")).toBeTruthy();
  expect(editorOf(view, 12).queryByText("Cambios sin guardar en este pool.")).toBeNull();
  expect(poolPuts()).toHaveLength(0);

  // Elegir a otro jugador no tira la edición: la lista lo dice y, al volver, sigue ahí.
  selectPlayer(view, 2);
  expect(view.getByTestId("roster-player-1").textContent).toContain("Pool sin guardar");
  selectPlayer(view, 1);
  expect(editorOf(view, 11).getByText("Cambios sin guardar en este pool.")).toBeTruthy();
});
