import "@/test-support/happy-dom";

import { cleanup, render, within } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import type { DraftState } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { protocolViewToDraftState, type OwnAssignedPositionBinding, type ProtocolPerspectiveView } from "../protocol-client";
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
  attemptPositions: [1, 2, 3, 4, 5],
  pendingPositions: [1, 2, 3, 4, 5],
  goldPenaltyBySlot: [0, 0, 0, 0, 0],
  penaltyRatePerSecond: 2,
  penaltyElapsedMs: 0,
  conflictBans: [],
  conflictCount: 0,
  attemptId: 1,
  notice: null,
  canYield: false,
};

// PD-026/PD-027: Own Team hero-by-position is session-layer truth (ownAssignedPositions), never a
// fixed seat<->position table. This fixture reconstructs the SAME layout the old fixed table would
// have produced (seat0->Pos5, seat1->Pos4, seat2->Pos3, seat3->Pos1, seat4->Pos2), only now
// expressed as explicit bindings the way the real engine reports them.
const OLD_TABLE_BINDINGS: OwnAssignedPositionBinding[] = [
  { round: 1, slotIndex: 0, assignedPosition: 5 }, // seat 0 -> Hero 1
  { round: 1, slotIndex: 1, assignedPosition: 4 }, // seat 1 -> Hero 2
  { round: 2, slotIndex: 0, assignedPosition: 3 }, // seat 2 -> Hero 3
  { round: 2, slotIndex: 1, assignedPosition: 1 }, // seat 3 -> Hero 4
  { round: 3, slotIndex: 0, assignedPosition: 2 }, // seat 4 -> Hero 5
];

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
    <SimulatorTeamRoster draftState={state()} config={draftConfig} phase={ACTIVE_PHASE} heroCatalog={HERO_CATALOG} ownAssignedPositions={[]} />,
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
      ownAssignedPositions={[]}
    />,
  );

  expect(view.getAllByText("Oculto hasta el reveal")).toHaveLength(5);
  expect(view.queryByText("SECRET HERO")).toBeNull();
  expect(view.container.textContent).not.toContain("999");
});

test("el draft completo mapea de inmediato los cinco héroes propios a Pos1-5; el rival se muestra en orden de reveal", () => {
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
    <SimulatorTeamRoster
      draftState={state([1, 2, 3, 4, 5], [6, 7, 8, 9, 10], "complete")}
      config={config(5, 2)}
      phase={complete}
      heroCatalog={HERO_CATALOG}
      ownAssignedPositions={OLD_TABLE_BINDINGS}
    />,
  );

  expect(ownSeat(view, 1).getByText("Hero 4")).toBeDefined();
  expect(ownSeat(view, 2).getByText("Hero 5")).toBeDefined();
  expect(ownSeat(view, 3).getByText("Hero 3")).toBeDefined();
  expect(ownSeat(view, 4).getByText("Hero 2")).toBeDefined();
  expect(ownSeat(view, 5).getByText("Hero 1")).toBeDefined();
  // PD-027: el rival nunca se remapea por una tabla seat->posición fija -- se muestra en el mismo
  // orden en que se reveló (índice de pick 0..4 -> asiento 1..5), sin ninguna etiqueta de posición.
  expect(within(view.getByTestId("enemy-roster-pos-1")).getByText("Hero 6")).toBeDefined();
  expect(within(view.getByTestId("enemy-roster-pos-2")).getByText("Hero 7")).toBeDefined();
  expect(within(view.getByTestId("enemy-roster-pos-3")).getByText("Hero 8")).toBeDefined();
  expect(within(view.getByTestId("enemy-roster-pos-4")).getByText("Hero 9")).toBeDefined();
  expect(within(view.getByTestId("enemy-roster-pos-5")).getByText("Hero 10")).toBeDefined();
  expect(view.queryByTestId("enemy-roster-role")).toBeNull();
});

test("PD-027: el rol visible del rival sale de RoleBelief del Coach, nunca de la cronología de pick", () => {
  // Con la tabla fija vieja (ROSTER_SEAT_FOR_POSITION), el asiento 3 (Hero 9) se etiquetaba "Pos1".
  // El Coach dice otra cosa: acá gana el Coach, nunca la cronología.
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
    <SimulatorTeamRoster
      draftState={state([1, 2, 3, 4, 5], [6, 7, 8, 9, 10], "complete")}
      config={config(5, 2)}
      phase={complete}
      heroCatalog={HERO_CATALOG}
      ownAssignedPositions={OLD_TABLE_BINDINGS}
      enemyRoleBeliefs={[
        { heroId: 9, status: "LIKELY", positions: [5] },
        { heroId: 10, status: "UNRESOLVED", positions: [3, 2] },
      ]}
    />,
  );

  const heroNineSeat = within(view.getByTestId("enemy-roster-pos-4"));
  expect(heroNineSeat.getByText("Hero 9")).toBeDefined();
  expect(heroNineSeat.getByText("Likely Pos5")).toBeDefined();
  expect(heroNineSeat.queryByText(/Pos1\b/)).toBeNull();

  const heroTenSeat = within(view.getByTestId("enemy-roster-pos-5"));
  expect(heroTenSeat.getByText("Hero 10")).toBeDefined();
  expect(heroTenSeat.getByText("Likely Pos3 / Possible Pos2")).toBeDefined();
});

test("PD-027: sin RoleBelief confiable, el héroe rival se muestra sin ninguna etiqueta de rol fabricada", () => {
  const view = render(
    <SimulatorTeamRoster
      draftState={state([1, 2, 3, 4, 5], [6, 7, 8, 9, 10], "complete")}
      config={config(5, 2)}
      phase={{
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
      }}
      heroCatalog={HERO_CATALOG}
      ownAssignedPositions={OLD_TABLE_BINDINGS}
    />,
  );

  for (const seat of [1, 2, 3, 4, 5]) {
    expect(within(view.getByTestId(`enemy-roster-pos-${seat}`)).queryByTestId("enemy-roster-role")).toBeNull();
  }
  expect(view.queryByText(/^Pos\d$/)).toBeNull();
  expect(view.queryByText(/Likely/)).toBeNull();
});

test("PD-027: SimulatorTeamRoster nunca exige ni recibe la asignación privada de posición del Enemy Bot", () => {
  // El componente sólo acepta `enemyRoleBeliefs` (evidencia del Coach) -- ningún campo de posición
  // privada del Enemy Bot existe en sus props (compilaría distinto si lo necesitara). Renderiza
  // completo sin esa información y sin que ningún texto de "posición interna"/seat privado escape al DOM.
  const view = render(
    <SimulatorTeamRoster
      draftState={state([1, 2, 3, 4, 5], [6, 7], "active")}
      config={config(5, 2)}
      phase={ACTIVE_PHASE}
      heroCatalog={HERO_CATALOG}
      ownAssignedPositions={[]}
    />,
  );

  expect(view.getByTestId("team-roster")).toBeDefined();
  expect(view.container.textContent).not.toMatch(/internal/i);
  expect(view.container.textContent).not.toMatch(/private/i);
});
