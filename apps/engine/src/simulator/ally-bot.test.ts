import { describe, expect, test } from "bun:test";
import { applyProtocolCommand, createProtocolState, type DraftProtocolState, type TeamSide } from "../draft-protocol";
import type { DraftState } from "../draft/reducer";
import { type HeroPositions } from "../signals/hero-positions";
import type { Suggestion, SuggestionSet } from "../signals/mix";
import type { DotaPosition } from "./ap-simulator-policy";
import { chooseAllyBotHero } from "./ally-bot";
import type { BotComputeSuggestions } from "./enemy-bot";

// Fixture position evidence: 10 heroes per position.
// Pos 1: 10..19, Pos 2: 20..29, Pos 3: 30..39, Pos 4: 40..49, Pos 5: 50..59.
const FIXTURE_POSITIONS: HeroPositions = {};
for (const position of [1, 2, 3, 4, 5] as DotaPosition[]) {
  for (let offset = 0; offset < 10; offset += 1) {
    FIXTURE_POSITIONS[position * 10 + offset] = [{ position, matches: 1000 }];
  }
}

function fakeSuggestionSet(state: DraftState, heroes: readonly number[]): SuggestionSet {
  const suggestions: Suggestion[] = heroes.slice(0, 6).map((hero, index) => ({
    hero,
    rank: (index + 1) as Suggestion["rank"],
    score: 100 - index,
    signals: [],
    reason: "fixture",
    confidence: "alta",
    evidenceCoverage: 1,
    guessingIndex: 0,
  }));
  return {
    schema: "suggestions/v1",
    sessionId: state.sessionId,
    basedOnSeq: 0,
    decisionContext: "closing_pick",
    suggestions,
    comparison: null,
    degraded: [],
    computedInMs: 0,
  } as SuggestionSet;
}

const rankingScorer: BotComputeSuggestions = async (state, _account, options) =>
  fakeSuggestionSet(state, options?.candidateHeroIds ?? []);

function freshRound1(bans: number[] = []): DraftProtocolState {
  const created = createProtocolState("ally-bot-test", "dota2/ranked-all-pick");
  if (!created.ok) throw new Error("setup failed");
  let state = created.state;
  if (bans.length > 0) {
    state = applyProtocolCommand(state, { type: "RECORD_RESOLVED_BANS", heroes: bans }).state;
  }
  return applyProtocolCommand(state, { type: "BAN_RESOLUTION_COMPLETE" }).state;
}

describe("Ally Bot -- selección determinista de aliados", () => {
  test("elige solo héroes admitidos para la posición asignada al asiento", async () => {
    const state = freshRound1();
    // PD-026/PD-027: position is chosen independently of seat/round -- this fixture targets Pos 5
    // (Hard Support: heroes 50..59) directly, never derived from a chronological seat.
    const pos5: DotaPosition = 5;

    const decision = await chooseAllyBotHero({
      seed: "SEED_A",
      side: "radiant",
      state,
      slotIndex: 0,
      rosterSlot: 0,
      position: pos5,
      decisionIndex: 0,
      patch: "7.41e",
      computeSuggestions: rankingScorer,
      heroPositions: FIXTURE_POSITIONS,
    });

    expect(decision).not.toBeNull();
    expect(decision!.position).toBe(5);
    // Must be in the Pos 5 universe (50..59)
    expect(decision!.heroId).toBeGreaterThanOrEqual(50);
    expect(decision!.heroId).toBeLessThanOrEqual(59);
  });

  test("respeta bans: nunca elige un héroe baneado en BAN_RESOLUTION", async () => {
    // Ban heroes 50, 51, 52, 53, 54, 55, 56, 57, 58 (leaving only 59 available for Pos 5)
    const bans = [50, 51, 52, 53, 54, 55, 56, 57, 58];
    const state = freshRound1(bans);
    const pos5: DotaPosition = 5;

    const decision = await chooseAllyBotHero({
      seed: "SEED_B",
      side: "radiant",
      state,
      slotIndex: 0,
      rosterSlot: 0,
      position: pos5,
      decisionIndex: 0,
      patch: "7.41e",
      computeSuggestions: rankingScorer,
      heroPositions: FIXTURE_POSITIONS,
    });

    expect(decision).not.toBeNull();
    expect(decision!.heroId).toBe(59);
  });

  test("respeta picks previos y del mismo lado: no elige un héroe ya sellado por un aliado", async () => {
    let state = freshRound1();
    // Ally human seals hero 50 in round 1 slot 0
    state = applyProtocolCommand(state, {
      type: "SUBMIT_SEALED_SELECTION",
      side: "radiant",
      slotIndex: 0,
      heroId: 50,
    }).state;

    // Ally Bot now picks for slot 1 (say Pos 4, but even if candidate had 50, 50 is taken)
    // Create an overlap where hero 50 was also listed for Pos 4
    const overlappingPositions: HeroPositions = {
      ...FIXTURE_POSITIONS,
      50: [{ position: 5, matches: 1000 }, { position: 4, matches: 1000 }],
    };

    const pos4: DotaPosition = 4;
    const decision = await chooseAllyBotHero({
      seed: "SEED_C",
      side: "radiant",
      state,
      slotIndex: 1,
      rosterSlot: 1,
      position: pos4,
      decisionIndex: 1,
      patch: "7.41e",
      computeSuggestions: rankingScorer,
      heroPositions: overlappingPositions,
    });

    expect(decision).not.toBeNull();
    expect(decision!.heroId).not.toBe(50);
  });

  test("CERO fuga de información enemiga: no inspecciona héroes enemigos sellados en la ronda actual", async () => {
    let state = freshRound1();
    // Enemy seals hero 40 in dire slot 0
    state = applyProtocolCommand(state, {
      type: "SUBMIT_SEALED_SELECTION",
      side: "dire",
      slotIndex: 0,
      heroId: 40,
    }).state;

    let inspectedState: DraftState | null = null;
    const inspectingScorer: BotComputeSuggestions = async (draft) => {
      inspectedState = draft;
      return fakeSuggestionSet(draft, [40, 41, 42]);
    };

    // Ally Bot picks for radiant slot 1 (Pos 4)
    await chooseAllyBotHero({
      seed: "SEED_D",
      side: "radiant",
      state,
      slotIndex: 1,
      rosterSlot: 1,
      position: 4,
      decisionIndex: 1,
      patch: "7.41e",
      computeSuggestions: inspectingScorer,
      heroPositions: FIXTURE_POSITIONS,
    });

    // The draft state passed to computeSuggestions MUST NOT have hero 40 in dire picks!
    expect(inspectedState).not.toBeNull();
    expect(inspectedState!.picks.dire).not.toContain(40);
    expect(inspectedState!.picks.dire).toHaveLength(0);
  });

  test("determinismo estricto: misma semilla + rol + índice => misma decisión", async () => {
    const state = freshRound1();
    const pos: DotaPosition = 3;

    const d1 = await chooseAllyBotHero({
      seed: "SAME_SEED",
      side: "radiant",
      state,
      slotIndex: 0,
      rosterSlot: 2,
      position: pos,
      decisionIndex: 0,
      patch: "7.41e",
      computeSuggestions: rankingScorer,
      heroPositions: FIXTURE_POSITIONS,
    });

    const d2 = await chooseAllyBotHero({
      seed: "SAME_SEED",
      side: "radiant",
      state,
      slotIndex: 0,
      rosterSlot: 2,
      position: pos,
      decisionIndex: 0,
      patch: "7.41e",
      computeSuggestions: rankingScorer,
      heroPositions: FIXTURE_POSITIONS,
    });

    expect(d1).not.toBeNull();
    expect(d2).not.toBeNull();
    expect(d1!.heroId).toBe(d2!.heroId);
    expect(d1!.position).toBe(d2!.position);
  });

  test("retorna null si no hay candidatos legales admitidos", async () => {
    // Ban ALL 10 heroes of Pos 5
    const bans = [50, 51, 52, 53, 54, 55, 56, 57, 58, 59];
    const state = freshRound1(bans);
    const pos5: DotaPosition = 5;

    const decision = await chooseAllyBotHero({
      seed: "SEED_EMPTY",
      side: "radiant",
      state,
      slotIndex: 0,
      rosterSlot: 0,
      position: pos5,
      decisionIndex: 0,
      patch: "7.41e",
      computeSuggestions: rankingScorer,
      heroPositions: FIXTURE_POSITIONS,
    });

    expect(decision).toBeNull();
  });
});
