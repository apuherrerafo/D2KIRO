import { deriveFlexDistribution } from "../apps/engine/src/intent/position-prior";
import type { HeroId } from "../apps/engine/src/draft/reducer";
import type { HeroPositions } from "../apps/engine/src/signals/hero-positions";

export type RolePressureProfile = [number, number, number, number, number];

export function rolePressure(heroes: readonly HeroId[], positions: HeroPositions): RolePressureProfile {
  const total = Math.max(1, heroes.length);
  const profile = [0, 0, 0, 0, 0] as RolePressureProfile;
  for (const hero of heroes) {
    const distribution = deriveFlexDistribution(hero, positions).probabilities;
    for (let i = 0; i < 5; i += 1) profile[i] += distribution[(i + 1) as 1 | 2 | 3 | 4 | 5] / total;
  }
  return profile;
}

export function profileDistance(left: RolePressureProfile, right: RolePressureProfile): number {
  return left.reduce((sum, value, index) => sum + Math.abs(value - right[index]!), 0) / 2;
}

export interface RolePressureCalibration {
  readonly irrelevantPairs: number;
  readonly stableIrrelevantRate: number;
  readonly pivotalPairs: number;
  readonly dynamicPivotalRate: number;
}

export function calibrateRolePressure(
  pairs: readonly { banPressureDelta: number; outputPressureDelta: number }[],
  irrelevantThreshold = 0.15,
  outputShiftThreshold = 0.1,
): RolePressureCalibration {
  const irrelevant = pairs.filter((pair) => pair.banPressureDelta < irrelevantThreshold);
  const pivotal = pairs.filter((pair) => pair.banPressureDelta >= irrelevantThreshold);
  return {
    irrelevantPairs: irrelevant.length,
    stableIrrelevantRate: irrelevant.length === 0 ? 1 : irrelevant.filter((pair) => pair.outputPressureDelta < outputShiftThreshold).length / irrelevant.length,
    pivotalPairs: pivotal.length,
    dynamicPivotalRate: pivotal.length === 0 ? 1 : pivotal.filter((pair) => pair.outputPressureDelta >= outputShiftThreshold).length / pivotal.length,
  };
}
