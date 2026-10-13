import { describe, expect, test } from "bun:test";
import { CANDIDATES, DRAFT } from "../counterfactual-lab/scenario";
import { FORBIDDEN_CLAIMS } from "../landing/copy";
import { LOOP_SCENARIOS } from "./story/scenarios";
import * as copy from "./copy";
import { NODES, SCENES } from "./memory/fixtures";

/* One page, one story: the chapters must agree about the same player. */
describe("landing v2 content consistency", () => {
  test("Hero and Counterfactual read the same draft from the same fixture", () => {
    const a = LOOP_SCENARIOS[0];
    expect(DRAFT.seat).toEqual(a.seat);
    expect(CANDIDATES.map((c) => c.hero)).toEqual(a.candidates.map((c) => c.hero));
  });

  test("Memory never presents as 'returned to' a hero the Counterfactual says has no history", () => {
    const noHistory = CANDIDATES.filter((c) => c.tone === "none").map((c) => c.hero);
    const memoryHeroes = NODES.filter((n) => n.kind === "hero").map((n) => n.label);
    for (const hero of noHistory) expect(memoryHeroes).not.toContain(hero);
    // Puck is the comfort pick everywhere
    expect(CANDIDATES.find((c) => c.hero === "Puck")?.evidence).toBe("Often played");
    expect(memoryHeroes).toContain("Puck");
  });

  test("the Memory story keeps its order", () => {
    expect(SCENES.map((s) => s.tab)).toEqual(["Match 01", "Match 08", "Match 24", "Match 56", "What it knows"]);
  });

  test("no integrated copy makes a forbidden claim or invents a rate", () => {
    const text = JSON.stringify(copy);
    for (const re of FORBIDDEN_CLAIMS) expect(text).not.toMatch(re);
    expect(text).not.toMatch(/\d+\s?%/);
    expect(text).not.toMatch(/win\s?rate\s?of/i);
  });

  test("FIT is always described as a score, never a rate", () => {
    expect(copy.PROPOSITION.fitNote).toMatch(/not a win rate/i);
  });
});
