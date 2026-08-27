import { describe, expect, test } from "bun:test";
import { createSynergyIndex } from "./synergy-index";

describe("synergy index", () => {
  test("returns synergy evidence only for confirmed allies with sufficient sample", () => {
    const index = createSynergyIndex({
      1: [
        { withHero: 2, games: 100, wins: 60, expectedWinrate: 0.5 },
        { withHero: 3, games: 99, wins: 80, expectedWinrate: 0.5 },
      ],
    });

    const rows = index.synergyRows(1, [2, 3, 99]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ally: 2, games: 100, winrateTogether: 0.6, expectedWinrate: 0.5 });
    expect(rows[0]?.synergyScore).toBeCloseTo(0.1, 6);
    expect(rows[0]?.confidence).toBeGreaterThan(0);
  });

  test("does not invent synergy for unknown candidates or allies", () => {
    const index = createSynergyIndex({
      1: [{ withHero: 2, games: 100, wins: 50, expectedWinrate: 0.5 }],
    });

    expect(index.synergyRows(99, [2])).toEqual([]);
    expect(index.synergyRows(1, [99])).toEqual([]);
  });
});
