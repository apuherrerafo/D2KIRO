import "@/test-support/happy-dom";

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { DraftPhase } from "../types";
import { BlindRoundPanel } from "./BlindRoundPanel";

afterEach(cleanup);

const HERO: HeroMeta = {
  id: 1,
  name: "npc_dota_hero_axe",
  localizedName: "Axe",
  imgUrl: "",
  primaryAttr: "str",
  attackType: "Melee",
  roles: [],
};

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

test("muestra las posiciones controladas y permite elegir Pos4 antes que Pos5", () => {
  const locks: [number, number][] = [];
  function lock(heroId: number, position: number) {
    locks.push([heroId, position]);
  }
  const view = render(
    <BlindRoundPanel phase={PHASE} draftState={null} heroCatalog={new Map([[1, HERO]])} onLockPick={lock} onYield={noop} />,
  );

  expect(view.getByTestId("pending-human-positions").textContent).toBe("Posiciones humanas pendientes: Pos4 Pos5");
  fireEvent.click(view.getByRole("button", { name: "Elegir para Pos4 Support" }));
  fireEvent.click(view.getByTitle("Axe"));
  expect(locks).toEqual([[1, 4]]);
});

// Product Semantics Recovery WP3 -- Party5 Round 1 visual contract: 2 pick slots, 5 pending positions.
const PARTY5_PHASE: Extract<DraftPhase, { type: "blind_round" }> = { ...PHASE, attemptPositions: [1, 2, 3, 4, 5], pendingPositions: [1, 2, 3, 4, 5] };
const PARTY5_R1 = { eligiblePositions: [1, 2, 3, 4, 5] as (1 | 2 | 3 | 4 | 5)[], roundCapacity: 2, hasHumanAction: true, noActionReason: null };

test("Party5 Ronda 1: '2 espacios de pick disponibles' separado de las 5 posiciones pendientes -- nunca 'elegí 5 héroes'", () => {
  const view = render(
    <BlindRoundPanel phase={PARTY5_PHASE} draftState={null} heroCatalog={new Map([[1, HERO]])} onLockPick={noop} onYield={noop} humanActionability={PARTY5_R1} selectedTarget={3} />,
  );
  expect(view.getByTestId("round-capacity").textContent).toContain("2 espacios de pick disponibles");
  expect(view.getByTestId("pending-human-positions").textContent).toBe("Posiciones humanas pendientes: Pos1 Pos2 Pos3 Pos4 Pos5");
  expect(view.container.textContent).not.toMatch(/elegí 5/i);
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
    <BlindRoundPanel phase={PARTY5_PHASE} draftState={null} heroCatalog={new Map([[1, HERO]])} onLockPick={lock} onYield={noop} humanActionability={PARTY5_R1} selectedTarget={3} onSelectTarget={select} />,
  );
  expect(view.getByRole("button", { name: "Elegir para Pos3 Offlane" }).className).toContain("border-accent-primary");
  fireEvent.click(view.getByTitle("Axe"));
  expect(locks).toEqual([[1, 3]]); // the pick goes to the Coach's target unless the Player changes it
  fireEvent.click(view.getByRole("button", { name: "Elegir para Pos5 Hard Support" }));
  expect(selections).toEqual([5]);
});

test("COHERENCE-009: tras ceder la ronda (sin acción humana) no se ofrece ningún pick", () => {
  const view = render(
    <BlindRoundPanel phase={PARTY5_PHASE} draftState={null} heroCatalog={new Map([[1, HERO]])} onLockPick={noop} onYield={noop} humanActionability={{ eligiblePositions: [], roundCapacity: 0, hasHumanAction: false, noActionReason: "YIELDED" }} selectedTarget={null} />,
  );
  expect(view.queryByTitle("Axe")).toBeNull();
  expect(view.queryByRole("group", { name: "Posición para el próximo pick" })).toBeNull();
});

test("el botón de ceder aparece sólo cuando canYield es verdadero, y dispara onYield", () => {
  const yields: number[] = [];
  const view = render(
    <BlindRoundPanel
      phase={{ ...PHASE, canYield: true }}
      draftState={null}
      heroCatalog={new Map([[1, HERO]])}
      onLockPick={noop}
      onYield={() => yields.push(1)}
    />,
  );
  const button = view.getByTestId("yield-round-button");
  fireEvent.click(button);
  expect(yields).toEqual([1]);
});
