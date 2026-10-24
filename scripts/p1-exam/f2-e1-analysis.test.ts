import { describe, expect, test } from "bun:test";
import type { HeroCapabilities } from "../../apps/engine/src/draft-paths/types";
import { E1_KINDS, F1_KINDS, analyze, boardTop3, classify, fills, verdictOf, type Run, type World } from "./f2-e1-analysis";
import { fingerprint, MOMENT_SCHEMA, type DecisionMoment, type MomentOutput, type ReplayResult } from "./replay";

// Inline fixtures only: no curated file, no SQLite, no replay set (invariantes.md).
const cap = (hero: number, over: Partial<HeroCapabilities> = {}): HeroCapabilities => ({ hero, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "low", teamfight: "low", scaling: "low", ...over });
const caps = new Map<number, HeroCapabilities>([
  [1, cap(1, { hasInitiation: true, hasCatch: true, structuralDamage: "low" })], [2, cap(2, { hasInitiation: true, hasCatch: true })], [3, cap(3, { hasInitiation: true, hasCatch: true })],
  [4, cap(4, { hasInitiation: true, hasCatch: true, damageType: "magical" })], [10, cap(10, { structuralDamage: "high", damageType: "magical" })], [11, cap(11, { structuralDamage: "low", damageType: "magical" })],
]);
const world: World = { caps, counters: new Map(), legalHeroIds: new Set([1, 2, 3, 4, 10, 11, 131]) };
const momentWith = (id: string, own: number[]): DecisionMoment => {
  const visible = { round: 3 as const, side: "radiant" as const, bans: [90], ownPicks: own.map((heroId) => ({ heroId, assignedPosition: 1 as const })), revealedEnemy: [], hiddenEnemySlots: 0, actionablePositions: [2 as const], humanPosition: 2 as const };
  return { schema: MOMENT_SCHEMA, id, origin: { checkpoint: "F1", draftKey: id, stateIndex: 0 }, session: { side: "radiant", humanPosition: 2, simulatorSeed: "S", account: "A", patch: "7.41e" }, pool: [], visible, visibleFingerprint: fingerprint({ visible, pool: [] }), reconstruction: { bans: [90], ownSealed: [], enemySealed: [] } };
};
const output = (top: number[], reason = "r"): MomentOutput => ({
  board: { recommendedPosition: 2, recommendedHeroId: top[0]!, targetBasis: null, columns: [{ position: 2, state: "RANKED", eligibleNow: true, top: top.map((heroId, i) => ({ heroId, rank: i + 1, reasons: [reason] })) }] },
  v4: { kind: "k", targetPosition: 2, viewedPosition: 2, targetBasis: null, state: "RANKED", cards: top.map((heroId) => ({ heroId, rationale: reason, basisKind: "statistical", risks: [] })) },
  v3: { primary: "p", shortlist: top.map((heroId) => ({ heroId, rationale: reason })) }, counterTop3: [],
});
const result = (id: string, o: MomentOutput): ReplayResult => ({ id, stateReproduced: true, visibleFingerprint: "f", outputFingerprint: fingerprint(o), output: o });
const run = (kinds: typeof F1_KINDS, entries: [string, MomentOutput][]): Run => ({ kinds, results: new Map(entries.map(([id, o]) => [id, result(id, o)])) });

describe("F2-E1 classification (state only, same for any version)", () => {
  test("closing window + all curated + structural gap open -> in A; the same team with a structural hero is not", () => {
    const open = classify(momentWith("open", [1, 2, 3, 4]), caps);
    expect(open).toMatchObject({ eligible: true, structuralOpen: true, a: true, remaining: 1 });
    const closed = classify(momentWith("closed", [1, 2, 3, 10]), caps);
    expect(closed).toMatchObject({ eligible: true, structuralOpen: false, a: false });
  });

  test("outside the window or with an uncurated own pick, the moment is never eligible", () => {
    expect(classify(momentWith("early", [1, 2]), caps).eligible).toBe(false);
    expect(classify(momentWith("uncurated", [1, 2, 3, 131]), caps)).toMatchObject({ eligible: false, a: false });
  });

  test("a hero without curated capabilities fills nothing; a structural hero fills the structural gap", () => {
    expect(fills(131, "structural_damage", caps, [])).toBe(false);
    expect(fills(10, "structural_damage", caps, ["physical"])).toBe(true);
    expect(fills(11, "structural_damage", caps, ["physical"])).toBe(false);
  });
});

describe("F2-E1 verdict and rule application", () => {
  test("verdict: any FAIL wins, then INCONCLUSIVE, else PASS", () => {
    expect(verdictOf(["PASS", "FAIL", "INCONCLUSIVE"])).toBe("FAIL");
    expect(verdictOf(["PASS", "INCONCLUSIVE"])).toBe("INCONCLUSIVE");
    expect(verdictOf(["PASS", "PASS"])).toBe("PASS");
    expect(E1_KINDS).toEqual([...F1_KINDS, "structural_damage"]);
  });

  test("P2 catches a change outside A, and a change inside A is not a violation", () => {
    const moments = [momentWith("inA", [1, 2, 3, 4]), momentWith("inB", [1, 2, 3, 10])];
    const f1 = run(F1_KINDS, [["inA", output([11, 1, 2])], ["inB", output([11, 1, 2])]]);
    const onlyA = run(E1_KINDS, [["inA", output([10, 1, 2])], ["inB", output([11, 1, 2])]]);
    const leaky = run(E1_KINDS, [["inA", output([10, 1, 2])], ["inB", output([10, 1, 2])]]);
    expect(analyze(moments, f1, onlyA, world).P2).toMatchObject({ status: "PASS", violations: { n: 0, of: 1 } });
    const bad = analyze(moments, f1, leaky, world);
    expect(bad.P2).toMatchObject({ status: "FAIL", violations: { n: 1, of: 1 } });
    expect(bad.changed.mustNotChangeViolations).toEqual(["inB"]);
  });

  test("few applicable moments make P1 and P3 INCONCLUSIVE, never PASS", () => {
    const moments = [momentWith("inA", [1, 2, 3, 4])];
    const f1 = run(F1_KINDS, [["inA", output([11, 1, 2])]]);
    const e1 = run(E1_KINDS, [["inA", output([10, 1, 2])]]);
    const report = analyze(moments, f1, e1, world);
    expect(report.P1.status).toBe("INCONCLUSIVE");
    expect(report.P3.status).toBe("INCONCLUSIVE");
    expect(report.P1.structuralFillF1).toEqual({ n: 0, of: 1, pct: 0 });
    expect(report.P1.structuralFillE1).toEqual({ n: 1, of: 1, pct: 100 });
    expect(boardTop3(output([5, 6, 7, 8]))).toEqual([5, 6, 7]);
  });

  test("an uncurated hero that enters a top-3 is reported as an undue promotion", () => {
    const moments = [momentWith("inA", [1, 2, 3, 4])];
    const report = analyze(moments, run(F1_KINDS, [["inA", output([11, 1, 2])]]), run(E1_KINDS, [["inA", output([131, 10, 2])]]), world);
    expect(report.P4.uncuratedPromotions).toEqual(["inA:131"]);
    expect(report.P4.status).toBe("FAIL");
  });
});
