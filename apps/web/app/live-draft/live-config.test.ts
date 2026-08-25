import { describe, expect, test } from "bun:test";
import { isDraftLiveEnabled, isProDrafterEnabled } from "./live-config";

describe("isDraftLiveEnabled", () => {
  test("sin variable definida conserva el draft local habilitado", () => {
    expect(isDraftLiveEnabled(undefined)).toBe(true);
  });

  test("solo el valor false deshabilita el draft en vivo", () => {
    expect(isDraftLiveEnabled("false")).toBe(false);
    expect(isDraftLiveEnabled("true")).toBe(true);
    expect(isDraftLiveEnabled("")).toBe(true);
  });
});

describe("isProDrafterEnabled", () => {
  test("sin variable definida queda apagado (dark launch, al revés de isDraftLiveEnabled)", () => {
    expect(isProDrafterEnabled(undefined)).toBe(false);
  });

  test("solo el valor \"true\" explícito lo habilita", () => {
    expect(isProDrafterEnabled("true")).toBe(true);
    expect(isProDrafterEnabled("false")).toBe(false);
    expect(isProDrafterEnabled("")).toBe(false);
  });
});
