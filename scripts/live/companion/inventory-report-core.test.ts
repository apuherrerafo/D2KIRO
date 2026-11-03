import { describe, expect, test } from "bun:test";
import { cellFor, parseInventory, renderReport, type Inventory } from "./inventory-report-core";

// Inline fixture shaped like the Companion's inventory-latest.json (never a real capture).
const INVENTORY: Inventory = {
  schema: "d2kiro-gsi-inventory/v1",
  companionVersion: "0.1.0",
  runId: "20261006-000000",
  updatedAt: "2026-10-06T00:00:00.000Z",
  phases: {
    MATCH: {
      posts: 50,
      firstAt: "b",
      lastAt: "c",
      gameStates: ["DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"],
      paths: { "$.hero.id": { seen: 50, nonEmpty: 50, types: ["number"] }, "$.items.slot#.name": { seen: 450, nonEmpty: 300, types: ["string"] } },
    },
    HERO_SELECTION: {
      posts: 10,
      firstAt: "a",
      lastAt: "b",
      gameStates: ["DOTA_GAMERULES_STATE_HERO_SELECTION"],
      paths: { "$.draft": { seen: 10, nonEmpty: 0, types: ["object"] }, "$.hero.id": { seen: 10, nonEmpty: 4, types: ["number"] }, "$.player.team_name": { seen: 10, nonEmpty: 10, types: ["string"] } },
    },
  },
};

describe("Companion inventory report", () => {
  test("NO / EMPTY / YES (n/posts), clamped to the phase's posts", () => {
    const drafting = INVENTORY.phases.HERO_SELECTION!;
    expect(cellFor(drafting, /^\$\.draft\.team#\.pick#_id$/)).toBe("NO");
    expect(cellFor(drafting, /^\$\.draft$/)).toBe("EMPTY");
    expect(cellFor(drafting, /^\$\.hero\.id$/)).toBe("YES (4/10)");
    expect(cellFor(INVENTORY.phases.MATCH!, /^\$\.items\.(slot|stash|teleport|neutral)#?\.name$/)).toBe("YES (50/50)");
  });

  test("phases in lifecycle order; research rows and every path are listed", () => {
    const report = renderReport(INVENTORY);
    expect(report.indexOf("| HERO_SELECTION | 10 |")).toBeLessThan(report.indexOf("| MATCH | 50 |"));
    expect(report).toContain("| FIELD | HERO_SELECTION | MATCH |");
    expect(report).toContain("| draft block (any content) | EMPTY | NO |");
    expect(report).toContain("| own hero id | YES (4/10) | YES (50/50) |");
    expect(report).toContain("| $.player.team_name | HERO_SELECTION 10/10 | string |");
  });

  test("anything that is not an inventory is refused", () => {
    expect(parseInventory("{}")).toBeNull();
    expect(parseInventory("not json")).toBeNull();
    expect(parseInventory(JSON.stringify(INVENTORY))?.runId).toBe("20261006-000000");
  });
});
