import { describe, expect, test } from "bun:test";
import { buildRecommendationSetV2 } from "./build";
import { buildRecommendationSetFromPerspective } from "./build-from-perspective";
import { HERO_POSITIONS, fakeCompute, harness, type Harness } from "../coach/session-harness.fixtures";

// Regression locks for the Simulator-only positional schedule (R1 -> Pos5+Pos4, R2 -> Pos3+Pos1,
// R3 -> Pos2). The discriminator is the session's real `adapterKind` (via `store.isSimulator`), NOT
// the mere presence of a `partyContext` -- Manual Live always carries one and must get no tags.

type Round = 1 | 2 | 3;
const OWN_HEROES = [3, 4, 5, 6, 7];
const ENEMY_HEROES = [11, 12, 13, 14, 15];

function advanceTo(h: Harness, round: Round) {
  const rosterOrder = [[0, 1], [0, 1], [0]];
  let own = 0;
  for (let closed = 1; closed < round; closed++) {
    for (const slotIndex of rosterOrder[closed - 1]!) {
      h.seal(h.side, slotIndex, OWN_HEROES[own]!);
      h.seal(h.enemy, slotIndex, ENEMY_HEROES[own]!);
      own++;
    }
  }
}

async function legacyPositions(h: Harness, id: string): Promise<(number | null | undefined)[]> {
  const set = await buildRecommendationSetV2({
    state: h.store.get(id)!,
    view: h.store.view(id)!,
    actor: h.side,
    patch: "7.41e",
    computeSuggestions: fakeCompute(),
    heroPositions: HERO_POSITIONS,
    isSimulator: h.store.isSimulator(id),
  });
  return set.decision.controlledSlots.map((slot) => slot.position);
}

async function v3Positions(h: Harness, id: string): Promise<(number | null | undefined)[]> {
  const context = h.store.perspectiveRecommendationContext(id)!;
  const set = await buildRecommendationSetFromPerspective({ context, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS });
  return set.decision.controlledSlots.map((slot) => slot.position);
}

const SCHEDULE: readonly (readonly [Round, number[]])[] = [
  [1, [5, 4]],
  [2, [3, 1]],
  [3, [2]],
];

describe("Manual Live con partyContext: sin etiquetas de posición derivadas del Simulador", () => {
  for (const [round] of SCHEDULE) {
    test(`ronda ${round}: partyContext solo NO activa el mapeo posicional (V3 y V2)`, async () => {
      const id = `manual-r${round}`;
      const h = harness({ sessionId: id, adapterKind: "manual" });
      advanceTo(h, round);
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

describe("Simulator: calendario posicional exacto", () => {
  for (const [round, expected] of SCHEDULE) {
    test(`V3 (Coach) ronda ${round} -> ${expected.map((p) => `Pos${p}`).join(" + ")}`, async () => {
      const id = `sim-v3-r${round}`;
      const h = harness({ sessionId: id, adapterKind: "simulator" });
      advanceTo(h, round);
      expect(h.store.isSimulator(id)).toBe(true);
      expect(await v3Positions(h, id)).toEqual(expected);
    });

    test(`V2 legacy ronda ${round} -> ${expected.map((p) => `Pos${p}`).join(" + ")}`, async () => {
      const id = `sim-v2-r${round}`;
      const h = harness({ sessionId: id, adapterKind: "simulator" });
      advanceTo(h, round);
      expect(await legacyPositions(h, id)).toEqual(expected);
    });
  }
});
