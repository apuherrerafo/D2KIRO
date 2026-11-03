import type { CounterfactualFixture } from "./types";

/* Fixture (named fake-scenario-* so the landing guard keeps invented draft data in fixture files only). It continues
   the Player Model: Puck is the first retained decision, and the Viper matchup is the contradiction that held "with a
   condition". The same draft is read twice: by an aggregate (meta, lane) and then through that model. Nothing here is a
   win rate or a count; levels only fix an order, and the page says the draft is illustrative. Copy is fixture copy. */
export const COUNTERFACTUAL_FIXTURE: CounterfactualFixture = {
  draft: {
    id: "ranked-all-pick:pos2:viper",
    context: "Ranked All Pick · Viper revealed",
    allies: [{ id: 107, name: "Earth Spirit" }, { id: 5, name: "Crystal Maiden" }],
    enemies: [{ id: 47, name: "Viper" }],
    you: "You · Pos 2 Mid",
  },
  candidates: [
    {
      hero: { id: 76, name: "Outworld Destroyer" },
      generic: { meta: { level: 3, text: "Meta · strong" }, lane: { level: 3, text: "Lane · holds" } },
      history: { level: 0, text: "History · none", evidence: "missing" },
    },
    {
      hero: { id: 13, name: "Puck" },
      generic: { meta: { level: 3, text: "Meta · strong" }, lane: { level: 2, text: "Lane · a risk" } },
      history: { level: 3, text: "History · yours", evidence: "present" },
      laneThroughYou: { challenged: "Lane · your games", qualified: { level: 3, text: "Lane · qualified" } },
    },
    {
      hero: { id: 106, name: "Ember Spirit" },
      generic: { meta: { level: 2, text: "Meta · playable" }, lane: { level: 2, text: "Lane · holds" } },
      history: { level: 0, text: "History · none", evidence: "missing" },
    },
  ],
  facts: [
    { id: "history", text: "Puck is where your history starts." },
    { id: "matchup", text: "Viper cut your line once. It held, with a condition." },
  ],
};
