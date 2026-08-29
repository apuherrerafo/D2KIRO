import "@/test-support/happy-dom";

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import type { DraftState, SuggestionSet } from "@/features/draft/types";
import { CopilotPanel } from "./CopilotPanel";

afterEach(cleanup);

const draftState: DraftState = {
  sessionId: "copilot-ui",
  schema: "draft-state/v1",
  format: "all_pick",
  patch: "7.41e",
  localSide: "radiant",
  phase: "active",
  banned: [],
  picks: { radiant: [], dire: [] },
  lastSeq: 4,
  appliedEventIds: [],
  quality: { unconfirmed: [], captureStatus: "ok" },
  updatedAt: "2026-08-25T00:00:00.000Z",
  firstPickSide: null,
  turnStartedAt: null,
  reserveRemainingMs: null,
  turn: null,
};

function suggestions(decisionContext: SuggestionSet["decisionContext"]): SuggestionSet {
  return {
    schema: "suggestions/v1",
    sessionId: draftState.sessionId,
    basedOnSeq: draftState.lastSeq,
    decisionContext,
    suggestions: [{
      hero: 7,
      rank: 1,
      score: 72,
      signals: [],
      reason: "Resumen táctico.",
      confidence: "media",
      evidence: [
        { kind: "opening", text: "Abre una composición flexible." },
        { kind: "counter", text: "Fuerte contra un rival revelado." },
        { kind: "risk", text: "La muestra de matchup es limitada." },
      ],
    }],
    comparison: null,
    degraded: [],
    computedInMs: 1,
  };
}

test.each([
  ["team_opening", "Apertura de equipo"],
  ["blind_second_pick", "Pick 2 — información ciega"],
  ["response_pick", "Pick 3/4 — respuesta a rivales revelados"],
  ["closing_pick", "Cierre — composición y riesgos"],
] as const)("renderiza el contexto %s sin parsear la razón", (context, heading) => {
  const view = render(<CopilotPanel draftState={draftState} suggestions={suggestions(context)} heroCatalog={new Map()} previewStatus="ready" />);

  expect(view.getByText(heading)).toBeDefined();
});

test("TSK-192: renderiza una celda compacta por cada recomendación (hasta 6, grid 2×3)", () => {
  const many: SuggestionSet = {
    ...suggestions("response_pick"),
    suggestions: [1, 2, 3, 4, 5, 6].map((hero, i) => ({
      hero, rank: (i + 1) as 1 | 2 | 3 | 4 | 5 | 6, score: 70 - i, signals: [], reason: `Motivo ${hero}`, confidence: "media" as const,
    })),
  };
  const view = render(<CopilotPanel draftState={draftState} suggestions={many} heroCatalog={new Map()} previewStatus="ready" />);

  expect(view.getAllByRole("button", { name: "Ver señales" })).toHaveLength(6);
  expect(view.getByText("Motivo 1")).toBeDefined();
  expect(view.getByText("Motivo 6")).toBeDefined();
});

test("agrupa los motivos positivos aparte de riesgos e incertidumbres (tras Ver señales, TSK-192)", () => {
  const view = render(<CopilotPanel draftState={draftState} suggestions={suggestions("response_pick")} heroCatalog={new Map()} previewStatus="ready" />);

  // En el grid compacto el detalle vive tras "Ver señales".
  fireEvent.click(view.getByRole("button", { name: "Ver señales" }));

  expect(view.getByRole("list", { name: "Motivos de la recomendación" })).toBeDefined();
  expect(view.getByText(/^Apertura:/)).toBeDefined();
  expect(view.getByText(/^Contrapick:/)).toBeDefined();
  expect(view.getByRole("list", { name: "Riesgos e incertidumbres" })).toBeDefined();
  expect(view.getByText(/^Riesgo:/)).toBeDefined();
});
