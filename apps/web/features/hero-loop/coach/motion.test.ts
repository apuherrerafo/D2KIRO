import { describe, expect, test } from "bun:test";
import { EYE_LIMIT, NEUTRAL_POSE, addPose, atomDisplacement, atomProgress, blinkOpen, staggerRank, statePose, verbImpulse } from "./motion";

const aim = { x: 0.8, y: 0.4 };

describe("statePose", () => {
  test("is deterministic", () => {
    expect(statePose("analyzing", 0.4, 3.3, aim)).toEqual(statePose("analyzing", 0.4, 3.3, aim));
  });
  test("eyes never leave the visor", () => {
    for (const s of ["watching", "analyzing", "confirming", "pointing"] as const) {
      for (let t = 0; t < 8; t += 0.07) {
        const p = statePose(s, t, t, { x: 5, y: -5 });
        expect(Math.abs(p.eyeX)).toBeLessThanOrEqual(EYE_LIMIT.x + 1e-9);
        expect(Math.abs(p.eyeZ)).toBeLessThanOrEqual(EYE_LIMIT.z + 1e-9);
      }
    }
  });
  test("pointing turns toward the aim, watching turns less", () => {
    expect(statePose("pointing", 2, 2, aim).yaw).toBeGreaterThan(statePose("watching", 2, 2, aim).yaw);
  });
  test("states are distinguishable by eye openness / sweep", () => {
    expect(statePose("analyzing", 1, 1, { x: 0, y: 0 }).eyeOpen).toBeLessThan(statePose("watching", 1, 1, { x: 0, y: 0 }).eyeOpen + 1e-9 + 0.25);
    expect(statePose("confirming", 0.3, 0.3, aim).eyeOpen).toBeLessThan(1);
  });
  test("reduced motion: no drift, no blink, no squash", () => {
    const a = statePose("watching", 1, 1, { x: 0, y: 0 }, true);
    const b = statePose("watching", 9, 9, { x: 0, y: 0 }, true);
    expect(a).toEqual(b);
    expect(a).toEqual({ ...NEUTRAL_POSE });
    expect(statePose("confirming", 0.1, 0.1, aim, true).squash).toBe(1);
  });
  test("blink closes briefly and reopens", () => {
    expect(blinkOpen(0.07)).toBeLessThan(0.3);
    expect(blinkOpen(1)).toBe(1);
  });
});

describe("verbImpulse", () => {
  test("every verb answers, MORPH adds nothing to the pose", () => {
    expect(verbImpulse("MORPH", 0.2, aim)).toEqual({});
    for (const v of ["ATTRACT", "REPEL", "TETHER", "GATHER", "SETTLE", "TRANSFER"] as const) {
      expect(Object.keys(verbImpulse(v, 0.2, aim)).length).toBeGreaterThan(0);
    }
  });
  test("impulses decay to a bounded offset", () => {
    const late = verbImpulse("REPEL", 6, aim);
    expect(Math.abs(late.shardRadius ?? 0)).toBeLessThan(0.001);
  });
  test("reduced motion ignores verbs", () => {
    expect(verbImpulse("REPEL", 0.1, aim, true)).toEqual({});
  });
  test("addPose clamps the eyes", () => {
    expect(addPose(NEUTRAL_POSE, { eyeX: 9 }).eyeX).toBe(EYE_LIMIT.x);
  });
});

describe("dissolve / reconstruction", () => {
  test("atom progress is monotonic and bounded", () => {
    let prev = 0;
    for (let g = 0; g <= 1.0001; g += 0.05) {
      const p = atomProgress(g, 0.5);
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p).toBeLessThanOrEqual(1);
      prev = p;
    }
    expect(atomProgress(1, 1)).toBe(1);
    expect(atomProgress(0, 0)).toBe(0);
  });
  test("every atom has finished by g = 1 and has not started at g = 0", () => {
    for (let h = -1; h <= 1; h += 0.25) {
      for (let id = 1; id < 600; id += 37) {
        expect(atomProgress(1, staggerRank(h, id, false))).toBe(1);
        expect(atomProgress(0, staggerRank(h, id, true))).toBe(0);
      }
    }
  });
  test("dissolve goes top-down, rebuild bottom-up", () => {
    expect(staggerRank(1, 1, false)).toBeLessThan(staggerRank(-1, 1, false));
    expect(staggerRank(-1, 1, true)).toBeLessThan(staggerRank(1, 1, true));
  });
  test("displacement endpoints", () => {
    expect(atomDisplacement(0)).toEqual({ out: 0, scale: 1, tumble: 0 });
    const end = atomDisplacement(1);
    expect(end.scale).toBe(0);
    expect(end.out).toBe(1);
  });
});
