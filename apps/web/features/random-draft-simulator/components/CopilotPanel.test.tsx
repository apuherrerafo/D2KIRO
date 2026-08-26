import "@/test-support/happy-dom";

import { cleanup, render } from "@testing-library/react";
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

test("agrupa los motivos positivos aparte de riesgos e incertidumbres", () => {
  const view = render(<CopilotPanel draftState={draftState} suggestions={suggestions("response_pick")} heroCatalog={new Map()} previewStatus="ready" />);

  expect(view.getByRole("list", { name: "Motivos de la recomendación" })).toBeDefined();
  expect(view.getByText(/^Apertura:/)).toBeDefined();
  expect(view.getByText(/^Contrapick:/)).toBeDefined();
  expect(view.getByRole("list", { name: "Riesgos e incertidumbres" })).toBeDefined();
  expect(view.getByText(/^Riesgo:/)).toBeDefined();
});
