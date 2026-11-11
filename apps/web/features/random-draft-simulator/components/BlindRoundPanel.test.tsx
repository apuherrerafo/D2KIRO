import "@/test-support/happy-dom";

import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { DraftPhase } from "../types";
import { BlindRoundPanel } from "./BlindRoundPanel";

afterEach(cleanup);

function hero(id: number, name: string): HeroMeta {
  return { id, name: `npc_dota_hero_${name.toLowerCase()}`, localizedName: name, imgUrl: "", primaryAttr: "str", attackType: "Melee", roles: [] };
}
const AXE = hero(1, "Axe");
const CATALOG = new Map([[1, AXE]]);

// PD-026/PD-027: Party 2 controlling Pos4 + Pos5 -- both are open in this attempt regardless of
// which round each ends up sealed in.
const PHASE: Extract<DraftPhase, { type: "blind_round" }> = {
  type: "blind_round",
  round: 1,
  timerRemainingMs: 25_000,
  timerDurationMs: 25_000,
  pendingUserPicks: [],
  lockedUserPicks: {},
  attemptPositions: [4, 5],
  pendingPositions: [4, 5],
  goldPenaltyBySlot: [0, 0, 0, 0, 0],
  penaltyRatePerSecond: 2,
  penaltyElapsedMs: 0,
  conflictBans: [],
  conflictCount: 0,
  attemptId: 1,
  notice: null,
  canYield: false,
};

function noop() {
  // unused in tests that don't exercise the yield button
}

// Elegir un resultado del buscador NUNCA confirma: abre el análisis, y confirmar es el botón «Elegir a X».
test("buscar un héroe lo abre en el análisis; solo el botón lo elige, con la posición marcada", () => {
  const locks: [number, number][] = [];
  function lock(heroId: number, position: number) {
    locks.push([heroId, position]);
  }
  const view = render(<BlindRoundPanel phase={PHASE} draftState={null} heroCatalog={CATALOG} onLockPick={lock} onYield={noop} />);

  expect(view.getByTestId("pending-human-positions").textContent).toBe("Posiciones humanas pendientes: Pos4 Pos5");
  expect(view.queryByTestId("analyzed-pick-button")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Pos4 Support" }));
  fireEvent.click(within(view.getByTestId("other-hero-search")).getByText("Axe"));
  expect(locks).toEqual([]); // el clic en el resultado no eligió nada
  expect(view.getByTestId("sl-manual-detail").textContent).toContain("Axe");
  fireEvent.click(view.getByRole("button", { name: "Elegir a Axe como Pos4 Support" }));
  expect(locks).toEqual([[1, 4]]);
});

// Product Semantics Recovery WP3 -- Party5 Round 1 visual contract: 2 pick slots, 5 pending positions.
const PARTY5_PHASE: Extract<DraftPhase, { type: "blind_round" }> = { ...PHASE, attemptPositions: [1, 2, 3, 4, 5], pendingPositions: [1, 2, 3, 4, 5] };
const PARTY5_R1 = { eligiblePositions: [1, 2, 3, 4, 5] as (1 | 2 | 3 | 4 | 5)[], roundCapacity: 2, hasHumanAction: true, noActionReason: null };

test("Party5 Ronda 1: 'Elige 2 héroes' separado de las 5 posiciones pendientes -- nunca 'elige 5 héroes'", () => {
  const view = render(
    <BlindRoundPanel phase={PARTY5_PHASE} draftState={null} heroCatalog={CATALOG} onLockPick={noop} onYield={noop} humanActionability={PARTY5_R1} selectedTarget={3} />,
  );
  expect(view.getByTestId("round-capacity").textContent).toContain("Ronda 1 de 3 · Elige 2 héroes");
  expect(view.getByTestId("round-capacity").getAttribute("data-round-capacity")).toBe("2");
  expect(view.getByTestId("pending-human-positions").textContent).toBe("Posiciones humanas pendientes: Pos1 Pos2 Pos3 Pos4 Pos5");
  expect(view.getAllByTestId("round-position-card")).toHaveLength(5);
  expect(view.container.textContent).not.toMatch(/elige 5/i);
});

test("COHERENCE-013: el selector muestra el objetivo del Coach y elegir otra posición lo pide al motor", () => {
  const selections: number[] = [];
  const locks: [number, number][] = [];
  function select(position: number) {
    selections.push(position);
  }
  function lock(heroId: number, position: number) {
    locks.push([heroId, position]);
  }
  const view = render(
    <BlindRoundPanel phase={PARTY5_PHASE} draftState={null} heroCatalog={CATALOG} onLockPick={lock} onYield={noop} humanActionability={PARTY5_R1} selectedTarget={3} onSelectTarget={select} />,
  );
  expect(view.getByRole("button", { name: "Pos3 Offlane" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(within(view.getByTestId("other-hero-search")).getByText("Axe"));
  fireEvent.click(view.getByRole("button", { name: "Elegir a Axe como Pos3 Offlane" }));
  expect(locks).toEqual([[1, 3]]); // the pick goes to the Coach's target unless the Player changes it
  fireEvent.click(view.getByRole("button", { name: "Pos5 Hard Support" }));
  expect(selections).toEqual([5]);
});

test("una posición que el jugador no controla nunca se ofrece como destino", () => {
  const view = render(<BlindRoundPanel phase={PHASE} draftState={null} heroCatalog={CATALOG} onLockPick={noop} onYield={noop} />);
  const group = view.getByRole("group", { name: "Posición para el próximo pick" });
  expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual(["Pos4 Support", "Pos5 Hard Support"]);
});

test("COHERENCE-009: tras ceder la ronda (sin acción humana) no se ofrece ningún pick", () => {
  const view = render(
    <BlindRoundPanel phase={PARTY5_PHASE} draftState={null} heroCatalog={CATALOG} onLockPick={noop} onYield={noop} humanActionability={{ eligiblePositions: [], roundCapacity: 0, hasHumanAction: false, noActionReason: "YIELDED" }} selectedTarget={null} />,
  );
  expect(view.queryByTestId("other-hero-search")).toBeNull();
  expect(view.queryByRole("group", { name: "Posición para el próximo pick" })).toBeNull();
});

test("el botón de ceder aparece sólo cuando canYield es verdadero, y dispara onYield", () => {
  const yields: number[] = [];
  function yieldRound() {
    yields.push(1);
  }
  const view = render(<BlindRoundPanel phase={{ ...PHASE, canYield: true }} draftState={null} heroCatalog={CATALOG} onLockPick={noop} onYield={yieldRound} />);
  fireEvent.click(view.getByTestId("yield-round-button"));
  expect(yields).toEqual([1]);
});

test("el buscador está SIEMPRE a la vista (no es un plegable) aunque el coach no tenga tablero", () => {
  const view = render(<BlindRoundPanel phase={PHASE} draftState={null} heroCatalog={CATALOG} onLockPick={noop} onYield={noop} />);
  const search = view.getByTestId("other-hero-search");
  expect(search.tagName).not.toBe("DETAILS");
  expect(search.closest("details")).toBeNull();
  expect(within(search).getByPlaceholderText("Buscar héroe...")).toBeTruthy();
  expect(within(search).getByText("Axe")).toBeTruthy();
});

test("un héroe baneado aparece deshabilitado y rotulado, y no se puede abrir para elegir", () => {
  const draftState = { banned: [1], picks: { radiant: [], dire: [] }, localSide: "radiant" } as never;
  const view = render(<BlindRoundPanel phase={PHASE} draftState={draftState} heroCatalog={CATALOG} onLockPick={noop} onYield={noop} />);
  const row = within(view.getByTestId("other-hero-search")).getByText("Axe").closest("button") as HTMLButtonElement;
  expect(row.disabled).toBe(true);
  expect(row.textContent).toContain("baneado o ya elegido");
  fireEvent.click(row);
  expect(view.queryByTestId("sl-manual-detail")).toBeNull();
  expect(view.queryByTestId("analyzed-pick-button")).toBeNull();
});

test("si el héroe abierto deja de ser legal (baneado por colisión), se explica el motivo y no queda botón", () => {
  const view = render(<BlindRoundPanel phase={PHASE} draftState={null} heroCatalog={CATALOG} onLockPick={noop} onYield={noop} />);
  fireEvent.click(within(view.getByTestId("other-hero-search")).getByText("Axe"));
  expect(view.getByTestId("analyzed-pick-button")).toBeTruthy();
  const banned = { banned: [1], picks: { radiant: [], dire: [] }, localSide: "radiant" } as never;
  view.rerender(<BlindRoundPanel phase={PHASE} draftState={banned} heroCatalog={CATALOG} onLockPick={noop} onYield={noop} />);
  expect(view.queryByTestId("analyzed-pick-button")).toBeNull();
  expect(view.getByTestId("analyzed-pick-blocked").textContent).toMatch(/no se puede elegir/i);
});

test("tras elegir por búsqueda el análisis se limpia: no queda un botón apuntando a un héroe ya sellado", () => {
  function lock() {
    // el hook real sellaría la posición; aquí solo importa que el panel suelte el héroe abierto
  }
  const view = render(<BlindRoundPanel phase={PHASE} draftState={null} heroCatalog={CATALOG} onLockPick={lock} onYield={noop} />);
  fireEvent.click(within(view.getByTestId("other-hero-search")).getByText("Axe"));
  fireEvent.click(view.getByTestId("analyzed-pick-button"));
  expect(view.queryByTestId("sl-manual-detail")).toBeNull();
  expect(view.queryByTestId("analyzed-pick-button")).toBeNull();
});

test("ronda revelada: dice qué pasó (picks de los dos equipos) y no ofrece elegir ni buscar", () => {
  const revealed: Extract<DraftPhase, { type: "round_revealed" }> = { type: "round_revealed", round: 1, userPicks: [1], botPicks: [2] } as never;
  const view = render(<BlindRoundPanel phase={revealed} draftState={null} heroCatalog={new Map([[1, AXE], [2, hero(2, "Bane")]])} onLockPick={noop} onYield={noop} />);
  expect(view.getByTestId("round-instruction").textContent).toContain("Ronda 1 terminada");
  expect(view.container.textContent).toContain("Axe");
  expect(view.container.textContent).toContain("Bane");
  expect(view.queryByTestId("other-hero-search")).toBeNull();
  expect(view.queryByTestId("analyzed-pick-button")).toBeNull();
});
