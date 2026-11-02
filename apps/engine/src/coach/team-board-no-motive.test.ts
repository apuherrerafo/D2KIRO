import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import { buildRecommendationSetFromPerspective } from "../recommendation/build-from-perspective";
import type { ComputeSuggestionsForRecommendation, PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import { buildTeamCoachBoard } from "./team-coach-board";
import { fakeCompute, harness, HERO_POSITIONS } from "./session-harness.fixtures";

// Regla "sin motivo no se recomienda" (2026-11-02), PR #88, hallazgo del revisor: las alternativas de una columna
// UNRANKED_POSITIONAL son héroes legales en orden de id, SIN preferencia alguna. Nunca pueden volverse "el héroe recomendado"
// del Team Coach (la web pintaría "Elige a X como <posición>" con X = el de id más bajo). Fixtures inline; sin datos curados reales.

const ALL: Position[] = [1, 2, 3, 4, 5];

/** El mismo stand-in de V6 pero sin ninguna razón aparte del rol: se quita la señal de parche de cada héroe. */
function roleOnlyCompute(): ComputeSuggestionsForRecommendation {
  const base = fakeCompute();
  return async (...args) => {
    const set = await base(...args);
    return {
      ...set,
      suggestions: set.suggestions.map((suggestion) => ({ ...suggestion, signals: suggestion.signals.filter((signal) => signal.signal !== "patch_meta") })),
      functionalEvidence: set.functionalEvidence
        ? { ...set.functionalEvidence, signalEvidence: set.functionalEvidence.signalEvidence.map((entry) => ({ ...entry, signals: entry.signals.filter((signal) => signal.signal !== "patch_meta") })) }
        : set.functionalEvidence,
    };
  };
}

async function boardWith(compute: ComputeSuggestionsForRecommendation) {
  const h = harness({ adapterKind: "simulator", controlledPositions: ALL });
  const context: PerspectiveRecommendationContext = { ...h.store.perspectiveRecommendationContext(h.id)!, playerPoolsByPosition: null };
  const board = await buildTeamCoachBoard({
    context,
    playerPersonalPosition: 4,
    heroPositions: HERO_POSITIONS,
    buildTargetRanking: (ctx, targetPosition) =>
      buildRecommendationSetFromPerspective({ context: ctx, computeSuggestions: compute, heroPositions: HERO_POSITIONS, targetPosition, teamOpening: false, singleSlotEvaluation: true }),
  });
  return board!;
}

describe("Team Coach Board -- una columna sin ranking nunca nombra un héroe recomendado", () => {
  test("control: con motivo propio en cada héroe, las columnas son RANKED y cada una tiene su héroe recomendado", async () => {
    const board = await boardWith(fakeCompute());
    const open = board.positions.filter((column) => column.eligibleNow);
    expect(open.length).toBeGreaterThan(0);
    for (const column of open) {
      expect(column.state).toBe("RANKED");
      expect(column.primaryHeroId).not.toBeNull();
    }
    expect(board.currentDecision.recommendedHeroId).not.toBeNull();
  });

  test("sin ninguna razón aparte del rol: todas las columnas abiertas quedan UNRANKED y NINGUNA tiene héroe primario ni recomendado", async () => {
    const board = await boardWith(roleOnlyCompute());
    const open = board.positions.filter((column) => column.eligibleNow);
    expect(open.length).toBeGreaterThan(0);
    for (const column of open) {
      expect(column.state).toBe("UNRANKED_POSITIONAL");
      expect(column.primaryHeroId).toBeNull();
      expect(column.top.some((candidate) => candidate.isPrimary)).toBe(false);
      expect(column.note?.startsWith("Sin recomendación con motivo")).toBe(true);
    }
    expect(board.currentDecision.recommendedHeroId).toBeNull();
  });
});
