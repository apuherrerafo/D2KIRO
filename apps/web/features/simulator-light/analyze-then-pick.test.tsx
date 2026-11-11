import "@/test-support/happy-dom";

import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { BlindRoundPanel } from "@/features/random-draft-simulator/components/BlindRoundPanel";
import type { DraftPhase } from "@/features/random-draft-simulator/types";
import type { TeamCoachBoardData, TeamCoachColumn, TeamPosition } from "@/features/team-coach/types";

afterEach(cleanup);

// P0 «Simulador jugable» · «Analizar» y «Elegir» son acciones separadas pero VIVEN JUNTAS: el botón está dentro del análisis del tablero.
// Se monta lo mismo que `app/simulator/page.tsx`: BlindRoundPanel (que contiene el tablero Light) con un único `onLockPick`. Fixtures inline.
type Blind = Extract<DraftPhase, { type: "blind_round" }>;

function hero(id: number, name: string): HeroMeta {
  return { id, name: `npc_dota_hero_${name.toLowerCase()}`, localizedName: name, imgUrl: "", primaryAttr: "str", attackType: "Melee", roles: [] };
}
const CATALOG = new Map([[31, hero(31, "Axe")], [32, hero(32, "Bane")], [51, hero(51, "Crystal Maiden")], [60, hero(60, "Dazzle")]]);

function column(position: TeamPosition, heroIds: number[], overrides: Partial<TeamCoachColumn> = {}): TeamCoachColumn {
  return {
    position,
    eligibleNow: true,
    alreadyFilled: false,
    filledHeroId: null,
    state: "RANKED",
    primaryHeroId: heroIds[0] ?? null,
    top: heroIds.map((heroId, index) => ({ heroId, rank: index + 1, score: 9 - index, reasons: [`razón ${heroId}`], isPrimary: index === 0, evidenceStrength: "STRONG" as const })),
    stateIdentity: "s",
    note: null,
    ...overrides,
  };
}

function boardOf(columns: TeamCoachColumn[], recommended: { position: TeamPosition; heroId: number } | null): TeamCoachBoardData {
  return {
    schema: "team-coach-board/v1",
    sessionId: "s",
    stateIdentity: "s",
    currentDecision: {
      recommendedPosition: recommended?.position ?? null,
      recommendedHeroId: recommended?.heroId ?? null,
      targetBasis: "STRATEGIC",
      reason: "razón de equipo",
      actionablePositions: columns.map((entry) => entry.position),
      roundCapacity: columns.length,
    },
    positions: columns,
    unboundOwnHeroIds: [],
  };
}

function phaseOf(locked: Blind["lockedUserPicks"]): Blind {
  return {
    type: "blind_round",
    round: 1,
    timerRemainingMs: 25_000,
    timerDurationMs: 25_000,
    pendingUserPicks: [],
    lockedUserPicks: locked,
    attemptPositions: [3, 5],
    pendingPositions: [3, 5].filter((position) => locked[position as 3 | 5] === undefined) as Blind["pendingPositions"],
    goldPenaltyBySlot: [0, 0, 0, 0, 0],
    penaltyRatePerSecond: 2,
    penaltyElapsedMs: 0,
    conflictBans: [],
    conflictCount: 0,
    attemptId: 1,
    notice: null,
    canYield: false,
  };
}

interface HarnessProps {
  board: TeamCoachBoardData;
  phase: Blind;
  locks: Array<[number, number]>;
}

function Harness({ board, phase, locks }: HarnessProps) {
  function lock(heroId: number, position: number) {
    locks.push([heroId, position]);
  }
  function noop() {
    // sin ceder la ronda
  }
  return <BlindRoundPanel board={board} boardStatus="ready" draftState={null} heroCatalog={CATALOG} humanPosition={5} onLockPick={lock} onYield={noop} phase={phase} />;
}

const BOARD = boardOf([column(3, [31, 32]), column(5, [51])], { position: 5, heroId: 51 });

test("abrir el análisis NO elige; elegir exige el botón de la ronda, con la posición de la columna del héroe", () => {
  const locks: Array<[number, number]> = [];
  const { container, queryByTestId, getByRole } = render(<Harness board={BOARD} locks={locks} phase={phaseOf({})} />);
  expect(queryByTestId("analyzed-pick")).toBeNull();
  fireEvent.click(container.querySelector('[data-card-key="3:32"] button') as HTMLButtonElement);
  expect(locks).toEqual([]);
  fireEvent.click(getByRole("button", { name: "Elegir a Bane como Pos3 Offlane" }));
  expect(locks).toEqual([[32, 3]]);
});

// El incidente: el botón vivía en otro panel, 700 px más abajo. Ahora está en el MISMO bloque que el análisis del héroe que se lee.
test("el botón «Elegir a X» está DENTRO del panel de análisis del tablero, junto al héroe abierto", () => {
  const locks: Array<[number, number]> = [];
  const { container, getByTestId } = render(<Harness board={BOARD} locks={locks} phase={phaseOf({})} />);
  fireEvent.click(container.querySelector('[data-card-key="3:32"] button') as HTMLButtonElement);
  const detail = container.querySelector(".sl-detail") as HTMLElement;
  expect(within(detail).getByTestId("analyzed-pick-button").textContent).toBe("Elegir a Bane");
  expect(detail.contains(getByTestId("analyzed-pick"))).toBe(true);
  expect(detail.querySelector(".sl-detail-name")).not.toBeNull(); // el héroe que se lee y el botón comparten bloque
  expect(locks).toEqual([]);
});

test("un héroe buscado a mano reemplaza al de la carta (uno solo en análisis) y también exige el botón", () => {
  const locks: Array<[number, number]> = [];
  const { container, getByTestId, getByRole } = render(<Harness board={BOARD} locks={locks} phase={phaseOf({})} />);
  const bane = container.querySelector('[data-card-key="3:32"] button') as HTMLButtonElement;
  fireEvent.click(bane);
  expect(bane.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(within(getByTestId("other-hero-search")).getByText("Dazzle"));
  expect(locks).toEqual([]);
  expect(bane.getAttribute("aria-pressed")).toBe("false");
  const detail = container.querySelector(".sl-detail") as HTMLElement;
  expect(within(detail).getByTestId("sl-manual-detail")).toBeDefined();
  expect(detail.querySelectorAll('[data-testid="analyzed-pick-button"]')).toHaveLength(1);
  fireEvent.click(getByRole("button", { name: "Elegir a Dazzle como Pos3 Offlane" }));
  expect(locks).toEqual([[60, 3]]);
});

test("abrir una carta después de una búsqueda devuelve el análisis al héroe de la carta", () => {
  const locks: Array<[number, number]> = [];
  const { container, getByTestId, queryByTestId } = render(<Harness board={BOARD} locks={locks} phase={phaseOf({})} />);
  fireEvent.click(within(getByTestId("other-hero-search")).getByText("Dazzle"));
  expect(queryByTestId("sl-manual-detail")).not.toBeNull();
  fireEvent.click(container.querySelector('[data-card-key="5:51"] button') as HTMLButtonElement);
  expect(queryByTestId("sl-manual-detail")).toBeNull();
  expect(getByTestId("analyzed-pick-button").getAttribute("aria-label")).toBe("Elegir a Crystal Maiden como Pos5 Hard Support");
});

test("sin recomendaciones en ninguna columna igual se puede elegir con el buscador", () => {
  const locks: Array<[number, number]> = [];
  const empty = boardOf([column(3, []), column(5, [])], null);
  const { getByTestId, getByRole } = render(<Harness board={empty} locks={locks} phase={phaseOf({})} />);
  fireEvent.click(within(getByTestId("other-hero-search")).getByText("Axe"));
  fireEvent.click(getByRole("button", { name: "Elegir a Axe como Pos3 Offlane" }));
  expect(locks).toEqual([[31, 3]]);
});

test("cerrar el análisis retira la acción de elegir; abrir otro candidato la cambia a ese héroe", () => {
  const locks: Array<[number, number]> = [];
  const { container, queryByTestId, getByRole } = render(<Harness board={BOARD} locks={locks} phase={phaseOf({})} />);
  const bane = container.querySelector('[data-card-key="3:32"] button') as HTMLButtonElement;
  fireEvent.click(bane);
  expect(queryByTestId("analyzed-pick")).not.toBeNull();
  fireEvent.click(bane);
  expect(queryByTestId("analyzed-pick")).toBeNull();
  fireEvent.click(container.querySelector('[data-card-key="5:51"] button') as HTMLButtonElement);
  expect(getByRole("button", { name: "Elegir a Crystal Maiden como Pos5 Hard Support" })).toBeDefined();
  expect(locks).toEqual([]);
});

test("tras elegir (posición sellada + columna llena), el tablero y la ronda quedan sincronizados: sin candidato abierto ni botón", () => {
  const locks: Array<[number, number]> = [];
  const view = render(<Harness board={BOARD} locks={locks} phase={phaseOf({})} />);
  fireEvent.click(view.container.querySelector('[data-card-key="3:31"] button') as HTMLButtonElement);
  fireEvent.click(view.getByTestId("analyzed-pick-button"));
  expect(locks).toEqual([[31, 3]]);
  const after = boardOf([column(3, [], { state: "FILLED", filledHeroId: 31, alreadyFilled: true, eligibleNow: false, primaryHeroId: null }), column(5, [51])], { position: 5, heroId: 51 });
  view.rerender(<Harness board={after} locks={locks} phase={phaseOf({ 3: 31 })} />);
  expect(view.queryByTestId("analyzed-pick")).toBeNull();
  expect(view.queryByTestId("analyzed-pick-blocked")).toBeNull();
  expect(view.container.querySelector("[data-detail-key]")).toBeNull();
  expect(view.container.querySelector('[data-testid="team-coach-column-3"]')?.textContent).toContain("Posición cubierta");
});
