import { expect, test } from "bun:test";
import { interactionDelta } from "./interactions";
import { LANE_DIMENSIONS } from "./profiles";
import type { HeroLineProfile, LaneDimension } from "./profiles";

// Fixtures a mano -- Φ_k es aritmética pura sobre HeroLineProfile, no depende del archivo curado
// real (mismo criterio S9/S10 que el resto de Fase 5-6).

const STRONG: HeroLineProfile = {
  heroId: 1,
  sustain: 0.8,
  killPressure: 0.8,
  harassRange: 0.8,
  dispelSave: 0.8,
  creepControl: 0.8,
};
const WEAK: HeroLineProfile = {
  heroId: 2,
  sustain: 0.2,
  killPressure: 0.2,
  harassRange: 0.2,
  dispelSave: 0.2,
  creepControl: 0.2,
};
const MID: HeroLineProfile = {
  heroId: 3,
  sustain: 0.5,
  killPressure: 0.5,
  harassRange: 0.5,
  dispelSave: 0.5,
  creepControl: 0.5,
};

test("par propio domina la dimensión -> delta positivo, número exacto", () => {
  const delta = interactionDelta("sustain", [STRONG, STRONG], [WEAK, WEAK]);
  expect(delta).toBeCloseTo(0.6, 10); // 0.8 - 0.2
});

test("par rival domina la dimensión -> delta negativo, número exacto", () => {
  const delta = interactionDelta("killPressure", [WEAK, WEAK], [STRONG, STRONG]);
  expect(delta).toBeCloseTo(-0.6, 10); // 0.2 - 0.8
});

test("intercambiar ally y enemy invierte el signo exacto (simetría)", () => {
  const forward = interactionDelta("harassRange", [STRONG, WEAK], [MID, MID]);
  const backward = interactionDelta("harassRange", [MID, MID], [STRONG, WEAK]);
  expect(backward).toBeCloseTo(-forward, 10);
});

test("promedios idénticos entre pares -> delta exactamente 0", () => {
  // (0.8+0.2)/2 = (0.2+0.8)/2 -- mismo promedio en ambos lados, aunque los pares no sean iguales.
  const delta = interactionDelta("dispelSave", [STRONG, WEAK], [WEAK, STRONG]);
  expect(delta).toBe(0);
});

test("mismo par en ambos lados -> delta exactamente 0", () => {
  const delta = interactionDelta("creepControl", [MID, MID], [MID, MID]);
  expect(delta).toBe(0);
});

test("cada dimensión lee su propio campo -- no un campo fijo (hallazgo tipo TSK-036)", () => {
  const ally1: HeroLineProfile = {
    heroId: 10,
    sustain: 0.9,
    killPressure: 0.1,
    harassRange: 0.5,
    dispelSave: 0.5,
    creepControl: 0.5,
  };
  const ally2: HeroLineProfile = {
    heroId: 11,
    sustain: 0.5,
    killPressure: 0.5,
    harassRange: 0.5,
    dispelSave: 0.5,
    creepControl: 0.5,
  };
  const enemy1: HeroLineProfile = {
    heroId: 12,
    sustain: 0.1,
    killPressure: 0.9,
    harassRange: 0.5,
    dispelSave: 0.5,
    creepControl: 0.5,
  };
  const enemy2: HeroLineProfile = {
    heroId: 13,
    sustain: 0.5,
    killPressure: 0.5,
    harassRange: 0.5,
    dispelSave: 0.5,
    creepControl: 0.5,
  };

  const expected: Record<LaneDimension, number> = {
    sustain: 0.4, // (0.9+0.5)/2 - (0.1+0.5)/2
    killPressure: -0.4, // (0.1+0.5)/2 - (0.9+0.5)/2
    harassRange: 0,
    dispelSave: 0,
    creepControl: 0,
  };

  for (const dimension of LANE_DIMENSIONS) {
    const delta = interactionDelta(dimension, [ally1, ally2], [enemy1, enemy2]);
    expect(delta).toBeCloseTo(expected[dimension], 10);
  }
});
