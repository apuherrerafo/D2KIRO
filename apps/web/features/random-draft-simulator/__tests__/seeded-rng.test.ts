// apps/web/features/random-draft-simulator/__tests__/seeded-rng.test.ts
import { test, expect } from "bun:test";
import { createSeededRng, generateDraftSeed } from "../seeded-rng";
import { SEED_PATTERN } from "../constants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEED_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomValidSeed(): string {
  return Array.from(
    { length: 8 },
    () => SEED_CHARS[Math.floor(Math.random() * SEED_CHARS.length)],
  ).join("");
}

// ---------------------------------------------------------------------------
// Feature: random-draft-simulator, Property 6: Ban_Phase es determinística
// dado el mismo seed y Personal_Ban_List
// Validates: Requirements 8.5
// ---------------------------------------------------------------------------

test("Property 6: dos instancias con el mismo seed producen la misma secuencia", () => {
  // Feature: random-draft-simulator, Property 6: Ban_Phase es determinística dado el mismo seed y Personal_Ban_List
  const N = 20; // llamadas a next() por instancia

  const results = Array.from({ length: 100 }, () => {
    const seed = randomValidSeed();

    const rng1 = createSeededRng(seed);
    const rng2 = createSeededRng(seed);

    const seq1 = Array.from({ length: N }, () => rng1.next());
    const seq2 = Array.from({ length: N }, () => rng2.next());

    return { seed, seq1, seq2 };
  });

  for (const { seq1, seq2 } of results) {
    expect(seq1).toEqual(seq2);
    // Extra: every value is in [0, 1)
    for (const v of seq1) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  }
});

// ---------------------------------------------------------------------------
// Feature: random-draft-simulator, Property 14: draftSeed auto-generado
// cumple el formato requerido
// Validates: Requirements 8.1
// ---------------------------------------------------------------------------

test("Property 14: generateDraftSeed cumple SEED_PATTERN /^[A-Z0-9]{8}$/ (100 casos)", () => {
  // Feature: random-draft-simulator, Property 14: draftSeed auto-generado cumple el formato requerido
  const seeds = Array.from({ length: 100 }, () => generateDraftSeed());

  for (const seed of seeds) {
    expect(SEED_PATTERN.test(seed)).toBe(true);
  }
});
