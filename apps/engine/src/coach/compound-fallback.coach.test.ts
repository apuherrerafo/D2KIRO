import { describe, expect, test } from "bun:test";
import type { TeamSide } from "../draft-protocol/types";
import type { HeroPositions } from "../signals/hero-positions";
import { harness, stripSession, type Harness } from "./session-harness.fixtures";

// AP Ranked Roles V1 / Wave 4A remediation -- Coach compound FALLBACK (MVP blocker: empty shortlist).
//
// Observed failure (soak, e.g. seed AUDIT033): two own seats open, own picks already made, and V6's whole top
// is heroes of ONE exclusive position (six Pos-1-only carries). No PAIR survives joint role assignment, so the
// compound construction returned nothing -> NO_LEGAL_HERO_UNIVERSE -> an empty shortlist, although each carry
// alone is a perfectly legal, role-feasible next pick. The fix degrades to the next SINGLE step and lets the Coach
// recompute after the Player picks it.
//
// Fixture world (all inline, no curated file): our round-1 picks are hero 2 (Pos 5) and hero 3 (Pos 4); the
// enemy takes 20/21. V6's fake ranks by pool order, so the round-2 top is eight Pos-1-only carries (11..18);
// hero 22 (Pos 2) is a feasible partner but sits OUTSIDE the 8-wide shortlist, exactly like the real case.

const SUPPORT_5 = 2;
const SUPPORT_4 = 3;
const ENEMY_A = 20;
const ENEMY_B = 21;
const CARRIES = [11, 12, 13, 14, 15, 16, 17, 18];
const MID = 22;
const OFFLANER = 23;

const POSITIONS: HeroPositions = {
  [SUPPORT_5]: [{ position: 5, matches: 1000 }],
  [SUPPORT_4]: [{ position: 4, matches: 1000 }],
  [ENEMY_A]: [{ position: 2, matches: 1000 }],
  [ENEMY_B]: [{ position: 3, matches: 1000 }],
  ...Object.fromEntries(CARRIES.map((hero) => [hero, [{ position: 1, matches: 1000 }]])),
  [MID]: [{ position: 2, matches: 1000 }],
  [OFFLANER]: [{ position: 3, matches: 1000 }],
  // Pos-5-only heroes: with hero 2 already holding Pos 5, they are infeasible even ALONE.
  40: [{ position: 5, matches: 1000 }],
  41: [{ position: 5, matches: 1000 }],
};
const POOL = [SUPPORT_5, SUPPORT_4, ENEMY_A, ENEMY_B, ...CARRIES, OFFLANER, MID];

function roundTwo(options: { side?: TeamSide; sessionId?: string; pool?: number[]; bans?: number[] } = {}): Harness {
  const h = harness({ side: options.side, sessionId: options.sessionId ?? "cf", heroPositions: POSITIONS, pool: options.pool ?? POOL, bans: options.bans, adapterKind: "simulator" });
  h.seal(h.side, 0, SUPPORT_5);
  h.seal(h.side, 1, SUPPORT_4);
  h.seal(h.enemy, 0, ENEMY_A);
  h.seal(h.enemy, 1, ENEMY_B); // round 1 closes; round 2 opens with two own seats
  return h;
}

const heroesOf = (output: { shortlist: { heroId: number }[] }): number[] => output.shortlist.map((card) => card.heroId);

describe("compound fallback -- no feasible pair, legal single step exists", () => {
  test("1. el estado que antes abortaba el draft (top de V6 = carries Pos-1-only) devuelve una salida accionable y no vacía", async () => {
    const { output, recommendationSet } = await roundTwo().compute();
    expect(recommendationSet.decision.actionCount).toBe(2); // both seats are still open: nothing about the decision was faked
    expect(output).not.toBeNull();
    expect(output!.shortlist.length).toBeGreaterThan(0);
    expect(heroesOf(output!).every((hero) => CARRIES.includes(hero))).toBe(true);
    expect(output!.primaryAction.label.length).toBeGreaterThan(0);
  });

  test("2. es un FALLBACK explícito: cada recomendación es de UN solo paso y el set lo declara (nunca un par fabricado)", async () => {
    const { recommendationSet } = await roundTwo().compute();
    expect(recommendationSet.recommendations.length).toBeGreaterThan(0);
    for (const recommendation of recommendationSet.recommendations) expect(recommendation.actions).toHaveLength(1);
    const reasons = recommendationSet.degradations.map((degradation) => degradation.reason);
    expect(reasons).toContain("COMPOUND_FALLBACK_SINGLE_STEP");
    expect(reasons).toContain("ROLE_ASSIGNMENT_IMPOSSIBLE"); // the pairs really were rejected first
    expect(reasons).not.toContain("NO_LEGAL_HERO_UNIVERSE");
    // PD-026/PD-027: this harness carries no `controlledPositions`, so slots get no position tag
    // at all (Simulator sessions without it are a legacy/degraded config, unreachable via the real
    // route) -- the slot NUMBER the fallback lands on is therefore no longer pinned to a fixed
    // chronology<->position schedule. What still must hold: every fallback action targets the SAME
    // single slot, consistently (deterministic construction, never split across seats).
    const slots = new Set(recommendationSet.recommendations.map((recommendation) => recommendation.actions[0]!.slot.slotIndex));
    expect(slots.size).toBe(1);
  });

  test("3. tras elegir la recomendación de fallback, el Coach recomputa para el asiento que queda", async () => {
    const h = roundTwo();
    const before = await h.compute();
    const chosen = heroesOf(before.output!)[0]!;
    const chosenSlot = before.recommendationSet.recommendations[0]!.actions[0]!.slot.slotIndex;
    h.seal(h.side, chosenSlot, chosen);
    const after = await h.compute();
    expect(after.trigger).toBe("OWN_PICK_CONFIRMED");
    expect(after.recommendationSet.decision.actionCount).toBe(1);
    expect(after.output).not.toBeNull();
    expect(after.output!.shortlist.length).toBeGreaterThan(0);
    expect(heroesOf(after.output!)).not.toContain(chosen);
    expect(after.recommendationSet.degradations.map((degradation) => degradation.reason)).not.toContain("COMPOUND_FALLBACK_SINGLE_STEP");
    expect(after.output!.meta.basedOn.stateIdentity).not.toBe(before.output!.meta.basedOn.stateIdentity);
  });

  test("4. las restricciones legales de rol siguen vigentes: un héroe infactible incluso SOLO nunca entra al fallback", async () => {
    // Heroes 40/41 are Pos-5-only and hero 2 already holds Pos 5. Put them at the top of V6.
    const h = roundTwo({ pool: [SUPPORT_5, SUPPORT_4, ENEMY_A, ENEMY_B, 40, 41, ...CARRIES] });
    const { output, recommendationSet } = await h.compute();
    expect(recommendationSet.degradations.map((degradation) => degradation.reason)).toContain("COMPOUND_FALLBACK_SINGLE_STEP");
    const offered = heroesOf(output!);
    expect(offered).not.toContain(40);
    expect(offered).not.toContain(41);
    expect(offered.length).toBeGreaterThan(0);
  });

  test("5a. sin NINGÚN héroe individual legal y factible sigue siendo un error explícito (no se inventa nada)", async () => {
    // Only infeasible heroes are left: no pair AND no single step.
    const h = roundTwo({ pool: [SUPPORT_5, SUPPORT_4, ENEMY_A, ENEMY_B, 40, 41] });
    const { output, recommendationSet } = await h.compute();
    expect(recommendationSet.recommendations).toEqual([]);
    const reasons = recommendationSet.degradations.map((degradation) => degradation.reason);
    expect(reasons).toContain("NO_LEGAL_HERO_UNIVERSE");
    expect(reasons).not.toContain("COMPOUND_FALLBACK_SINGLE_STEP");
    expect(output!.shortlist).toEqual([]);
  });

  test("5b. universo legal realmente vacío (todo baneado o elegido) -> NO_LEGAL_HERO_UNIVERSE, sin fallback", async () => {
    const h = roundTwo({ bans: CARRIES.concat([MID, OFFLANER]), pool: POOL });
    const { output, recommendationSet } = await h.compute();
    expect(recommendationSet.recommendations).toEqual([]);
    expect(recommendationSet.degradations.map((degradation) => degradation.reason)).toContain("NO_LEGAL_HERO_UNIVERSE");
    expect(output!.shortlist).toEqual([]);
  });

  test("6. el Player puede ignorar el fallback y elegir otro héroe legal: se acepta y el Coach recomputa normalmente", async () => {
    const h = roundTwo();
    const before = await h.compute();
    expect(heroesOf(before.output!)).not.toContain(MID);
    h.seal(h.side, 0, MID); // seal() throws when the kernel rejects: MID is legal though the Coach never offered it
    const after = await h.compute();
    expect(after.trigger).toBe("OWN_PICK_CONFIRMED");
    expect(after.output!.shortlist.length).toBeGreaterThan(0);
    expect(JSON.stringify(after.output)).not.toMatch(/wrong|incorrect|rechaz|equivoc/i);
  });

  test("7. información oculta del rival no influye: dos mundos que difieren sólo en picks rivales OCULTOS dan la misma salida, byte a byte", async () => {
    const x = roundTwo({ sessionId: "cf-twin" });
    const y = roundTwo({ sessionId: "cf-twin" });
    x.seal(x.enemy, 0, 30); // round-2 enemy selections stay HIDDEN until the round closes
    x.seal(x.enemy, 1, 31);
    y.seal(y.enemy, 0, 32);
    y.seal(y.enemy, 1, 33);
    const outX = await x.compute();
    const outY = await y.compute();
    expect(outX.recommendationSet.degradations.map((degradation) => degradation.reason)).toContain("COMPOUND_FALLBACK_SINGLE_STEP");
    expect(stripSession(outX)).toBe(stripSession(outY));
  });

  test("8. Radiant y Dire funcionan igual: mismo fallback, mismo shortlist", async () => {
    const radiant = await roundTwo({ side: "radiant", sessionId: "cf-side" }).compute();
    const dire = await roundTwo({ side: "dire", sessionId: "cf-side" }).compute();
    for (const result of [radiant, dire]) {
      expect(result.recommendationSet.degradations.map((degradation) => degradation.reason)).toContain("COMPOUND_FALLBACK_SINGLE_STEP");
      expect(result.output!.shortlist.length).toBeGreaterThan(0);
    }
    expect(heroesOf(dire.output!)).toEqual(heroesOf(radiant.output!));
  });

  test("9. el Hero Pool personal no cambia la construcción del fallback (aislamiento): mismo set V2 y mismos héroes, en el mismo orden", async () => {
    const h = roundTwo({ sessionId: "cf-pool" });
    const context = () => h.store.perspectiveRecommendationContext(h.id)!;
    const noPool = await h.coach.recompute({ context: context(), playerPersonalPosition: 2 });
    const withPool = await h.coach.recompute({ context: context(), playerPersonalPosition: 2, config: { heroPool: [MID, 18] } });
    expect(JSON.stringify(withPool.recommendationSet)).toBe(JSON.stringify(noPool.recommendationSet));
    expect(heroesOf(withPool.output!)).toEqual(heroesOf(noPool.output!));
  });

  test("regresión: si SÍ existe un par factible, la recomendación sigue siendo compuesta y no aparece el fallback", async () => {
    const h = roundTwo({ pool: [SUPPORT_5, SUPPORT_4, ENEMY_A, ENEMY_B, 11, OFFLANER, 12] }); // (11, 23) is a feasible pair (Pos 1 Carry + Pos 3 Offlane)
    const { recommendationSet } = await h.compute();
    expect(recommendationSet.recommendations.some((recommendation) => recommendation.actions.length === 2)).toBe(true);
    expect(recommendationSet.degradations.map((degradation) => degradation.reason)).not.toContain("COMPOUND_FALLBACK_SINGLE_STEP");
  });

  test("regresión: un asiento único (actionCount 1) no usa ni declara el fallback", async () => {
    const h = roundTwo();
    h.seal(h.side, 0, CARRIES[0]!);
    const { recommendationSet } = await h.compute();
    expect(recommendationSet.decision.actionCount).toBe(1);
    expect(recommendationSet.degradations.map((degradation) => degradation.reason)).not.toContain("COMPOUND_FALLBACK_SINGLE_STEP");
  });
});
