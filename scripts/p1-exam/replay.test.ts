import { describe, expect, test } from "bun:test";
import { canonicalJson, commandsFor, compareRuns, fingerprint, selectRepresentative, validateMoment, MOMENT_SCHEMA, type DecisionMoment, type MomentOutput, type ReplayResult } from "./replay";

// Inline fixtures only: no SQLite, no curated file, no captured moments file (invariantes.md).
const pool = [{ hero: 11, source: "manual" as const, personalWinrate: null, personalGames: 0, updatedAt: "2026-01-01T00:00:00.000Z" }];
function momentAt(round: 1 | 2 | 3, over: Partial<DecisionMoment["reconstruction"]> = {}): DecisionMoment {
  const visible = { round, side: "radiant" as const, bans: [1, 2], ownPicks: [{ heroId: 21, assignedPosition: 1 as const }], revealedEnemy: [31], hiddenEnemySlots: 1, actionablePositions: [2, 3] as (1 | 2 | 3 | 4 | 5)[], humanPosition: 1 as const };
  return {
    schema: MOMENT_SCHEMA, id: `m${round}`, origin: { checkpoint: "F1", draftKey: "k", stateIndex: 0 },
    session: { side: "radiant", humanPosition: 1, simulatorSeed: "AUDIT001", account: "A", patch: "7.41e" },
    pool, visible, visibleFingerprint: fingerprint({ visible, pool }),
    reconstruction: {
      bans: [1, 2],
      // round 1 is fully played; round 2 is the moment (one own seal done, enemy already sealed); round 3 heroes MUST NOT matter.
      ownSealed: [{ round: 1, slotIndex: 0, heroId: 21, assignedPosition: 1 }, { round: 2, slotIndex: 0, heroId: 22, assignedPosition: 2 }, { round: 3, slotIndex: 0, heroId: 23, assignedPosition: 3 }],
      enemySealed: [{ round: 1, slotIndex: 0, heroId: 31 }, { round: 2, slotIndex: 0, heroId: 32 }, { round: 3, slotIndex: 0, heroId: 33 }],
      ...over,
    },
  };
}

describe("Decision Replay: the moment", () => {
  test("a well-formed moment validates clean", () => {
    expect(validateMoment(momentAt(2))).toEqual([]);
  });

  test("edge validation: malformed or tampered moments are refused with a reason, never replayed", () => {
    const tamper = (mutate: (m: any) => void): string[] => { const m: any = structuredClone(momentAt(2)); mutate(m); return validateMoment(m); };
    expect(tamper((m) => { m.schema = "x"; })).toContain("schema");
    expect(tamper((m) => { m.session.side = "north"; })).toContain("session.side");
    expect(tamper((m) => { m.reconstruction.ownSealed[0].assignedPosition = 9; })).toContain("reconstruction.ownSealed");
    expect(tamper((m) => { m.reconstruction.bans = []; })).toContain("reconstruction.bans");
    expect(tamper((m) => { m.reconstruction.enemySealed[1].heroId = 21; })).toContain("a hero appears twice in the recipe");
    expect(tamper((m) => { m.visible.revealedEnemy = [31, 99]; })).toContain("visibleFingerprint does not match visible state and pool");
    expect(tamper((m) => { m.pool[0].hero = 12; })).toContain("visibleFingerprint does not match visible state and pool");
    expect(validateMoment("not an object")).toContain("schema");
  });

  test("a same-round collision-to-be (both sides sealed the same hero before the reveal) is a legal moment; a repeat across rounds or with a ban is not", () => {
    const sameRound = momentAt(2, { ownSealed: [{ round: 2, slotIndex: 0, heroId: 40, assignedPosition: 2 }], enemySealed: [{ round: 2, slotIndex: 0, heroId: 40 }] });
    expect(validateMoment(sameRound)).toEqual([]);
    const acrossRounds = momentAt(2, { ownSealed: [{ round: 1, slotIndex: 0, heroId: 40, assignedPosition: 1 }], enemySealed: [{ round: 2, slotIndex: 0, heroId: 40 }] });
    expect(validateMoment(acrossRounds)).toContain("a hero appears twice in the recipe");
    const withBan = momentAt(2, { ownSealed: [{ round: 2, slotIndex: 0, heroId: 1, assignedPosition: 2 }] });
    expect(validateMoment(withBan)).toContain("a hero appears twice in the recipe");
  });

  test("slot 0 is a legal slot", () => {
    expect(validateMoment(momentAt(1))).toEqual([]);
  });
});

describe("Decision Replay: no information from future picks", () => {
  test("the rebuild never issues a command for a later round than the moment", () => {
    const commands = commandsFor(momentAt(2));
    expect(commands.map((c) => c.round)).toEqual([1, 1, 2, 2]);
    expect(commands.some((c) => c.heroId === 23 || c.heroId === 33)).toBe(false);
  });

  test("round 1 moment replays nothing from rounds 2 and 3, and enemy seals go first in each round", () => {
    const commands = commandsFor(momentAt(1));
    expect(commands.map((c) => `${c.kind}:${c.round}`)).toEqual(["enemy-seal:1", "own-seal:1"]);
    expect(commandsFor(momentAt(3)).map((c) => c.kind)).toEqual(["enemy-seal", "own-seal", "enemy-seal", "own-seal", "enemy-seal", "own-seal"]);
  });
});

describe("Decision Replay: determinism helpers", () => {
  test("canonical JSON ignores key order, so equal values hash equal", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe(canonicalJson({ a: [2, { c: 3, d: 4 }], b: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });

  test("representative selection is deterministic and spans every round", () => {
    const many = [1, 2, 3].flatMap((round) => Array.from({ length: 10 }, (_, i) => ({ ...momentAt(round as 1 | 2 | 3), id: `r${round}-${i}` })));
    const first = selectRepresentative(many, 4);
    expect(first.map((m) => m.id)).toEqual(selectRepresentative(many, 4).map((m) => m.id));
    expect(first).toHaveLength(12);
    expect(new Set(first.map((m) => m.visible.round))).toEqual(new Set([1, 2, 3]));
    expect(selectRepresentative(many.slice(0, 2), 4)).toHaveLength(2);
  });
});

describe("Decision Replay: comparing two versions on the same moments", () => {
  const output = (position: number, heroes: number[], reason = "r"): MomentOutput => ({
    board: { recommendedPosition: position, recommendedHeroId: heroes[0]!, targetBasis: null, columns: [{ position, state: "RANKED", eligibleNow: true, top: heroes.map((heroId, i) => ({ heroId, rank: i + 1, reasons: [reason] })) }] },
    v4: { kind: "k", targetPosition: position, viewedPosition: position, targetBasis: null, state: "RANKED", cards: heroes.map((heroId) => ({ heroId, rationale: reason, basisKind: "statistical", risks: [] })) },
    v3: { primary: "p", shortlist: heroes.map((heroId) => ({ heroId, rationale: reason })) },
    counterTop3: [],
  });
  const result = (id: string, o: MomentOutput, stateReproduced = true): ReplayResult => ({ id, stateReproduced, visibleFingerprint: "f", outputFingerprint: fingerprint(o), output: o });

  test("identical outputs are 'same'; a position change, a ranking change and a reasons-only change are told apart", () => {
    const a = [result("same", output(1, [5, 6])), result("pos", output(1, [5, 6])), result("rank", output(1, [5, 6])), result("why", output(1, [5, 6]))];
    const b = [result("same", output(1, [5, 6])), result("pos", output(2, [5, 6])), result("rank", output(1, [6, 5])), result("why", output(1, [5, 6], "other reason"))];
    const diff = compareRuns(a, b);
    expect(diff.same).toBe(1);
    expect(Object.fromEntries(diff.different.map((d) => [d.id, d.what]))).toEqual({ pos: ["recommended position"], rank: ["board ranking", "v4 cards"], why: ["reasons or risks only"] });
    expect(diff.stateMismatches).toEqual([]);
  });

  test("a moment whose state was NOT reproduced is never compared: it is reported, not counted as same", () => {
    const a = [result("x", output(1, [5]), true)];
    const b = [result("x", output(1, [5]), false)];
    expect(compareRuns(a, b)).toEqual({ same: 0, different: [], stateMismatches: ["x"] });
    expect(compareRuns(a, [])).toEqual({ same: 0, different: [], stateMismatches: ["x"] });
  });
});
