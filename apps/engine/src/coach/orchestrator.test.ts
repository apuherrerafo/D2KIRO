import { describe, expect, test } from "bun:test";
import { buildRecommendationSetFromPerspective } from "../recommendation/build-from-perspective";
import { CoachOrchestrator } from "./orchestrator";
import { HERO_COUNTERING_ENEMY_9, HERO_POSITIONS, fakeCompute, harness, POOL, stripSession } from "./session-harness.fixtures";

// AP Ranked Roles V1 / Wave 2 (tasks 14, 19) -- the Coach orchestrated over the real kernel, the real
// ProtocolSessionStore and the real PERSPECTIVE-SAFE recommendation path (see session-harness.fixtures.ts).

describe("Coach orchestration over the real kernel", () => {
  test("INITIAL: al abrir la fase de picks ya hay una acción primaria y una shortlist, antes del primer pick del Player", async () => {
    const h = harness();
    const first = await h.compute();
    expect(first.trigger).toBe("DRAFT_PICKS_STARTED");
    expect(first.output!.primaryAction.label.length).toBeGreaterThan(0);
    expect(first.output!.primaryAction.strategy.kind).not.toBe("OPPORTUNITY");
    expect(first.output!.shortlist.length).toBeGreaterThan(0);
    expect(first.output!.meta).toMatchObject({ round: 1, ownPicksRemaining: 5, decisionContext: "team_opening" });
  });

  test("ROL A NIVEL DE POSICIÓN sin héroe: la acción inicial puede ser REVEAL_POSITION sin heroId", async () => {
    const h = harness();
    const output = (await h.compute()).output!;
    expect(output.primaryAction.strategy.kind).toBe("REVEAL_POSITION");
    expect(output.primaryAction.strategy).not.toHaveProperty("heroId");
  });

  test("OWN PICK #1: recomputa YA, antes del reveal rival, con una nueva identidad de estado", async () => {
    const h = harness();
    const before = await h.compute();
    const chosen = before.output!.shortlist[0]!.heroId;
    h.seal(h.side, 0, chosen);

    const context = h.store.perspectiveRecommendationContext(h.id)!;
    expect(context.view.enemyPicks.every((slot) => slot.visibility === "HIDDEN")).toBe(true); // no enemy reveal has happened
    const after = await h.coach.onOwnPickConfirmed({ context, playerPersonalPosition: 2 });

    expect(after.trigger).toBe("OWN_PICK_CONFIRMED");
    expect(after.output!.meta.basedOn.stateIdentity).not.toBe(before.output!.meta.basedOn.stateIdentity);
    expect(after.output!.meta.ownPicksRemaining).toBe(4);
    expect(after.output!.meta.decisionContext).toBe("blind_second_pick");
    expect(after.output!.shortlist.map((card) => card.heroId)).not.toContain(chosen);
    expect(after.output!.meta.revision).toBeGreaterThan(before.output!.meta.revision);
  });

  test("el trigger se deriva de lo que cambió: pick propio -> OWN_PICK_CONFIRMED; reveal -> ROUND_REVEALED; nada -> REFRESH", async () => {
    const h = harness();
    await h.compute();
    h.seal(h.side, 0, 1);
    expect((await h.compute()).trigger).toBe("OWN_PICK_CONFIRMED");
    expect((await h.compute()).trigger).toBe("REFRESH");
    h.seal(h.side, 1, 2);
    h.seal(h.enemy, 0, 9);
    h.seal(h.enemy, 1, 10);
    expect((await h.compute()).trigger).toBe("ROUND_REVEALED");
  });

  test("HIDDEN ENEMY ISOLATION: dos verdades del Simulator que difieren SÓLO en el héroe rival oculto -> el Coach produce lo mismo, byte a byte", async () => {
    const x = harness({ sessionId: "twin" });
    const y = harness({ sessionId: "twin" });
    x.seal(x.enemy, 0, 9);
    y.seal(y.enemy, 0, 10); // a different hidden identity, same slot
    x.seal(x.side, 0, 1);
    y.seal(y.side, 0, 1);
    const outX = await x.compute();
    const outY = await y.compute();
    expect(stripSession(outX)).toBe(stripSession(outY));
    // ...including everything the Coach itself believed.
    expect(JSON.stringify([...outX.coachState.enemyRoleBeliefs])).toBe(JSON.stringify([...outY.coachState.enemyRoleBeliefs]));
  });

  test("HIDDEN ENEMY ISOLATION (disponibilidad): un héroe que el rival sella en secreto sigue siendo recomendable para el Player", async () => {
    const h = harness();
    h.seal(h.enemy, 0, 3); // hero 3 sealed by the enemy, still hidden
    const output = (await h.compute()).output!;
    const all = new Set([...output.shortlist.map((card) => card.heroId)]);
    const unhidden = await harness().compute();
    // The shortlist must be exactly what it would be with NOTHING sealed by the enemy.
    expect(output.shortlist.map((card) => card.heroId)).toEqual(unhidden.output!.shortlist.map((card) => card.heroId));
    expect(all.size).toBeGreaterThan(0);
  });

  test("REVEAL CAMBIA EL CONSEJO: tras revelarse el héroe rival 9 el héroe que lo contrarresta aparece con su insignia COUNTER; antes no", async () => {
    const h = harness({ sessionId: "reveal" });
    h.seal(h.side, 0, 1);
    h.seal(h.enemy, 0, 9);
    const preReveal = await h.compute();
    expect(preReveal.output!.shortlist.flatMap((card) => card.badges)).not.toContain("COUNTER");
    expect(preReveal.coachState.enemyRoleBeliefs.has(9)).toBe(false); // hidden: the Coach does not even know it exists

    h.seal(h.side, 1, 2);
    h.seal(h.enemy, 1, 10);
    const postReveal = await h.coach.onRoundReveal({ context: h.store.perspectiveRecommendationContext(h.id)!, playerPersonalPosition: 2 });
    expect(postReveal.trigger).toBe("ROUND_REVEALED");
    expect(postReveal.output!.meta.basedOn.stateIdentity).not.toBe(preReveal.output!.meta.basedOn.stateIdentity);
    expect(postReveal.coachState.enemyRoleBeliefs.has(9)).toBe(true); // now legal evidence
    const counterCard = postReveal.output!.shortlist.find((card) => card.heroId === HERO_COUNTERING_ENEMY_9);
    expect(counterCard?.badges).toContain("COUNTER");
    expect(postReveal.output!.shortlist[0]!.heroId).toBe(HERO_COUNTERING_ENEMY_9); // the revealed hero legally reshapes the options
  });

  test("el mismo héroe oculto X vs Y diverge SÓLO tras el reveal", async () => {
    const x = harness({ sessionId: "diverge" });
    const y = harness({ sessionId: "diverge" });
    for (const [h, hidden] of [[x, 9], [y, 6]] as const) {
      h.seal(h.enemy, 0, hidden);
      h.seal(h.enemy, 1, 10);
      h.seal(h.side, 0, 1);
    }
    expect(stripSession(await x.compute())).toBe(stripSession(await y.compute())); // still hidden
    for (const h of [x, y]) h.seal(h.side, 1, 2); // round closes -> enemy heroes revealed
    expect(stripSession(await x.compute())).not.toBe(stripSession(await y.compute()));
  });

  test("INTERNAL ENEMY ROLE ISOLATION: distinto seed (=> distintas asignaciones privadas del Enemy Bot) con el mismo estado visible -> misma salida", async () => {
    // The Coach reads a PerspectiveDraftView only. The Simulator seed also derives the Enemy Bot's private seat
    // positions; two sessions with different seeds but identical visible state must therefore be indistinguishable.
    const a = harness({ sessionId: "iso", seed: "AAAA0001", humanPosition: 1 });
    const b = harness({ sessionId: "iso", seed: "ZZZZ9999", humanPosition: 1 });
    for (const h of [a, b]) {
      h.seal(h.enemy, 0, 9);
      h.seal(h.side, 0, 3);
    }
    expect(stripSession(await a.compute())).toBe(stripSession(await b.compute()));
  });

  test("PLAYER DEVIATION: el Player elige un héroe distinto del sugerido, el kernel lo acepta y el Coach recomputa sin rechazo ni aviso", async () => {
    const h = harness();
    const before = await h.compute();
    const suggested = new Set(before.output!.shortlist.map((card) => card.heroId));
    const other = POOL.find((hero) => !suggested.has(hero));
    const chosen = other ?? POOL.find((hero) => hero !== before.output!.shortlist[0]!.heroId)!;
    h.seal(h.side, 0, chosen); // seal() throws if the kernel rejected it
    const after = await h.compute();
    expect(after.trigger).toBe("OWN_PICK_CONFIRMED");
    expect(after.output!.shortlist.map((card) => card.heroId)).not.toContain(chosen);
    expect(after.output!.primaryAction.label.length).toBeGreaterThan(0);
    expect(JSON.stringify(after.output)).not.toMatch(/wrong|incorrect|error|rechaz|equivoc/i);
  });

  test("RADIANT y DIRE: ambos lados reciben una acción primaria y recomputan tras un pick propio", async () => {
    for (const side of ["radiant", "dire"] as const) {
      const h = harness({ side, sessionId: `side-${side}` });
      const first = await h.compute();
      expect(first.output!.primaryAction.label.length).toBeGreaterThan(0);
      h.seal(side, 0, 1);
      const second = await h.compute();
      expect(second.trigger).toBe("OWN_PICK_CONFIRMED");
      expect(second.output!.meta.basedOn.stateIdentity).not.toBe(first.output!.meta.basedOn.stateIdentity);
    }
  });

  test("POSICIÓN PERSONAL != TIMING: cualquier posición personal ve los mismos asientos legales en la Ronda 1 y el mismo consejo", async () => {
    const outputs: string[] = [];
    for (const position of [1, 2, 3, 4, 5] as const) {
      const h = harness({ humanPosition: position, sessionId: "pp" });
      const seats = h.store.authorizedLegalActions(h.id)!.filter((action) => action.type === "SUBMIT_SEALED_SELECTION");
      expect(seats).toHaveLength(2); // both Round-1 seats are legal for every personal position
      outputs.push(stripSession(await h.compute(position)));
    }
    expect(new Set(outputs).size).toBe(1);
  });

  test("SUPPORT-FIRST != ORDEN FIJO: el consejo no es una función de la ronda; se mueve con la evidencia", async () => {
    const h = harness({ sessionId: "not-a-script" });
    const opening = await h.compute();
    h.seal(h.side, 0, 1);
    h.seal(h.enemy, 0, 9);
    h.seal(h.side, 1, 2);
    h.seal(h.enemy, 1, 10);
    const round2 = await h.compute();
    const openingAction = opening.output!.primaryAction.strategy;
    const round2Action = round2.output!.primaryAction.strategy;
    // Opening: the leader is a core with no stronger role evidence -> the support PRIOR. Round 2: the ranking (a data-backed
    // counter) now leads with a core, so the answer follows the evidence to that core -- neither round is "support" or "core" by rule.
    expect(openingAction).toMatchObject({ kind: "REVEAL_POSITION" });
    expect([4, 5]).toContain((openingAction as { position: number }).position);
    expect(round2Action).toMatchObject({ kind: "REVEAL_POSITION", position: 3 });
    expect(round2Action).not.toHaveProperty("heroId"); // and it still does not name a hero
  });
});

describe("asignación de posición y concurrencia", () => {
  test("el Player asigna la posición de un héroe rival REVELADO: enemyRoleBeliefs se actualiza y el Coach recomputa", async () => {
    const h = harness({ sessionId: "assign" });
    h.seal(h.side, 0, 1);
    h.seal(h.side, 1, 2);
    h.seal(h.enemy, 0, 9);
    h.seal(h.enemy, 1, 10);
    const context = h.store.perspectiveRecommendationContext(h.id)!;
    const before = await h.coach.recompute({ context });
    expect(before.coachState.enemyRoleBeliefs.get(9)!.status).not.toBe("CONFIRMED");

    const after = await h.coach.onPlayerPositionAssigned({ context }, 9, 3);
    expect(after.trigger).toBe("PLAYER_POSITION_ASSIGNED");
    expect(after.coachState.enemyRoleBeliefs.get(9)!.status).toBe("CONFIRMED");
    expect(after.coachState.enemyRoleBeliefs.get(9)!.probabilities[3]).toBe(1);
    expect(after.output!.meta.revision).toBeGreaterThan(before.output!.meta.revision);
  });

  test("asignar posición a un héroe rival OCULTO se ignora: no existe creencia ni efecto (no sirve para sondear)", async () => {
    const h = harness({ sessionId: "assign-hidden" });
    h.seal(h.enemy, 0, 9); // sealed and hidden
    const context = h.store.perspectiveRecommendationContext(h.id)!;
    const result = await h.coach.onPlayerPositionAssigned({ context }, 9, 3);
    expect(result.coachState.playerPositionAssignments.size).toBe(0);
    expect(result.coachState.enemyRoleBeliefs.size).toBe(0);
  });

  test("sin bloqueo de cálculo: dos recomputaciones simultáneas terminan ambas, con revisiones distintas y crecientes", async () => {
    const h = harness({ sessionId: "concurrent" });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const coach = new CoachOrchestrator({
      heroPositions: HERO_POSITIONS,
      async buildRecommendationSet(context) {
        calls += 1;
        if (calls === 1) await gate; // the FIRST computation is slow
        return buildRecommendationSetFromPerspective({ context, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS });
      },
    });
    const first = coach.recompute({ context: h.store.perspectiveRecommendationContext(h.id)! });
    const second = coach.recompute({ context: h.store.perspectiveRecommendationContext(h.id)! }); // must not be suppressed by the busy first one
    const secondDone = await second;
    release();
    const firstDone = await first;
    expect(calls).toBe(2);
    expect(secondDone.revision).toBeGreaterThan(firstDone.revision);
    expect(secondDone.output!.primaryAction.label.length).toBeGreaterThan(0);
    expect(firstDone.output!.primaryAction.label.length).toBeGreaterThan(0);
  });
});
