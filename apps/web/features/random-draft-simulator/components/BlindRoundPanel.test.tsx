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

const PHASE: Extract<DraftPhase, { type: "blind_round" }> = {
  type: "blind_round",
  round: 1,
  timerRemainingMs: 25_000,
  timerDurationMs: 25_000,
  pendingUserPicks: [],
  lockedUserPicks: {},
  attemptSeats: [0, 1],
  pendingSeats: [0, 1],
  goldPenaltyBySlot: [0, 0, 0, 0, 0],
  penaltyRatePerSecond: 2,
  penaltyElapsedMs: 0,
  conflictBans: [],
  conflictCount: 0,
  attemptId: 1,
  notice: null,
};

test("muestra 2 picks y permite elegir Pos4 antes que Pos5 usando slotIndex explícito", () => {
  const locks: [number, number][] = [];
  function lock(heroId: number, slotIndex: number) {
    locks.push([heroId, slotIndex]);
  }
  const view = render(
    <BlindRoundPanel phase={PHASE} draftState={null} heroCatalog={new Map([[1, HERO]])} onLockPick={lock} />,
  );

  expect(view.getByText("2 picks en esta ronda")).toBeDefined();
  fireEvent.click(view.getByRole("button", { name: "Elegir para Pos4 Support" }));
  fireEvent.click(view.getByTitle("Axe"));
  expect(locks).toEqual([[1, 1]]);
});
