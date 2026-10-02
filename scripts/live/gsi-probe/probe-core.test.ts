import { describe, expect, test } from "bun:test";
import {
  GSI_URI,
  HERO_SELECTION,
  buildGsiConfig,
  computeVerdict,
  createEvidence,
  dotaRootForLibrary,
  extractOwnToken,
  formatSummary,
  formatVerdict,
  gsiCfgDir,
  parseLibraryFolders,
  recordEvidence,
  summarizeGsi,
  summaryKey,
} from "./probe-core";

// Fixtures are synthetic. The account-ish values are sentinels the summary must never echo.
const SECRET_TOKEN = "a".repeat(64);
const STEAM_ID = "76561190000000042";
const ACCOUNT_ID = "39990042";
const PLAYER_NAME = "SentinelPlayerName";

function playerPayload(extra: Record<string, unknown> = {}) {
  return {
    provider: { name: "Dota 2", appid: 570, version: 47, timestamp: 1 },
    map: { name: "start", matchid: "9000000001", game_time: 0, clock_time: -60, game_state: HERO_SELECTION },
    player: { steamid: STEAM_ID, accountid: ACCOUNT_ID, name: PLAYER_NAME, activity: "playing", team_name: "radiant" },
    hero: {},
    draft: {},
    auth: { token: SECRET_TOKEN },
    ...extra,
  };
}

function draftWith(radiantPicks: number[], direPicks: number[], bans: number[], activeteam = 2) {
  const team = (picks: number[], teamBans: number[]) => {
    const block: Record<string, unknown> = { home_team: false };
    for (let i = 0; i < 5; i += 1) {
      block[`pick${i}_id`] = picks[i] ?? 0;
      block[`pick${i}_class`] = picks[i] ? `hero_${picks[i]}` : "";
    }
    teamBans.forEach((id, i) => {
      block[`ban${i}_id`] = id;
      block[`ban${i}_class`] = `hero_${id}`;
    });
    return block;
  };
  return { activeteam, pick: true, activeteam_time_remaining: 25, radiant_bonus_time: 130, dire_bonus_time: 130, team2: team(radiantPicks, bans), team3: team(direPicks, []) };
}

describe("install detection", () => {
  test("parses every library path of libraryfolders.vdf, unescaping backslashes", () => {
    const vdf = `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}`;
    expect(parseLibraryFolders(vdf)).toEqual(["C:\\Program Files (x86)\\Steam", "D:\\SteamLibrary"]);
  });

  test("builds the Dota root and gamestate_integration dir under a library", () => {
    const root = dotaRootForLibrary("D:\\SteamLibrary\\");
    expect(root).toBe("D:\\SteamLibrary\\steamapps\\common\\dota 2 beta");
    expect(gsiCfgDir(root)).toBe("D:\\SteamLibrary\\steamapps\\common\\dota 2 beta\\game\\dota\\cfg\\gamestate_integration");
  });
});

describe("cfg", () => {
  test("posts to the probe URI with draft/player/hero/map enabled and round-trips its own token", () => {
    const cfg = buildGsiConfig(SECRET_TOKEN);
    expect(cfg).toContain(`"uri"           "${GSI_URI}"`);
    for (const key of ["draft", "player", "hero", "map"]) expect(cfg).toMatch(new RegExp(`"${key}"\\s+"1"`));
    expect(extractOwnToken(cfg)).toBe(SECRET_TOKEN);
  });

  test("never adopts the token of a cfg that is not ours", () => {
    expect(extractOwnToken(`"other" { "uri" "http://127.0.0.1:3000/" "auth" { "token" "${SECRET_TOKEN}" } }`)).toBeNull();
  });
});

describe("safe summary", () => {
  test("never echoes steam id, account id, player name, match id or auth token", () => {
    const summary = summarizeGsi(playerPayload({ draft: draftWith([1, 2], [3], [4, 5]) }));
    const printed = `${JSON.stringify(summary)}\n${formatSummary(summary)}`;
    for (const secret of [STEAM_ID, ACCOUNT_ID, PLAYER_NAME, SECRET_TOKEN, "9000000001"]) {
      expect(printed).not.toContain(secret);
    }
    expect(summary.sectionKeys.auth).toBeUndefined();
    expect(summary.sectionKeys.player).toEqual(["accountid", "activity", "name", "steamid", "team_name"]);
  });

  test("player-mode empty draft: draft present no, team present yes", () => {
    const summary = summarizeGsi(playerPayload());
    expect(summary.gameState).toBe(HERO_SELECTION);
    expect(summary.draftPresent).toBe(false);
    expect(summary.teamPresent).toBe(true);
    expect(summary.teamName).toBe("radiant");
    expect(summary.heroPresent).toBe(false);
  });

  test("spectator-shaped draft maps team2/team3 to radiant/dire picks and bans", () => {
    const summary = summarizeGsi(playerPayload({ draft: draftWith([10, 20], [30], [40, 50]), hero: { id: 10, name: "npc_dota_hero_x" } }));
    expect(summary.draftPresent).toBe(true);
    const radiant = summary.draft?.teams.find((t) => t.side === "radiant");
    const dire = summary.draft?.teams.find((t) => t.side === "dire");
    expect(radiant?.picks.map((p) => p.heroId)).toEqual([10, 20]);
    expect(radiant?.bans.map((p) => p.heroId)).toEqual([40, 50]);
    expect(dire?.picks.map((p) => p.heroId)).toEqual([30]);
    expect(summary.heroId).toBe(10);
  });

  test("rejects non-hero values in pick/class fields", () => {
    const draft = { team2: { pick0_id: "Robert'); DROP", pick0_class: "<script>", pick1_id: 5, pick1_class: "Not Safe" } };
    const radiant = summarizeGsi(playerPayload({ draft })).draft?.teams[0];
    expect(radiant?.picks).toEqual([{ slot: 1, heroId: 5, heroClass: null }]);
  });

  test("dedupe key ignores the per-second timer but not a new pick", () => {
    const a = summarizeGsi(playerPayload({ draft: { ...draftWith([1], [], []), activeteam_time_remaining: 20 } }));
    const b = summarizeGsi(playerPayload({ draft: { ...draftWith([1], [], []), activeteam_time_remaining: 19 } }));
    const c = summarizeGsi(playerPayload({ draft: draftWith([1, 2], [], []) }));
    expect(summaryKey(a)).toBe(summaryKey(b));
    expect(summaryKey(a)).not.toBe(summaryKey(c));
  });
});

describe("verdict", () => {
  test("no HERO_SELECTION update -> NO_HERO_SELECTION_OBSERVED", () => {
    const evidence = createEvidence();
    recordEvidence(evidence, summarizeGsi(playerPayload({ map: { game_state: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS" } })));
    expect(computeVerdict(evidence).verdict).toBe("NO_HERO_SELECTION_OBSERVED");
  });

  test("side only, draft always empty -> INSUFFICIENT, naming the missing fields", () => {
    const evidence = createEvidence();
    recordEvidence(evidence, summarizeGsi(playerPayload()));
    recordEvidence(evidence, summarizeGsi(playerPayload({ hero: { id: 7, name: "npc_dota_hero_y" } })));
    const { verdict, criteria } = computeVerdict(evidence);
    expect(verdict).toBe("GSI_DRAFT_INSUFFICIENT");
    expect(criteria.map((c) => c.observed)).toEqual([true, false, false, false, false]);
    expect(formatVerdict(evidence)).toContain("only own hero.id = {7}");
  });

  test("bans + both sides' picks + growing pick count -> SUFFICIENT", () => {
    const evidence = createEvidence();
    recordEvidence(evidence, summarizeGsi(playerPayload({ draft: draftWith([], [], [40]) })));
    recordEvidence(evidence, summarizeGsi(playerPayload({ draft: draftWith([10], [], [40], 3) })));
    recordEvidence(evidence, summarizeGsi(playerPayload({ draft: draftWith([10], [30], [40], 2) })));
    expect(computeVerdict(evidence).verdict).toBe("GSI_DRAFT_SUFFICIENT");
  });

  test("evidence outside HERO_SELECTION does not count", () => {
    const evidence = createEvidence();
    recordEvidence(evidence, summarizeGsi(playerPayload()));
    const strategy = playerPayload({ draft: draftWith([10], [30], [40]) });
    strategy.map = { ...strategy.map, game_state: "DOTA_GAMERULES_STATE_STRATEGY_TIME" };
    recordEvidence(evidence, summarizeGsi(strategy));
    expect(computeVerdict(evidence).verdict).toBe("GSI_DRAFT_INSUFFICIENT");
    expect(evidence.statesSeen).toEqual([HERO_SELECTION, "DOTA_GAMERULES_STATE_STRATEGY_TIME"]);
  });
});
