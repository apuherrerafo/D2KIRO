import { describe, expect, test } from "bun:test";
import type { DraftInputMode } from "./store";
import { buildDraftEvent } from "./use-submit-draft-event";

describe("buildDraftEvent", () => {
  test("modo pick con lado conocido produce hero_picked al lado correcto", () => {
    const mode: DraftInputMode = { action: "pick", side: "radiant" };

    expect(buildDraftEvent(mode, 42)).toEqual({ type: "hero_picked", hero: 42, side: "radiant" });
  });

  test("modo pick sin lado identificado no produce ningún evento", () => {
    const mode: DraftInputMode = { action: "pick", side: "unknown" };

    expect(buildDraftEvent(mode, 42)).toBeNull();
  });

  test("modo ban con lado desconocido produce hero_banned side:unknown", () => {
    const mode: DraftInputMode = { action: "ban", side: "unknown" };

    expect(buildDraftEvent(mode, 7)).toEqual({ type: "hero_banned", hero: 7, side: "unknown" });
  });

  test("modo ban ignora el lado del modo -- ningún flujo manual expone quién baneó", () => {
    const mode: DraftInputMode = { action: "ban", side: "dire" };

    expect(buildDraftEvent(mode, 7)).toEqual({ type: "hero_banned", hero: 7, side: "unknown" });
  });
});
