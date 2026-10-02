import { describe, expect, test } from "bun:test";
import { gsiPayload, SENTINELS } from "./gsi.fixtures";
import { draftFactCount, normalizeGsi, observationsFromGsi } from "./gsi-normalize";

// TSK-219 -- the GSI allowlist. Pure: payload in, facts out. Fixtures are synthetic (gsi.fixtures.ts).

describe("normalizeGsi -- phase and side", () => {
  test("hero selection with our side reported", () => {
    const update = normalizeGsi(gsiPayload({ teamName: "dire" }));
    expect(update.phase).toBe("draft");
    expect(update.gameState).toBe("DOTA_GAMERULES_STATE_HERO_SELECTION");
    expect(update.side).toBe("dire");
    expect(update.capabilities.side).toBe(true);
  });

  test("strategy time is still the draft; pre-game and in-progress are the match; no map is the menu", () => {
    expect(normalizeGsi(gsiPayload({ gameState: "DOTA_GAMERULES_STATE_STRATEGY_TIME" })).phase).toBe("draft");
    expect(normalizeGsi(gsiPayload({ gameState: "DOTA_GAMERULES_STATE_PRE_GAME" })).phase).toBe("match");
    expect(normalizeGsi(gsiPayload({ gameState: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS" })).phase).toBe("match");
    expect(normalizeGsi(gsiPayload({ gameState: "DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD" })).phase).toBe("loading");
    expect(normalizeGsi(gsiPayload({ gameState: null })).phase).toBe("idle");
  });

  test("an unknown team name or a non-allowlisted game state is dropped, never passed through", () => {
    const update = normalizeGsi({ map: { game_state: "<script>" }, player: { team_name: "spectator" } });
    expect(update.gameState).toBeNull();
    expect(update.side).toBeNull();
  });
});

describe("normalizeGsi -- draft capability detection", () => {
  test("a spectator-style draft block yields bans and both sides' picks, in slot order", () => {
    const update = normalizeGsi(gsiPayload({ teamName: "radiant", draft: { radiant: { picks: [11, 12], bans: [1, 2] }, dire: { picks: [21], bans: [3] } } }));
    expect(update.draft).toEqual({
      bans: [1, 2, 3],
      picks: [
        { side: "radiant", heroId: 11 },
        { side: "radiant", heroId: 12 },
        { side: "dire", heroId: 21 },
      ],
    });
    expect(update.capabilities).toEqual({ draftBlock: true, side: true, ownHero: false, bans: true, allyPicks: true, enemyPicks: true });
  });

  test("a player's empty draft block is reported as NO draft data -- nothing is invented", () => {
    const update = normalizeGsi(gsiPayload({ teamName: "radiant", heroId: 8, draft: "empty" }));
    expect(update.draft).toBeNull();
    expect(update.capabilities).toEqual({ draftBlock: false, side: true, ownHero: true, bans: false, allyPicks: false, enemyPicks: false });
  });

  test("empty team blocks (or only home_team) are NOT draft data -- the capture stays honestly partial", () => {
    for (const draft of [{ team2: {}, team3: {} }, { team2: { home_team: true }, team3: { home_team: false } }]) {
      const update = normalizeGsi({ map: { game_state: "DOTA_GAMERULES_STATE_HERO_SELECTION" }, player: { team_name: "radiant" }, draft });
      expect(update.draft).toBeNull();
      expect(update.capabilities.draftBlock).toBe(false);
    }
  });

  test("zero / malformed hero ids in the draft block are ignored (slots present = draft data, just none valid yet)", () => {
    const update = normalizeGsi({ map: { game_state: "DOTA_GAMERULES_STATE_HERO_SELECTION" }, draft: { team2: { pick0_id: 0, pick1_id: "x", ban0_id: -4, ban1_id: 5000 }, team3: {} } });
    expect(update.draft).toEqual({ bans: [], picks: [] });
  });

  test("garbage input never throws", () => {
    for (const value of [null, undefined, 42, "x", [], { map: [] }, { draft: "x" }, { hero: { id: {} } }]) {
      expect(() => normalizeGsi(value)).not.toThrow();
    }
  });
});

describe("normalizeGsi -- privacy", () => {
  test("no identity value (steam id, account id, player name, match id) and no token survives normalization", () => {
    const token = "a".repeat(64);
    const update = normalizeGsi(gsiPayload({ token, teamName: "radiant", heroId: 8, telemetry: true, draft: { radiant: { picks: [8] } } }));
    const serialized = JSON.stringify(update);
    for (const sentinel of SENTINELS) expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toContain(token);
    // The match id becomes a one-way key: stable for the same match, different for another one.
    expect(update.matchKey).toMatch(/^[0-9a-f]{16}$/);
    expect(normalizeGsi(gsiPayload({ matchId: "1234567890" })).matchKey).toBe(update.matchKey);
    expect(normalizeGsi(gsiPayload({ matchId: "1234567891" })).matchKey).not.toBe(update.matchKey);
  });

  test("match telemetry is discovered as capability labels only, never values", () => {
    const update = normalizeGsi(gsiPayload({ gameState: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", teamName: "radiant", heroId: 8, telemetry: true }));
    expect(update.telemetry).toEqual(expect.arrayContaining(["clock_time", "hero_level", "hero_health", "hero_mana", "hero_alive", "hero_respawn", "hero_buyback", "kda", "last_hits", "denies", "gold", "gpm", "xpm", "items", "item_cooldowns", "abilities", "ability_levels", "ability_cooldowns"]));
    // Not sent by this payload -> not claimed.
    expect(update.telemetry).not.toContain("net_worth");
    expect(update.telemetry.every((label) => /^[a-z_]+$/.test(label))).toBe(true);
  });

  test("the inventory is reduced to a one-way key: equal items -> equal key, a change -> a new key, no item names kept", () => {
    const inMatch = (items?: string[]) => normalizeGsi(gsiPayload({ gameState: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", heroId: 8, telemetry: true, items }));
    const before = inMatch(["item_tango", "item_branches"]);
    expect(before.itemsKey).toMatch(/^[0-9a-f]{16}$/);
    expect(inMatch(["item_tango", "item_branches"]).itemsKey).toBe(before.itemsKey);
    expect(inMatch(["item_tango", "item_magic_wand"]).itemsKey).not.toBe(before.itemsKey);
    expect(JSON.stringify(before)).not.toContain("item_branches");
    expect(normalizeGsi(gsiPayload({ heroId: 8 })).itemsKey).toBeNull();
    expect(normalizeGsi({ items: { slot0: { name: "<script>" } } }).itemsKey).toBeNull();
  });

  test("draft fact count: bans + picks + our own hero", () => {
    expect(draftFactCount(normalizeGsi(gsiPayload({ teamName: "radiant", draft: "empty" })))).toBe(0);
    expect(draftFactCount(normalizeGsi(gsiPayload({ teamName: "radiant", heroId: 11, draft: { radiant: { bans: [10], picks: [11] }, dire: { picks: [21] } } })))).toBe(4);
  });
});

describe("observationsFromGsi", () => {
  test("hero selection: draft started, side first, then bans, picks and our own locked hero", () => {
    const update = normalizeGsi(gsiPayload({ teamName: "radiant", heroId: 8, draft: { radiant: { bans: [1] }, dire: { picks: [21] } } }));
    expect(observationsFromGsi(update, "7.41e")).toEqual([
      { type: "draft_started", patch: "7.41e" },
      { type: "bans_closed" },
      { type: "side", side: "radiant" },
      { type: "ban", heroId: 1 },
      { type: "pick", side: "dire", heroId: 21, position: null },
      { type: "pick", side: "radiant", heroId: 8, position: null },
    ]);
  });

  test("outside the draft, the hero is the match hero -- never a pick", () => {
    expect(observationsFromGsi(normalizeGsi(gsiPayload({ gameState: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", teamName: "radiant", heroId: 8 })), "7.41e")).toEqual([]);
    expect(observationsFromGsi(normalizeGsi(gsiPayload({ gameState: null })), "7.41e")).toEqual([]);
  });

  test("our own hero without a known side is not attributed to any side", () => {
    expect(observationsFromGsi(normalizeGsi(gsiPayload({ heroId: 8 })), "7.41e")).toEqual([{ type: "draft_started", patch: "7.41e" }, { type: "bans_closed" }]);
  });
});
