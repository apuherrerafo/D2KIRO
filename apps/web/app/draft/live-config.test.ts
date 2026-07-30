import { describe, expect, test } from "bun:test";
import { isDraftLiveEnabled } from "./live-config";

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
