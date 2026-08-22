// Feature: random-draft-simulator, Property 17: Serialización round-trip preserva todos los campos
// Feature: random-draft-simulator, Property 18: Deserialización con campo inválido identifica el campo específico
// Validates: Requirements 10.2, 10.3, 10.4

import { test, expect } from "bun:test";
import {
  validateDraftSessionSnapshot,
  type DraftSessionSnapshot,
  type PicksByRound,
} from "../types";

// ---------------------------------------------------------------------------
// Helpers — generadores manuales de datos válidos
// ---------------------------------------------------------------------------

const VALID_SEEDS = [
  "AAAAAAAA", "ZZZZZZZZ", "00000000", "Z9Z9Z9Z9",
  "ABCDEFG1", "12345678", "DEADBEEF", "CAFEBABE",
];

function makeSeed(i: number): string {
  return VALID_SEEDS[i % VALID_SEEDS.length];
}

function makeHeroId(base: number): number {
  // HeroId must be a positive integer
  return (base % 200) + 1;
}

function makeHeroIds(count: number, offset: number): number[] {
  return Array.from({ length: count }, (_, i) => makeHeroId(offset + i * 3));
}

function makePicksByRound(offset: number): [PicksByRound, PicksByRound, PicksByRound] {
  return [
    { userPicks: makeHeroIds(2, offset),      botPicks: makeHeroIds(2, offset + 50) },
    { userPicks: makeHeroIds(2, offset + 10), botPicks: makeHeroIds(2, offset + 60) },
    { userPicks: makeHeroIds(1, offset + 20), botPicks: makeHeroIds(1, offset + 70) },
  ];
}

function makeValidSnapshot(i: number): DraftSessionSnapshot {
  const offset = (i * 7) % 180;
  return {
    draftSeed: makeSeed(i),
    userSide: i % 2 === 0 ? "radiant" : "dire",
    personalBanList: makeHeroIds(i % 5, offset + 100),
    resolvedBans: makeHeroIds((i % 16) + 1, offset + 120),
    picksByRound: makePicksByRound(offset),
    hiddenBotPicks: makeHeroIds(i % 11, offset + 140),
  };
}

// ---------------------------------------------------------------------------
// Property 17: Serialización round-trip preserva todos los campos
// Validates: Requirements 10.2, 10.3
// ---------------------------------------------------------------------------

test("Property 17 — round-trip JSON preserva todos los campos del snapshot", () => {
  // Feature: random-draft-simulator, Property 17: Serialización round-trip preserva todos los campos
  const cases = Array.from({ length: 100 }, (_, i) => makeValidSnapshot(i));

  for (const original of cases) {
    const serialized = JSON.stringify(original);
    const parsed: unknown = JSON.parse(serialized);
    const result = validateDraftSessionSnapshot(parsed);

    expect(result.ok).toBe(true);
    if (!result.ok) continue; // type narrowing — above assertion already fails the test

    const restored = result.value;

    // Each field must equal the original
    expect(restored.draftSeed).toBe(original.draftSeed);
    expect(restored.userSide).toBe(original.userSide);
    expect(restored.personalBanList).toEqual(original.personalBanList);
    expect(restored.resolvedBans).toEqual(original.resolvedBans);
    expect(restored.hiddenBotPicks).toEqual(original.hiddenBotPicks);

    // picksByRound: all 3 rounds, both sides
    for (let r = 0; r < 3; r++) {
      expect(restored.picksByRound[r].userPicks).toEqual(original.picksByRound[r].userPicks);
      expect(restored.picksByRound[r].botPicks).toEqual(original.picksByRound[r].botPicks);
    }
  }
});

// ---------------------------------------------------------------------------
// Property 18: Deserialización con campo inválido identifica el campo específico
// Validates: Requirement 10.4
// ---------------------------------------------------------------------------

type SnapshotKey = keyof DraftSessionSnapshot;

interface MutationCase {
  field: SnapshotKey | string;
  mutate: (s: Record<string, unknown>) => void;
}

const mutations: MutationCase[] = [
  { field: "draftSeed",       mutate: (s) => { s["draftSeed"] = "toolong!!"; } },
  { field: "draftSeed",       mutate: (s) => { s["draftSeed"] = 12345678; } },
  { field: "draftSeed",       mutate: (s) => { s["draftSeed"] = "abc"; } },
  { field: "userSide",        mutate: (s) => { s["userSide"] = "mid"; } },
  { field: "userSide",        mutate: (s) => { s["userSide"] = null; } },
  { field: "personalBanList", mutate: (s) => { s["personalBanList"] = "notanarray"; } },
  { field: "personalBanList", mutate: (s) => { s["personalBanList"] = [1, 2, 3, 4, 5]; } },
  { field: "personalBanList", mutate: (s) => { s["personalBanList"] = [0, 1]; } }, // 0 is not positive
  { field: "resolvedBans",    mutate: (s) => { s["resolvedBans"] = null; } },
  { field: "resolvedBans",    mutate: (s) => { s["resolvedBans"] = Array.from({ length: 21 }, (_, i) => i + 1); } },
  { field: "picksByRound",    mutate: (s) => { s["picksByRound"] = []; } },
  { field: "picksByRound",    mutate: (s) => { s["picksByRound"] = "notanarray"; } },
  { field: "picksByRound[0]", mutate: (s) => { (s["picksByRound"] as unknown[])[0] = { userPicks: "bad", botPicks: [] }; } },
  { field: "picksByRound[1]", mutate: (s) => { (s["picksByRound"] as unknown[])[1] = { userPicks: [], botPicks: [-1] }; } },
  { field: "picksByRound[2]", mutate: (s) => { (s["picksByRound"] as unknown[])[2] = null; } },
  { field: "hiddenBotPicks",  mutate: (s) => { s["hiddenBotPicks"] = "notanarray"; } },
  { field: "hiddenBotPicks",  mutate: (s) => { s["hiddenBotPicks"] = Array.from({ length: 11 }, (_, i) => i + 1); } },
];

test("Property 18 — campo inválido identificado por nombre específico", () => {
  // Feature: random-draft-simulator, Property 18: Deserialización con campo inválido identifica el campo específico
  const baseSnapshots = Array.from({ length: 10 }, (_, i) => makeValidSnapshot(i));

  for (const mutation of mutations) {
    for (const base of baseSnapshots) {
      // Deep-clone via JSON so we don't mutate the original
      const obj = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
      mutation.mutate(obj);

      const result = validateDraftSessionSnapshot(obj);

      expect(result.ok).toBe(false);
      if (result.ok) continue; // narrowing

      // The reported field must match the mutated field
      expect(result.field).toBe(mutation.field);
    }
  }
});
