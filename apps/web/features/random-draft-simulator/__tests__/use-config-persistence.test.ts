// Feature: random-draft-simulator
// Property 3: Persistencia en localStorage es round-trip
// Validates: Requirements 1.5
//
// El store de localStorage en sí es una capa trivial de string en/string out —
// la lógica que puede fallar es serializar/deserializar + validar la estructura.
// Se prueba esa capa pura directamente, sin `window`/`localStorage` (no hay entorno
// DOM en `bun test` en este proyecto — ver testing-seams.md, ninguna prueba de este
// feature depende de un DOM real).

import { test, expect } from "bun:test";
import { validatePersistedConfig, type PersistedConfig } from "../use-config-persistence";
import type { HeroId } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomPersistedConfig(caseIndex: number): PersistedConfig {
  const userSide = caseIndex % 2 === 0 ? "radiant" : "dire";
  const listSize = caseIndex % 5; // 0-4
  const personalBanList: HeroId[] = Array.from({ length: listSize }, (_, i) => i + 1);
  return { userSide, playerPosition: ((caseIndex % 5) + 1) as 1 | 2 | 3 | 4 | 5, personalBanList };
}

// ---------------------------------------------------------------------------
// Property 3: round-trip serializar → parsear → validar preserva la config
// Validates: Requirements 1.5
// ---------------------------------------------------------------------------

test("Property 3: JSON.stringify -> JSON.parse -> validatePersistedConfig preserva la config (100 casos)", () => {
  // Feature: random-draft-simulator, Property 3: Persistencia en localStorage es round-trip
  for (let caseIndex = 0; caseIndex < 100; caseIndex++) {
    const original = randomPersistedConfig(caseIndex);

    const serialized = JSON.stringify(original);
    const roundTripped = validatePersistedConfig(JSON.parse(serialized));

    expect(roundTripped).toEqual(original);
  }
});

// ---------------------------------------------------------------------------
// Req. 1.5 (fallback seguro): estructuras inválidas retornan null, nunca lanzan
// ---------------------------------------------------------------------------

test("validatePersistedConfig retorna null para estructuras inválidas sin lanzar", () => {
  const invalidCases: unknown[] = [
    null,
    undefined,
    "not-an-object",
    42,
    {},
    { userSide: "top" },
    { userSide: "radiant" },
    { userSide: "radiant", personalBanList: "not-an-array" },
    { userSide: "radiant", personalBanList: [1, 2, 3, 4, 5] },
    { userSide: "radiant", personalBanList: [1, -2, 3] },
    { userSide: "radiant", personalBanList: [1, 2.5, 3] },
  ];

  for (const invalid of invalidCases) {
    expect(validatePersistedConfig(invalid)).toBeNull();
  }
});
