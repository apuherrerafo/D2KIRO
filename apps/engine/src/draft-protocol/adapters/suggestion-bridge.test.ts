import { describe, expect, test } from "bun:test";
import { applyProtocolCommand, createProtocolState, project } from "../kernel";
import { derivePerspectiveSuggestionInputs, perspectiveToLegacyDraftState } from "./suggestion-bridge";

describe("derivePerspectiveSuggestionInputs / perspectiveToLegacyDraftState -- S2.2 hidden-info fix", () => {
  test("un pick sellado propio del oponente NUNCA aparece en el bridge de un viewer distinto", () => {
    const created = createProtocolState("bridge-1", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup failed");
    let state = applyProtocolCommand(created.state, { type: "BAN_RESOLUTION_COMPLETE" }).state;
    // Radiant seals a pick; Dire has not sealed anything yet in this round.
    state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 42 }).state;

    const direView = project(state, "dire");
    const inputs = derivePerspectiveSuggestionInputs(direView);
    // The type itself makes this true (HIDDEN carries no heroId) -- this assertion is the
    // behavioral proof that the bridge's OUTPUT never contains it either.
    expect(inputs.enemyPicks).not.toContain(42);
    expect(inputs.ownPicks).toEqual([]);

    const legacyState = perspectiveToLegacyDraftState(direView, { patch: "7.41e" });
    expect(legacyState.picks.radiant).not.toContain(42);
    expect(legacyState.picks.dire).not.toContain(42);
  });

  test("el propio pick sellado SÍ es visible para uno mismo (KNOWN), nunca para el rival", () => {
    const created = createProtocolState("bridge-2", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup failed");
    let state = applyProtocolCommand(created.state, { type: "BAN_RESOLUTION_COMPLETE" }).state;
    state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 77 }).state;

    const radiantView = project(state, "radiant");
    const inputs = derivePerspectiveSuggestionInputs(radiantView);
    expect(inputs.ownPicks).toContain(77);

    const direView = project(state, "dire");
    expect(derivePerspectiveSuggestionInputs(direView).enemyPicks).not.toContain(77);
  });

  test("picks confirmados (revelados) sí cruzan al bridge del rival", () => {
    const created = createProtocolState("bridge-3", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup failed");
    let state = applyProtocolCommand(created.state, { type: "BAN_RESOLUTION_COMPLETE" }).state;
    // Fill round 1 entirely with distinct heroes so it resolves and confirms/reveals immediately.
    state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 1 }).state;
    state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1, heroId: 2 }).state;
    state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 3 }).state;
    state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 1, heroId: 4 }).state;

    const direView = project(state, "dire");
    const legacyState = perspectiveToLegacyDraftState(direView, { patch: "7.41e" });
    expect(legacyState.picks.dire.sort()).toEqual([3, 4]);
    expect(legacyState.picks.radiant.sort()).toEqual([1, 2]);
    expect(legacyState.format).toBe("all_pick");
  });

  test("bans siempre visibles a cualquier viewer, incluido null (espectador)", () => {
    const created = createProtocolState("bridge-4", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup failed");
    let state = applyProtocolCommand(created.state, { type: "RECORD_RESOLVED_BANS", heroes: [10, 11] }).state;
    state = applyProtocolCommand(state, { type: "BAN_RESOLUTION_COMPLETE" }).state;

    const spectatorView = project(state, null);
    const bridged = perspectiveToLegacyDraftState(spectatorView, { patch: "7.41e" });
    expect(bridged.banned.sort()).toEqual([10, 11]);
    expect(bridged.localSide).toBe("unknown");
    // Spectator degrades to an empty board rather than guessing a radiant/dire split it cannot
    // attribute correctly (project(state, null) merges both sides into one undifferentiated list).
    expect(bridged.picks).toEqual({ radiant: [], dire: [] });
  });

  test("captains-mode se mapea a format captains_mode", () => {
    const created = createProtocolState("bridge-5", "dota2/captains-mode");
    if (!created.ok) throw new Error("setup failed");
    const state = applyProtocolCommand(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }).state;
    const view = project(state, "radiant");
    expect(perspectiveToLegacyDraftState(view, { patch: "7.40" }).format).toBe("captains_mode");
  });
});
