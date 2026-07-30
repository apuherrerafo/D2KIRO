import { describe, expect, test } from "bun:test";
import { getVisibleDraftPathCards } from "./cover-flow";
import type { DraftPath } from "./types";

function path(archetype: DraftPath["archetype"]): DraftPath {
  return {
    archetype,
    label: archetype,
    score: 1,
    missing: [],
    nextPick: { hero: 1, score: 1, fills: [], reasons: [] },
    followUps: [],
    reason: "reason",
  };
}

describe("getVisibleDraftPathCards", () => {
  test("devuelve anterior, activo y siguiente para navegación cover-flow", () => {
    const cards = getVisibleDraftPathCards([path("push"), path("teamfight"), path("pickoff")], 1);

    expect(cards.map((card) => card.position)).toEqual(["previous", "active", "next"]);
    expect(cards.map((card) => card.path.archetype)).toEqual(["push", "teamfight", "pickoff"]);
  });

  test("clampa el índice activo si queda fuera de rango", () => {
    const cards = getVisibleDraftPathCards([path("push"), path("scaling")], 99);

    expect(cards.map((card) => card.position)).toEqual(["previous", "active"]);
    expect(cards.map((card) => card.path.archetype)).toEqual(["push", "scaling"]);
  });
});
