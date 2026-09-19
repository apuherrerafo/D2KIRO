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

test("the closed contract accepts no_signal_available", () => {
  const context: import("./decision-context").DraftDecisionContext = "no_signal_available";
  expect(context).toBe("no_signal_available");
});

test("no afirma respuesta rival si los picks no están presentes en el estado", () => {
  expect(deriveDecisionContext(activeState([1, 2], []), false)).toBe("blind_second_pick");
});

test("el momento visible se declara una sola vez en decisionContext, nunca repetido en cada reason", () => {
  const response = buildSuggestions(activeState([1, 2], [11, 12]), {
    heroes: { 1: { id: 1, localizedName: "Uno" }, 2: { id: 2, localizedName: "Dos" }, 3: { id: 3, localizedName: "Tres" }, 11: { id: 11, localizedName: "Once" }, 12: { id: 12, localizedName: "Doce" } },
    matchups: {},
  }, { heroPositions: {}, heroCapabilities: [] });
  const blind = buildSuggestions(activeState([1, 2], []), {
    heroes: { 1: { id: 1, localizedName: "Uno" }, 2: { id: 2, localizedName: "Dos" }, 3: { id: 3, localizedName: "Tres" } },
    matchups: {},
  }, { heroPositions: {}, heroCapabilities: [] });

  expect(response.decisionContext).toBe("response_pick");
  expect(blind.decisionContext).toBe("blind_second_pick");

  // El encabezado de fase ("Pick 3/4: responde a...", "Pick 2 ciego: combina...") ya lo muestra
  // el panel una sola vez a partir de `decisionContext` -- si `reason` lo repitiera, las 5
  // tarjetas de una misma ronda arrancarían con el mismo texto clonado (hallazgo real de
  // producto: "todo parece el mismo loop", TSK-124).
  for (const suggestion of response.suggestions) {
    expect(suggestion.reason).not.toContain("Pick 3/4: responde");
  }
  for (const suggestion of blind.suggestions) {
    expect(suggestion.reason).not.toContain("Pick 2 ciego: combina");
  }
});

// --- AP Ranked Roles V1 / Wave 2 (task 15): deriveDecisionContextFromView ------------------------
import { deriveDecisionContextFromView } from "./decision-context";
import type { PerspectiveDraftView, PerspectiveHeroSlot } from "../draft-protocol/types";

const known = (heroId: number): PerspectiveHeroSlot => ({ visibility: "KNOWN", heroId });
const revealed = (heroId: number): PerspectiveHeroSlot => ({ visibility: "REVEALED", heroId });
const hidden = (): PerspectiveHeroSlot => ({ visibility: "HIDDEN" });

function apView(phase: "PICK_ROUND_1" | "PICK_ROUND_2" | "PICK_ROUND_3", ownPicks: PerspectiveHeroSlot[], enemyPicks: PerspectiveHeroSlot[]): PerspectiveDraftView {
  return {
    schema: "draft-protocol-perspective/v1",
    sessionId: "ctx-view",
    ruleset: { id: "dota2/ranked-all-pick" } as PerspectiveDraftView["ruleset"],
    status: "ACTIVE",
    degradation: null,
    viewerSide: "radiant",
    bannedHeroes: [],
    ownPicks,
    enemyPicks,
    rankedAp: { phase, banResolutionComplete: true },
    captainsMode: null,
  };
}

test("view: PICK_ROUND_1 sin picks propios confirmados -> team_opening", () => {
  expect(deriveDecisionContextFromView(apView("PICK_ROUND_1", [], [hidden(), hidden()]))).toBe("team_opening");
});

test("view: PICK_ROUND_1 con un pick propio sellado (KNOWN) -> blind_second_pick, sin esperar al rival", () => {
  expect(deriveDecisionContextFromView(apView("PICK_ROUND_1", [known(1)], [hidden(), hidden()]))).toBe("blind_second_pick");
});

test("view: dos rivales REVELADOS -> response_pick; cuatro -> closing_pick", () => {
  expect(deriveDecisionContextFromView(apView("PICK_ROUND_2", [known(1), known(2)], [revealed(11), revealed(12), hidden(), hidden()]))).toBe("response_pick");
  expect(deriveDecisionContextFromView(apView("PICK_ROUND_3", [known(1), known(2), known(3), known(4)], [revealed(11), revealed(12), revealed(13), revealed(14)]))).toBe("closing_pick");
});

test("view: un slot rival HIDDEN nunca cuenta como rival visible (no hay heroId que contar)", () => {
  expect(deriveDecisionContextFromView(apView("PICK_ROUND_1", [known(1), known(2)], [hidden(), hidden()]))).toBe("blind_second_pick");
});

test("view: coincide con la derivación legacy en cada momento alcanzable de All Pick", () => {
  const cases: [PerspectiveDraftView, Parameters<typeof activeState>, boolean][] = [
    [apView("PICK_ROUND_1", [], [hidden(), hidden()]), [[], []], true],
    [apView("PICK_ROUND_1", [known(1)], [hidden(), hidden()]), [[1], []], true],
    [apView("PICK_ROUND_2", [known(1), known(2)], [revealed(11), revealed(12)]), [[1, 2], [11, 12]], true],
    [apView("PICK_ROUND_3", [known(1), known(2), known(3), known(4)], [revealed(11), revealed(12), revealed(13), revealed(14)]), [[1, 2, 3, 4], [11, 12, 13, 14]], true],
  ];
  for (const [view, [own, enemy], teamOpening] of cases) {
    expect(deriveDecisionContextFromView(view)).toBe(deriveDecisionContext(activeState(own, enemy), teamOpening));
  }
});
