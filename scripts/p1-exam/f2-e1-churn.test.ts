import { describe, expect, test } from "bun:test";
import type { HeroCapabilities } from "../../apps/engine/src/draft-paths/types";
import { classifyChurn, type ChurnInput } from "./f2-e1-churn";

// Inline fixtures only (invariantes.md).
const cap = (hero: number, over: Partial<HeroCapabilities> = {}): HeroCapabilities => ({ hero, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "low", teamfight: "low", scaling: "low", ...over });
const caps = new Map<number, HeroCapabilities>([
  [1, cap(1, { structuralDamage: "high" })], [2, cap(2, { structuralDamage: "medium" })], [3, cap(3)], [4, cap(4)], [5, cap(5, { hasInitiation: true })], [6, cap(6, { structuralDamage: "high", hasInitiation: true })],
]);
const base = (over: Partial<ChurnInput>): ChurnInput => ({ openGaps: ["structural_damage", "initiation"], ownDamageTypes: ["physical"], f1Top3: [3, 4, 5], e1Top3: [3, 4, 5], caps, exposure: () => 0, ...over });

describe("F2-E1 churn classification", () => {
  test("GAIN: no structural hero before, one now", () => {
    expect(classifyChurn(base({ f1Top3: [3, 4, 5], e1Top3: [3, 4, 1] })).cls).toBe("GAIN");
  });

  test("REORDER_ONLY: same set, different order", () => {
    expect(classifyChurn(base({ f1Top3: [1, 3, 4], e1Top3: [3, 4, 1] })).cls).toBe("REORDER_ONLY");
  });

  test("FILLER_FOR_NONFILLER: already covered, a structural hero replaces a non-structural one, nothing lost", () => {
    expect(classifyChurn(base({ f1Top3: [1, 3, 5], e1Top3: [1, 2, 5] })).cls).toBe("FILLER_FOR_NONFILLER");
  });

  test("POSSIBLE_REGRESSION: an open gap the F1 top-3 covered is lost (initiation), even if the swap brings a structural hero", () => {
    const out = classifyChurn(base({ f1Top3: [1, 3, 5], e1Top3: [1, 3, 2] }));
    expect(out.cls).toBe("POSSIBLE_REGRESSION");
    expect(out.lostGaps).toEqual(["initiation"]);
  });

  test("POSSIBLE_REGRESSION: hard-counter exposure goes up with no gap lost", () => {
    const exposure = (heroes: number[]): number => (heroes.includes(2) ? 1 : 0);
    const out = classifyChurn(base({ f1Top3: [1, 3, 5], e1Top3: [1, 2, 5], exposure }));
    expect(out).toMatchObject({ cls: "POSSIBLE_REGRESSION", exposureDelta: 1 });
  });

  test("UNCURATED_ENTRY: an uncurated hero entering a top-3 that was already covered is labelled as such", () => {
    expect(classifyChurn(base({ f1Top3: [1, 3, 5], e1Top3: [1, 145, 5] })).cls).toBe("UNCURATED_ENTRY");
  });

  test("STILL_UNFILLED: neither top-3 covers the structural gap", () => {
    expect(classifyChurn(base({ f1Top3: [3, 4, 5], e1Top3: [3, 4, 145] })).cls).toBe("STILL_UNFILLED");
  });

  test("NEUTRAL_SWAP: covered before and after, a non-structural swap, nothing lost", () => {
    expect(classifyChurn(base({ f1Top3: [1, 3, 5], e1Top3: [1, 4, 5] })).cls).toBe("NEUTRAL_SWAP");
  });
});
