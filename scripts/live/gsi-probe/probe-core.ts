// Direct Valve GSI probe -- pure core (no I/O). Answers one question from the user's REAL client:
// during HERO SELECTION, what draft information does Valve Game State Integration expose to a player?
//
// Privacy contract: a GSI payload carries `player.steamid`, `player.accountid`, `player.name` and the
// `auth.token`. NOTHING here ever returns a raw value from the payload except through an allowlist
// (game_state, team_name, hero ids, hero class names, draft turn fields). Unknown values are reduced
// to their KEY NAMES only. The whole payload is never echoed.

export const GSI_PORT = 4001;
export const GSI_HOST = "127.0.0.1";
export const GSI_URI = `http://${GSI_HOST}:${GSI_PORT}/`;
export const GSI_CFG_NAME = "gamestate_integration_d2kiro.cfg";
export const HERO_SELECTION = "DOTA_GAMERULES_STATE_HERO_SELECTION";

// Valve team numbers: DOTA_TEAM_GOODGUYS = 2, DOTA_TEAM_BADGUYS = 3.
const DRAFT_TEAM_SIDE: Record<string, "radiant" | "dire"> = { team2: "radiant", team3: "dire" };

// ---------------------------------------------------------------------------------------------------
// Install detection
// ---------------------------------------------------------------------------------------------------

/** `"path"  "D:\\SteamLibrary"` lines of Steam's libraryfolders.vdf. */
export function parseLibraryFolders(vdf: string): string[] {
  const paths: string[] = [];
  for (const match of vdf.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/g)) {
    paths.push(match[1].replace(/\\\\/g, "\\"));
  }
  return paths;
}

export function dotaRootForLibrary(library: string): string {
  return joinWin(library, "steamapps", "common", "dota 2 beta");
}

export function gsiCfgDir(dotaRoot: string): string {
  return joinWin(dotaRoot, "game", "dota", "cfg", "gamestate_integration");
}

/** A Dota root is real only if its `game\dota\cfg` exists (uninstall-registry entries go stale). */
export function dotaCfgParent(dotaRoot: string): string {
  return joinWin(dotaRoot, "game", "dota", "cfg");
}

function joinWin(...parts: string[]): string {
  return parts.map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, ""))).join("\\");
}

// ---------------------------------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------------------------------

export function buildGsiConfig(token: string): string {
  return `"D2KIRO GSI Probe"
{
    "uri"           "${GSI_URI}"
    "timeout"       "5.0"
    "buffer"        "0.1"
    "throttle"      "0.1"
    "heartbeat"     "30.0"
    "data"
    {
        "provider"      "1"
        "map"           "1"
        "player"        "1"
        "hero"          "1"
        "draft"         "1"
        "abilities"     "1"
        "items"         "1"
        "buildings"     "1"
        "league"        "0"
        "wearables"     "0"
        "events"        "1"
        "couriers"      "1"
        "neutralitems"  "1"
        "roshan"        "1"
        "minimap"       "1"
    }
    "auth"
    {
        "token"         "${token}"
    }
}
`;
}

/** Reuses the token of a cfg we wrote earlier, so a Dota client launched with it keeps authenticating. */
export function extractOwnToken(cfg: string): string | null {
  if (!cfg.includes(GSI_URI)) return null;
  const match = cfg.match(/"token"\s+"([0-9a-f]{32,128})"/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------------------------------
// Safe summary
// ---------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

export interface DraftSide {
  side: "radiant" | "dire";
  picks: Array<{ slot: number; heroId: number; heroClass: string | null }>;
  bans: Array<{ slot: number; heroId: number; heroClass: string | null }>;
  /** Key names inside the team block, for structure. */
  keys: string[];
}

export interface SafeSummary {
  gameState: string | null;
  topKeys: string[];
  sectionKeys: Record<string, string[]>;
  draftPresent: boolean;
  draftKeys: string[];
  draft: {
    activeTeam: number | null;
    pick: boolean | null;
    activeTeamTimeRemaining: number | null;
    teams: DraftSide[];
  } | null;
  heroPresent: boolean;
  heroId: number | null;
  heroClass: string | null;
  teamPresent: boolean;
  teamName: "radiant" | "dire" | null;
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeHeroId(value: unknown): number | null {
  const n = typeof value === "string" && /^\d{1,3}$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1000 ? n : null;
}

function safeClass(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9_]{1,64}$/.test(value) ? value : null;
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonEmpty(value: unknown): boolean {
  return isObject(value) && Object.keys(value).length > 0;
}

function summarizeDraftTeam(teamKey: string, block: Json): DraftSide | null {
  const side = DRAFT_TEAM_SIDE[teamKey];
  if (!side) return null;
  const picks: DraftSide["picks"] = [];
  const bans: DraftSide["bans"] = [];
  for (const key of Object.keys(block)) {
    const match = key.match(/^(pick|ban)(\d{1,2})_id$/);
    if (!match) continue;
    const heroId = safeHeroId(block[key]);
    if (heroId === null || heroId === 0) continue;
    const entry = { slot: Number(match[2]), heroId, heroClass: safeClass(block[`${match[1]}${match[2]}_class`]) };
    (match[1] === "pick" ? picks : bans).push(entry);
  }
  picks.sort((a, b) => a.slot - b.slot);
  bans.sort((a, b) => a.slot - b.slot);
  return { side, picks, bans, keys: Object.keys(block).sort() };
}

export function summarizeGsi(payload: unknown): SafeSummary {
  const body = isObject(payload) ? payload : {};
  const map = isObject(body.map) ? body.map : {};
  const player = isObject(body.player) ? body.player : {};
  const hero = isObject(body.hero) ? body.hero : {};
  const draft = isObject(body.draft) ? body.draft : null;

  const sectionKeys: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(body)) {
    // `auth` holds only the token: its key names are fixed and its values are never touched.
    if (key === "auth") continue;
    if (isObject(value)) sectionKeys[key] = Object.keys(value).sort();
  }

  const teamNameRaw = player.team_name;
  const teamName = teamNameRaw === "radiant" || teamNameRaw === "dire" ? teamNameRaw : null;
  const heroId = safeHeroId(hero.id);

  let draftSummary: SafeSummary["draft"] = null;
  if (draft && nonEmpty(draft)) {
    const teams: DraftSide[] = [];
    for (const [key, value] of Object.entries(draft)) {
      if (!isObject(value)) continue;
      const team = summarizeDraftTeam(key, value);
      if (team) teams.push(team);
    }
    draftSummary = {
      activeTeam: safeNumber(draft.activeteam),
      pick: typeof draft.pick === "boolean" ? draft.pick : null,
      activeTeamTimeRemaining: safeNumber(draft.activeteam_time_remaining),
      teams,
    };
  }

  return {
    gameState: typeof map.game_state === "string" && /^[A-Z0-9_]{1,64}$/.test(map.game_state) ? map.game_state : null,
    topKeys: Object.keys(body).sort(),
    sectionKeys,
    draftPresent: draft !== null && nonEmpty(draft),
    draftKeys: draft ? Object.keys(draft).sort() : [],
    draft: draftSummary,
    heroPresent: nonEmpty(body.hero),
    heroId: heroId !== null && heroId > 0 ? heroId : null,
    heroClass: safeClass(hero.name),
    teamPresent: teamName !== null,
    teamName,
  };
}

/** Dedupe key: ignores the per-second timer so only structural/draft changes print. */
export function summaryKey(summary: SafeSummary): string {
  const draft = summary.draft ? { ...summary.draft, activeTeamTimeRemaining: null } : null;
  return JSON.stringify({ ...summary, draft });
}

function formatSide(team: DraftSide): string {
  const fmt = (list: DraftSide["picks"]) =>
    list.length === 0 ? "-" : list.map((e) => `${e.slot}:${e.heroId}${e.heroClass ? `(${e.heroClass})` : ""}`).join(" ");
  return `  ${team.side.padEnd(7)} picks [${fmt(team.picks)}]  bans [${fmt(team.bans)}]`;
}

export function formatSummary(summary: SafeSummary): string {
  const lines = [
    `GSI state: ${summary.gameState ?? "(none)"}`,
    `GSI keys: [${summary.topKeys.join(", ")}]`,
    `draft present: ${summary.draftPresent ? "yes" : "no"}`,
    `draft keys: [${summary.draftKeys.join(", ")}]`,
    `hero present: ${summary.heroPresent ? "yes" : "no"}${summary.heroId !== null ? ` (hero.id=${summary.heroId}${summary.heroClass ? ` ${summary.heroClass}` : ""})` : ""}`,
    `team present: ${summary.teamPresent ? `yes (player.team_name=${summary.teamName})` : "no"}`,
  ];
  for (const [section, keys] of Object.entries(summary.sectionKeys)) {
    if (section === "draft") continue;
    lines.push(`  ${section} keys: [${keys.join(", ")}]`);
  }
  if (summary.draft) {
    const d = summary.draft;
    lines.push(`  draft.activeteam=${d.activeTeam ?? "-"} draft.pick=${d.pick ?? "-"} draft.activeteam_time_remaining=${d.activeTeamTimeRemaining ?? "-"}`);
    for (const team of d.teams) lines.push(formatSide(team), `    keys: [${team.keys.join(", ")}]`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------------
// Evidence + verdict (only from HERO_SELECTION updates; nothing inferred)
// ---------------------------------------------------------------------------------------------------

export interface Evidence {
  heroSelectionUpdates: number;
  statesSeen: string[];
  sideField: string | null;
  draftEverPresent: boolean;
  draftKeysSeen: string[];
  banIds: Set<number>;
  allyPickIds: Set<number>;
  enemyPickIds: Set<number>;
  selfHeroIds: Set<number>;
  pickCountsSeen: number[];
  activeTeamsSeen: Set<number>;
}

export function createEvidence(): Evidence {
  return {
    heroSelectionUpdates: 0,
    statesSeen: [],
    sideField: null,
    draftEverPresent: false,
    draftKeysSeen: [],
    banIds: new Set(),
    allyPickIds: new Set(),
    enemyPickIds: new Set(),
    selfHeroIds: new Set(),
    pickCountsSeen: [],
    activeTeamsSeen: new Set(),
  };
}

export function recordEvidence(evidence: Evidence, summary: SafeSummary): void {
  if (summary.gameState && evidence.statesSeen.at(-1) !== summary.gameState) evidence.statesSeen.push(summary.gameState);
  if (summary.gameState !== HERO_SELECTION) return;
  evidence.heroSelectionUpdates += 1;
  if (summary.teamName) evidence.sideField = `player.team_name=${summary.teamName}`;
  if (summary.heroId !== null) evidence.selfHeroIds.add(summary.heroId);
  for (const key of summary.draftKeys) if (!evidence.draftKeysSeen.includes(key)) evidence.draftKeysSeen.push(key);
  if (!summary.draft) return;
  evidence.draftEverPresent = true;
  if (summary.draft.activeTeam !== null) evidence.activeTeamsSeen.add(summary.draft.activeTeam);
  let pickCount = 0;
  for (const team of summary.draft.teams) {
    for (const ban of team.bans) evidence.banIds.add(ban.heroId);
    pickCount += team.picks.length;
    if (!summary.teamName) continue;
    const target = team.side === summary.teamName ? evidence.allyPickIds : evidence.enemyPickIds;
    for (const pick of team.picks) target.add(pick.heroId);
  }
  if (evidence.pickCountsSeen.at(-1) !== pickCount) evidence.pickCountsSeen.push(pickCount);
}

export interface Verdict {
  verdict: "GSI_DRAFT_SUFFICIENT" | "GSI_DRAFT_INSUFFICIENT" | "NO_HERO_SELECTION_OBSERVED";
  criteria: Array<{ name: string; observed: boolean; field: string }>;
}

export function computeVerdict(evidence: Evidence): Verdict {
  const ids = (set: Set<number>) => [...set].sort((a, b) => a - b).join(",");
  const draftNote = evidence.draftEverPresent ? "" : " (draft block never non-empty during HERO_SELECTION)";
  const progressed = evidence.pickCountsSeen.some((count, i) => i > 0 && count > evidence.pickCountsSeen[i - 1]);
  const criteria = [
    { name: "our side", observed: evidence.sideField !== null, field: evidence.sideField ?? "player.team_name not radiant/dire" },
    { name: "bans", observed: evidence.banIds.size > 0, field: evidence.banIds.size > 0 ? `draft.teamN.banK_id = {${ids(evidence.banIds)}}` : `no draft.teamN.banK_id > 0${draftNote}` },
    { name: "allied locked picks", observed: evidence.allyPickIds.size > 0, field: evidence.allyPickIds.size > 0 ? `draft.team<ours>.pickK_id = {${ids(evidence.allyPickIds)}}` : `no draft.team<ours>.pickK_id > 0${draftNote}${evidence.selfHeroIds.size > 0 ? `; only own hero.id = {${ids(evidence.selfHeroIds)}}` : ""}` },
    { name: "enemy revealed picks", observed: evidence.enemyPickIds.size > 0, field: evidence.enemyPickIds.size > 0 ? `draft.team<theirs>.pickK_id = {${ids(evidence.enemyPickIds)}}` : `no draft.team<theirs>.pickK_id > 0${draftNote}` },
    { name: "pick progression", observed: progressed, field: progressed ? `pick count sequence ${evidence.pickCountsSeen.join("->")}, draft.activeteam {${ids(evidence.activeTeamsSeen)}}` : `no increasing pick count across updates${draftNote}` },
  ];
  if (evidence.heroSelectionUpdates === 0) return { verdict: "NO_HERO_SELECTION_OBSERVED", criteria };
  return { verdict: criteria.every((c) => c.observed) ? "GSI_DRAFT_SUFFICIENT" : "GSI_DRAFT_INSUFFICIENT", criteria };
}

export function formatVerdict(evidence: Evidence): string {
  const { verdict, criteria } = computeVerdict(evidence);
  return [
    "",
    "==================== D2KIRO GSI VERDICT ====================",
    verdict,
    `HERO_SELECTION updates measured: ${evidence.heroSelectionUpdates}`,
    `states seen: ${evidence.statesSeen.join(" -> ") || "(none)"}`,
    `draft keys seen during HERO_SELECTION: [${evidence.draftKeysSeen.join(", ")}]`,
    ...criteria.map((c) => `  [${c.observed ? "x" : " "}] ${c.name.padEnd(21)} ${c.field}`),
    "=============================================================",
  ].join("\n");
}
