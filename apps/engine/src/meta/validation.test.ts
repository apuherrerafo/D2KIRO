import { expect, test } from "bun:test";
import { isValidRawHero, isValidRawHeroStatsRow, isValidRawMatchup, isValidRawPlayerHero, isValidSteamAccountId } from "./validation";
import { mapPlayerHero } from "./mappers";

const VALID_HERO = {
  id: 1,
  name: "npc_dota_hero_antimage",
  localized_name: "Anti-Mage",
  primary_attr: "agi",
  attack_type: "Melee",
  roles: ["Carry", "Escape"],
};

test("isValidRawHero acepta un name con el patrón fijo de Valve", () => {
  expect(isValidRawHero(VALID_HERO)).toBe(true);
});

test("isValidRawHero rechaza name con truco de host-injection userinfo@host", () => {
  expect(isValidRawHero({ ...VALID_HERO, name: "npc_dota_hero_antimage@evil.example" })).toBe(false);
});

test("isValidRawHero rechaza name sin el prefijo fijo de Valve", () => {
  expect(isValidRawHero({ ...VALID_HERO, name: "antimage" })).toBe(false);
});

test("isValidRawHero rechaza name con esquema absoluto embebido", () => {
  expect(isValidRawHero({ ...VALID_HERO, name: "npc_dota_hero_antimage?u=https://evil.example" })).toBe(false);
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

// TSK-018 (fase 1b): accountId nunca es una respuesta de OpenDota, pero sigue siendo input
// externo -- va aquí junto a los demás validadores del borde para no crear un archivo propio
// solo para una función.
test("isValidSteamAccountId acepta un id numérico válido", () => {
  expect(isValidSteamAccountId("123456789")).toBe(true);
});

test("isValidSteamAccountId rechaza valores no numéricos o vacíos", () => {
  expect(isValidSteamAccountId("abc123")).toBe(false);
  expect(isValidSteamAccountId("")).toBe(false);
  expect(isValidSteamAccountId(" 123")).toBe(false);
  expect(isValidSteamAccountId("123 ")).toBe(false);
});

test("isValidSteamAccountId rechaza 0 y valores fuera del rango de Steam32", () => {
  expect(isValidSteamAccountId("0")).toBe(false);
  expect(isValidSteamAccountId("4294967296")).toBe(false);
});

test("isValidSteamAccountId acepta el límite superior exacto de Steam32", () => {
  expect(isValidSteamAccountId("4294967295")).toBe(true);
});

test("isValidRawPlayerHero acepta una fila con hero_id/games/win numéricos", () => {
  expect(isValidRawPlayerHero({ hero_id: 1, games: 20, win: 12 })).toBe(true);
});

test("isValidRawPlayerHero rechaza si falta un campo requerido", () => {
  expect(isValidRawPlayerHero({ hero_id: 1, games: 20 })).toBe(false);
});

test("isValidRawPlayerHero rechaza si algún campo no es numérico", () => {
  expect(isValidRawPlayerHero({ hero_id: "1", games: 20, win: 12 })).toBe(false);
});

test("mapPlayerHero convierte el campo win (OpenDota) a wins (nombre interno)", () => {
  expect(mapPlayerHero({ hero_id: 1, games: 20, win: 12 })).toEqual({ heroId: 1, games: 20, wins: 12 });
});
