import { describe, expect, test } from "bun:test";
import { LOOP_SCENARIOS } from "../landing-v2/story/scenarios";
import { BEATS, leaderAt, rowsAt, signed, transition } from "./model";
import { CANDIDATES, COPY, DRAFT } from "./scenario";

const hero = LOOP_SCENARIOS.find((s) => s.id === "A")!;

describe("counterfactual fixture is the Hero Loop draft A", () => {
  test("same seat, allies, enemies and candidates", () => {
    expect(DRAFT.seat).toEqual(hero.seat);
    expect(DRAFT.enemies).toEqual(hero.enemies.map((e) => e.hero));
    expect(CANDIDATES.map((c) => c.hero)).toEqual(hero.candidates.map((c) => c.hero));
  });
  test("generic FIT 84 / 82 / 77 and personal FIT 83 / 88 / 77", () => {
    expect(CANDIDATES.map((c) => [c.hero, c.genericFit, c.personalFit])).toEqual([["Queen of Pain", 84, 83], ["Void Spirit", 77, 77], ["Puck", 82, 88]]);
  });
  test("the personal-history phrases are the Hero's, hero by hero", () => {
    const phrases = hero.steps.find((s) => s.kind === "personal")!.detail!;
    for (const c of CANDIDATES) expect(c.evidence).toBe(phrases[c.hero]);
  });
  test("no pool contradiction: a hero said to have no history never carries a games change", () => {
    for (const c of CANDIDATES.filter((x) => x.tone === "none")) expect(c.gamesDelta).toBe(0);
  });
});

describe("ranking", () => {
  test("generic leads with Queen of Pain, Puck is #2", () => {
    expect(rowsAt("generic").map((r) => r.hero)).toEqual(["Queen of Pain", "Puck", "Void Spirit"]);
  });
  test("evidence arrives without moving anything", () => {
    expect(rowsAt("evidence").map((r) => [r.hero, r.fit])).toEqual(rowsAt("generic").map((r) => [r.hero, r.fit]));
    expect(rowsAt("evidence").every((r) => r.evidenceShown && !r.deltaShown)).toBe(true);
  });
  test("for you: Puck moves #2 → #1 and the cause is your games", () => {
    expect(leaderAt("personal")).toBe("Puck");
    expect(transition()).toMatchObject({ from: "Queen of Pain", to: "Puck", changed: true, riserFrom: 2, cause: 6 });
  });
  test("a displayed delta always equals the FIT difference", () => {
    for (const r of rowsAt("personal")) expect(r.fit - r.genericFit).toBe(r.gamesDelta);
  });
  test("signed uses a true minus", () => {
    expect(signed(6)).toBe("+6");
    expect(signed(-1)).toBe("\u22121");
  });
});

describe("copy and story", () => {
  test("FIT is labelled and nothing reads as a rate or a count", () => {
    expect(COPY.fit).toBe("FIT");
    const all = JSON.stringify(COPY) + JSON.stringify(CANDIDATES);
    expect(all).not.toMatch(/win|%|MMR|games played|\d+ games/i);
  });
  test("the Coach points once and ends quiet", () => {
    expect(BEATS.filter((b) => b.coach.state === "pointing")).toHaveLength(1);
    expect(BEATS[BEATS.length - 1].coach.scale).toBeLessThan(1);
  });
});
