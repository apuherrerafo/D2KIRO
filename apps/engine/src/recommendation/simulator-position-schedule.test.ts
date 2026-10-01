import { describe, expect, test } from "bun:test";
import { buildRecommendationSetV2 } from "./build";
import { buildRecommendationSetFromPerspective } from "./build-from-perspective";
import { HERO_POSITIONS, fakeCompute, harness, type Harness } from "../coach/session-harness.fixtures";

// PD-026/PD-027 + WP1 regression lock. This file used to pin a FIXED chronology<->position schedule
// (R1 -> Pos5+Pos4, R2 -> Pos3+Pos1, R3 -> Pos2), and after that an ASCENDING zip of
// `humanOpenPositions` onto round slots (Party5 R1 -> Pos1+Pos2) -- both let round capacity decide
// WHICH positions were offered (INV-OWN-002). What replaces them (WP1, human-actionability.ts): the
// decision carries `humanActionability` -- every eligible human position, never truncated -- and
// exactly `roundCapacity` slots. PD-001: a generic human round slot is NEVER tagged with a position --
// not for Solo, Party2, Party3 nor Party5, whether or not every eligible position fits the round. The
// discriminator is still the session's real `adapterKind` (via
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

async function v3Decision(h: Harness, id: string) {
  const context = h.store.perspectiveRecommendationContext(id)!;
  return (await buildRecommendationSetFromPerspective({ context, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS })).decision;
}

describe("Simulator con controlledPositions: elegibilidad completa + capacidad de ronda, nunca un zip posición<->slot", () => {
  test("Party5 ronda 1, nada sellado: 5 posiciones elegibles, capacidad 2, slots SIN etiqueta (no Pos1+Pos2)", async () => {
    const id = "sim-early";
    const h = harness({ sessionId: id, adapterKind: "simulator", controlledPositions: [1, 2, 3, 4, 5] });
    const decision = await v3Decision(h, id);
    expect(decision.humanActionability).toEqual({ eligiblePositions: [1, 2, 3, 4, 5], roundCapacity: 2, hasHumanAction: true, noActionReason: null });
    expect(decision.actionCount).toBe(2);
    expect(await v3Positions(h, id)).toEqual([undefined, undefined]);
    expect(await legacyPositions(h, id)).toEqual([undefined, undefined]);
  });

  test("la elegibilidad se reduce con cada pick propio; los slots genéricos NUNCA llevan etiqueta de posición", async () => {
    const id = "sim-shrink";
    const h = harness({ sessionId: id, adapterKind: "simulator", controlledPositions: [1, 2, 3, 4, 5] });

    // Player deliberately picks Pos5 (Hard Support) and Pos3 (Offlane) FIRST, in round 1 -- the
    // exact non-chronological order PD-026/PD-027 exists to allow.
    const r1a = h.store.applyApSimulatorOwnSelection(id, { type: "SUBMIT_SEALED_SELECTION", side: h.side, slotIndex: 0, heroId: OWN_HEROES[0]! }, 5);
    if (!r1a.ok) throw new Error("setup");
    // After ONE pick, round 1 still has one own slot: the remaining FOUR positions stay eligible, capacity 1.
    expect((await v3Decision(h, id)).humanActionability).toEqual({ eligiblePositions: [1, 2, 3, 4], roundCapacity: 1, hasHumanAction: true, noActionReason: null });
    const r1b = h.store.applyApSimulatorOwnSelection(id, { type: "SUBMIT_SEALED_SELECTION", side: h.side, slotIndex: 1, heroId: OWN_HEROES[1]! }, 3);
    if (!r1b.ok) throw new Error("setup");
    const enemyR1a = h.store.apply(id, { type: "SUBMIT_SEALED_SELECTION", side: h.enemy, slotIndex: 0, heroId: ENEMY_HEROES[0]! });
    const enemyR1b = h.store.apply(id, { type: "SUBMIT_SEALED_SELECTION", side: h.enemy, slotIndex: 1, heroId: ENEMY_HEROES[1]! });
    if (!enemyR1a || enemyR1a.rejected || !enemyR1b || enemyR1b.rejected) throw new Error("setup");

    // Round 2: [1, 2, 4] eligible, capacity 2 -> untagged (3 positions do not fit 2 slots).
    expect(h.store.humanOpenPositions(id)).toEqual([1, 2, 4]);
    expect((await v3Decision(h, id)).humanActionability?.eligiblePositions).toEqual([1, 2, 4]);
    expect(await v3Positions(h, id)).toEqual([undefined, undefined]);
    expect(await legacyPositions(h, id)).toEqual([undefined, undefined]);

    const r2a = h.store.applyApSimulatorOwnSelection(id, { type: "SUBMIT_SEALED_SELECTION", side: h.side, slotIndex: 0, heroId: OWN_HEROES[2]! }, 1);
    if (!r2a.ok) throw new Error("setup");
    const r2b = h.store.applyApSimulatorOwnSelection(id, { type: "SUBMIT_SEALED_SELECTION", side: h.side, slotIndex: 1, heroId: OWN_HEROES[3]! }, 2);
    if (!r2b.ok) throw new Error("setup");
    const enemyR2a = h.store.apply(id, { type: "SUBMIT_SEALED_SELECTION", side: h.enemy, slotIndex: 0, heroId: ENEMY_HEROES[2]! });
    const enemyR2b = h.store.apply(id, { type: "SUBMIT_SEALED_SELECTION", side: h.enemy, slotIndex: 1, heroId: ENEMY_HEROES[3]! });
    if (!enemyR2a || enemyR2a.rejected || !enemyR2b || enemyR2b.rejected) throw new Error("setup");

    // Round 3: only Pos4 remains and it fits the round -- eligibility says [4], yet the generic round slot
    // stays positionless (PD-001). Proves the LAST-picked position is never forced into a fixed
    // "Pos2 always closes" schedule, and that a single eligible position is not a slot tag either.
    expect(h.store.humanOpenPositions(id)).toEqual([4]);
    expect((await v3Decision(h, id)).humanActionability).toEqual({ eligiblePositions: [4], roundCapacity: 1, hasHumanAction: true, noActionReason: null });
    expect(await v3Positions(h, id)).toEqual([undefined]);
    expect(await legacyPositions(h, id)).toEqual([undefined]);
  });

  // PD-001 -- G. Party2 Pos2+Pos5: every eligible position fits the round, and still NO slot is tagged.
  test("Party2 Pos2+Pos5 antes de sellar: elegibles [2,5], capacidad 2, ningún slot de ronda se presenta como Pos2/Pos5 (V2 y V3)", async () => {
    const id = "sim-party2";
    const h = harness({ sessionId: id, adapterKind: "simulator", controlledPositions: [2, 5] });
    const decision = await v3Decision(h, id);
    expect(decision.humanActionability).toEqual({ eligiblePositions: [2, 5], roundCapacity: 2, hasHumanAction: true, noActionReason: null });
    expect(decision.actionCount).toBe(2);
    expect(decision.controlledSlots.length).toBe(2);
    expect(await v3Positions(h, id)).toEqual([undefined, undefined]);
    expect(await legacyPositions(h, id)).toEqual([undefined, undefined]);
    for (const set of [
      await buildRecommendationSetFromPerspective({ context: h.store.perspectiveRecommendationContext(id)!, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS }),
      await buildRecommendationSetV2({
        state: h.store.get(id)!, view: h.store.view(id)!, actor: h.side, patch: "7.41e", computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS,
        isSimulator: true, controlledPositions: h.store.metadata(id)!.controlledPositions ?? undefined, humanOpenPositions: h.store.humanOpenPositions(id) ?? undefined,
      }),
    ]) {
      for (const recommendation of set.recommendations) for (const action of recommendation.actions) expect(action.slot.position).toBeUndefined();
    }
  });

  // PD-001 -- H. A synthetic single-target evaluation is explicitly scoped to its target; the placeholder
  // slot index it rides on never changes that target.
  test("evaluación sintética de un objetivo: lleva el objetivo explícito y cambiar el slot de relleno no lo cambia", async () => {
    const id = "sim-synthetic";
    const h = harness({ sessionId: id, adapterKind: "simulator", controlledPositions: [2, 5] });
    const evaluate = async (targetPosition: 2 | 5) => (await buildRecommendationSetFromPerspective({
      context: h.store.perspectiveRecommendationContext(id)!, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS, targetPosition, teamOpening: false, singleSlotEvaluation: true,
    })).decision;
    const first = await evaluate(2);
    expect(first.controlledSlots).toHaveLength(1);
    expect(first.controlledSlots[0]!.position).toBe(2);
    const firstSlotIndex = first.controlledSlots[0]!.slotIndex;

    // Seal own slot 0 as Pos5 -> the only open own slot is now a different slot index.
    const sealed = h.store.applyApSimulatorOwnSelection(id, { type: "SUBMIT_SEALED_SELECTION", side: h.side, slotIndex: 0, heroId: OWN_HEROES[0]! }, 5);
    if (!sealed.ok) throw new Error("setup");
    const second = await evaluate(2);
    expect(second.controlledSlots[0]!.slotIndex).not.toBe(firstSlotIndex);
    expect(second.controlledSlots[0]!.position).toBe(2);
    // The explicit target is whatever the caller scoped, independent of the slot it rides on.
    expect((await evaluate(5)).controlledSlots[0]!.position).toBe(5);
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
