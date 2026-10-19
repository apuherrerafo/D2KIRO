import { describe, expect, test } from "bun:test";
import { confirmInListOrder, placedAssignment, placePlayer, samePositions, type SeatedPlayer } from "./position-assignment";

const team: SeatedPlayer[] = [
  { key: 1, position: 1 },
  { key: 2, position: 2 },
  { key: 3, position: 3 },
  { key: 4, position: 4 },
  { key: 5, position: 5 },
];
const positionsOf = (players: readonly SeatedPlayer[]) => players.map((player) => [player.key, player.position]);

describe("placePlayer", () => {
  test("dropping a player on an occupied seat swaps the two, nobody else moves", () => {
    expect(positionsOf(placePlayer(team, 2, 5))).toEqual([[1, 1], [2, 5], [3, 3], [4, 4], [5, 2]]);
  });

  test("a swap is symmetric: dragging the other way round gives the same board", () => {
    expect(positionsOf(placePlayer(team, 5, 2))).toEqual(positionsOf(placePlayer(team, 2, 5)));
  });

  test("moving onto a free seat just moves", () => {
    const withHole = placePlayer(team, 3, null); // 3 leaves the board
    expect(positionsOf(placePlayer(withHole, 4, 3))).toEqual([[1, 1], [2, 2], [3, null], [4, 3], [5, 5]]);
  });

  test("dropping on a seat taken by someone while the mover is UNPLACED sends the occupant to 'no seat'", () => {
    const withHole = placePlayer(team, 3, null);
    expect(positionsOf(placePlayer(withHole, 3, 1))).toEqual([[1, null], [2, 2], [3, 1], [4, 4], [5, 5]]);
  });

  test("taking someone off the board unplaces only them", () => {
    expect(positionsOf(placePlayer(team, 4, null))).toEqual([[1, 1], [2, 2], [3, 3], [4, null], [5, 5]]);
  });

  test("placing a player where they already are, or an unknown player, changes nothing", () => {
    expect(positionsOf(placePlayer(team, 2, 2))).toEqual(positionsOf(team));
    expect(positionsOf(placePlayer(team, 99, 2))).toEqual(positionsOf(team));
  });

  test("never mutates its input and never produces two people on one seat", () => {
    const snapshot = positionsOf(team);
    let board: SeatedPlayer[] = team;
    for (const [key, seat] of [[1, 3], [3, 4], [4, 1], [2, null], [2, 5], [5, 2]] as const) {
      board = placePlayer(board, key, seat);
      const seats = board.flatMap((player) => (player.position === null ? [] : [player.position]));
      expect(new Set(seats).size).toBe(seats.length);
    }
    expect(positionsOf(team)).toEqual(snapshot);
  });

  test("extra fields on the players (name, id...) survive the move", () => {
    const named = [{ key: 1, position: 1 as const, name: "Ana" }, { key: 2, position: 2 as const, name: "Bruno" }];
    expect(placePlayer(named, 1, 2)).toEqual([{ key: 1, position: 2, name: "Ana" }, { key: 2, position: 1, name: "Bruno" }]);
  });
});

describe("placedAssignment / samePositions", () => {
  test("only placed players appear in the assignment", () => {
    expect(placedAssignment(placePlayer(team, 4, null))).toEqual({ "1": 1, "2": 2, "3": 3, "5": 5 });
  });

  test("samePositions compares by player, not by array order", () => {
    expect(samePositions(team, [...team].reverse())).toBe(true);
    expect(samePositions(team, placePlayer(team, 1, 2))).toBe(false);
  });
});

describe("confirmInListOrder", () => {
  const unplaced = (keys: number[]): SeatedPlayer[] => keys.map((key) => ({ key, position: null }));

  test("an old team with nobody placed: the Nth listed player takes Pos N", () => {
    expect(positionsOf(confirmInListOrder(unplaced([1, 2, 3, 4, 5])))).toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]);
  });

  test("follows the list order (the key), not the array order", () => {
    expect(positionsOf(confirmInListOrder(unplaced([3, 1, 2, 5, 4])))).toEqual([[3, 3], [1, 1], [2, 2], [5, 5], [4, 4]]);
  });

  test("if anyone is already placed it changes nothing -- it never overrides a decision the user made", () => {
    const partial: SeatedPlayer[] = [{ key: 1, position: null }, { key: 2, position: 4 }, { key: 3, position: null }];
    expect(confirmInListOrder(partial)).toEqual(partial);
  });

  test("never mutates its input", () => {
    const input = unplaced([1, 2]);
    confirmInListOrder(input);
    expect(input.every((player) => player.position === null)).toBe(true);
  });
});
