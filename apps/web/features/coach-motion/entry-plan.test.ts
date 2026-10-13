import { describe, expect, test } from "bun:test";
import { entryPhases, planEntry } from "./entry-plan";

describe("entry plan", () => {
  test("phases are the stride grid plus the canonical end", () => {
    expect(entryPhases(60, 12)).toEqual([0, 12, 24, 36, 48, 60]);
    expect(entryPhases(60, 60)).toEqual([0, 60]);
  });

  test("canonical ignores the shown frame", () => {
    for (const shown of [0, 30, 59]) expect(planEntry("canonical", shown, 1, 60, 6)).toEqual({ phase: 60, wait: 0 });
  });

  test("nearest picks the closest entry phase to the next shown phase, with no wait", () => {
    expect(planEntry("nearest", 0, 1, 60, 6)).toEqual({ phase: 0, wait: 0 }); // next = 1
    expect(planEntry("nearest", 30, 1, 60, 6)).toEqual({ phase: 30, wait: 0 }); // next = 31
    expect(planEntry("nearest", 33, 1, 60, 6)).toEqual({ phase: 36, wait: 0 }); // next = 34
    expect(planEntry("nearest", 57, 1, 60, 6)).toEqual({ phase: 60, wait: 0 }); // next = 58 -> canonical
    expect(planEntry("nearest", 30, -1, 60, 6)).toEqual({ phase: 30, wait: 0 }); // next = 29
  });

  test("wait runs on in the travel direction to the next entry phase", () => {
    expect(planEntry("wait", 48, 1, 60, 6)).toEqual({ phase: 54, wait: 5 }); // next = 49
    expect(planEntry("wait", 53, 1, 60, 6)).toEqual({ phase: 54, wait: 0 }); // next = 54
    expect(planEntry("wait", 58, 1, 60, 6)).toEqual({ phase: 60, wait: 1 }); // next = 59 -> the end
    expect(planEntry("wait", 30, -1, 60, 6)).toEqual({ phase: 24, wait: 5 }); // next = 29, going down
    expect(planEntry("wait", 3, -1, 60, 6)).toEqual({ phase: 0, wait: 2 });
  });

  test("the wait never exceeds stride - 1 frames", () => {
    for (let shown = 0; shown < 60; shown += 1) for (const dir of [1, -1] as const) expect(planEntry("wait", shown, dir, 60, 6).wait).toBeLessThanOrEqual(5);
  });
});
