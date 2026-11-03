import { describe, expect, test } from "bun:test";
import { applyProtocolCommand, createProtocolState, type DraftProtocolState, type TeamSide } from "../draft-protocol";
import type { DraftState } from "../draft/reducer";
import { isCandidateAdmittedForPosition, type HeroPositions } from "../signals/hero-positions";
import type { Suggestion, SuggestionSet } from "../signals/mix";
import type { DotaPosition } from "./ap-simulator-policy";
import {
  chooseEnemyBotHero,
  createEnemyBotConfig,
  deriveInternalPositionAssignments,
  type BotComputeSuggestions,
  type EnemyBotConfig,
} from "./enemy-bot";

// Fixture position evidence (S10): 10 heroes per position, exactly one listed position each.
// heroes 10..19 -> Pos1, 20..29 -> Pos2, 30..39 -> Pos3, 40..49 -> Pos4, 50..59 -> Pos5.
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
    score: 100 - index, // all inside the 5-point quality band -> the seed decides
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

/** Ranks whatever universe the bot restricted it to -- never invents a hero outside candidateHeroIds. */
const rankingScorer: BotComputeSuggestions = async (state, _account, options) =>
  fakeSuggestionSet(state, options?.candidateHeroIds ?? []);

function freshRound1(): DraftProtocolState {
  const created = createProtocolState("bot-test", "dota2/ranked-all-pick");
  if (!created.ok) throw new Error("setup");
  return applyProtocolCommand(created.state, { type: "BAN_RESOLUTION_COMPLETE" }).state;
}

/** Fills the current round with unique filler heroes (100+) for both sides so the kernel moves on. */
function advanceRound(state: DraftProtocolState, filler: { next: number }): DraftProtocolState {
  let next = state;
  for (const slot of [...(next.rankedAp?.round?.openSlots ?? [])]) {
    next = applyProtocolCommand(next, {
      type: "SUBMIT_SEALED_SELECTION",
      side: slot.side,
      slotIndex: slot.slotIndex,
      heroId: (filler.next += 1),
    }).state;
  }
  return next;
}

function stateAtSeat(rosterSlot: number): { state: DraftProtocolState; slotIndex: number } {
  const filler = { next: 100 };
  let state = freshRound1();
  if (rosterSlot >= 2) state = advanceRound(state, filler);
  if (rosterSlot >= 4) state = advanceRound(state, filler);
  const slotIndex = rosterSlot <= 1 ? rosterSlot : rosterSlot <= 3 ? rosterSlot - 2 : 0;
  return { state, slotIndex };
}

describe("Enemy Bot -- internal position assignments", () => {
  test("es una permutacion de Pos1..Pos5 sobre los 5 asientos", () => {
    for (const seed of ["AAAAAAAA", "BBBBBBBB", "D2K00001", "ZZZZ9999"]) {
      for (const side of ["radiant", "dire"] as const) {
        const assignments = deriveInternalPositionAssignments(seed, side);
        expect(Object.keys(assignments).map(Number).sort()).toEqual([0, 1, 2, 3, 4]);
        expect(Object.values(assignments).sort()).toEqual([1, 2, 3, 4, 5]);
      }
    }
  });

  test("determinista por seed; distintas seeds producen distintas asignaciones", () => {
    expect(deriveInternalPositionAssignments("D2K00001", "dire")).toEqual(deriveInternalPositionAssignments("D2K00001", "dire"));
    const variants = new Set(
      Array.from({ length: 30 }, (_, index) => JSON.stringify(deriveInternalPositionAssignments(`SEED${index}`, "dire"))),
    );
    expect(variants.size).toBeGreaterThan(5);
  });

  test("la posicion NO depende del orden de pick: sobre muchas seeds, cada rol cae en asientos de las tres rondas", () => {
    const seatsForPos1 = new Set<number>();
    for (let index = 0; index < 60; index += 1) {
      const assignments = deriveInternalPositionAssignments(`SEED${index}`, "dire");
      for (const [seat, position] of Object.entries(assignments)) if (position === 1) seatsForPos1.add(Number(seat));
    }
    expect([...seatsForPos1].sort()).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("Enemy Bot -- cada asiento recibe un heroe valido para su posicion asignada", () => {
  for (const botSide of ["radiant", "dire"] as TeamSide[]) {
    test(`los 5 asientos del bot (${botSide}): Pos1..Pos5 reciben un heroe de su posicion`, async () => {
      const config = createEnemyBotConfig("D2K00001", botSide);
      const seenPositions = new Set<number>();
      for (let rosterSlot = 0; rosterSlot < 5; rosterSlot += 1) {
        const { state, slotIndex } = stateAtSeat(rosterSlot);
        const decision = await chooseEnemyBotHero({
          config,
          state,
          slotIndex,
          rosterSlot,
          decisionIndex: rosterSlot,
          patch: "7.41e",
          computeSuggestions: rankingScorer,
          heroPositions: FIXTURE_POSITIONS,
        });
        expect(decision).not.toBeNull();
        const assigned = config.internalPositionAssignments[rosterSlot]!;
        expect(decision!.position).toBe(assigned);
        expect(isCandidateAdmittedForPosition(decision!.heroId, assigned, FIXTURE_POSITIONS)).toBe(true);
        expect(Math.floor(decision!.heroId / 10)).toBe(assigned); // fixture: hero id tens digit == position
        seenPositions.add(assigned);
      }
      expect([...seenPositions].sort()).toEqual([1, 2, 3, 4, 5]);
    });
  }

  test("aunque el scorer devuelva heroes fuera de posicion, el bot nunca los elige", async () => {
    const config = createEnemyBotConfig("D2K00001", "dire");
    const noisyScorer: BotComputeSuggestions = async (state) => fakeSuggestionSet(state, [50, 51, 52, 53, 54, 55]);
    const rosterSlot = 0;
    const assigned = config.internalPositionAssignments[rosterSlot]!;
    const { state, slotIndex } = stateAtSeat(rosterSlot);
    const decision = await chooseEnemyBotHero({
      config,
      state,
      slotIndex,
      rosterSlot,
      decisionIndex: 0,
      patch: "7.41e",
      computeSuggestions: noisyScorer,
      heroPositions: FIXTURE_POSITIONS,
    });
    if (assigned === 5) expect(decision?.heroId).toBeGreaterThanOrEqual(50);
    else expect(decision).toBeNull();
  });

  test("sin ningun heroe admisible -> null (nunca un pick invalido)", async () => {
    const config: EnemyBotConfig = { side: "dire", seed: "X", internalPositionAssignments: { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5 } };
    const { state, slotIndex } = stateAtSeat(0);
    const decision = await chooseEnemyBotHero({
      config,
      state,
      slotIndex,
      rosterSlot: 0,
      decisionIndex: 0,
      patch: "7.41e",
      computeSuggestions: rankingScorer,
      heroPositions: {},
    });
    expect(decision).toBeNull();
  });
});

describe("Enemy Bot -- determinismo y variacion", () => {
  async function pick(seed: string, rosterSlot: number, decisionIndex: number): Promise<number | undefined> {
    const config = createEnemyBotConfig(seed, "dire");
    const { state, slotIndex } = stateAtSeat(rosterSlot);
    const decision = await chooseEnemyBotHero({
      config,
      state,
      slotIndex,
      rosterSlot,
      decisionIndex,
      patch: "7.41e",
      computeSuggestions: rankingScorer,
      heroPositions: FIXTURE_POSITIONS,
    });
    return decision?.heroId;
  }

  async function run(seed: string): Promise<(number | undefined)[]> {
    return Promise.all([0, 1, 2, 3, 4].map((seat) => pick(seed, seat, seat)));
  }

  test("misma seed => misma secuencia de los 5 picks", async () => {
    expect(await run("D2K00001")).toEqual(await run("D2K00001"));
  });

  test("distinta seed => variacion valida en al menos un pick", async () => {
    const baseline = JSON.stringify(await run("D2K00001"));
    const others = await Promise.all(["D2K00002", "D2K00003", "ABCDEFGH", "QWERTY12"].map(run));
    expect(others.some((sequence) => JSON.stringify(sequence) !== baseline)).toBe(true);
    for (const sequence of others) for (const heroId of sequence) expect(heroId).toBeGreaterThanOrEqual(10);
  });

  // Wave 5 Task 34: EACH of three different seeds must differ from the baseline in at least one of the five slots
  // (the test above only requires that SOME seed does), and every seed must replay byte-identically.
  test("tres seeds distintas: cada una difiere del baseline en >= 1 asiento, y cada una se repite idéntica", async () => {
    const baseline = await run("D2K00001");
    for (const seed of ["D2K00002", "D2K00003", "ABCDEFGH"]) {
      const sequence = await run(seed);
      expect(sequence.some((heroId, seat) => heroId !== baseline[seat])).toBe(true);
      expect(JSON.stringify(await run(seed))).toBe(JSON.stringify(sequence));
      expect(sequence).toHaveLength(5);
      expect(sequence.every((heroId) => heroId !== undefined)).toBe(true);
    }
  });
});

describe("Enemy Bot -- informacion oculta simetrica", () => {
  test("un pick sellado (oculto) del Player NO se le quita al bot: el mismo heroe sigue siendo elegible", async () => {
    // Bot = dire, seat 0 is assigned Pos1 for this config; Pos1 has exactly ONE hero on record (10).
    const positions: HeroPositions = { 10: [{ position: 1, matches: 1000 }], 20: [{ position: 2, matches: 1000 }] };
    const config: EnemyBotConfig = { side: "dire", seed: "S", internalPositionAssignments: { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5 } };
    let state = freshRound1();
    // The Player secretly seals hero 10.
    state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 10 }).state;
    let visibleToBot: DraftState | null = null;
    const spy: BotComputeSuggestions = async (legacy, account, options) => {
      visibleToBot = legacy;
      return rankingScorer(legacy, account, options);
    };
    const decision = await chooseEnemyBotHero({
      config,
      state,
      slotIndex: 0,
      rosterSlot: 0,
      decisionIndex: 0,
      patch: "7.41e",
      computeSuggestions: spy,
      heroPositions: positions,
    });
    expect(decision?.heroId).toBe(10);
    // ...and the suggestion input the bot used never contained the Player hidden pick.
    expect(visibleToBot!.picks.radiant).not.toContain(10);
    expect(visibleToBot!.picks.dire).not.toContain(10);
  });

  test("la asignacion interna nunca sale en la decision del bot (solo heroId + posicion del asiento propio)", async () => {
    const config = createEnemyBotConfig("D2K00001", "dire");
    const { state, slotIndex } = stateAtSeat(0);
    const decision = await chooseEnemyBotHero({
      config,
      state,
      slotIndex,
      rosterSlot: 0,
      decisionIndex: 0,
      patch: "7.41e",
      computeSuggestions: rankingScorer,
      heroPositions: FIXTURE_POSITIONS,
    });
    expect(Object.keys(decision!).sort()).toEqual(["heroId", "position"]);
  });
});
