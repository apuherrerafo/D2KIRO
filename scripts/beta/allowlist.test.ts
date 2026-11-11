import { describe, expect, test } from "bun:test";
import { addToAllowlist, parseAllowlist, parseSteamInput, removeFromAllowlist } from "./allowlist";

// Vectores inline (sin cuentas reales): 76561197960265729 -> Steam32 1 ; 76561198000000001 -> 39734273.
describe("parseSteamInput", () => {
  test("SteamID64 se convierte con BigInt, no con Number", () => {
    const naive = Number("76561198000000001") - Number("76561197960265728");
    const parsed = parseSteamInput("76561198000000001");
    expect(parsed).toEqual({ ok: true, steam32: 39734273 });
    expect(naive).toBe(39734272); // la aritmética con Number pierde precisión sin avisar
  });

  test("acepta Steam32 y link /profiles/<id64>", () => {
    expect(parseSteamInput("39734273")).toEqual({ ok: true, steam32: 39734273 });
    expect(parseSteamInput("https://steamcommunity.com/profiles/76561198000000001/")).toEqual({ ok: true, steam32: 39734273 });
  });

  test("rechaza vanity, texto y fuera de rango", () => {
    expect(parseSteamInput("https://steamcommunity.com/id/alguien").ok).toBe(false);
    expect(parseSteamInput("abc").ok).toBe(false);
    expect(parseSteamInput("0").ok).toBe(false);
    expect(parseSteamInput("99999999999").ok).toBe(false);
  });
});

describe("lista de la beta", () => {
  test("agregar es idempotente y conserva el orden", () => {
    const first = addToAllowlist("100", 200);
    expect(first).toEqual({ next: "100,200", changed: true, count: 2 });
    expect(addToAllowlist(first.next, 200)).toEqual({ next: "100,200", changed: false, count: 2 });
  });

  test("retirar no deja la lista vacía", () => {
    expect(removeFromAllowlist("100,200", 200)).toEqual({ next: "100", changed: true, count: 1 });
    expect(() => removeFromAllowlist("100", 100)).toThrow();
  });

  test("una lista actual corrupta no se toca", () => {
    expect(() => parseAllowlist("100,abc")).toThrow();
    expect(() => addToAllowlist("100,,x", 5)).toThrow();
  });
});
