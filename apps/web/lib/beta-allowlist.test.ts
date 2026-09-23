import { describe, expect, test } from "bun:test";
import { isSteamIdAllowed, parseBetaAllowedSteamIds } from "./beta-allowlist";

describe("BETA_ALLOWED_STEAM_IDS", () => {
  test("sin valor o sólo espacios preserva el acceso normal", () => {
    expect(isSteamIdAllowed(35488109, undefined)).toBe(true);
    expect(isSteamIdAllowed(35488109, " ,  ")).toBe(true);
  });
  test("acepta IDs Steam32 separados por comas y espacios", () => {
    expect(isSteamIdAllowed(35488109, " 35488109, 123 ")).toBe(true);
    expect(isSteamIdAllowed(999, " 35488109, 123 ")).toBe(false);
  });
  test("una configuración malformada falla cerrada", () => {
    expect(parseBetaAllowedSteamIds("35488109, not-an-id").malformed).toBe(true);
    expect(isSteamIdAllowed(35488109, "35488109, not-an-id")).toBe(false);
    expect(isSteamIdAllowed(35488109, "0")).toBe(false);
    expect(isSteamIdAllowed(35488109, "4294967296")).toBe(false);
  });
});
