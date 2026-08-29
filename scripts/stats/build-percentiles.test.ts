import { describe, expect, test } from "bun:test";
import { computePercentiles } from "./build-percentiles";

const META = { trainSplitHash: "abc123", corpusPatchOverride: "7.41e" };

describe("computePercentiles — SPEC §16.5", () => {
  test("señal con datos: p05 < p95, n correcto, metadata pasada", () => {
    const raws = Array.from({ length: 100 }, (_, i) => i / 100); // 0.00 .. 0.99
    const r = computePercentiles({ counter: raws }, META);
    expect(r.schemaVersion).toBe(1);
    expect(r.trainSplitHash).toBe("abc123");
    expect(r.corpusPatchOverride).toBe("7.41e");
    const e = r.signals.counter;
    expect(e).not.toBeNull();
    expect(e!.global.n).toBe(100);
    expect(e!.global.p05).toBeLessThan(e!.global.p95);
    expect(e!.global.p05).toBeCloseTo(0.05, 1);
    expect(e!.global.p95).toBeCloseTo(0.94, 1);
  });

  test("señal sin datos -> null (el motor cae a RAW_RANGE)", () => {
    const r = computePercentiles({ counter: [] }, META);
    expect(r.signals.counter).toBeNull();
    expect(r.signals.team_synergy).toBeNull(); // ni siquiera aparece en la entrada
  });

  test("hero_pool_fit y archetype_fit NUNCA se calibran, aunque haya datos", () => {
    const r = computePercentiles({ hero_pool_fit: [0.1, 0.5, 0.9], archetype_fit: [0.2, 0.4, 0.8] }, META);
    expect(r.signals.hero_pool_fit).toBeNull();
    expect(r.signals.archetype_fit).toBeNull();
  });

  test("p05 === p95 (raw constante) -> null (evita división por cero en el motor)", () => {
    const r = computePercentiles({ position_fit: [0.5, 0.5, 0.5, 0.5, 0.5] }, META);
    expect(r.signals.position_fit).toBeNull();
  });

  test("determinismo: mismos raws -> mismo resultado", () => {
    const raws = { counter: [-0.05, -0.02, 0, 0.01, 0.03, 0.06], position_fit: [0, 0.3, 0.5, 0.7, 1] };
    expect(JSON.stringify(computePercentiles(raws, META))).toBe(JSON.stringify(computePercentiles(raws, META)));
  });

  test("las 6 señales aparecen en el output (con valor o null)", () => {
    const r = computePercentiles({}, META);
    for (const s of ["position_fit", "counter", "patch_meta", "team_synergy", "hero_pool_fit", "archetype_fit"]) {
      expect(s in r.signals).toBe(true);
    }
  });
});
