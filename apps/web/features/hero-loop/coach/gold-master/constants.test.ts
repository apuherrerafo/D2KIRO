import { describe, expect, test } from "bun:test";
import {
  TONE_MAPPING_EXPOSURE,
  areaLightIntensity,
  blenderCameraPosition,
  blenderToThree,
  specularIntensityFromBlenderLevel,
  verticalFovDegrees,
} from "./constants";

describe("Blender -> Three.js conversions (derived, not eyeballed)", () => {
  test("Specular IOR Level 0.35 (body) -> specularIntensity 0.70; 0.50 (glass/rim) -> 1.0; 0 (core) -> 0", () => {
    expect(specularIntensityFromBlenderLevel(0.35)).toBeCloseTo(0.7, 10);
    expect(specularIntensityFromBlenderLevel(0.5)).toBe(1);
    expect(specularIntensityFromBlenderLevel(0)).toBe(0);
  });

  test("ONE global light scalar: radiance = P / (pi * size^2); hierarchy Key > TopSoft > RimCyan > Pink > Fill preserved per-light, no per-light fudge", () => {
    expect(areaLightIntensity(650, 4.5)).toBeCloseTo(650 / (Math.PI * 4.5 ** 2), 10);
    // the same scalar for every light: intensity * pi * size^2 / watts === 1
    for (const [w, s] of [[650, 4.5], [70, 4.0], [1000, 2.4], [600, 2.4], [400, 2.4]] as const) {
      expect((areaLightIntensity(w, s) * Math.PI * s * s) / w).toBeCloseTo(1, 12);
    }
  });

  test("EV -1.4296875 -> exposure 2^EV", () => {
    expect(TONE_MAPPING_EXPOSURE).toBeCloseTo(0.37121, 5);
  });

  test("85 mm on a 36 mm sensor -> 23.9 deg vertical FOV", () => {
    expect(verticalFovDegrees(85, 36)).toBeCloseTo(23.9, 1);
  });

  test("HERO camera (azimuth -22, d 7.5, h 0.45, target 0,0,0.14) in Blender space, then Y-up", () => {
    const blender = blenderCameraPosition(-22, 7.5, 0.45, [0, 0, 0.14]);
    expect(blender[0]).toBeCloseTo(-2.8095, 3);
    expect(blender[1]).toBeCloseTo(-6.9538, 3);
    expect(blender[2]).toBe(0.45);
    expect(blenderToThree(blender)).toEqual([blender[0], 0.45, -blender[1]]);
    // SIDE (90) sits on +X like the saved ReviewCam (7.5, 0, 0.45)
    const side = blenderCameraPosition(90, 7.5, 0.45, [0, 0, 0.14]);
    expect(side[0]).toBeCloseTo(7.5, 10);
    expect(Math.abs(side[1])).toBeLessThan(1e-9);
  });
});
