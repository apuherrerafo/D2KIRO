import { expect, test } from "bun:test";
import { isValidRawHero, isValidRawHeroStatsRow, isValidRawMatchup } from "./validation";

const VALID_HERO = {
  id: 1,
  name: "npc_dota_hero_antimage",
  localized_name: "Anti-Mage",
  img: "/apps/dota2/images/dota_react/heroes/antimage.png",
  primary_attr: "agi",
  attack_type: "Melee",
  roles: ["Carry", "Escape"],
};

test("isValidRawHero acepta una ruta de imagen relativa segura", () => {
  expect(isValidRawHero(VALID_HERO)).toBe(true);
});

test("isValidRawHero rechaza img con truco de host-injection userinfo@host", () => {
  expect(isValidRawHero({ ...VALID_HERO, img: "@evil.example/x" })).toBe(false);
});

test("isValidRawHero rechaza img protocol-relative (doble slash inicial)", () => {
  expect(isValidRawHero({ ...VALID_HERO, img: "//evil.example/x" })).toBe(false);
});

test("isValidRawHero rechaza img con esquema absoluto embebido", () => {
  expect(isValidRawHero({ ...VALID_HERO, img: "/x?u=https://evil.example" })).toBe(false);
});

test("isValidRawHero rechaza si falta un campo requerido", () => {
  const { primary_attr: _omit, ...withoutPrimaryAttr } = VALID_HERO;
  expect(isValidRawHero(withoutPrimaryAttr)).toBe(false);
});

test("isValidRawMatchup acepta una fila con los 3 campos numéricos", () => {
  expect(isValidRawMatchup({ hero_id: 2, games_played: 100, wins: 50 })).toBe(true);
});

test("isValidRawMatchup rechaza si algún campo no es numérico", () => {
  expect(isValidRawMatchup({ hero_id: "2", games_played: 100, wins: 50 })).toBe(false);
});

test("isValidRawHeroStatsRow acepta una fila con los 8 pares pick/win numéricos", () => {
  const row: Record<string, number> = { id: 1 };
  for (let tier = 1; tier <= 8; tier++) {
    row[`${tier}_pick`] = 100;
    row[`${tier}_win`] = 50;
  }
  expect(isValidRawHeroStatsRow(row)).toBe(true);
});

test("isValidRawHeroStatsRow rechaza si falta el pick/win de un solo bracket", () => {
  const row: Record<string, number> = { id: 1 };
  for (let tier = 1; tier <= 8; tier++) {
    row[`${tier}_pick`] = 100;
    row[`${tier}_win`] = 50;
  }
  delete row["8_win"];
  expect(isValidRawHeroStatsRow(row)).toBe(false);
});
