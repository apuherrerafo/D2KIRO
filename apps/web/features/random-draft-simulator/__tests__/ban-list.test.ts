// Feature: random-draft-simulator
// Property 1: Personal_Ban_List acepta listas de 0 a 4 héroes y rechaza la quinta adición
// Property 2: Personal_Ban_List rechaza duplicados
// Property 4: Eliminación de héroe reduce longitud en 1
// Validates: Requirements 1.2, 1.3, 1.4, 1.6

import { test, expect } from "bun:test";
import { addHeroToBanList, removeHeroFromBanList } from "../ban-list";
import type { HeroId } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Genera un HeroId positivo único dentro de un rango dado. */
function heroId(n: number): HeroId {
  return (n + 1) as HeroId;
}

/**
 * Devuelve N HeroIds únicos: [1, 2, ..., N].
 * N debe ser ≤ 150 (tamaño aproximado del pool real).
 */
function uniqueHeroes(n: number): HeroId[] {
  return Array.from({ length: n }, (_, i) => heroId(i));
}

// ---------------------------------------------------------------------------
// Property 1: acepta listas de 0–4 héroes; rechaza la quinta adición
// Validates: Requirements 1.2, 1.4
// ---------------------------------------------------------------------------

test("Property 1: añadir héroe a lista de 0–3 retorna ok:true (100 casos)", function addToSmallListAlwaysOk() {
  // Feature: random-draft-simulator, Property 1: Personal_Ban_List acepta listas de 0 a 4 héroes y rechaza la quinta adición
  const results = Array.from({ length: 100 }, function generateCase(_, caseIndex) {
    // Tamaño de lista: distribuimos 0-3 ciclando
    const listSize = caseIndex % 4; // 0, 1, 2, 3
    const heroPool = uniqueHeroes(10);
    const list = heroPool.slice(0, listSize) as HeroId[];
    const newHero = heroPool[listSize]; // distinto a los ya presentes

    const result = addHeroToBanList(list, newHero);
    return { result, listSize };
  });

  for (const { result, listSize } of results) {
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.list).toHaveLength(listSize + 1);
    }
  }
});

test("Property 1: añadir héroe a lista de 4 retorna ok:false (100 casos)", function addToFullListAlwaysFails() {
  // Feature: random-draft-simulator, Property 1: Personal_Ban_List acepta listas de 0 a 4 héroes y rechaza la quinta adición
  const results = Array.from({ length: 100 }, function generateCase(_, caseIndex) {
    // Variamos qué héroes están en la lista para cubrir distintos conjuntos
    const offset = caseIndex * 5;
    const list = Array.from({ length: 4 }, (_, i) => heroId(offset + i));
    const newHero = heroId(offset + 4); // 5to héroe distinto

    return addHeroToBanList(list, newHero);
  });

  for (const result of results) {
    expect(result.ok).toBe(false);
  }
});

// ---------------------------------------------------------------------------
// Property 2: rechaza duplicados
// Validates: Requirement 1.3
// ---------------------------------------------------------------------------

test("Property 2: agregar el mismo héroe dos veces retorna ok:false en la segunda adición (100 casos)", function duplicateHeroRejected() {
  // Feature: random-draft-simulator, Property 2: Personal_Ban_List rechaza duplicados
  const results = Array.from({ length: 100 }, function generateCase(_, caseIndex) {
    // Lista de tamaño 0–2 para que haya espacio y el rechazo sea por duplicado, no por límite
    const listSize = caseIndex % 3; // 0, 1, 2
    const heroPool = uniqueHeroes(10);
    const list = heroPool.slice(0, listSize) as HeroId[];
    const duplicate = heroPool[listSize];

    // Primera adición: debe aceptarse
    const firstAdd = addHeroToBanList(list, duplicate);
    if (!firstAdd.ok) {
      // Esto no debería ocurrir; si ocurre, el caso es inválido
      return { firstOk: false, secondOk: false };
    }

    // Segunda adición del mismo héroe: debe rechazarse
    const secondAdd = addHeroToBanList(firstAdd.list, duplicate);
    return { firstOk: firstAdd.ok, secondOk: secondAdd.ok };
  });

  for (const { firstOk, secondOk } of results) {
    expect(firstOk).toBe(true);
    expect(secondOk).toBe(false);
  }
});

// ---------------------------------------------------------------------------
// Property 4: eliminar héroe reduce la longitud en 1
// Validates: Requirement 1.6
// ---------------------------------------------------------------------------

test("Property 4: removeHeroFromBanList reduce la longitud en exactamente 1 (100 casos)", function removingHeroReducesLengthByOne() {
  // Feature: random-draft-simulator, Property 4: Eliminación de héroe reduce longitud en 1
  const results = Array.from({ length: 100 }, function generateCase(_, caseIndex) {
    // Tamaño de lista: 1–4 (removiendo un héroe presente)
    const listSize = (caseIndex % 4) + 1; // 1, 2, 3, 4
    const heroPool = uniqueHeroes(listSize + 1);
    const list = heroPool.slice(0, listSize) as HeroId[];

    // Elegimos qué héroe remover variando el índice
    const removeIndex = caseIndex % listSize;
    const heroToRemove = list[removeIndex];

    const after = removeHeroFromBanList(list, heroToRemove);
    return { before: list.length, after };
  });

  for (const { before, after } of results) {
    expect(after.length).toBe(before - 1);
  }
});

test("Property 4: el héroe eliminado no aparece en la lista resultante (100 casos)", function removedHeroAbsentFromResult() {
  // Feature: random-draft-simulator, Property 4: Eliminación de héroe reduce longitud en 1
  const results = Array.from({ length: 100 }, function generateCase(_, caseIndex) {
    const listSize = (caseIndex % 4) + 1;
    const heroPool = uniqueHeroes(listSize + 1);
    const list = heroPool.slice(0, listSize) as HeroId[];

    const removeIndex = caseIndex % listSize;
    const heroToRemove = list[removeIndex];
    const after = removeHeroFromBanList(list, heroToRemove);

    return { heroToRemove, after };
  });

  for (const { heroToRemove, after } of results) {
    expect(after.includes(heroToRemove)).toBe(false);
  }
});
