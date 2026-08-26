import { expect, test } from "bun:test";
import { createIdleDraftState } from "../draft/reducer";
import { deriveDecisionContext } from "./decision-context";
import { buildSuggestions } from "../signals/mix";

function activeState(own: number[], enemy: number[]) {
  return {
    ...createIdleDraftState("context"),
    phase: "active" as const,
    format: "all_pick" as const,
    localSide: "radiant" as const,
    picks: { radiant: own, dire: enemy },
  };
}

test("deriva el contexto solo de picks revelados de All Pick", () => {
  expect(deriveDecisionContext(activeState([], []), true)).toBe("team_opening");
  expect(deriveDecisionContext(activeState([1], []), false)).toBe("blind_second_pick");
  expect(deriveDecisionContext(activeState([1, 2], [11, 12]), false)).toBe("response_pick");
  expect(deriveDecisionContext(activeState([1, 2, 3, 4], [11, 12, 13, 14]), false)).toBe("closing_pick");
});

test("no afirma respuesta rival si los picks no están presentes en el estado", () => {
  expect(deriveDecisionContext(activeState([1, 2], []), false)).toBe("blind_second_pick");
});

test("la razón de una sugerencia comunica el momento visible, sin inventar picks ocultos", () => {
  const response = buildSuggestions(activeState([1, 2], [11, 12]), {
    heroes: { 1: { id: 1, localizedName: "Uno" }, 2: { id: 2, localizedName: "Dos" }, 3: { id: 3, localizedName: "Tres" }, 11: { id: 11, localizedName: "Once" }, 12: { id: 12, localizedName: "Doce" } },
    matchups: {},
  }, { heroPositions: {}, heroCapabilities: [] });
  const blind = buildSuggestions(activeState([1, 2], []), {
    heroes: { 1: { id: 1, localizedName: "Uno" }, 2: { id: 2, localizedName: "Dos" }, 3: { id: 3, localizedName: "Tres" } },
    matchups: {},
  }, { heroPositions: {}, heroCapabilities: [] });

  expect(response.suggestions[0]?.reason).toContain("picks rivales revelados");
  expect(response.decisionContext).toBe("response_pick");
  expect(blind.suggestions[0]?.reason).toContain("Pick 2 ciego");
  expect(blind.decisionContext).toBe("blind_second_pick");
});
