import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import { createCounterScorer } from "../signals/counter";
import type { CuratedCounter } from "../signals/hero-counters";
import { harness, stripSession } from "./session-harness.fixtures";

// AP Ranked Roles V1 / Wave 4A (tasks 24-25) -- Safe Core as the Coach's `opportunity` block, over the REAL
// kernel + ProtocolSessionStore + perspective-safe recommendation path (session-harness.fixtures.ts). Only V6's
// scorer is a deterministic fake, and the curated counters are an INLINE fixture: no hero-counters.json.
//
// Fixture world: hero 1 is the V6 top and a resolved Carry (Pos 1). Curated: hero 7 and hero 8 counter it HARD,
// hero 4 counters it MEDIUM. Heroes 2 (Pos 5) and 3 (Pos 4) are supports.

const CARRY = 1;
const HARD_A = 7;
const HARD_B = 8;
const MEDIUM = 4;

const curated = (level: CuratedCounter["level"], vs: number): CuratedCounter => ({ vs, level, why: `fixture ${vs}` });
const COUNTERS = new Map<number, CuratedCounter[]>([[CARRY, [curated("hard", HARD_A), curated("hard", HARD_B), curated("medium", MEDIUM)]]]);

describe("Safe Core opportunity -- Coach over the real kernel", () => {
  test("1. POSITIVO: los counters duros curados del core ya están baneados -> aparece el bloque, con la acción primaria intacta", async () => {
    const { output } = await harness({ bans: [HARD_A, HARD_B], heroCounters: COUNTERS }).compute();
    expect(output!.opportunity).toBeDefined();
    expect(output!.opportunity).toMatchObject({ subtype: "SAFE_CORE", heroId: CARRY, evidence: "2 de 2 counters duros curados ya no están disponibles para el rival (2 baneados)" });
    expect(output!.opportunity!.label).toBe("Ventana de core: 2 de 2 counters duros curados ya no están disponibles para el rival (2 baneados)");
    // The normal Coach hierarchy still stands: a primary action and a shortlist exist next to the block.
    expect(output!.primaryAction.label.length).toBeGreaterThan(0);
    expect(output!.shortlist.length).toBeGreaterThan(0);
  });

  test("1b. MIXTO: un counter baneado y otro en tu equipo -> el bloque dice 'ya no están disponibles' y nunca 'baneados' para el pick propio", async () => {
    const h = harness({ bans: [HARD_A], heroCounters: COUNTERS });
    h.seal(h.side, 0, HARD_B); // our own team holds the second hard counter: the rival cannot take it
    const { output } = await h.compute();
    expect(output!.opportunity).toMatchObject({ subtype: "SAFE_CORE", heroId: CARRY });
    expect(output!.opportunity!.evidence).toBe("2 de 2 counters duros curados ya no están disponibles para el rival (1 baneado · 1 en tu equipo)");
    expect(output!.opportunity!.label).toBe("Ventana de core: 2 de 2 counters duros curados ya no están disponibles para el rival (1 baneado · 1 en tu equipo)");
    expect(output!.opportunity!.evidence).not.toMatch(/2 baneados/);
    expect(output!.opportunity!.counterEvidence.relieved).toEqual([
      { heroId: HARD_A, level: "hard", status: "BANNED" },
      { heroId: HARD_B, level: "hard", status: "OWN_PICK" },
    ]);
  });

  test("1c. COBERTURA: un core con UN solo counter duro curado, ya baneado, NO produce la oportunidad (piso = 2)", async () => {
    const oneCounter = new Map<number, CuratedCounter[]>([[CARRY, [curated("hard", HARD_A), curated("medium", MEDIUM)]]]);
    const { output } = await harness({ bans: [HARD_A], heroCounters: oneCounter }).compute();
    expect(output).not.toHaveProperty("opportunity");
    expect(JSON.stringify(output)).not.toContain('"opportunity"');
    // The normal Coach output is intact: only the block is withheld. (The shortlist lists heroes that can execute the
    // primary action -- RB-2 -- so the core need not appear there; it stays V6's leader in the recommendation set.)
    expect(output!.shortlist.length).toBeGreaterThan(0);
    expect(output!.primaryAction.label.length).toBeGreaterThan(0);
  });

  test("1d. BAN_RELIEF INTACTO: el mismo héroe de un solo counter SIGUE recibiendo el alivio de V6 `counter` (scorer real), pero Safe Core calla", () => {
    const state: DraftState = {
      sessionId: "s1", schema: "draft-state/v1", format: "all_pick", patch: "7.41e", localSide: "radiant", phase: "active",
      banned: [HARD_A], picks: { radiant: [], dire: [] }, lastSeq: 0, appliedEventIds: [], quality: { unconfirmed: [], captureStatus: "ok" },
      updatedAt: "2026-09-20T00:00:00Z", firstPickSide: null, turnStartedAt: null, reserveRemainingMs: null,
    };
    const oneCounter = new Map<number, CuratedCounter[]>([[CARRY, [curated("hard", HARD_A)]]]);
    const scored = createCounterScorer(oneCounter).score(state, CARRY, { heroes: { [HARD_A]: { id: HARD_A, localizedName: "Counter A" } }, matchups: {} });
    expect(scored.raw).toBeCloseTo(0.04, 10); // BAN_RELIEF.hard, unchanged by the Safe Core coverage floor
    expect(scored.explanation).toBe("1 de sus counters está baneado: Counter A");
  });

  test("2. NEGATIVO: el mismo core con un counter duro todavía disponible -> el bloque NO existe (ausente, no null)", async () => {
    const { output } = await harness({ bans: [HARD_A], heroCounters: COUNTERS }).compute();
    expect(output).not.toHaveProperty("opportunity");
    expect(JSON.stringify(output)).not.toContain('"opportunity"');
  });

  test("3. COUNTER CURADO BANEADO: el alivio queda registrado por héroe, con estado BANNED", async () => {
    const { output } = await harness({ bans: [HARD_A, HARD_B], heroCounters: COUNTERS }).compute();
    expect(output!.opportunity!.counterEvidence).toEqual({
      kind: "COUNTER_RELIEF",
      sourceType: "CURATED",
      relieved: [
        { heroId: HARD_A, level: "hard", status: "BANNED" },
        { heroId: HARD_B, level: "hard", status: "BANNED" },
      ],
      totalHardCounters: 2,
    });
  });

  test("4. COUNTER NO BANEADO: si el counter sigue legalmente disponible no hay evidencia de 'counter baneado'", async () => {
    const none = (await harness({ bans: [], heroCounters: COUNTERS }).compute()).output!;
    const partial = (await harness({ bans: [HARD_A], heroCounters: COUNTERS }).compute()).output!;
    for (const output of [none, partial]) {
      expect(output).not.toHaveProperty("opportunity");
      expect(JSON.stringify(output)).not.toMatch(/ya no est[aá]n? disponibles?|baneados?/);
    }
  });

  test("5. PROCEDENCIA: el bloque declara evidencia CURATED y no afirma nada estadístico ni de parche", async () => {
    const { output } = await harness({ bans: [HARD_A, HARD_B], heroCounters: COUNTERS }).compute();
    const block = JSON.stringify(output!.opportunity);
    expect(output!.opportunity!.counterEvidence.sourceType).toBe("CURATED");
    expect(block).not.toMatch(/STATISTICAL|7\.41|current|meta|win ?rate|%|estad[ií]stic|verificad/i);
  });

  test("6. ENEMIGO OCULTO: dos mundos que difieren SÓLO en un héroe rival oculto -> misma salida, byte a byte, antes del reveal", async () => {
    const x = harness({ sessionId: "sc-twin", bans: [HARD_A, HARD_B], heroCounters: COUNTERS });
    const y = harness({ sessionId: "sc-twin", bans: [HARD_A, HARD_B], heroCounters: COUNTERS });
    x.seal(x.enemy, 0, MEDIUM); // hidden: in world X the enemy secretly holds a curated MEDIUM counter of the carry
    y.seal(y.enemy, 0, 6);
    x.seal(x.side, 0, 2);
    y.seal(y.side, 0, 2);
    const outX = await x.compute();
    const outY = await y.compute();
    expect(outX.output!.opportunity).toBeDefined(); // the Coach cannot know, so the window still shows
    expect(stripSession(outX)).toBe(stripSession(outY));
  });

  test("7. REVEAL ENEMIGO: al revelarse un counter curado la decisión cambia; con otro héroe revelado se mantiene", async () => {
    const x = harness({ sessionId: "sc-reveal", bans: [HARD_A, HARD_B], heroCounters: COUNTERS });
    const y = harness({ sessionId: "sc-reveal", bans: [HARD_A, HARD_B], heroCounters: COUNTERS });
    for (const [h, hiddenHero] of [[x, MEDIUM], [y, 6]] as const) {
      h.seal(h.enemy, 0, hiddenHero);
      h.seal(h.enemy, 1, 10);
      h.seal(h.side, 0, 2);
    }
    expect(stripSession(await x.compute())).toBe(stripSession(await y.compute())); // still hidden
    for (const h of [x, y]) h.seal(h.side, 1, 3); // round closes -> enemy picks are revealed

    const afterX = (await x.compute()).output!;
    const afterY = (await y.compute()).output!;
    expect(afterX).not.toHaveProperty("opportunity"); // a curated counter of the carry is now on the enemy team
    expect(afterY.opportunity).toMatchObject({ heroId: CARRY, subtype: "SAFE_CORE" });
  });

  test("8. LADO: Radiant vs Dire por sí solo NO cambia el resultado (el contexto de lado está bloqueado, Task 26)", async () => {
    const radiant = (await harness({ side: "radiant", bans: [HARD_A, HARD_B], heroCounters: COUNTERS }).compute()).output!;
    const dire = (await harness({ side: "dire", bans: [HARD_A, HARD_B], heroCounters: COUNTERS }).compute()).output!;
    expect(dire.opportunity).toEqual(radiant.opportunity);
    const radiantNo = (await harness({ side: "radiant", bans: [HARD_A], heroCounters: COUNTERS }).compute()).output!;
    const direNo = (await harness({ side: "dire", bans: [HARD_A], heroCounters: COUNTERS }).compute()).output!;
    expect(radiantNo).not.toHaveProperty("opportunity");
    expect(direNo).not.toHaveProperty("opportunity");
  });

  test("9. HERO POOL: cambiar el pool personal (o la posición personal) NO cambia la decisión de equipo", async () => {
    const h = harness({ bans: [HARD_A, HARD_B], heroCounters: COUNTERS });
    const context = () => h.store.perspectiveRecommendationContext(h.id)!;
    const noPool = (await h.coach.recompute({ context: context(), playerPersonalPosition: 2 })).output!;
    const poolA = (await h.coach.recompute({ context: context(), playerPersonalPosition: 2, config: { heroPool: [CARRY, 4, 5] } })).output!;
    const poolB = (await h.coach.recompute({ context: context(), playerPersonalPosition: 1, config: { heroPool: [2, 3] } })).output!;
    expect(noPool.opportunity).toBeDefined();
    expect(poolA.opportunity).toEqual(noPool.opportunity);
    expect(poolB.opportunity).toEqual(noPool.opportunity);

    const closed = harness({ bans: [HARD_A], heroCounters: COUNTERS });
    const withPool = (await closed.coach.recompute({ context: closed.store.perspectiveRecommendationContext(closed.id)!, playerPersonalPosition: 2, config: { heroPool: [CARRY] } })).output!;
    expect(withPool).not.toHaveProperty("opportunity"); // a pool never manufactures a window
  });

  test("10. DESVIACIÓN: el Player ignora la oportunidad y elige otro héroe legal -> aceptado, el Coach recomputa normalmente", async () => {
    const h = harness({ bans: [HARD_A, HARD_B], heroCounters: COUNTERS });
    const before = (await h.compute()).output!;
    expect(before.opportunity?.heroId).toBe(CARRY);
    h.seal(h.side, 0, 5); // seal() throws if the kernel rejected it; hero 5 is not the suggested carry
    const after = await h.compute();
    expect(after.trigger).toBe("OWN_PICK_CONFIRMED");
    expect(after.output!.meta.basedOn.stateIdentity).not.toBe(before.meta.basedOn.stateIdentity);
    expect(JSON.stringify(after.output)).not.toMatch(/wrong|incorrect|rechaz|equivoc/i);
    // Ignoring the window does not close it: the carry is still open and its counters are still banned.
    expect(after.output!.opportunity?.heroId).toBe(CARRY);
  });

  test("10b. SEGUIR la oportunidad tampoco la deja colgada: con el core ya elegido el bloque desaparece", async () => {
    const h = harness({ bans: [HARD_A, HARD_B], heroCounters: COUNTERS });
    h.seal(h.side, 0, CARRY);
    const after = (await h.compute()).output!;
    expect(after).not.toHaveProperty("opportunity");
  });

  test("11. NO ES UNIVERSAL: sin evidencia curada inyectada, o sin bans relevantes, ningún estado del draft produce el bloque", async () => {
    const noData = harness({ bans: [HARD_A, HARD_B] }); // no heroCounters at all
    expect((await noData.compute()).output).not.toHaveProperty("opportunity");

    const ordinary = harness({ bans: [], heroCounters: COUNTERS });
    expect((await ordinary.compute()).output).not.toHaveProperty("opportunity");
    ordinary.seal(ordinary.side, 0, 2);
    expect((await ordinary.compute()).output).not.toHaveProperty("opportunity");
    ordinary.seal(ordinary.side, 1, 3);
    ordinary.seal(ordinary.enemy, 0, 6);
    ordinary.seal(ordinary.enemy, 1, 10);
    expect((await ordinary.compute()).output).not.toHaveProperty("opportunity");
  });

  test("la oportunidad es informativa: con o sin ella, primaryAction y shortlist son idénticos", async () => {
    const withData = (await harness({ sessionId: "sc-info", bans: [HARD_A, HARD_B], heroCounters: COUNTERS }).compute()).output!;
    const without = (await harness({ sessionId: "sc-info", bans: [HARD_A, HARD_B] }).compute()).output!;
    expect(withData.opportunity).toBeDefined();
    expect(without.primaryAction).toEqual(withData.primaryAction);
    expect(without.shortlist).toEqual(withData.shortlist);
    expect(withData.primaryAction.strategy.kind).not.toBe("OPPORTUNITY");
  });

  test("Safe Core no toca V6: el RecommendationSetV2 es idéntico con y sin evidencia curada inyectada", async () => {
    const withData = await harness({ sessionId: "sc-v6", bans: [HARD_A, HARD_B], heroCounters: COUNTERS }).compute();
    const without = await harness({ sessionId: "sc-v6", bans: [HARD_A, HARD_B] }).compute();
    expect(JSON.stringify(withData.recommendationSet)).toBe(JSON.stringify(without.recommendationSet));
  });

  test("el mismo estado visible produce el mismo bloque: determinismo", async () => {
    const a = (await harness({ sessionId: "sc-det", bans: [HARD_A, HARD_B], heroCounters: COUNTERS }).compute()).output!;
    const b = (await harness({ sessionId: "sc-det", bans: [HARD_A, HARD_B], heroCounters: COUNTERS }).compute()).output!;
    expect(JSON.stringify(a.opportunity)).toBe(JSON.stringify(b.opportunity));
  });
});
