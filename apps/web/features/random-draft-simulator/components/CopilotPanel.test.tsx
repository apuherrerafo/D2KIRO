import "@/test-support/happy-dom";

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import { NOT_COMPUTED, type RecommendationSetV2, type RecommendationV2 } from "../protocol-client";
import { CopilotPanel } from "./CopilotPanel";

afterEach(cleanup);

function singleAction(hero: number, score: number): RecommendationV2 {
  return {
    actions: [{ slot: { side: "radiant", slotIndex: 0 }, hero }],
    score,
    confidence: "media",
    roleImpact: { [hero]: { status: "LIKELY", position: 1, marginals: { 1: 0.6, 2: 0.1, 3: 0.1, 4: 0.1, 5: 0.1 }, entropy: 1.8 } },
    risks: [],
    legacy: { hero, signals: [], evidenceCoverage: 0.62, guessingIndex: 0.38, reason: `Resumen táctico ${hero}.` },
  };
}

function compound(heroA: number, heroB: number, score: number): RecommendationV2 {
  return {
    actions: [
      { slot: { side: "radiant", slotIndex: 0 }, hero: heroA },
      { slot: { side: "radiant", slotIndex: 1 }, hero: heroB },
    ],
    score,
    confidence: "alta",
    roleImpact: {
      [heroA]: { status: "LIKELY", position: 1, marginals: { 1: 0.7, 2: 0.1, 3: 0.1, 4: 0.05, 5: 0.05 }, entropy: 1.2 },
      [heroB]: { status: "LIKELY", position: 3, marginals: { 1: 0.1, 2: 0.1, 3: 0.6, 4: 0.1, 5: 0.1 }, entropy: 1.6 },
    },
    risks: [],
    legacy: null,
  };
}

function recommendationSet(overrides: Partial<RecommendationSetV2> = {}): RecommendationSetV2 {
  return {
    schema: "recommendation-set/v2",
    sessionId: "copilot-ui",
    decision: { actor: "radiant", actionKind: "PICK", controlledSlots: [{ side: "radiant", slotIndex: 0 }], actionCount: 1 },
    recommendations: [singleAction(7, 72)],
    degradations: [],
    deferred: { opponentResponse: NOT_COMPUTED, steal: NOT_COMPUTED, lookahead: NOT_COMPUTED },
    decisionContext: "response_pick",
    ...overrides,
  };
}

test.each([
  ["team_opening", "Apertura de equipo"],
  ["blind_second_pick", "Pick 2 — información ciega"],
  ["response_pick", "Pick 3/4 — respuesta a rivales revelados"],
  ["closing_pick", "Cierre — composición y riesgos"],
  ["no_signal_available", "No hay señales disponibles para votar"],
] as const)("renderiza el contexto %s", (context: RecommendationSetV2["decisionContext"], heading: string) => {
  const view = render(<CopilotPanel recommendations={recommendationSet({ decisionContext: context })} heroCatalog={new Map()} previewStatus="ready" />);
  expect(view.getByText(heading)).toBeDefined();
});

test("recomendaciones single-action: una celda compacta por recomendación, vía SuggestionCard real", () => {
  const set = recommendationSet({
    recommendations: [1, 2, 3, 4, 5, 6].map((hero, i) => singleAction(hero, 70 - i)),
  });
  const view = render(<CopilotPanel recommendations={set} heroCatalog={new Map()} previewStatus="ready" />);
  expect(view.getAllByRole("button", { name: "Ver señales" })).toHaveLength(6);
  expect(view.getByText("Resumen táctico 1.")).toBeDefined();
  expect(view.getByText("Resumen táctico 6.")).toBeDefined();
});

test("recomendaciones compuestas (legacy: null): se muestran como dupla, nunca via SuggestionCard (no hay proyección V1 que aplanar)", () => {
  const set = recommendationSet({ recommendations: [compound(1, 2, 199), compound(3, 4, 180)] });
  const view = render(<CopilotPanel recommendations={set} heroCatalog={new Map()} previewStatus="ready" />);
  expect(view.getAllByText("Dupla sugerida")).toHaveLength(2);
  expect(view.queryAllByRole("button", { name: "Ver señales" })).toHaveLength(0);
});

test("degradaciones se muestran siempre que existan, ninguna se calla en silencio", () => {
  const set = recommendationSet({ degradations: [{ reason: "stale_meta", detail: "El meta tiene más de 24 horas." }] });
  const view = render(<CopilotPanel recommendations={set} heroCatalog={new Map()} previewStatus="ready" />);
  expect(view.getByText("El meta tiene más de 24 horas.")).toBeDefined();
});

test("sin recomendaciones (p. ej. CM fail-closed): estado explícito, nunca un panel en blanco", () => {
  const set = recommendationSet({ recommendations: [] });
  const view = render(<CopilotPanel recommendations={set} heroCatalog={new Map()} previewStatus="ready" />);
  expect(view.getByText("Sin candidatos para el estado actual del draft.")).toBeDefined();
});

test("previewStatus failed: ofrece reintentar, nunca queda congelado en silencio", () => {
  let retried = false;
  const view = render(
    <CopilotPanel recommendations={null} heroCatalog={new Map()} previewStatus="failed" onRetryPreview={() => (retried = true)} />,
  );
  view.getByRole("button", { name: "Reintentar" }).click();
  expect(retried).toBe(true);
});

// R1 S7 -- "UI PRODUCT TEST — S6": prueba dedicada de que un payload real de RecommendationSet/v2
// con `deferred` poblado llega hasta el Copilot. Si protocol-client.ts dejara de parsear
// `deferred` en silencio (p. ej. un rename de campo en el motor), este test debe fallar -- no sólo
// los de parseo en protocol-client.test.ts, sino el que prueba lo que el USUARIO ve.
const HERO_CATALOG = new Map([
  [7, { id: 7, name: "npc_dota_hero_earthshaker", localizedName: "Earthshaker", imgUrl: "", primaryAttr: "str", attackType: "Melee", roles: [] }],
]);

test("S6 -- respuesta rival plausible: texto de producto visible, nunca un número de probabilidad", () => {
  const set = recommendationSet({
    deferred: {
      opponentResponse: { status: "PLAUSIBLE_RESPONSE", action: { slot: { side: "dire", slotIndex: 0 }, hero: 7 }, confidence: "media" },
      steal: NOT_COMPUTED,
      lookahead: NOT_COMPUTED,
    },
  });
  const view = render(<CopilotPanel recommendations={set} heroCatalog={HERO_CATALOG} previewStatus="ready" />);
  expect(view.getByText("Respuesta rival plausible: Earthshaker.")).toBeDefined();
  expect(view.queryByText(/%/)).toBeNull();
});

test("S6 -- steal MATERIALIZED se muestra", () => {
  const materialized = recommendationSet({
    deferred: { opponentResponse: NOT_COMPUTED, steal: { status: "MATERIALIZED", heroId: 7 }, lookahead: NOT_COMPUTED },
  });
  const materializedView = render(<CopilotPanel recommendations={materialized} heroCatalog={HERO_CATALOG} previewStatus="ready" />);
  expect(materializedView.getByText(/le quita Earthshaker al rival/)).toBeDefined();
});

test("S6 -- steal STILL_CONTESTABLE no produce ninguna tarjeta (sólo aparece cuando es significativo)", () => {
  const contestable = recommendationSet({
    deferred: { opponentResponse: NOT_COMPUTED, steal: { status: "STILL_CONTESTABLE", heroId: 7 }, lookahead: NOT_COMPUTED },
  });
  const contestableView = render(<CopilotPanel recommendations={contestable} heroCatalog={HERO_CATALOG} previewStatus="ready" />);
  expect(contestableView.queryByTestId("opponent-intelligence")).toBeNull();
});

test("S6 -- NOT_COMPUTED y otros sentinels no crashean y no dejan tarjeta vacía", () => {
  const set = recommendationSet({
    deferred: {
      opponentResponse: { status: "NO_LEGAL_RESPONSE", action: null, confidence: null },
      steal: { status: "NOT_APPLICABLE", heroId: null },
      lookahead: { status: "COLLISION_PENDING", resultingEvaluation: null },
    },
  });
  const view = render(<CopilotPanel recommendations={set} heroCatalog={HERO_CATALOG} previewStatus="ready" />);
  expect(view.queryByTestId("opponent-intelligence")).toBeNull();
});

test("S6 -- lookahead con evaluación resultante: consecuencia en lenguaje humano, sin inventar un porcentaje", () => {
  const set = recommendationSet({
    deferred: {
      opponentResponse: NOT_COMPUTED,
      steal: NOT_COMPUTED,
      lookahead: { status: "PLAUSIBLE_RESPONSE", resultingEvaluation: { ourActionScore: 72, opponentResponseScore: 65, scoreDelta: -7 } },
    },
  });
  const view = render(<CopilotPanel recommendations={set} heroCatalog={HERO_CATALOG} previewStatus="ready" />);
  expect(view.getByText("Después de este pick, el modelo considera al rival con fuerza 65 frente a tu 72.")).toBeDefined();
});

test("posición sugerida y riesgos de la recomendación top se muestran cuando el motor los reporta", () => {
  const set = recommendationSet({
    recommendations: [{
      ...singleAction(7, 72),
      roleImpact: { 7: { status: "CONFIRMED_FORCED", position: 4, marginals: { 1: 0, 2: 0, 3: 0, 4: 0.95, 5: 0.05 }, entropy: 0.3 } },
      risks: [{ kind: "low_evidence", detail: "Pocas partidas recientes con este héroe." }],
    }],
  });
  const view = render(<CopilotPanel recommendations={set} heroCatalog={HERO_CATALOG} previewStatus="ready" />);
  expect(view.getByText("Posición sugerida: Support")).toBeDefined();
  expect(view.getByText(/Pocas partidas recientes con este héroe\./)).toBeDefined();
});
