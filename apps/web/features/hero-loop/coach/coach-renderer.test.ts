import { describe, expect, test } from "bun:test";
import { AimStabilizer, HERO_AIMS, HERO_STATES, aimVector, allStillUrls, quantizeAim, stillUrl } from "./coach-renderer";

describe("quantizeAim", () => {
  test("dead zone is center", () => {
    expect(quantizeAim(0)).toBe("center");
    expect(quantizeAim(0.2)).toBe("center");
  });
  test("sides", () => {
    expect(quantizeAim(-0.6)).toBe("left");
    expect(quantizeAim(0.6)).toBe("right");
  });
  test("sprite aim maps to a live aim vector", () => {
    expect(aimVector("left").x).toBe(-1);
    expect(aimVector("right").x).toBe(1);
    expect(aimVector("center").x).toBe(0);
  });
});

describe("hero pack addressing", () => {
  test("url shape", () => {
    expect(stillUrl({ state: "analyzing", aim: "left" })).toBe("/coach-web-pack/hero/analyzing-l.webp");
    expect(stillUrl({ state: "pointing", aim: "right" })).toBe("/coach-web-pack/hero/pointing-r.webp");
  });
  test("preload list is the 12 hero frames, unique", () => {
    const urls = allStillUrls();
    expect(new Set(urls).size).toBe(HERO_STATES.length * HERO_AIMS.length);
    expect(urls).toHaveLength(12);
  });
});

describe("AimStabilizer", () => {
  test("a new direction must hold before it is adopted", () => {
    const s = new AimStabilizer(160);
    expect(s.next("left", 0, false)).toBe("center");
    expect(s.next("left", 100, false)).toBe("center");
    expect(s.next("left", 170, false)).toBe("left");
  });
  test("flicker never lands", () => {
    const s = new AimStabilizer(160);
    s.next("left", 0, false);
    s.next("right", 100, false);
    expect(s.next("left", 200, false)).toBe("center");
  });
  test("reduced motion is immediate", () => {
    expect(new AimStabilizer().next("right", 0, true)).toBe("right");
  });
});
