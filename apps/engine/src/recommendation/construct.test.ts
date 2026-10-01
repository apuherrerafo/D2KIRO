import { describe, expect, test } from "bun:test";
import type { HeroId } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import { isCandidateAdmittedForPosition, type HeroPositions } from "../signals/hero-positions";
import type { SuggestionSet } from "../signals/mix";
import {
  buildCompoundRecommendations,
  buildSingleRecommendations,
  type ConstructContext,
} from "./construct";
import type { RecommendationSlot } from "./types";
import type { ShortlistEntry } from "./shortlist";

// Hero definitions:
// Hero 10: Pos 5 only (Hard Support)
// Hero 20: Pos 4 only (Support)
// Hero 30: Pos 3 only (Offlane)
// Hero 40: Pos 1 only (Carry)
// Hero 50: Dual-role Pos 5 + Pos 4 (e.g. Snapfire)
// Hero 51: Dual-role Pos 5 + Pos 4 (e.g. Mirana)
// Hero 99: High-scoring Pos 1 only (Carry)
const TEST_POSITIONS: HeroPositions = {
  10: [{ position: 5, matches: 1000 }],
  20: [{ position: 4, matches: 1000 }],
  30: [{ position: 3, matches: 1000 }],
  40: [{ position: 1, matches: 1000 }],
  50: [
    { position: 5, matches: 800 },
    { position: 4, matches: 600 },
  ],
  51: [
    { position: 5, matches: 700 },
    { position: 4, matches: 700 },
  ],
  99: [{ position: 1, matches: 2000 }],
};

function makeEntry(hero: HeroId, score: number, confidence: "alta" | "media" | "baja" = "alta"): ShortlistEntry {
  return {
    hero,
    suggestion: {
      hero,
      rank: 1,
      score,
      confidence,
      signals: [
        {
          signal: "counter",
          raw: 0.5,
          normalized: 0.5,
          weighted: score,
          explanation: "test",
          sampleSize: 100,
          applicable: true,
        },
      ],
      reason: "test",
      evidenceCoverage: 1,
      guessingIndex: 0,
    },
  };
}

function makeContext(legalHeroIds?: Set<HeroId>): ConstructContext {
  return {
    isLegal: (hero: HeroId) => (legalHeroIds ? legalHeroIds.has(hero) : true),
    contextEvidence: [],
  };
}

const DUMMY_SUGGESTION_SET: SuggestionSet = {
  schema: "suggestions/v1",
  sessionId: "test-session",
  basedOnSeq: 0,
  suggestions: [],
  comparison: null,
  degraded: [],
  computedInMs: 1,
  decisionContext: "team_opening",
  functionalEvidence: {
    metaIsStale: false,
    signalEvidence: [],
    heroPositions: Object.entries(TEST_POSITIONS).map(([hero, positions]) => ({ hero: Number(hero), positions })),
    teamOpening: null,
    partyPreferredPositions: [],
  },
};

describe("Multi-Pick Package Position Column Alignment (construct.ts)", () => {
  const round1Slots: RecommendationSlot[] = [
    { side: "radiant", slotIndex: 0, position: 5 },
    { side: "radiant", slotIndex: 1, position: 4 },
  ];

  const round2Slots: RecommendationSlot[] = [
    { side: "radiant", slotIndex: 0, position: 3 },
    { side: "radiant", slotIndex: 1, position: 1 },
  ];

  test("1. Pos5+Pos4 package: each displayed hero is admitted for its column", () => {
    // Hero 20 (Pos 4 only) has higher score than Hero 10 (Pos 5 only).
    // Shortlist order puts Hero 20 first.
    const shortlist = [makeEntry(20, 95), makeEntry(10, 90)];
    const recs = buildCompoundRecommendations(
      makeContext(),
      shortlist,
      [],
      TEST_POSITIONS,
      undefined,
      round1Slots,
      false,
      [],
    );

    expect(recs).toHaveLength(1);
    const [rec] = recs;
    const actionSlot0 = rec!.actions.find((a) => a.slot.slotIndex === 0)!;
    const actionSlot1 = rec!.actions.find((a) => a.slot.slotIndex === 1)!;

    // slot 0 is Pos 5: must be Hero 10
    expect(actionSlot0.hero).toBe(10);
    expect(isCandidateAdmittedForPosition(actionSlot0.hero, 5, TEST_POSITIONS)).toBe(true);

    // slot 1 is Pos 4: must be Hero 20
    expect(actionSlot1.hero).toBe(20);
    expect(isCandidateAdmittedForPosition(actionSlot1.hero, 4, TEST_POSITIONS)).toBe(true);
  });

  test("2. Pos3+Pos1 package: each displayed hero is admitted for its column", () => {
    // Hero 40 (Pos 1 only) has higher score than Hero 30 (Pos 3 only).
    // Shortlist order puts Hero 40 first.
    const shortlist = [makeEntry(40, 95), makeEntry(30, 90)];
    const recs = buildCompoundRecommendations(
      makeContext(),
      shortlist,
      [],
      TEST_POSITIONS,
      undefined,
      round2Slots,
      false,
      [],
    );

    expect(recs).toHaveLength(1);
    const [rec] = recs;
    const actionSlot0 = rec!.actions.find((a) => a.slot.slotIndex === 0)!;
    const actionSlot1 = rec!.actions.find((a) => a.slot.slotIndex === 1)!;

    // slot 0 is Pos 3: must be Hero 30
    expect(actionSlot0.hero).toBe(30);
    expect(isCandidateAdmittedForPosition(actionSlot0.hero, 3, TEST_POSITIONS)).toBe(true);

    // slot 1 is Pos 1: must be Hero 40
    expect(actionSlot1.hero).toBe(40);
    expect(isCandidateAdmittedForPosition(actionSlot1.hero, 1, TEST_POSITIONS)).toBe(true);
  });

  test("3. Dual-role heroes may be assigned legally", () => {
    // Hero 50 (Pos 5 + Pos 4) paired with Hero 20 (Pos 4 only).
    // Hero 20 can only play Pos 4, so Hero 50 must legally take Pos 5.
    const shortlist = [makeEntry(50, 95), makeEntry(20, 90)];
    const recs = buildCompoundRecommendations(
      makeContext(),
      shortlist,
      [],
      TEST_POSITIONS,
      undefined,
      round1Slots,
      false,
      [],
    );

    expect(recs).toHaveLength(1);
    const [rec] = recs;
    const actionSlot0 = rec!.actions.find((a) => a.slot.slotIndex === 0)!;
    const actionSlot1 = rec!.actions.find((a) => a.slot.slotIndex === 1)!;

    expect(actionSlot0.hero).toBe(50);
    expect(isCandidateAdmittedForPosition(actionSlot0.hero, 5, TEST_POSITIONS)).toBe(true);
    expect(actionSlot1.hero).toBe(20);
    expect(isCandidateAdmittedForPosition(actionSlot1.hero, 4, TEST_POSITIONS)).toBe(true);
  });

  test("4. A high-scoring hero cannot be placed into an inadmissible positional column merely due to ranking", () => {
    // Hero 99 is Carry (Pos 1 only) with top score 150.
    // Hero 10 is Hard Support (Pos 5 only) with score 80.
    // In Round 1 (Pos 5 + Pos 4), Hero 99 cannot play either position.
    // The pair cannot produce a valid positional pair and must NOT be presented.
    const shortlist = [makeEntry(99, 150), makeEntry(10, 80)];
    const recs = buildCompoundRecommendations(
      makeContext(),
      shortlist,
      [],
      TEST_POSITIONS,
      undefined,
      round1Slots,
      false,
      [],
    );

    expect(recs).toHaveLength(0);
  });

  test("5. Pair/package recommendation quality logic remains otherwise unchanged", () => {
    const entryA = makeEntry(10, 80, "alta");
    const entryB = makeEntry(20, 90, "media");
    const shortlist = [entryB, entryA];
    const recs = buildCompoundRecommendations(
      makeContext(),
      shortlist,
      [],
      TEST_POSITIONS,
      undefined,
      round1Slots,
      false,
      [],
    );

    expect(recs).toHaveLength(1);
    const [rec] = recs;
    expect(rec!.score).toBe(80 + 90);
    expect(rec!.confidence).toBe("media");
    expect(rec!.legal).toBe(true);
    expect(rec!.legacy).toBeNull();
    expect(rec!.roleImpact[10]).toBeDefined();
    expect(rec!.roleImpact[20]).toBeDefined();
  });

  test("6. Hidden-info behavior unchanged: constructContext receives only perspective-safe predicates", () => {
    // Context legality checks must be respected independently of positions.
    const legalSet = new Set<HeroId>([10]); // Hero 20 is marked not legal (e.g. banned or picked)
    const shortlist = [makeEntry(20, 95), makeEntry(10, 90)];
    const recs = buildCompoundRecommendations(
      makeContext(legalSet),
      shortlist,
      [],
      TEST_POSITIONS,
      undefined,
      round1Slots,
      false,
      [],
    );

    // Hero 20 is not legal, so no package is constructed
    expect(recs).toHaveLength(0);
  });

  test("7. Hero Pool isolation unchanged: partyPreferredPositions influences roleImpact without forcing positional admission", () => {
    const shortlist = [makeEntry(10, 90), makeEntry(20, 85)];
    const recs = buildCompoundRecommendations(
      makeContext(),
      shortlist,
      [],
      TEST_POSITIONS,
      [4], // soft preference
      round1Slots,
      false,
      [],
    );

    expect(recs).toHaveLength(1);
    expect(recs[0]!.actions.find((a) => a.slot.slotIndex === 0)!.hero).toBe(10);
    expect(recs[0]!.actions.find((a) => a.slot.slotIndex === 1)!.hero).toBe(20);
  });

  test("8. UX P0 arbitrary-first-slot behavior unchanged: dual-role heroes maintain higher-score in first slot", () => {
    // Both Hero 50 (score 95) and Hero 51 (score 90) can play both Pos 5 and Pos 4.
    // Direct assignment preserves UX P0: higher-scored hero 50 fills lower-numbered slot 0.
    const shortlist = [makeEntry(50, 95), makeEntry(51, 90)];
    const recs = buildCompoundRecommendations(
      makeContext(),
      shortlist,
      [],
      TEST_POSITIONS,
      undefined,
      round1Slots,
      false,
      [],
    );

    expect(recs).toHaveLength(1);
    const [rec] = recs;
    const actionSlot0 = rec!.actions.find((a) => a.slot.slotIndex === 0)!;
    const actionSlot1 = rec!.actions.find((a) => a.slot.slotIndex === 1)!;

    expect(actionSlot0.hero).toBe(50);
    expect(actionSlot1.hero).toBe(51);
  });

  test("9. Single-seat recommendation (Stage 2 post first lock) filters by slot position", () => {
    // Remaining slot 1 is Pos 4 (Support).
    // Shortlist has Hero 10 (Pos 5 only, score 100) and Hero 20 (Pos 4 only, score 90).
    const remainingSlot: RecommendationSlot = { side: "radiant", slotIndex: 1, position: 4 };
    const shortlist = [makeEntry(10, 100), makeEntry(20, 90)];

    const recs = buildSingleRecommendations(
      makeContext(),
      shortlist,
      [],
      TEST_POSITIONS,
      undefined,
      remainingSlot,
      false,
      DUMMY_SUGGESTION_SET,
      [],
    );

    // Hero 10 cannot play Pos 4, so only Hero 20 is recommended.
    expect(recs).toHaveLength(1);
    expect(recs[0]!.actions[0]!.hero).toBe(20);
    expect(recs[0]!.actions[0]!.slot.position).toBe(4);
    expect(isCandidateAdmittedForPosition(20, 4, TEST_POSITIONS)).toBe(true);
  });
});

// Greptile PR #9 (P1, INV-BIND-001) -- an own hero whose evidence is Pos1-only but that the human
// authoritatively bound to Pos5 must occupy Pos5, never Pos1, in the hard role-feasibility gate.
describe("authoritative own bindings in role feasibility (construct.ts)", () => {
  const ownHeroBoundOffRole = 40; // Pos1-only evidence
  const pos1OnlyCandidate = 99;
  const slot: RecommendationSlot = { side: "radiant", slotIndex: 1 };

  function run(context: ConstructContext) {
    const degradations: Parameters<typeof buildSingleRecommendations>[8] = [];
    const recs = buildSingleRecommendations(context, [makeEntry(pos1OnlyCandidate, 90)], [ownHeroBoundOffRole], TEST_POSITIONS, undefined, slot, false, DUMMY_SUGGESTION_SET, degradations, 5, true);
    return { recs, degradations };
  }

  test("bound to Pos5: a Pos1-only candidate stays role-feasible at the open Pos1", () => {
    const { recs, degradations } = run({ ...makeContext(), ownConfirmedPositions: new Map<HeroId, Position>([[ownHeroBoundOffRole, 5]]) });
    expect(recs.map((rec) => rec.actions[0]!.hero)).toEqual([pos1OnlyCandidate]);
    expect(degradations.filter((degradation) => degradation.reason === "ROLE_ASSIGNMENT_IMPOSSIBLE")).toEqual([]);
  });

  test("without the binding, the same own hero is inferred at Pos1 and the candidate is dropped (lock is sensitive)", () => {
    const { recs, degradations } = run(makeContext());
    expect(recs).toEqual([]);
    expect(degradations.some((degradation) => degradation.reason === "ROLE_ASSIGNMENT_IMPOSSIBLE")).toBe(true);
  });
});
