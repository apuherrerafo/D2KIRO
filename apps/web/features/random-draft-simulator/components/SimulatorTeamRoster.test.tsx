import "@/test-support/happy-dom";

import { cleanup, render, within } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import type { DraftState } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { protocolViewToDraftState, type ProtocolPerspectiveView } from "../protocol-client";
import type { DraftConfig, DraftPhase } from "../types";
import { SimulatorTeamRoster } from "./SimulatorTeamRoster";

afterEach(cleanup);

const HERO_CATALOG = new Map<number, HeroMeta>(
  Array.from({ length: 10 }, (_, index) => {
    const id = index + 1;
    return [id, {
      id,
      name: `npc_dota_hero_${id}`,
      localizedName: `Hero ${id}`,
      imgUrl: "",
      primaryAttr: "str",
      attackType: "Melee",
      roles: [],
    }];
  }),
);

function config(partySize: 1 | 2 | 3 | 5, playerPosition: 1 | 2 | 3 | 4 | 5, partyPositions?: (1 | 2 | 3 | 4 | 5)[]): DraftConfig {
  return {
    draftSeed: "ABCDEFGH",
    userSide: "radiant",
    playerPosition,
    partySize,
    partyPositions,
    personalBanList: [],
    patch: "7.41e",
  };
}

function state(own: number[] = [], enemy: number[] = [], phase: DraftState["phase"] = "active"): DraftState {
  return {
    sessionId: "roster-test",
    schema: "draft-state/v1",
    format: "all_pick",
    patch: "7.41e",
    localSide: "radiant",
    phase,
    banned: [],
    picks: { radiant: own, dire: enemy },
    lastSeq: own.length + enemy.length,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "2026-09-24T00:00:00.000Z",
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    turn: null,
  };
}

const ACTIVE_PHASE: DraftPhase = {
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

function ownSeat(view: ReturnType<typeof render>, position: number) {
  return within(view.getByTestId(`own-roster-pos-${position}`));
}

test.each([
  ["Solo", config(1, 2), { 1: "ALLY BOT", 2: "YOU", 3: "ALLY BOT", 4: "ALLY BOT", 5: "ALLY BOT" }],
  ["Party2", config(2, 2, [2, 5]), { 1: "ALLY BOT", 2: "YOU", 3: "ALLY BOT", 4: "ALLY BOT", 5: "PARTY" }],
  ["Party3", config(3, 3, [1, 3, 5]), { 1: "PARTY", 2: "ALLY BOT", 3: "YOU", 4: "ALLY BOT", 5: "PARTY" }],
  ["Party5", config(5, 2), { 1: "PARTY", 2: "YOU", 3: "PARTY", 4: "PARTY", 5: "PARTY" }],
] as const)("%s: cada Pos1-5 identifica YOU, PARTY o ALLY BOT", (_label, draftConfig, controllers) => {
  const view = render(
    <SimulatorTeamRoster draftState={state()} config={draftConfig} phase={ACTIVE_PHASE} heroCatalog={HERO_CATALOG} />,
  );

  for (const position of [1, 2, 3, 4, 5] as const) {
    expect(ownSeat(view, position).getByText(controllers[position])).toBeDefined();
  }
});

test("el rival conserva cinco estados ocultos y nunca filtra la identidad sellada", () => {
  const perspective: ProtocolPerspectiveView = {
    schema: "draft-protocol-perspective/v1",
    sessionId: "hidden-enemy",
    status: "ACTIVE",
    viewerSide: "radiant",
    bannedHeroes: [],
    ownPicks: [],
    enemyPicks: [{ visibility: "HIDDEN" }, { visibility: "HIDDEN" }],
    rankedAp: { phase: "PICK_ROUND_1", banResolutionComplete: true },
    captainsMode: null,
  };
  const view = render(
    <SimulatorTeamRoster
      draftState={protocolViewToDraftState(perspective, "7.41e")}
      config={config(1, 2)}
      phase={ACTIVE_PHASE}
      heroCatalog={new Map([[999, { ...HERO_CATALOG.get(1)!, id: 999, localizedName: "SECRET HERO" }]])}
    />,
  );

  expect(view.getAllByText("Oculto hasta el reveal")).toHaveLength(5);
  expect(view.queryByText("SECRET HERO")).toBeNull();
  expect(view.container.textContent).not.toContain("999");
});

test("el draft completo mapea de inmediato los diez héroes a Pos1-5", () => {
  const complete: DraftPhase = {
    type: "complete",
    summary: {
      draftSeed: "ABCDEFGH",
      userSide: "radiant",
      playerPosition: 2,
      partySize: 5,
      partyPositions: [1, 2, 3, 4, 5],
      personalBanList: [],
      resolvedBans: [],
      picksByRound: [
        { userPicks: [1, 2], botPicks: [6, 7] },
        { userPicks: [3, 4], botPicks: [8, 9] },
        { userPicks: [5], botPicks: [10] },
      ],
    },
  };
  const view = render(
    <SimulatorTeamRoster draftState={state([1, 2, 3, 4, 5], [6, 7, 8, 9, 10], "complete")} config={config(5, 2)} phase={complete} heroCatalog={HERO_CATALOG} />,
  );

  expect(ownSeat(view, 1).getByText("Hero 4")).toBeDefined();
  expect(ownSeat(view, 2).getByText("Hero 5")).toBeDefined();
  expect(ownSeat(view, 3).getByText("Hero 3")).toBeDefined();
  expect(ownSeat(view, 4).getByText("Hero 2")).toBeDefined();
  expect(ownSeat(view, 5).getByText("Hero 1")).toBeDefined();
  expect(within(view.getByTestId("enemy-roster-pos-1")).getByText("Hero 9")).toBeDefined();
  expect(within(view.getByTestId("enemy-roster-pos-2")).getByText("Hero 10")).toBeDefined();
});
