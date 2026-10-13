import { describe, expect, test } from "bun:test";
import { PROJECT_STATUS as P } from "./project-status";

describe("project status data", () => {
  test("progress values are 0-100 and there are 10 cards", () => {
    expect(P.cards).toHaveLength(10);
    for (const c of [...P.cards, { progress: P.overall }]) {
      expect(c.progress).toBeGreaterThanOrEqual(0);
      expect(c.progress).toBeLessThanOrEqual(100);
    }
  });
  test("no card is BLOCKED (blockers are not invented)", () => {
    expect(P.cards.some((c) => c.status === "BLOCKED")).toBe(false);
  });
});
