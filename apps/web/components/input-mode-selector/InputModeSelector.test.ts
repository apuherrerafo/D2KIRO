import { describe, expect, test } from "bun:test";
import type { DraftInputMode } from "@/features/draft/store";
import { isModeActive } from "./InputModeSelector";

describe("isModeActive", () => {
  test("Pick Radiant está activo solo con action:pick y side:radiant", () => {
    const mode: DraftInputMode = { action: "pick", side: "radiant" };
    expect(isModeActive(mode, "pick", "radiant")).toBe(true);
    expect(isModeActive(mode, "pick", "dire")).toBe(false);
    expect(isModeActive(mode, "ban")).toBe(false);
  });

  test("Pick Dire está activo solo con action:pick y side:dire", () => {
    const mode: DraftInputMode = { action: "pick", side: "dire" };
    expect(isModeActive(mode, "pick", "dire")).toBe(true);
    expect(isModeActive(mode, "pick", "radiant")).toBe(false);
  });

  test("Ban está activo con action:ban sin importar el side guardado", () => {
    expect(isModeActive({ action: "ban", side: "unknown" }, "ban")).toBe(true);
    expect(isModeActive({ action: "ban", side: "radiant" }, "ban")).toBe(true);
  });

  test("pick con side:unknown no deja ningún botón de Pick activo", () => {
    const mode: DraftInputMode = { action: "pick", side: "unknown" };
    expect(isModeActive(mode, "pick", "radiant")).toBe(false);
    expect(isModeActive(mode, "pick", "dire")).toBe(false);
    expect(isModeActive(mode, "ban")).toBe(false);
  });
});
