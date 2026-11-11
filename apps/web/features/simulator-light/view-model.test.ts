import { describe, expect, test } from "bun:test";
import type { TeamCoachBoardData, TeamCoachCandidate, TeamCoachColumn } from "@/features/team-coach/types";
import type { ColumnCandidate } from "./merge-candidates";
import { cardModelOf, decisionViewOf, noActionReasonOf, recommendationOf } from "./view-model";

// Fixtures inline (ninguna prueba lee datos reales). Ids arbitrarios.
function candidate(heroId: number, rank: number, extra: Partial<TeamCoachCandidate> = {}): TeamCoachCandidate {
  return { heroId, rank, score: null, reasons: [], isPrimary: false, evidenceStrength: "STRONG", ...extra };
}
function entryOf(value: TeamCoachCandidate): ColumnCandidate {
  return { candidate: value, generalRank: value.rank, poolRank: null };
}
const column = { position: 3 } as TeamCoachColumn;
const recommended = { position: 3 as const, heroId: 10, forMe: true, basis: "STRATEGIC" as const, reason: null };

describe("cardModelOf · D3 por composición (Fase 3D.1)", () => {
  const rec = entryOf(candidate(10, 1, { isPrimary: true }));
  const plain = entryOf(candidate(11, 2));
  const weak = entryOf(candidate(12, 3, { evidenceStrength: "WEAK" }));

  test("la recomendada seleccionada o no: StateTarget.state SIEMPRE = recommended; la selección va en `pressed`", () => {
    const off = cardModelOf({ entry: rec, column, recommendation: recommended, selected: false, showPlan: true });
    const on = cardModelOf({ entry: rec, column, recommendation: recommended, selected: true, showPlan: true });
    expect(off.state).toBe("recommended");
    expect(off.pressed).toBe(false);
    expect(on.state).toBe("recommended");
    expect(on.pressed).toBe(true);
    expect(on.notch).toBe("ELIGE AHORA");
  });

  test("un candidato común seleccionado NO cambia el estado del motor (rest); solo `pressed`", () => {
    const model = cardModelOf({ entry: plain, column, recommendation: recommended, selected: true, showPlan: true });
    expect(model.state).toBe("rest");
    expect(model.pressed).toBe(true);
  });

  test("evidencia limitada se mantiene como uncertain aunque se seleccione", () => {
    expect(cardModelOf({ entry: weak, column, recommendation: recommended, selected: true, showPlan: true }).state).toBe("uncertain");
  });

  test("la tarjeta nunca usa el estado selected del StateTarget (un canal por componente)", () => {
    for (const selected of [true, false]) {
      for (const entry of [rec, plain, weak]) {
        expect(cardModelOf({ entry, column, recommendation: recommended, selected, showPlan: true }).state).not.toBe("selected");
      }
    }
  });

  test("posición y puesto van por separado (el puesto de top y el del pool no se mezclan)", () => {
    const pooled: ColumnCandidate = { candidate: candidate(13, 4), generalRank: null, poolRank: 2 };
    const model = cardModelOf({ entry: pooled, column: { position: 3 } as TeamCoachColumn, recommendation: null, selected: false, showPlan: false });
    expect(model.rankText).toBe("#2 de tu pool");
  });
});

describe("recommendationOf · el ELIGE AHORA nunca se reasigna", () => {
  function board(heroId: number, strength: "STRONG" | "WEAK"): TeamCoachBoardData {
    return {
      currentDecision: { recommendedPosition: 3, recommendedHeroId: heroId, targetBasis: "STRATEGIC", reason: "por qué" },
      positions: [{ position: 3, top: [candidate(heroId, 1, { isPrimary: true, evidenceStrength: strength })] }],
    } as unknown as TeamCoachBoardData;
  }
  test("columna visible + primario + STRONG → recomendación", () => {
    expect(recommendationOf(board(10, "STRONG"), [3], 3)?.heroId).toBe(10);
  });
  test("columna NO visible → sin recomendación (no se reasigna a otro héroe)", () => {
    expect(recommendationOf(board(10, "STRONG"), [1], 1)).toBeNull();
  });
  test("evidencia WEAK → sin recomendación", () => {
    expect(recommendationOf(board(10, "WEAK"), [3], 3)).toBeNull();
  });
});

describe("recommendationOf · la razón es la que entrega el motor, sea cual sea el criterio", () => {
  function boardWith(basis: "STRATEGIC" | "DETERMINISTIC_DEFAULT" | "PHASE_FALLBACK" | null, reason: string): TeamCoachBoardData {
    return {
      currentDecision: { recommendedPosition: 3, recommendedHeroId: 10, targetBasis: basis, reason },
      positions: [{ position: 3, top: [candidate(10, 1, { isPrimary: true })] }],
    } as unknown as TeamCoachBoardData;
  }
  test("STRATEGIC, DETERMINISTIC_DEFAULT y PHASE_FALLBACK conservan su razón verbatim (el tablero anterior también la mostraba)", () => {
    for (const basis of ["STRATEGIC", "DETERMINISTIC_DEFAULT", "PHASE_FALLBACK"] as const) {
      const rec = recommendationOf(boardWith(basis, "razón del motor"), [3], 3);
      expect(rec?.reason).toBe("razón del motor");
      expect(rec?.basis).toBe(basis);
    }
  });
  test("razón vacía → null: nunca se inventa una", () => {
    expect(recommendationOf(boardWith("STRATEGIC", ""), [3], 3)?.reason).toBeNull();
  });
});

describe("decisionViewOf · la decisión del equipo no se le atribuye al héroe abierto", () => {
  const rec = { position: 3 as const, heroId: 10, forMe: true, basis: "STRATEGIC" as const, reason: "porque sí" };
  test("el héroe abierto ES el recomendado → sameAsOpen", () => {
    expect(decisionViewOf(rec, null, { position: 3, heroId: 10 })).toMatchObject({ kind: "recommended", heroId: 10, sameAsOpen: true, reason: "porque sí" });
  });
  test("otro héroe de la misma posición → sameAsOpen false; la vista sigue nombrando al recomendado", () => {
    expect(decisionViewOf(rec, null, { position: 3, heroId: 11 })).toMatchObject({ kind: "recommended", heroId: 10, sameAsOpen: false });
  });
  test("el mismo héroe pero en OTRA posición tampoco cuenta como el recomendado", () => {
    expect(decisionViewOf(rec, null, { position: 1, heroId: 10 })).toMatchObject({ kind: "recommended", sameAsOpen: false });
  });
  test("sin recomendación pero con aviso del motor → kind none; sin nada → null", () => {
    expect(decisionViewOf(null, "El draft terminó.", { position: 3, heroId: 10 })).toEqual({ kind: "none", reason: "El draft terminó." });
    expect(decisionViewOf(null, null, { position: 3, heroId: 10 })).toBeNull();
  });
});

describe("noActionReasonOf", () => {
  const withDecision = (decision: object) => ({ currentDecision: decision, positions: [] }) as unknown as TeamCoachBoardData;
  test("posición y héroe null + razón → se dice; con posición → no es «sin acción»", () => {
    expect(noActionReasonOf(withDecision({ recommendedPosition: null, recommendedHeroId: null, reason: "No hay un pick humano abierto en este momento." }))).toBe("No hay un pick humano abierto en este momento.");
    expect(noActionReasonOf(withDecision({ recommendedPosition: 3, recommendedHeroId: 10, reason: "x" }))).toBeNull();
    expect(noActionReasonOf(withDecision({ recommendedPosition: null, recommendedHeroId: null, reason: "" }))).toBeNull();
  });
});
