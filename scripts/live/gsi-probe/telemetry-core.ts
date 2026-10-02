// In-match GSI telemetry discovery -- pure core (no I/O). Capability discovery, NOT a pass/fail:
// it records which key paths the player's real client actually sends during the match, and whether
// each one changes over time. Field names are never assumed: every capability line is matched against
// OBSERVED paths, and the full observed inventory is printed so nothing depends on a guessed name.
//
// Privacy contract: values are never output. Change detection keeps only a hash per path, in memory.
// The single exception is an allowlist of public game-data names (hero/item/ability class names under
// `hero`, `items`, `abilities`, matching ^[a-z0-9_]+$). `auth`, `previously` and `added` are never walked.

export const IN_MATCH_STATES = new Set(["DOTA_GAMERULES_STATE_PRE_GAME", "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"]);

const SKIPPED_SECTIONS = new Set(["auth", "previously", "added"]);
const UNIT_SECTIONS = new Set(["player", "hero", "items", "abilities"]);
const MAX_DEPTH = 6;
const SAFE_GAME_NAME = /^[a-z0-9_]{1,64}$/;

interface PathStat {
  types: Set<string>;
  seen: number;
  changed: boolean;
}

export interface Telemetry {
  updatesByState: Map<string, number>;
  statesSeen: string[];
  paths: Map<string, PathStat>;
  lastHash: Map<string, string>;
  heroNames: Set<string>;
  itemNames: Set<string>;
  abilityNames: Set<string>;
  itemSlotKeys: Set<string>;
  /** team number -> distinct `player#` blocks seen under it in player/hero/items/abilities. */
  unitTeams: Map<number, Set<string>>;
  minimapTeams: Set<number>;
  ownTeamName: "radiant" | "dire" | null;
}

export function createTelemetry(): Telemetry {
  return {
    updatesByState: new Map(),
    statesSeen: [],
    paths: new Map(),
    lastHash: new Map(),
    heroNames: new Set(),
    itemNames: new Set(),
    abilityNames: new Set(),
    itemSlotKeys: new Set(),
    unitTeams: new Map(),
    minimapTeams: new Set(),
    ownTeamName: null,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Digits -> `#` (slot0 -> slot#, team2 -> team#); anything not a plain identifier -> `<key>`. */
export function generalizeSegment(segment: string): string {
  const generalized = segment.replace(/\d+/g, "#");
  return /^[A-Za-z_#][A-Za-z0-9_#]{0,47}$/.test(generalized) ? generalized : "<key>";
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function collectLeaves(value: unknown, path: string[], out: Array<[string[], unknown]>): void {
  if (isObject(value) && path.length < MAX_DEPTH) {
    for (const [key, child] of Object.entries(value)) collectLeaves(child, [...path, key], out);
    return;
  }
  out.push([path, value]);
}

function noteSafeName(t: Telemetry, path: string[], value: unknown): void {
  if (path.at(-1) !== "name" || typeof value !== "string" || !SAFE_GAME_NAME.test(value)) return;
  if (path[0] === "hero") t.heroNames.add(value);
  if (path[0] === "items") t.itemNames.add(value);
  if (path[0] === "abilities") t.abilityNames.add(value);
}

function noteScope(t: Telemetry, path: string[], value: unknown): void {
  if (UNIT_SECTIONS.has(path[0])) {
    for (let i = 1; i < path.length; i += 1) {
      const team = path[i].match(/^team([23])$/);
      if (!team) continue;
      const players = t.unitTeams.get(Number(team[1])) ?? new Set<string>();
      const next = path[i + 1];
      if (next && /^player\d{1,2}$/.test(next)) players.add(next);
      t.unitTeams.set(Number(team[1]), players);
    }
  }
  if (path[0] === "minimap" && path.at(-1) === "team" && (value === 2 || value === 3)) t.minimapTeams.add(value);
}

export function recordTelemetry(t: Telemetry, payload: unknown, gameState: string | null): void {
  if (gameState === null || !IN_MATCH_STATES.has(gameState)) return;
  t.updatesByState.set(gameState, (t.updatesByState.get(gameState) ?? 0) + 1);
  if (t.statesSeen.at(-1) !== gameState) t.statesSeen.push(gameState);
  if (!isObject(payload)) return;

  const player = isObject(payload.player) ? payload.player : {};
  if (player.team_name === "radiant" || player.team_name === "dire") t.ownTeamName = player.team_name;
  if (isObject(payload.items)) for (const key of Object.keys(payload.items)) t.itemSlotKeys.add(generalizeSegment(key) === "<key>" ? "<key>" : key);

  const leaves: Array<[string[], unknown]> = [];
  for (const [section, value] of Object.entries(payload)) {
    if (SKIPPED_SECTIONS.has(section)) continue;
    collectLeaves(value, [section], leaves);
  }
  for (const [path, value] of leaves) {
    const concrete = path.join("\u0000");
    const generalized = path.map(generalizeSegment).join(".");
    const stat = t.paths.get(generalized) ?? { types: new Set<string>(), seen: 0, changed: false };
    stat.types.add(valueType(value));
    stat.seen += 1;
    const hash = String(Bun.hash(JSON.stringify(value) ?? "undefined"));
    const previous = t.lastHash.get(concrete);
    if (previous !== undefined && previous !== hash) stat.changed = true;
    t.lastHash.set(concrete, hash);
    t.paths.set(generalized, stat);
    noteSafeName(t, path, value);
    noteScope(t, path, value);
  }
}

// ---------------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------------

interface Capability {
  label: string;
  sections: string[];
  key: RegExp;
}

const CAPABILITIES: Capability[] = [
  { label: "time.clock_time", sections: ["map"], key: /^clock_time$/ },
  { label: "time.game_time", sections: ["map"], key: /^game_time$/ },
  { label: "map.game_state", sections: ["map"], key: /^game_state$/ },
  { label: "hero.id", sections: ["hero"], key: /^id$/ },
  { label: "hero.name", sections: ["hero"], key: /^name$/ },
  { label: "hero.level", sections: ["hero"], key: /^level$/ },
  { label: "hero.alive", sections: ["hero"], key: /alive/ },
  { label: "hero.health", sections: ["hero"], key: /^health$/ },
  { label: "hero.max_health", sections: ["hero"], key: /^max_health$/ },
  { label: "hero.mana", sections: ["hero"], key: /^mana$/ },
  { label: "hero.max_mana", sections: ["hero"], key: /^max_mana$/ },
  { label: "hero.respawn", sections: ["hero"], key: /respawn/ },
  { label: "hero.buyback", sections: ["hero"], key: /buyback/ },
  { label: "player.kills", sections: ["player"], key: /^kills$/ },
  { label: "player.deaths", sections: ["player"], key: /^deaths$/ },
  { label: "player.assists", sections: ["player"], key: /^assists$/ },
  { label: "player.last_hits", sections: ["player"], key: /^last_?hits$/ },
  { label: "player.denies", sections: ["player"], key: /^denies$/ },
  { label: "player.gold", sections: ["player"], key: /^gold/ },
  { label: "player.gpm", sections: ["player"], key: /^(gpm|gold_per_min)/ },
  { label: "player.xpm", sections: ["player"], key: /^(xpm|xp_per_min)/ },
  { label: "player.net_worth", sections: ["player"], key: /net_?worth/ },
  { label: "items.name", sections: ["items"], key: /^name$/ },
  { label: "items.charges", sections: ["items"], key: /charges/ },
  { label: "items.cooldown", sections: ["items"], key: /cooldown/ },
  { label: "abilities.name", sections: ["abilities"], key: /^name$/ },
  { label: "abilities.level", sections: ["abilities"], key: /^level$/ },
  { label: "abilities.cooldown", sections: ["abilities"], key: /cooldown/ },
  { label: "abilities.can_cast", sections: ["abilities"], key: /can_cast|castable/ },
  { label: "abilities.ultimate", sections: ["abilities"], key: /ultimate/ },
];

function matchingPaths(t: Telemetry, sections: string[], key: RegExp): string[] {
  return [...t.paths.keys()].filter((p) => {
    const segments = p.split(".");
    return sections.includes(segments[0]) && key.test(segments.at(-1) ?? "");
  });
}

function statusOf(t: Telemetry, paths: string[]): string {
  if (paths.length === 0) return "ABSENT";
  const changing = paths.some((p) => t.paths.get(p)?.changed);
  return `PRESENT ${changing ? "(changing)" : "(static)"}  [${paths.join(", ")}]`;
}

function sectionStatus(t: Telemetry, section: string): string {
  return [...t.paths.keys()].some((p) => p.split(".")[0] === section) ? "PRESENT" : "ABSENT";
}

export function dataScope(t: Telemetry): { scopes: string[]; evidence: string[] } {
  const own = t.ownTeamName === "radiant" ? 2 : t.ownTeamName === "dire" ? 3 : null;
  const evidence: string[] = [];
  let team = false;
  let enemy = false;
  for (const [teamNumber, players] of t.unitTeams) {
    evidence.push(`team${teamNumber} blocks under player/hero/items/abilities: ${players.size} player# block(s)`);
    if (own === null) continue;
    if (teamNumber === own && players.size > 1) team = true;
    if (teamNumber !== own) enemy = true;
  }
  if (t.minimapTeams.size > 0) {
    evidence.push(`minimap.<obj>.team values: {${[...t.minimapTeams].sort().join(",")}}`);
    if (own !== null && [...t.minimapTeams].some((n) => n !== own)) enemy = true;
  }
  if (own === null && t.unitTeams.size > 0) evidence.push("own side unknown (no player.team_name) -- team/enemy split not decidable");
  const scopes = [team ? "TEAM_DATA_PRESENT" : null, enemy ? "ENEMY_DATA_PRESENT" : null].filter((s): s is string => s !== null);
  if (scopes.length === 0) scopes.push(t.unitTeams.size > 0 ? "MULTI_UNIT_BLOCKS_SIDE_UNKNOWN" : "OWN_PLAYER_ONLY");
  return { scopes, evidence };
}

export function formatTelemetryReport(t: Telemetry, generatedAt: string): string {
  const updates = [...t.updatesByState.entries()].map(([s, n]) => `${s} (${n} updates)`);
  const lines = ["GSI MATCH TELEMETRY", `generated: ${generatedAt}`, `in-match states observed: ${updates.join(", ") || "NONE"}`];
  if (t.paths.size === 0) {
    lines.push("", "No in-match payload observed yet (states counted: PRE_GAME, GAME_IN_PROGRESS).");
    return `${lines.join("\n")}\n`;
  }
  const scope = dataScope(t);
  lines.push(`own side (player.team_name): ${t.ownTeamName ?? "not observed"}`, `data scope: ${scope.scopes.join(" + ")}`);
  for (const e of scope.evidence) lines.push(`  ${e}`);
  lines.push("", "status legend: PRESENT (changing) = value changed between updates; PRESENT (static) = never changed while observed", "");
  for (const c of CAPABILITIES) lines.push(`${c.label}: ${statusOf(t, matchingPaths(t, c.sections, c.key))}`);
  const kda = ["kills", "deaths", "assists"].every((k) => matchingPaths(t, ["player"], new RegExp(`^${k}$`)).length > 0);
  const itemChanges = [...t.paths.entries()].filter(([p, s]) => p.startsWith("items.") && s.changed).map(([p]) => p);
  const abilityCooldowns = matchingPaths(t, ["abilities"], /cooldown/);
  lines.push(
    "",
    `player.kda: ${kda ? "PRESENT" : "ABSENT"}`,
    `items: ${sectionStatus(t, "items")}`,
    `item slots observed: [${[...t.itemSlotKeys].sort().join(", ")}]`,
    `item names observed: [${[...t.itemNames].sort().join(", ")}]`,
    `item_changes_observed: ${itemChanges.length > 0 ? `YES  [${itemChanges.join(", ")}]` : "NO"}`,
    `abilities: ${sectionStatus(t, "abilities")}`,
    `ability names observed: [${[...t.abilityNames].sort().join(", ")}]`,
    `ability_cooldowns: ${abilityCooldowns.length > 0 ? "PRESENT" : "ABSENT"}`,
    `hero names observed: [${[...t.heroNames].sort().join(", ")}]`,
    "",
    "OBSERVED PATH INVENTORY (generalized: digits -> #; values never shown)",
  );
  for (const [path, stat] of [...t.paths.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${path.padEnd(44)} ${[...stat.types].sort().join("|").padEnd(14)} seen ${String(stat.seen).padStart(6)}  ${stat.changed ? "CHANGING" : "static"}`);
  }
  return `${lines.join("\n")}\n`;
}

export function telemetryStatusLine(t: Telemetry): string {
  const total = [...t.updatesByState.values()].reduce((a, b) => a + b, 0);
  const changing = [...t.paths.values()].filter((s) => s.changed).length;
  return `match telemetry: ${total} in-match updates, ${t.paths.size} distinct paths, ${changing} changing`;
}
