import type { HeroId } from "../draft/reducer";

export interface TacticalOverrideConfig {
  tier1Flex: readonly HeroId[];
  earlyAggressors: readonly HeroId[];
  macroStrategies: readonly { pillars: readonly HeroId[]; remaining: HeroId }[];
  saveSupports: readonly HeroId[];
  antiFlexPenalty?: number;
}

export const DEFAULT_TACTICAL_OVERRIDES: TacticalOverrideConfig = {
  tier1Flex: [19, 7, 13],
  earlyAggressors: [85, 47, 70],
  macroStrategies: [{ pillars: [92, 77], remaining: 38 }],
  saveSupports: [79, 3, 111, 45],
  antiFlexPenalty: 0.5,
};

export function applyTacticalOverrides<T extends { readonly heroId: HeroId; readonly score: number }>(
  candidates: readonly T[],
  banned: readonly HeroId[],
  config: TacticalOverrideConfig = DEFAULT_TACTICAL_OVERRIDES,
): T[] {
  const bans = new Set(banned);
  const antiFlex = config.tier1Flex.filter((hero) => bans.has(hero)).length >= 2;
  const depletedSaves = config.saveSupports.filter((hero) => bans.has(hero)).length >= Math.max(1, config.saveSupports.length - 1);
  const macro = config.macroStrategies.find((strategy) => strategy.pillars.filter((hero) => bans.has(hero)).length >= 2);
  return candidates.map((candidate) => {
    let score = candidate.score;
    if (antiFlex && config.tier1Flex.includes(candidate.heroId)) score *= config.antiFlexPenalty ?? 0.5;
    if (antiFlex && config.earlyAggressors.includes(candidate.heroId)) score *= 1.15;
    if (macro?.remaining === candidate.heroId) score *= 2;
    if (depletedSaves && config.saveSupports.includes(candidate.heroId) && !bans.has(candidate.heroId)) score *= 2;
    return { ...candidate, score };
  });
}
