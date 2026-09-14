import { describe, expect, test } from "bun:test";
import { isPatchWithinRange } from "./patch-range";

describe("isPatchWithinRange", () => {
  test("el propio extremo inferior y superior están dentro del rango", () => {
    expect(isPatchWithinRange("7.40", "7.40", "7.41e")).toBe(true);
    expect(isPatchWithinRange("7.41e", "7.40", "7.41e")).toBe(true);
  });

  test("un parche intermedio con sufijo de letra está dentro del rango", () => {
    expect(isPatchWithinRange("7.41b", "7.40", "7.41e")).toBe(true);
  });

  test("un parche base ordena antes que sus propios hotfixes con sufijo", () => {
    expect(isPatchWithinRange("7.41", "7.41a", "7.41e")).toBe(false);
    expect(isPatchWithinRange("7.41a", "7.41", "7.41e")).toBe(true);
  });

  test("un parche anterior al rango se rechaza", () => {
    expect(isPatchWithinRange("7.39", "7.40", "7.41e")).toBe(false);
  });

  test("un parche posterior al rango se rechaza", () => {
    expect(isPatchWithinRange("7.42", "7.40", "7.41e")).toBe(false);
  });

  test("un parche mal formado nunca es compatible (fail closed)", () => {
    expect(isPatchWithinRange("not-a-patch", "7.40", "7.41e")).toBe(false);
    expect(isPatchWithinRange("", "7.40", "7.41e")).toBe(false);
  });
});
