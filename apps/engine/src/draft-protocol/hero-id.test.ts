import { describe, expect, test } from "bun:test";
import { isValidHeroId } from "./hero-id";

// Blocker 4C / test evidence #8, #9: NaN and Infinity heroIds must be rejected.
describe("isValidHeroId — Blocker 4C", () => {
  test("acepta enteros positivos", () => {
    expect(isValidHeroId(1)).toBe(true);
    expect(isValidHeroId(126)).toBe(true);
  });

  test("rechaza NaN", () => {
    expect(isValidHeroId(NaN)).toBe(false);
  });

  test("rechaza Infinity y -Infinity", () => {
    expect(isValidHeroId(Infinity)).toBe(false);
    expect(isValidHeroId(-Infinity)).toBe(false);
  });

  test("rechaza no-enteros", () => {
    expect(isValidHeroId(1.5)).toBe(false);
  });

  test("rechaza <= 0", () => {
    expect(isValidHeroId(0)).toBe(false);
    expect(isValidHeroId(-1)).toBe(false);
  });

  test("rechaza representaciones numéricas inválidas (strings, null, undefined, objetos)", () => {
    expect(isValidHeroId("1" as unknown)).toBe(false);
    expect(isValidHeroId(null)).toBe(false);
    expect(isValidHeroId(undefined)).toBe(false);
    expect(isValidHeroId({} as unknown)).toBe(false);
  });
});
