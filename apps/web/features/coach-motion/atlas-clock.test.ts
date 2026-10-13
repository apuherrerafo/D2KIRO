import { describe, expect, test } from "bun:test";
import { elapsedOfSeq, frameAt, frameOfSeq, isFinished, locate, seqAt } from "./atlas-clock";

describe("atlas clock", () => {
  test("30 fps: frame n begins at n * 33.33 ms", () => {
    expect(seqAt(0, 30)).toBe(0);
    expect(seqAt(33.3, 30)).toBe(0);
    expect(seqAt(33.34, 30)).toBe(1);
    expect(seqAt(1000, 30)).toBe(30);
    expect(seqAt(-5, 30)).toBe(0);
  });

  test("once holds the last frame and finishes on it", () => {
    expect(frameAt(5000, 39, 30, "once")).toBe(38);
    expect(isFinished(37 * (1000 / 30), 39, 30, "once")).toBe(false);
    expect(isFinished(38 * (1000 / 30), 39, 30, "once")).toBe(true);
  });

  test("loop wraps 0..n-1", () => {
    expect([58, 59, 60, 61].map((s) => frameOfSeq(s, 60, "loop"))).toEqual([58, 59, 0, 1]);
    expect(isFinished(99999, 60, 30, "loop")).toBe(false);
  });

  test("pingpong turns without doubling the end frames", () => {
    expect(Array.from({ length: 10 }, (_, s) => frameOfSeq(s, 4, "pingpong"))).toEqual([0, 1, 2, 3, 2, 1, 0, 1, 2, 3]);
    expect(isFinished(99999, 60, 30, "pingpong")).toBe(false);
  });

  test("a one-frame clip is always frame 0", () => {
    for (const mode of ["once", "loop", "pingpong"] as const) expect(frameOfSeq(7, 1, mode)).toBe(0);
  });

  test("a playlist plays its segments back to back and the last one follows the mode", () => {
    const at = (s: number) => locate(s, [4, 3], "once");
    expect([0, 3, 4, 6, 7, 99].map(at)).toEqual([
      { segment: 0, frame: 0 },
      { segment: 0, frame: 3 },
      { segment: 1, frame: 0 },
      { segment: 1, frame: 2 },
      { segment: 1, frame: 2 },
      { segment: 1, frame: 2 },
    ]);
    expect(locate(9, [3], "pingpong")).toEqual({ segment: 0, frame: 1 });
  });

  test("the stepper lands exactly on a sequence index", () => {
    for (const s of [0, 1, 17, 38, 59]) expect(seqAt(elapsedOfSeq(s, 30), 30)).toBe(s);
  });
});
