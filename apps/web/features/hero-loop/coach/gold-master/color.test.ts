import { describe, expect, test } from "bun:test";
import { atomEffectiveAlbedo, atomEffectiveAlbedoFromStored, decodeStoredRgba, srgbByteToLinear, type Rgb } from "./color";

// Fixtures extracted from the CLOSED Blender Gold Master (baseform_complete02) with Blender 5.2:
// `storedCol/storedOcc` = the BYTE_COLOR bytes on a real atom vertex; `blenderLinear*` = what Blender's own
// Color Attribute node reads back (`attribute.data[i].color`). Inline on purpose — no test opens the .blend/.bin.
const BLENDER_FIXTURES: Record<string, { storedCol: Rgb; storedOcc: number; blenderLinearCol: Rgb; blenderLinearOcc: number }> = {
  blue: { storedCol: [38, 38, 209], storedOcc: 84, blenderLinearCol: [0.0193824, 0.0193824, 0.637597], blenderLinearOcc: 0.0886556 },
  cyan: { storedCol: [40, 225, 225], storedOcc: 107, blenderLinearCol: [0.021219, 0.7529424, 0.7529424], blenderLinearOcc: 0.1470273 },
  green: { storedCol: [41, 229, 41], storedOcc: 162, blenderLinearCol: [0.0221739, 0.783538, 0.0221739], blenderLinearOcc: 0.3613068 },
  violet: { storedCol: [148, 45, 251], storedOcc: 84, blenderLinearCol: [0.2961383, 0.0262412, 0.9646866], blenderLinearOcc: 0.0886556 },
  pink: { storedCol: [215, 39, 127], storedOcc: 107, blenderLinearCol: [0.6795426, 0.0202886, 0.2122308], blenderLinearOcc: 0.1470273 },
  red: { storedCol: [227, 41, 41], storedOcc: 151, blenderLinearCol: [0.7681514, 0.0221739, 0.0221739], blenderLinearOcc: 0.309469 },
  orange: { storedCol: [242, 143, 44], storedOcc: 113, blenderLinearCol: [0.8879232, 0.2746774, 0.0251869], blenderLinearOcc: 0.1651322 },
};

describe("P0 color pipeline — stored BYTE_COLOR -> effective Blender albedo (decode exactly once)", () => {
  for (const [hue, fx] of Object.entries(BLENDER_FIXTURES)) {
    test(`${hue}: srgbToLinear(stored byte) equals Blender's own linear read-back`, () => {
      fx.storedCol.forEach((byte, i) => expect(Math.abs(srgbByteToLinear(byte) - fx.blenderLinearCol[i])).toBeLessThan(1e-6));
      expect(Math.abs(srgbByteToLinear(fx.storedOcc) - fx.blenderLinearOcc)).toBeLessThan(1e-6);
    });
  }

  test("the BYTE_COLOR trap: copying the byte as if it were linear, or decoding twice, gives a visibly different color", () => {
    const fx = BLENDER_FIXTURES.blue;
    const correct = fx.blenderLinearCol[2]; // 0.6376
    const asLinear = fx.storedCol[2] / 255; //  0.8196 — byte copied as linear (too bright / washed)
    const doubleDecoded = srgbByteToLinear(Math.round(correct * 255)); // 0.3571 — decoded twice (too dark)
    expect(asLinear - correct).toBeGreaterThan(0.15);
    expect(correct - doubleDecoded).toBeGreaterThan(0.15);
  });

  test("hue is preserved by the decode (no systematic hue shift on any of the 7 hue families)", () => {
    const hueOf = ([r, g, b]: Rgb) => {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      if (d === 0) return 0;
      let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
      return (h + 360) % 360;
    };
    for (const fx of Object.values(BLENDER_FIXTURES)) {
      const decoded = fx.storedCol.map(srgbByteToLinear) as Rgb;
      const delta = Math.abs(((hueOf(decoded) - hueOf(fx.blenderLinearCol) + 180) % 360) - 180);
      expect(delta).toBeLessThan(0.01);
    }
  });

  test("atom albedo: Mat_Life_P2 mix(L, L^1.6, 0.8 - 0.8*Occ) reproduces the node graph on a hand-computed vertex", () => {
    const fx = BLENDER_FIXTURES.blue;
    // factor = 0.8 - 0.8*0.0886556 = 0.7290755 ; blue channel: 0.637597*(1-f) + 0.637597^1.6*f
    const f = 0.8 - 0.8 * fx.blenderLinearOcc;
    const expected = fx.blenderLinearCol.map((c) => c * (1 - f) + c ** 1.6 * f);
    const got = atomEffectiveAlbedo(fx.blenderLinearCol, fx.blenderLinearOcc);
    got.forEach((v, i) => expect(Math.abs(v - expected[i])).toBeLessThan(1e-9));
    const fromStored = atomEffectiveAlbedoFromStored(fx.storedCol, fx.storedOcc);
    fromStored.forEach((v, i) => expect(Math.abs(v - expected[i])).toBeLessThan(1e-5));
  });

  test("Occ = 1 (fully open) leaves the albedo untouched; the pow(1.6) only deepens occluded vertices", () => {
    const L: Rgb = [0.2, 0.5, 0.9];
    // Occ = 1 -> factor 0 -> albedo === L exactly
    atomEffectiveAlbedo(L, 1).forEach((v, i) => expect(Math.abs(v - L[i])).toBeLessThan(1e-12));
    // Occ = 0 -> factor 0.8 -> albedo = 0.2*L + 0.8*L^1.6 (< L for L < 1: deeper, more saturated)
    atomEffectiveAlbedo(L, 0).forEach((v, i) => expect(Math.abs(v - (L[i] * 0.2 + L[i] ** 1.6 * 0.8))).toBeLessThan(1e-12));
    atomEffectiveAlbedo(L, 0).forEach((v, i) => expect(v).toBeLessThan(L[i]));
  });

  test("decodeStoredRgba decodes RGB once and ignores alpha", () => {
    const bytes = new Uint8Array([38, 38, 209, 255, 0, 0, 0, 7]);
    const out = decodeStoredRgba(bytes, 2);
    expect(Math.abs(out[2] - 0.637597)).toBeLessThan(1e-6);
    expect(out[3]).toBe(0);
    expect(out.length).toBe(6);
  });
});
