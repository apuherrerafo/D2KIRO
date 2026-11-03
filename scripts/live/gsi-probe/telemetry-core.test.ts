import { describe, expect, test } from "bun:test";
import { createTelemetry, dataScope, formatTelemetryReport, generalizeSegment, recordTelemetry, telemetryStatusLine } from "./telemetry-core";

// Synthetic payloads. Identity-ish values are sentinels the report must never contain.
const IN_GAME = "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS";
const SECRET_TOKEN = "b".repeat(64);
const STEAM_ID = "76561190000000077";
const ACCOUNT_ID = "39990077";
const PLAYER_NAME = "SentinelPlayerName";
const TEAMMATE_NAME = "SentinelTeammate";
const ENEMY_NAME = "SentinelEnemy";
const MATCH_ID = "9000000077";

function ownPayload(clock: number, slot0 = "item_tango") {
  return {
    provider: { name: "Dota 2", appid: 570 },
    map: { name: "start", matchid: MATCH_ID, game_time: clock + 90, clock_time: clock, game_state: IN_GAME },
    player: { steamid: STEAM_ID, accountid: ACCOUNT_ID, name: PLAYER_NAME, team_name: "radiant", kills: 1, deaths: 0, assists: 2, last_hits: 10 + clock, denies: 1, gold: 600, gpm: 300, xpm: 400 },
    hero: { id: 7, name: "npc_dota_hero_earthshaker", level: 3, alive: true, health: 700, max_health: 700, mana: 300, max_mana: 300, respawn_seconds: 0, buyback_cost: 250, buyback_cooldown: 0 },
    abilities: { ability0: { name: "earthshaker_fissure", level: 1, can_cast: true, passive: false, cooldown: clock % 2, ultimate: false } },
    items: { slot0: { name: slot0, charges: 3, can_cast: true, cooldown: 0 }, slot1: { name: "empty" } },
    auth: { token: SECRET_TOKEN },
    previously: { player: { name: PLAYER_NAME } },
    added: { player: { steamid: STEAM_ID } },
  };
}

function spectatorShapedPayload() {
  return {
    map: { matchid: MATCH_ID, clock_time: 100, game_state: IN_GAME },
    player: {
      team2: { player0: { steamid: STEAM_ID, accountid: ACCOUNT_ID, name: PLAYER_NAME }, player1: { steamid: "76561190000000078", name: TEAMMATE_NAME } },
      team3: { player5: { steamid: "76561190000000079", accountid: "39990079", name: ENEMY_NAME } },
    },
    hero: { team3: { player5: { name: ENEMY_NAME, id: 1 } } },
    minimap: { o0: { team: 3, unitname: ENEMY_NAME, xpos: 1, ypos: 2 } },
    auth: { token: SECRET_TOKEN },
  };
}

const SENTINELS = [STEAM_ID, ACCOUNT_ID, PLAYER_NAME, TEAMMATE_NAME, ENEMY_NAME, MATCH_ID, SECRET_TOKEN, "76561190000000078", "76561190000000079", "39990079"];

describe("match telemetry privacy", () => {
  test("own-player payload: report and status line never contain identity, match id or token", () => {
    const t = createTelemetry();
    recordTelemetry(t, ownPayload(10), IN_GAME);
    recordTelemetry(t, ownPayload(11, "item_branches"), IN_GAME);
    const printed = `${formatTelemetryReport(t, "2026-10-02T00:00:00Z")}\n${telemetryStatusLine(t)}`;
    for (const secret of SENTINELS) expect(printed).not.toContain(secret);
    expect(printed).not.toContain("auth.");
    expect(printed).not.toContain("previously.");
    expect(printed).not.toContain("added.");
  });

  test("teammate/enemy-shaped payload: no teammate or enemy identity leaks either", () => {
    const t = createTelemetry();
    recordTelemetry(t, spectatorShapedPayload(), IN_GAME);
    const printed = formatTelemetryReport(t, "2026-10-02T00:00:00Z");
    for (const secret of SENTINELS) expect(printed).not.toContain(secret);
  });

  test("a non-game-data string in a name slot is never echoed", () => {
    const t = createTelemetry();
    const payload = ownPayload(10, "Sentinel Mixed Case");
    payload.abilities.ability0.name = PLAYER_NAME;
    recordTelemetry(t, payload, IN_GAME);
    const printed = formatTelemetryReport(t, "x");
    expect(printed).not.toContain("Sentinel Mixed Case");
    expect(printed).not.toContain(PLAYER_NAME);
    expect(printed).toContain("item names observed: [empty]");
  });

  test("odd key names are reduced, digits generalized", () => {
    expect(generalizeSegment("slot0")).toBe("slot#");
    expect(generalizeSegment("team2")).toBe("team#");
    expect(generalizeSegment(STEAM_ID)).toBe("#");
    expect(generalizeSegment(`player_${ACCOUNT_ID}`)).toBe("player_#");
    expect(generalizeSegment("has space")).toBe("<key>");
  });
});

describe("match telemetry discovery", () => {
  test("only in-match states are recorded", () => {
    const t = createTelemetry();
    recordTelemetry(t, ownPayload(10), "DOTA_GAMERULES_STATE_HERO_SELECTION");
    expect(t.paths.size).toBe(0);
    expect(formatTelemetryReport(t, "x")).toContain("No in-match payload observed yet");
  });

  test("reports presence and changing vs static from observed paths", () => {
    const t = createTelemetry();
    recordTelemetry(t, ownPayload(10), IN_GAME);
    recordTelemetry(t, ownPayload(11, "item_branches"), IN_GAME);
    const report = formatTelemetryReport(t, "x");
    expect(report).toContain("time.clock_time: PRESENT (changing)  [map.clock_time]");
    expect(report).toContain("hero.level: PRESENT (static)  [hero.level]");
    expect(report).toContain("player.last_hits: PRESENT (changing)");
    expect(report).toContain("player.net_worth: ABSENT");
    expect(report).toContain("player.kda: PRESENT");
    expect(report).toContain("item_changes_observed: YES  [items.slot#.name]");
    expect(report).toContain("item names observed: [empty, item_branches, item_tango]");
    expect(report).toContain("ability_cooldowns: PRESENT");
    expect(report).toContain("data scope: OWN_PLAYER_ONLY");
  });

  test("no slot change -> item_changes_observed: NO", () => {
    const t = createTelemetry();
    recordTelemetry(t, ownPayload(10), IN_GAME);
    recordTelemetry(t, ownPayload(11), IN_GAME);
    expect(formatTelemetryReport(t, "x")).toContain("item_changes_observed: NO");
  });

  test("team/enemy blocks are classified against our side", () => {
    const t = createTelemetry();
    recordTelemetry(t, { ...ownPayload(10), player: { team_name: "radiant" } }, IN_GAME);
    recordTelemetry(t, spectatorShapedPayload(), IN_GAME);
    expect(dataScope(t).scopes).toEqual(["TEAM_DATA_PRESENT", "ENEMY_DATA_PRESENT"]);
  });

  test("multi-player blocks with unknown side are not guessed", () => {
    const t = createTelemetry();
    recordTelemetry(t, spectatorShapedPayload(), IN_GAME);
    expect(dataScope(t).scopes).toEqual(["MULTI_UNIT_BLOCKS_SIDE_UNKNOWN"]);
  });
});
