import { describe, expect, test } from "bun:test";
import { flips, orderKey, pickMoments } from "./f2-e1-packet";
import { MOMENT_SCHEMA, fingerprint, type DecisionMoment } from "./replay";

// Inline fixtures only (invariantes.md). The packet generator itself needs the real world and is exercised by running it.
const moment = (id: string): DecisionMoment => {
  const visible = { round: 3 as const, side: "radiant" as const, bans: [], ownPicks: [], revealedEnemy: [], hiddenEnemySlots: 0, actionablePositions: [1 as const], humanPosition: 1 as const };
  return { schema: MOMENT_SCHEMA, id, origin: { checkpoint: "F1", draftKey: id, stateIndex: 0 }, session: { side: "radiant", humanPosition: 1, simulatorSeed: "S", account: "A", patch: "7.41e" }, pool: [], visible, visibleFingerprint: fingerprint({ visible, pool: [] }), reconstruction: { bans: [1], ownSealed: [], enemySealed: [] } };
};
const many = Array.from({ length: 40 }, (_, i) => moment(`m${i}`));

describe("F2-E1 blind packet", () => {
  test("selection is deterministic for a seed, differs across seeds, and always keeps the pinned moments", () => {
    const a = pickMoments(many, 10, "seed-1", new Set(["m7", "m33"]));
    expect(pickMoments(many, 10, "seed-1", new Set(["m7", "m33"])).map((m) => m.id)).toEqual(a.map((m) => m.id));
    expect(pickMoments(many, 10, "seed-2", new Set(["m7", "m33"])).map((m) => m.id)).not.toEqual(a.map((m) => m.id));
    expect(a).toHaveLength(10);
    expect(a.map((m) => m.id)).toContain("m7");
    expect(a.map((m) => m.id)).toContain("m33");
  });

  test("fewer changed moments than asked: take them all, no duplicates", () => {
    const few = pickMoments(many.slice(0, 3), 10, "s", new Set());
    expect(few).toHaveLength(3);
    expect(new Set(few.map((m) => m.id)).size).toBe(3);
  });

  test("the A/B assignment is reproducible and roughly balanced, so position in the packet does not reveal the version", () => {
    expect(flips("s", "m1")).toBe(flips("s", "m1"));
    const ones = many.filter((m) => flips("F2E1-v1", m.id)).length;
    expect(ones).toBeGreaterThan(8);
    expect(ones).toBeLessThan(32);
    expect(orderKey("s", "a")).not.toBe(orderKey("s", "b"));
  });
});
