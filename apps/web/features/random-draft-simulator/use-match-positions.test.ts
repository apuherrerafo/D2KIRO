import "@/test-support/happy-dom";

import { expect, test } from "bun:test";
import type { PositionBoardPlayer } from "@/components/position-board/PositionBoard";
import type { Seat, TeamGroupEntry, TeamMemberEntry } from "@/features/team-groups/types";
import { countActivePools } from "./use-match-positions";

// F0: the screen's "pools active" count must say what the engine will do (poolsByConfirmedPosition): a member's pool
// counts only on their CONFIRMED usual position. Inline fixtures; nothing here is a real team.

function member(id: number, position: Seat | null, heroPool: number[]): TeamMemberEntry {
  return { id, teamGroupId: 1, slot: id, position, name: `M${id}`, heroPool, updatedAt: "2026-10-19" };
}

const group: TeamGroupEntry = {
  id: 1,
  name: "T",
  partySize: 5,
  updatedAt: "2026-10-19",
  members: [member(1, 1, [11]), member(2, 2, [21]), member(3, 3, [31]), member(4, 4, [41]), member(5, null, [51])],
};

function board(positions: Array<Seat | null>): PositionBoardPlayer[] {
  return group.members.map((m, index) => ({ key: m.id, name: m.name, position: positions[index] ?? null }));
}

test("everybody on their usual seat: every confirmed member with heroes counts, the owner's seat and the unconfirmed one don't", () => {
  expect(countActivePools(group, board([1, 2, 3, 4, null]), 1)).toBe(3);
});

test("a carry moved to Pos 5 (and the Pos 4 player to Pos 1) counts no pool for those seats", () => {
  expect(countActivePools(group, board([5, 2, 3, 1, 4]), null)).toBe(2);
});

test("back on the usual confirmed seat the pool counts again", () => {
  expect(countActivePools(group, board([5, 2, 3, 4, null]), null)).toBe(3);
  expect(countActivePools(group, board([1, 2, 3, 4, null]), null)).toBe(4);
});

test("a member with no confirmed position never counts, wherever they are placed", () => {
  expect(countActivePools(group, board([null, null, null, null, 5]), null)).toBe(0);
});
