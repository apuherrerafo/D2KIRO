import { describe, expect, test } from "bun:test";
import { harness, HERO_POSITIONS } from "./session-harness.fixtures";
import { buildCoachObservableState } from "./observable-state";
import { known, view } from "./test.fixtures";

// Wave 3 tasks 20-23: the personal set is a second V6 construction, not a post-filter of the
// team shortlist. These assertions intentionally use the perspective-safe harness only.
describe("PersonalHeroView", () => {
  test("team advice can reveal Pos5 while TU MID AHORA independently contains only Mid candidates", async () => {
    const h = harness({ humanPosition: 2 });
    const result = await h.compute(2);
    expect(result.output!.primaryAction.strategy).toMatchObject({ kind: "REVEAL_POSITION", position: 5 });
    expect(result.output!.personalHeroView!.position).toBe(2);
    expect(result.output!.personalHeroView!.heroes.map((hero) => hero.heroId)).toEqual([4, 6]);
    expect(result.output!.shortlist.map((hero) => hero.heroId)).not.toContain(6);
    expect(result.personalRecommendationSet).toBeDefined();
  });

  test("personal set recalculates after an own visible pick and after a revealed enemy", async () => {
    const h = harness({ humanPosition: 2 });
    const before = await h.compute(2);
    h.seal(h.side, 0, 1);
    const afterPick = await h.compute(2);
    expect(afterPick.output!.meta.basedOn.stateIdentity).not.toBe(before.output!.meta.basedOn.stateIdentity);
    h.seal(h.side, 1, 2);
    h.seal(h.enemy, 0, 9);
    h.seal(h.enemy, 1, 10);
    const afterReveal = await h.compute(2);
    expect(afterReveal.output!.personalHeroView!.heroes.length).toBeGreaterThan(0);
    expect(afterReveal.output!.meta.basedOn.stateIdentity).not.toBe(afterPick.output!.meta.basedOn.stateIdentity);
  });

  test("without a configured pool the personal view remains useful and every pool signal abstains", async () => {
    const h = harness({ humanPosition: 2 });
    const result = await h.compute(2);
    expect(result.output!.personalHeroView!.heroes.length).toBeGreaterThan(0);
    expect(result.output!.outsidePoolRecommendation).toBeUndefined(); // no uncalibrated score-gap threshold
  });
});

describe("own/enemy flex role beliefs", () => {
  test("a flexible own hero remains LIKELY across two roles until an explicit compatible assignment", async () => {
    const h = harness();
    h.seal(h.side, 0, 6);
    const context = h.store.perspectiveRecommendationContext(h.id)!;
    const before = await h.coach.onOwnPickConfirmed({ context, playerPersonalPosition: 2 });
    expect(before.coachState.ownRoleBeliefs.get(6)!.status).toBe("LIKELY");
    expect(before.output!.roleBeliefs.own.find((belief) => belief.heroId === 6)!.positions).toEqual([2, 3]);
    const after = await h.coach.onPlayerPositionAssigned({ context, playerPersonalPosition: 2 }, 6, 3);
    expect(after.coachState.ownRoleBeliefs.get(6)!.status).toBe("CONFIRMED");
  });

  test("explicit assignments alone become structural occupancy; soft beliefs never self-confirm", () => {
    const v = view("PICK_ROUND_2", [known(6), known(4)], []);
    const state = buildCoachObservableState(v, { heroPositions: HERO_POSITIONS, playerPositionAssignments: new Map([[4, 2 as const]]) });
    expect(state.ownRoleBeliefs.get(6)!.status).toBe("LIKELY");
    expect(state.ownRoleBeliefs.get(6)!.probabilities[2]).toBe(0);
    expect(state.ownRoleBeliefs.get(6)!.probabilities[3]).toBe(1);
  });

  test("an incompatible manual assignment is ignored safely", async () => {
    const h = harness();
    h.seal(h.side, 0, 6);
    const context = h.store.perspectiveRecommendationContext(h.id)!;
    const result = await h.coach.onPlayerPositionAssigned({ context }, 6, 5);
    expect(result.coachState.playerPositionAssignments.has(6)).toBe(false);
    expect(result.coachState.ownRoleBeliefs.get(6)!.status).toBe("LIKELY");
  });
});
