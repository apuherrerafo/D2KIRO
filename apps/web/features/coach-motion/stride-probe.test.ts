import { describe, expect, test } from "bun:test";
import { NATURAL_STEP_FACTOR, probeSlice, recommendStride } from "./stride-probe";

const probe = probeSlice([2, 3, 4, 5, 6, 8]);
const at = (loop: "watching" | "analyzing", stride: number) => probe[loop].strides.find((s) => s.stride === stride)!;

describe("entry-stride probe · real authored pose tracks", () => {
  test("ANALYZING moves at a constant, much higher speed than WATCHING (so stride 6 cannot be a universal constant)", () => {
    expect(probe.analyzing.step.median).toBeGreaterThan(10 * probe.watching.step.median);
    expect(probe.analyzing.step.max / probe.analyzing.step.median).toBeLessThan(1.05); // steady ring spin: velocity is the same at every phase
  });

  test("the entry jump of ANALYZING grows with the frames the nearest head is off: stride 2/3 = one natural step, 4/5 = two, 6 = three", () => {
    const step = probe.analyzing.step.max;
    expect(at("analyzing", 2).maxJump).toBeCloseTo(step, 1);
    expect(at("analyzing", 3).maxJump).toBeCloseTo(step, 1);
    expect(at("analyzing", 4).maxJump / step).toBeCloseTo(2, 1);
    expect(at("analyzing", 6).maxJump / step).toBeCloseTo(3, 1);
    expect(at("analyzing", 6).maxFramesOff).toBe(3);
    expect(at("analyzing", 3).maxFramesOff).toBe(1);
  });

  test("the rule that accepts the approved WATCHING stride 6 picks ANALYZING stride 3", () => {
    expect(NATURAL_STEP_FACTOR).toBe(1.5);
    expect(recommendStride(probe.watching)).toBe(6);
    expect(recommendStride(probe.analyzing)).toBe(3);
  });

  test("the cost of the finer grid is stated by the probe: heads per source loop", () => {
    expect(at("analyzing", 3).heads).toBe(70);
    expect(at("analyzing", 6).heads).toBe(35);
    expect(at("watching", 6).heads).toBe(42);
  });
});
