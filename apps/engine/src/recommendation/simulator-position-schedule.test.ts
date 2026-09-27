import { describe, expect, test } from "bun:test";
import { buildRecommendationSetV2 } from "./build";
import { buildRecommendationSetFromPerspective } from "./build-from-perspective";
import { HERO_POSITIONS, fakeCompute, harness, type Harness } from "../coach/session-harness.fixtures";

// PD-026/PD-027 regression lock. This file used to pin a FIXED chronology<->position schedule
// (R1 -> Pos5+Pos4, R2 -> Pos3+Pos1, R3 -> Pos2) -- that schedule is deleted repo-wide (position !=
// pick chronology). What replaces it: recommendation slot `.position` tags are driven by
// `humanOpenPositions` (the session's still-unfilled human-controlled positions, ascending order),
// never by round/slotIndex. The discriminator is still the session's real `adapterKind` (via
// `store.isSimulator`) AND `controlledPositions` being set -- Manual Live always carries a
// partyContext and must get no tags; a Simulator session without `controlledPositions` (legacy,
// unreachable through the real route since PD-026/PD-027) also gets no tags, degrading safely.

type Round = 1 | 2 | 3;
const OWN_HEROES = [3, 4, 5, 6, 7];
const ENEMY_HEROES = [11, 12, 13, 14, 15];

async function legacyPositions(h: Harness, id: string): Promise<(number | null | undefined)[]> {
  const set = await buildRecommendationSetV2({
    state: h.store.get(id)!,
    view: h.store.view(id)!,
    actor: h.side,
    patch: "7.41e",
    computeSuggestions: fakeCompute(),
    heroPositions: HERO_POSITIONS,
    isSimulator: h.store.isSimulator(id),
    controlledPositions: h.store.metadata(id)!.controlledPositions ?? undefined,
    humanOpenPositions: h.store.humanOpenPositions(id) ?? undefined,
  });
  return set.decision.controlledSlots.map((slot) => slot.position);
}

async function v3Positions(h: Harness, id: string): Promise<(number | null | undefined)[]> {
  const context = h.store.perspectiveRecommendationContext(id)!;
  const set = await buildRecommendationSetFromPerspective({ context, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS });
  return set.decision.controlledSlots.map((slot) => slot.position);
}

describe("Manual Live con partyContext: sin etiquetas de posición derivadas del Simulador", () => {
  for (const round of [1, 2, 3] as Round[]) {
    test(`ronda ${round}: partyContext solo NO activa el mapeo posicional (V3 y V2)`, async () => {
      const id = `manual-r${round}`;
      const h = harness({ sessionId: id, adapterKind: "manual" });
      // Manual sessions never bind via the AP atomic op -- direct kernel seal is the real path for them.
      const rosterOrder = [[0, 1], [0, 1], [0]];
      let own = 0;
      for (let closed = 1; closed < round; closed++) {
        for (const slotIndex of rosterOrder[closed - 1]!) {
          h.seal(h.side, slotIndex, OWN_HEROES[own]!);
          h.seal(h.enemy, slotIndex, ENEMY_HEROES[own]!);
          own++;
        }
      }
      expect(h.store.isSimulator(id)).toBe(false);
      expect(h.store.perspectiveRecommendationContext(id)!.partyContext).not.toBeNull();
      const v3 = await v3Positions(h, id);
      const v2 = await legacyPositions(h, id);
      expect(v3.length).toBeGreaterThan(0);
      expect(v3.every((position) => position === undefined)).toBe(true);
      expect(v2.every((position) => position === undefined)).toBe(true);
    });
  }
});

describe("Simulator con controlledPositions: la etiqueta de posición sigue a humanOpenPositions, nunca a round/slotIndex", () => {
  test("nada sellado todavia: humanOpenPositions = las 5 controladas -> ronda 1 etiqueta Pos1 + Pos2 (orden ascendente, no cronologico)", async () => {
    const id = "sim-early";
    const h = harness({ sessionId: id, adapterKind: "simulator", controlledPositions: [1, 2, 3, 4, 5] });
    expect(await v3Positions(h, id)).toEqual([1, 2]);
    expect(await legacyPositions(h, id)).toEqual([1, 2]);
  });

  test("humanOpenPositions se reduce con cada pick propio, y la etiqueta de las rondas siguientes refleja SOLO lo que queda", async () => {
    const id = "sim-shrink";
    const h = harness({ sessionId: id, adapterKind: "simulator", controlledPositions: [1, 2, 3, 4, 5] });

    // Before any pick: all 5 open -> round 1's two slots tag Pos1 + Pos2 (ascending).
    expect(await v3Positions(h, id)).toEqual([1, 2]);
    expect(await legacyPositions(h, id)).toEqual([1, 2]);

    // Player deliberately picks Pos5 (Hard Support) and Pos3 (Offlane) FIRST, in round 1 -- the
    // exact non-chronological order PD-026/PD-027 exists to allow.
    const r1a = h.store.applyApSimulatorOwnSelection(id, { type: "SUBMIT_SEALED_SELECTION", side: h.side, slotIndex: 0, heroId: OWN_HEROES[0]! }, 5);
    if (!r1a.ok) throw new Error("setup");
    const r1b = h.store.applyApSimulatorOwnSelection(id, { type: "SUBMIT_SEALED_SELECTION", side: h.side, slotIndex: 1, heroId: OWN_HEROES[1]! }, 3);
    if (!r1b.ok) throw new Error("setup");
    const enemyR1a = h.store.apply(id, { type: "SUBMIT_SEALED_SELECTION", side: h.enemy, slotIndex: 0, heroId: ENEMY_HEROES[0]! });
    const enemyR1b = h.store.apply(id, { type: "SUBMIT_SEALED_SELECTION", side: h.enemy, slotIndex: 1, heroId: ENEMY_HEROES[1]! });
    if (!enemyR1a || enemyR1a.rejected || !enemyR1b || enemyR1b.rejected) throw new Error("setup");

    // Now in round 2: humanOpenPositions = [1, 2, 4] (5 and 3 are bound) -> ascending tags Pos1 + Pos2.
    expect(await v3Positions(h, id)).toEqual([1, 2]);
    expect(await legacyPositions(h, id)).toEqual([1, 2]);
    expect(h.store.humanOpenPositions(id)).toEqual([1, 2, 4]);

    const r2a = h.store.applyApSimulatorOwnSelection(id, { type: "SUBMIT_SEALED_SELECTION", side: h.side, slotIndex: 0, heroId: OWN_HEROES[2]! }, 1);
    if (!r2a.ok) throw new Error("setup");
    const r2b = h.store.applyApSimulatorOwnSelection(id, { type: "SUBMIT_SEALED_SELECTION", side: h.side, slotIndex: 1, heroId: OWN_HEROES[3]! }, 2);
    if (!r2b.ok) throw new Error("setup");
    const enemyR2a = h.store.apply(id, { type: "SUBMIT_SEALED_SELECTION", side: h.enemy, slotIndex: 0, heroId: ENEMY_HEROES[2]! });
    const enemyR2b = h.store.apply(id, { type: "SUBMIT_SEALED_SELECTION", side: h.enemy, slotIndex: 1, heroId: ENEMY_HEROES[3]! });
    if (!enemyR2a || enemyR2a.rejected || !enemyR2b || enemyR2b.rejected) throw new Error("setup");

    // Round 3: only Pos4 remains -- proves the LAST-picked position is never forced into a fixed
    // "Pos2 always closes" schedule; here it's Pos4 that closes, because that's what the human left.
    expect(h.store.humanOpenPositions(id)).toEqual([4]);
    expect(await v3Positions(h, id)).toEqual([4]);
    expect(await legacyPositions(h, id)).toEqual([4]);
  });

  test("sin controlledPositions (legacy, inalcanzable por la ruta real): Simulator no etiqueta ninguna posición -- degrada, nunca inventa una", async () => {
    const id = "sim-legacy";
    const h = harness({ sessionId: id, adapterKind: "simulator" }); // no controlledPositions
    h.seal(h.side, 0, OWN_HEROES[0]!);
    h.seal(h.enemy, 0, ENEMY_HEROES[0]!);
    expect(h.store.isSimulator(id)).toBe(true);
    expect(await v3Positions(h, id)).toEqual([undefined]);
    expect(await legacyPositions(h, id)).toEqual([undefined]);
  });
});
