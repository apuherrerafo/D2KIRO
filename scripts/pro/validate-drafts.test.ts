import { expect, test } from "bun:test";
import { CURATED_HERO_IDS, validateDraftShape } from "./validate-drafts";

const valid = { match_id: 42, patch: 141, picks_bans: Array.from({ length: 24 }, (_, order) => ({ order, hero_id: [...CURATED_HERO_IDS][order % CURATED_HERO_IDS.size], is_pick: order % 2 === 0 })) };

test("acepta un draft completo y ordenado", () => expect(validateDraftShape(valid)).toEqual({ valid: true, errors: [] }));
test("rechaza incompletos, orden inválido y héroe fuera de catálogo", () => {
  const result = validateDraftShape({ ...valid, picks_bans: [{ order: 1, hero_id: 999 }] });
  expect(result.valid).toBe(false);
  expect(result.errors).toEqual(["incomplete_picks_bans", "invalid_draft_order", "invalid_hero_id"]);
});

test("acepta IDs vigentes fuera del antiguo rango 1..127", () => {
  expect(validateDraftShape({ ...valid, picks_bans: valid.picks_bans.map((turn) => ({ ...turn, hero_id: 155 })) }).valid).toBe(true);
});

test("rechaza IDs numéricos que no existen en el catálogo curado", () => {
  const result = validateDraftShape({ ...valid, picks_bans: valid.picks_bans.map((turn) => ({ ...turn, hero_id: 127 })) });
  expect(result.errors).toContain("invalid_hero_id");
});
