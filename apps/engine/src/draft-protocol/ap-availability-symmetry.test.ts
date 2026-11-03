import { describe, expect, test } from "bun:test";
import { applyProtocolCommand, createProtocolState, isSealedSelectionLegal, project } from "./index";
import type { DraftProtocolState, ProtocolCommand, TeamSide } from "./types";

// AP Ranked Roles V1 / Wave 1 Task 10 -- symmetric hero availability inside a round.
// A hero the OTHER side has secretly sealed this round is still available: the two picks are
// reconciled at reveal (collision), never by the second side finding the hero missing.

const PUCK = 14;
const LION = 26;

function start(): DraftProtocolState {
  const created = createProtocolState("symmetry", "dota2/ranked-all-pick");
  if (!created.ok) throw new Error("setup");
  return applyProtocolCommand(created.state, { type: "BAN_RESOLUTION_COMPLETE" }).state;
}

function submit(state: DraftProtocolState, side: TeamSide, slotIndex: number, heroId: number): DraftProtocolState {
  const command: ProtocolCommand = { type: "SUBMIT_SEALED_SELECTION", side, slotIndex, heroId };
  const result = applyProtocolCommand(state, command);
  if (result.rejected) throw new Error(`rejected: ${result.rejected}`);
  return result.state;
}

for (const [hider, seeker] of [["dire", "radiant"], ["radiant", "dire"]] as const) {
  describe(`${hider} sella Puck en secreto; ${seeker} sigue viendolo disponible`, () => {
    const state = submit(start(), hider, 0, PUCK);

    test("la vista de quien busca lo muestra HIDDEN, sin heroId", () => {
      const view = project(state, seeker);
      expect(view.enemyPicks).toEqual([{ visibility: "HIDDEN" }]);
      expect(JSON.stringify(view.enemyPicks)).not.toContain("heroId");
    });

    test("isSealedSelectionLegal(Puck) es true para quien busca", () => {
      expect(isSealedSelectionLegal(state, seeker, 0, PUCK)).toBe(true);
    });

    test("Puck no aparece en los bans de la vista", () => {
      expect(project(state, seeker).bannedHeroes).not.toContain(PUCK);
    });

    test("quien ya lo selecciono no puede volver a sellarlo (mismo lado, otro slot)", () => {
      expect(isSealedSelectionLegal(state, hider, 1, PUCK)).toBe(false);
    });
  });
}

describe("despues del reveal", () => {
  test("colision #1: Puck queda baneado y deja de estar disponible para ambos", () => {
    let state = start();
    state = submit(state, "radiant", 0, PUCK);
    state = submit(state, "radiant", 1, 1);
    state = submit(state, "dire", 0, PUCK);
    state = submit(state, "dire", 1, 2);
    expect(state.rankedAp?.bannedHeroes).toContain(PUCK);
    expect(state.rankedAp?.round?.collisionsResolved).toBe(1);
    expect(isSealedSelectionLegal(state, "radiant", 0, PUCK)).toBe(false);
    expect(isSealedSelectionLegal(state, "dire", 0, PUCK)).toBe(false);
    expect(project(state, "radiant").bannedHeroes).toContain(PUCK);
  });

  test("sin colision: los heroes revelados de ambos equipos salen del pool para las rondas siguientes", () => {
    let state = start();
    state = submit(state, "radiant", 0, PUCK);
    state = submit(state, "radiant", 1, 1);
    state = submit(state, "dire", 0, LION);
    state = submit(state, "dire", 1, 2);
    expect(state.rankedAp?.phase).toBe("PICK_ROUND_2");
    for (const hero of [PUCK, 1, LION, 2]) {
      expect(isSealedSelectionLegal(state, "radiant", 0, hero)).toBe(false);
      expect(isSealedSelectionLegal(state, "dire", 0, hero)).toBe(false);
    }
    expect(project(state, "radiant").enemyPicks.every((slot) => slot.visibility === "REVEALED")).toBe(true);
  });

  test("el contador de colisiones es por ronda y se reinicia en la siguiente", () => {
    let state = start();
    state = submit(state, "radiant", 0, PUCK);
    state = submit(state, "radiant", 1, 1);
    state = submit(state, "dire", 0, PUCK);
    state = submit(state, "dire", 1, 2);
    expect(state.rankedAp?.round?.collisionsResolved).toBe(1);
    state = submit(state, "radiant", 0, 3);
    state = submit(state, "dire", 0, 4);
    expect(state.rankedAp?.phase).toBe("PICK_ROUND_2");
    expect(state.rankedAp?.round?.collisionsResolved).toBe(0);
  });
});
