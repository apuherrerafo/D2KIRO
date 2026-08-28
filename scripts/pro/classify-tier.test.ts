import { expect, test } from "bun:test";
import { classifyDrafts, classifyTier, type ClassifiableDraft } from "./classify-tier";

const complete = (overrides: Partial<ClassifiableDraft> = {}): ClassifiableDraft => ({
  league: { tier: "premium" }, game_mode: 2, od_data: { has_gcdata: true },
  picks_bans: Array.from({ length: 10 }, (_, i) => ({ is_pick: true, hero_id: i + 1, team: (i < 5 ? 0 : 1) as 0 | 1 })),
  ...overrides,
});

test("clasifica premium/professional y conserva clases excluidas", () => {
  expect(classifyTier(complete())).toBe("tier_1");
  expect(classifyTier(complete({ league: { tier: "professional" } }))).toBe("tier_2");
  expect(classifyTier(complete({ league: { tier: "amateur" } }))).toBe("excluded");
  expect(classifyTier(complete({ league: { tier: "unknown" } }))).toBe("excluded");
});

test("la calidad del draft gana al tier declarado", () => {
  expect(classifyTier(complete({ picks_bans: [] }))).toBe("unclassifiable");
  expect(classifyTier(complete({ game_mode: 1 }))).toBe("unclassifiable");
  expect(classifyTier(complete({ od_data: { has_gcdata: false } }))).toBe("unclassifiable");
  expect(classifyTier(complete({ picks_bans: complete().picks_bans.slice(0, 9) }))).toBe("unclassifiable");
});

test("cada draft cae en exactamente una clase y la suma conserva el total", () => {
  const result = classifyDrafts([
    complete(), complete({ league: { tier: "professional" } }), complete({ league: { tier: "excluded" } }), complete({ picks_bans: [] }),
  ]);
  expect(result).toEqual({ tier_1: 1, tier_2: 1, excluded: 1, unclassifiable: 1 });
  expect(Object.values(result).reduce((sum, count) => sum + count, 0)).toBe(4);
});
