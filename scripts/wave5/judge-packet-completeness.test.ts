import { describe, expect, test } from "bun:test";
import { REQUIRED_SCENARIO_IDS, SCENARIOS } from "../wave5-dota-judge-packet";

describe("Judge packet completeness guard", () => {
  test("exact required scenarios S01 through S15 are registered", () => {
    expect(REQUIRED_SCENARIO_IDS).toEqual([
      "S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "S11", "S12", "S13", "S14", "S15",
    ]);
    expect(SCENARIOS).toHaveLength(15);
    const ids = SCENARIOS.map((s) => s.id);
    expect(ids).toEqual([...REQUIRED_SCENARIO_IDS]);
  });

  test("no scenario ID is duplicated", () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(15);
  });

  test("every scenario has complete structural metadata and pick function", () => {
    for (const s of SCENARIOS) {
      expect(["radiant", "dire"]).toContain(s.side);
      expect([1, 2, 3, 4, 5]).toContain(s.position);
      expect(["follow-coach", "varied", "deviate"]).toContain(s.policy);
      expect(typeof s.account).toBe("number");
      expect(s.tags.length).toBeGreaterThan(0);
      expect(typeof s.pick).toBe("function");
    }
  });

  test("S10 and S11 naturally exercise Safe Core opportunities under varied policy", () => {
    const s10 = SCENARIOS.find((s) => s.id === "S10")!;
    expect(s10.tags).toContain("safe-core-opportunity");
    expect(s10.policy).toBe("varied");
    expect(s10.side).toBe("radiant");

    const s11 = SCENARIOS.find((s) => s.id === "S11")!;
    expect(s11.tags).toContain("safe-core-opportunity");
    expect(s11.policy).toBe("varied");
    expect(s11.side).toBe("dire");
  });

  test("S14 covers real curated counter catalog demotion", () => {
    const s14 = SCENARIOS.find((s) => s.id === "S14")!;
    expect(s14.tags).toContain("revealed-hard-counter-demotion");
  });

  test("S15 covers COUNTER badge truthfulness with revealed enemy counters", () => {
    const s15 = SCENARIOS.find((s) => s.id === "S15")!;
    expect(s15.tags).toContain("counter-truthfulness");
    expect(s15.tags).toContain("revealed-enemy-counters");
  });
});
