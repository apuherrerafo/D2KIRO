import { describe, expect, test } from "bun:test";
import type { TeamCoachCandidate } from "@/features/team-coach/types";
import { mergeColumnCandidates } from "./merge-candidates";

// Fixtures inline (regla del proyecto: ninguna prueba lee datos reales). Ids arbitrarios.
function candidate(heroId: number, rank: number, extra: Partial<TeamCoachCandidate> = {}): TeamCoachCandidate {
  return { heroId, rank, score: null, reasons: [], isPrimary: false, ...extra };
}

describe("mergeColumnCandidates (Fase 3D: sin duplicados, sin perder únicos, sin tocar el orden)", () => {
  const top = [candidate(1, 1, { isPrimary: true }), candidate(2, 2), candidate(3, 3), candidate(4, 4)];
  // Pool numerado DENTRO del pool: el héroe 3 es #3 en top pero #2 en el pool; el 9 solo existe en el pool.
  const poolTop = [candidate(1, 1), candidate(3, 2), candidate(9, 3)];

  test("`general` es exactamente `top`, en su orden, sin duplicar héroes", () => {
    const merged = mergeColumnCandidates({ top, poolTop });
    expect(merged.general.map((entry) => entry.candidate.heroId)).toEqual([1, 2, 3, 4]);
  });

  test("un héroe que está en las dos listas aparece UNA vez y conserva sus dos números por separado", () => {
    const merged = mergeColumnCandidates({ top, poolTop });
    const three = merged.general.find((entry) => entry.candidate.heroId === 3);
    expect(three?.generalRank).toBe(3);
    expect(three?.poolRank).toBe(2);
    const all = [...merged.general, ...merged.poolOnly].map((entry) => entry.candidate.heroId);
    expect(new Set(all).size).toBe(all.length);
  });

  test("un candidato que solo existe en `poolTop` se conserva, sin puesto general inventado", () => {
    const merged = mergeColumnCandidates({ top, poolTop });
    expect(merged.poolOnly.map((entry) => entry.candidate.heroId)).toEqual([9]);
    expect(merged.poolOnly[0]?.generalRank).toBeNull();
    expect(merged.poolOnly[0]?.poolRank).toBe(3);
  });

  test("la unión no pierde ningún héroe de ninguna de las dos listas", () => {
    const merged = mergeColumnCandidates({ top, poolTop });
    const shown = new Set([...merged.general, ...merged.poolOnly].map((entry) => entry.candidate.heroId));
    const expected = new Set([...top, ...poolTop].map((entry) => entry.heroId));
    expect(shown).toEqual(expected);
  });

  test("no altera ningún `rank` ni `isPrimary` de `top` (el primario sigue siendo el de `top`, no el de `poolTop`)", () => {
    const merged = mergeColumnCandidates({ top, poolTop });
    expect(merged.general.map((entry) => entry.candidate.rank)).toEqual([1, 2, 3, 4]);
    expect(merged.general.find((entry) => entry.candidate.heroId === 1)?.candidate.isPrimary).toBe(true);
    expect(merged.general.filter((entry) => entry.candidate.isPrimary)).toHaveLength(1);
  });

  test("`risks` solo viene en el primer elemento de cada lista: se completa con el de la otra copia, sin inventar", () => {
    const risks = [{ vsHeroId: 77, why: "texto curado del motor" }];
    const merged = mergeColumnCandidates({
      top: [candidate(1, 1), candidate(3, 2)],
      poolTop: [candidate(3, 1, { risks })],
    });
    expect(merged.general.find((entry) => entry.candidate.heroId === 3)?.candidate.risks).toEqual(risks);
    expect(merged.general.find((entry) => entry.candidate.heroId === 1)?.candidate.risks).toBeUndefined();
  });

  test("sin `poolTop` (motor anterior o sin pool): solo `general`, nada en `poolOnly`", () => {
    const merged = mergeColumnCandidates({ top, poolTop: undefined });
    expect(merged.poolOnly).toEqual([]);
    expect(merged.general.every((entry) => entry.poolRank === null)).toBe(true);
  });

  test("columna vacía (RANKED sin candidatos): no devuelve nada", () => {
    expect(mergeColumnCandidates({ top: [], poolTop: [] })).toEqual({ general: [], poolOnly: [] });
  });
});
