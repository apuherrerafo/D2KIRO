import { describe, expect, test } from "bun:test";
import { createRelationshipIndex, wilsonInterval } from "./relationship-index";

describe("relationship index", () => {
  test("calculates a bounded Wilson interval", () => {
    const interval = wilsonInterval(140, 200);
    expect(interval.lower).toBeGreaterThan(0);
    expect(interval.upper).toBeLessThan(1);
    expect(interval.lower).toBeLessThan(interval.upper);
  });

  test("returns only observed matchups with sufficient evidence", () => {
    const index = createRelationshipIndex({
      1: [
        { vsHero: 2, games: 200, wins: 140 },
        { vsHero: 3, games: 199, wins: 150 },
      ],
    });

    const rows = index.counterRows(1, [2, 3, 99]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rival: 2, games: 200 });
    expect(rows[0]?.delta).toBeCloseTo(-0.0268, 3);
    expect(rows[0]?.confidence).toBeGreaterThan(0);
    expect(rows[0]?.confidence).toBeLessThanOrEqual(1);
  });

  test("exposes the raw observed winrate, and baseline is recoverable as observedWinrate - delta (TSK-184)", () => {
    const index = createRelationshipIndex({
      1: [
        { vsHero: 2, games: 200, wins: 140 },
        { vsHero: 3, games: 199, wins: 150 },
      ],
    });

    const rows = index.counterRows(1, [2]);
    expect(rows[0]?.observedWinrate).toBeCloseTo(0.7, 10); // 140 / 200
    // baseline del candidato = (140 + 150) / (200 + 199)
    const baseline = (140 + 150) / (200 + 199);
    expect((rows[0]!.observedWinrate) - (rows[0]!.delta)).toBeCloseTo(baseline, 10);
  });

  test("does not invent evidence for unknown candidates or rivals", () => {
    const index = createRelationshipIndex({
      1: [{ vsHero: 2, games: 200, wins: 100 }],
    });

    expect(index.counterRows(99, [2])).toEqual([]);
    expect(index.counterRows(1, [99])).toEqual([]);
  });
});
