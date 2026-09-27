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

  expect(view.getByText("Ronda 1 -- elegí 2 héroes para tu equipo (0 de 2 sellados)")).toBeDefined();
  fireEvent.click(view.getByRole("button", { name: "Elegir para Pos4 Support" }));
  fireEvent.click(view.getByTitle("Axe"));
  expect(locks).toEqual([[1, 4]]);
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
