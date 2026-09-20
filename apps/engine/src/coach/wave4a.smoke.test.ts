import { describe, expect, test } from "bun:test";
import type { CuratedCounter } from "../signals/hero-counters";
import { harness, stripSession } from "./session-harness.fixtures";

// WAVE 4A -- automated product scenarios (Safe Core V1 + curated counter evidence + Opportunity block).
// Run by `bun run test:wave4a:smoke`. Headless: real kernel, real ProtocolSessionStore, real perspective-safe
// recommendation path; only V6's scorer and the curated counters are inline fixtures. This certifies Wave 4A
// only -- Task 26 (side context) and Task 27 (one-ply) are BLOCKED and are not exercised here.

const CARRY = 1;
const HARD_A = 7;
const HARD_B = 8;
const MEDIUM = 4;
const curated = (level: CuratedCounter["level"], vs: number): CuratedCounter => ({ vs, level, why: `fixture ${vs}` });
const COUNTERS = new Map<number, CuratedCounter[]>([[CARRY, [curated("hard", HARD_A), curated("hard", HARD_B), curated("medium", MEDIUM)]]]);

// Words that would turn curated evidence into an unsupported claim (verified current-patch / statistical / side).
const UNSUPPORTED_CLAIMS = /STATISTICAL|7\.41|current[- ]meta|statistically|win ?rate|\d+ ?%|estad[ií]stic|verificad|mejor winrate/i;

describe("WAVE 4A smoke", () => {
  test("A -- SAFE CORE APARECE: acción primaria normal + oportunidad curada, sin ninguna afirmación estadística ni de parche", async () => {
    const { output } = await harness({ sessionId: "w4a-a", bans: [HARD_A, HARD_B], heroCounters: COUNTERS }).compute();

    // The normal Coach hierarchy is intact.
    expect(output!.primaryAction.label.length).toBeGreaterThan(0);
    expect(output!.primaryAction.strategy.kind).not.toBe("OPPORTUNITY");
    expect(output!.shortlist.length).toBeGreaterThan(0);

    // The exceptional block is present, curated, and counter-relief shaped.
    expect(output!.opportunity).toMatchObject({ subtype: "SAFE_CORE", heroId: CARRY });
    expect(output!.opportunity!.counterEvidence).toMatchObject({ kind: "COUNTER_RELIEF", sourceType: "CURATED", totalHardCounters: 2 });
    expect(output!.opportunity!.counterEvidence.relieved.every((entry) => entry.status === "BANNED")).toBe(true);
    expect(output!.opportunity!.evidence).toBe("2 de 2 counters duros curados ya no están disponibles para el rival (2 baneados)");

    // Nothing the product shows in the block claims verified statistics, a patch, a win rate or a side.
    expect(JSON.stringify(output!.opportunity)).not.toMatch(UNSUPPORTED_CLAIMS);
  });

  test("B -- SAFE CORE NO APARECE: evidencia insuficiente (un counter duro sigue disponible) y drafts ordinarios", async () => {
    const insufficient = (await harness({ sessionId: "w4a-b", bans: [HARD_A], heroCounters: COUNTERS }).compute()).output!;
    expect(insufficient).not.toHaveProperty("opportunity");
    expect(insufficient.primaryAction.label.length).toBeGreaterThan(0);
    expect(insufficient.shortlist.length).toBeGreaterThan(0);

    const ordinary = (await harness({ sessionId: "w4a-b2", bans: [], heroCounters: COUNTERS }).compute()).output!;
    expect(ordinary).not.toHaveProperty("opportunity");
  });

  test("C -- INFORMACIÓN OCULTA: dos mundos que difieren sólo en el rival oculto son idénticos antes del reveal; tras el reveal pueden divergir", async () => {
    const x = harness({ sessionId: "w4a-c", bans: [HARD_A, HARD_B], heroCounters: COUNTERS });
    const y = harness({ sessionId: "w4a-c", bans: [HARD_A, HARD_B], heroCounters: COUNTERS });
    for (const [h, hiddenHero] of [[x, MEDIUM], [y, 6]] as const) {
      h.seal(h.enemy, 0, hiddenHero); // the ONLY difference between the two worlds, still sealed
      h.seal(h.enemy, 1, 10);
      h.seal(h.side, 0, 2);
    }
    const preX = await x.compute();
    const preY = await y.compute();
    expect(preX.output!.opportunity).toBeDefined();
    expect(stripSession(preX)).toBe(stripSession(preY)); // Safe Core / Opportunity identical before the reveal

    for (const h of [x, y]) h.seal(h.side, 1, 3); // the round closes: the hidden heroes become legal knowledge
    const postX = (await x.compute()).output!;
    const postY = (await y.compute()).output!;
    expect(postX).not.toHaveProperty("opportunity"); // a curated counter is now visibly on the enemy team
    expect(postY.opportunity?.heroId).toBe(CARRY);
  });
});
