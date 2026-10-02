import { createHash } from "node:crypto";
import type { HeroId, TeamSide } from "../draft-protocol/types";
import type { LiveObservation } from "./live-capture";

// Valve Game State Integration (Dota 2) -> the live capture's facts. Pure, no I/O.
//
// A GSI payload is EXTERNAL input that also carries personal data (`player.steamid`,
// `player.accountid`, `player.name`, `map.matchid`) and the link credential (`auth.token`). This
// module reads ONLY an allowlist: the game state, our side, our own hero id, the draft block's
// pick/ban hero ids, and the PRESENCE (never the value) of match telemetry fields. Identity is never
// read -- the owner of a live session is the account that generated the link, server side.
// `map.matchid` is reduced to a one-way hash in memory, only to notice "this is a different match".
//
// Draft visibility is NOT assumed: a player's client may send an empty `draft` block during Ranked All
// Pick (Valve populates it for spectators). Whatever is missing is reported as missing, so the UI says
// "partial capture -- enter the rest by hand" instead of inventing picks.

export type GsiPhase = "idle" | "loading" | "draft" | "match";

export interface GsiDraftCapabilities {
  /** The `draft` block carried any team data. */
  draftBlock: boolean;
  side: boolean;
  ownHero: boolean;
  bans: boolean;
  allyPicks: boolean;
  enemyPicks: boolean;
}

export interface GsiUpdate {
  /** Allowlisted `map.game_state` (DOTA_GAMERULES_STATE_*), null when absent (main menu heartbeat). */
  gameState: string | null;
  phase: GsiPhase;
  side: TeamSide | null;
  ownHeroId: HeroId | null;
  /** Pick/ban hero ids from the draft block; null when the client sent no draft data. */
  draft: { bans: HeroId[]; picks: { side: TeamSide; heroId: HeroId }[] } | null;
  /** One-way hash of `map.matchid` (never the id itself); null when absent. */
  matchKey: string | null;
  capabilities: GsiDraftCapabilities;
  /** Match telemetry capability labels PRESENT in this payload (values never kept). */
  telemetry: string[];
}

const DRAFT_STATES = new Set(["DOTA_GAMERULES_STATE_HERO_SELECTION", "DOTA_GAMERULES_STATE_STRATEGY_TIME"]);
const LOADING_STATES = new Set(["DOTA_GAMERULES_STATE_INIT", "DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD", "DOTA_GAMERULES_STATE_CUSTOM_GAME_SETUP"]);
const GAME_STATE = /^DOTA_GAMERULES_STATE_[A-Z_]{1,48}$/;
// Valve team numbers: DOTA_TEAM_GOODGUYS = 2 (Radiant), DOTA_TEAM_BADGUYS = 3 (Dire).
const DRAFT_TEAM_SIDE: Record<string, TeamSide> = { team2: "radiant", team3: "dire" };
const DRAFT_SLOT_KEY = /^(pick|ban)(\d{1,2})_id$/;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function heroIdOf(value: unknown): HeroId | null {
  const n = typeof value === "string" && /^\d{1,3}$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n < 1000 ? n : null;
}

function phaseOf(gameState: string | null): GsiPhase {
  if (gameState === null) return "idle";
  if (DRAFT_STATES.has(gameState)) return "draft";
  if (LOADING_STATES.has(gameState)) return "loading";
  return "match";
}

function readDraft(block: Json): GsiUpdate["draft"] {
  const bans: HeroId[] = [];
  const picks: { side: TeamSide; heroId: HeroId }[] = [];
  // Only pick/ban slots count as draft data: an empty `team2: {}` (or one with only `home_team`) says nothing.
  let teamData = false;
  for (const [teamKey, team] of Object.entries(block)) {
    const side = DRAFT_TEAM_SIDE[teamKey];
    if (!side || !isObject(team)) continue;
    const slots = Object.keys(team)
      .map((key) => ({ key, match: key.match(DRAFT_SLOT_KEY) }))
      .filter((entry): entry is { key: string; match: RegExpMatchArray } => entry.match !== null)
      .sort((a, b) => Number(a.match[2]) - Number(b.match[2]));
    if (slots.length > 0) teamData = true;
    for (const { key, match } of slots) {
      const heroId = heroIdOf(team[key]);
      if (heroId === null) continue;
      if (match[1] === "ban") bans.push(heroId);
      else picks.push({ side, heroId });
    }
  }
  return teamData ? { bans, picks } : null;
}

function hashMatch(value: unknown): string | null {
  const id = typeof value === "string" || typeof value === "number" ? String(value) : null;
  if (id === null || !/^\d{1,20}$/.test(id) || /^0+$/.test(id)) return null;
  return createHash("sha256").update(`d2k-gsi-match/v1|${id}`).digest("hex").slice(0, 16);
}

interface TelemetryProbe {
  label: string;
  section: "map" | "hero" | "player" | "items" | "abilities";
  test: (section: Json) => boolean;
}

function has(key: string, kind: "number" | "boolean" = "number") {
  return (section: Json) => typeof section[key] === kind;
}

function anyChild(test: (child: Json) => boolean) {
  return (section: Json) => Object.values(section).some((child) => isObject(child) && test(child));
}

// Capability discovery only: which fields this client sends. No coaching is built on any of them yet.
const TELEMETRY_PROBES: TelemetryProbe[] = [
  { label: "clock_time", section: "map", test: has("clock_time") },
  { label: "game_time", section: "map", test: has("game_time") },
  { label: "hero_level", section: "hero", test: has("level") },
  { label: "hero_health", section: "hero", test: has("health") },
  { label: "hero_mana", section: "hero", test: has("mana") },
  { label: "hero_alive", section: "hero", test: has("alive", "boolean") },
  { label: "hero_respawn", section: "hero", test: has("respawn_seconds") },
  { label: "hero_buyback", section: "hero", test: (s) => typeof s.buyback_cost === "number" || typeof s.buyback_cooldown === "number" },
  { label: "kda", section: "player", test: (s) => ["kills", "deaths", "assists"].every((key) => typeof s[key] === "number") },
  { label: "last_hits", section: "player", test: has("last_hits") },
  { label: "denies", section: "player", test: has("denies") },
  { label: "gold", section: "player", test: has("gold") },
  { label: "gpm", section: "player", test: has("gpm") },
  { label: "xpm", section: "player", test: has("xpm") },
  { label: "net_worth", section: "player", test: (s) => typeof s.net_worth === "number" || typeof s.networth === "number" },
  { label: "items", section: "items", test: anyChild((item) => typeof item.name === "string") },
  { label: "item_cooldowns", section: "items", test: anyChild((item) => typeof item.cooldown === "number") },
  { label: "abilities", section: "abilities", test: anyChild((ability) => typeof ability.name === "string") },
  { label: "ability_levels", section: "abilities", test: anyChild((ability) => typeof ability.level === "number") },
  { label: "ability_cooldowns", section: "abilities", test: anyChild((ability) => typeof ability.cooldown === "number") },
];

function readTelemetry(body: Json): string[] {
  const labels: string[] = [];
  for (const probe of TELEMETRY_PROBES) {
    const section = body[probe.section];
    if (isObject(section) && probe.test(section)) labels.push(probe.label);
  }
  return labels;
}

/** External input -> the allowlisted facts of one GSI update. Never throws, never returns a raw value outside the allowlist. */
export function normalizeGsi(payload: unknown): GsiUpdate {
  const body = isObject(payload) ? payload : {};
  const map = isObject(body.map) ? body.map : {};
  const player = isObject(body.player) ? body.player : {};
  const hero = isObject(body.hero) ? body.hero : {};
  const gameState = typeof map.game_state === "string" && GAME_STATE.test(map.game_state) ? map.game_state : null;
  const side = player.team_name === "radiant" || player.team_name === "dire" ? player.team_name : null;
  const ownHeroId = heroIdOf(hero.id);
  const draft = isObject(body.draft) ? readDraft(body.draft) : null;

  const allyPicks = side !== null && draft !== null && draft.picks.some((pick) => pick.side === side);
  const enemyPicks = side !== null && draft !== null && draft.picks.some((pick) => pick.side !== side);
  return {
    gameState,
    phase: phaseOf(gameState),
    side,
    ownHeroId,
    draft,
    matchKey: hashMatch(map.matchid),
    capabilities: {
      draftBlock: draft !== null,
      side: side !== null,
      ownHero: ownHeroId !== null,
      bans: draft !== null && draft.bans.length > 0,
      allyPicks,
      enemyPicks,
    },
    telemetry: readTelemetry(body),
  };
}

/**
 * The draft facts one update states, in application order (side first, so own picks are recognised).
 * Only during hero selection / strategy time: outside the draft a hero id is the match hero, not a pick.
 */
export function observationsFromGsi(update: GsiUpdate, patch: string): LiveObservation[] {
  if (update.phase !== "draft") return [];
  // Hero selection already shown by the game = the Player needs recommendations NOW, not after the first
  // lock. A player's GSI may never say when bans end, so the pick phase opens immediately. Safe: every
  // rebuild replays all bans before ban resolution closes, so a ban reported later still lands first.
  const observations: LiveObservation[] = [{ type: "draft_started", patch }, { type: "bans_closed" }];
  if (update.side !== null) observations.push({ type: "side", side: update.side });
  for (const heroId of update.draft?.bans ?? []) observations.push({ type: "ban", heroId });
  for (const pick of update.draft?.picks ?? []) observations.push({ type: "pick", side: pick.side, heroId: pick.heroId, position: null });
  // Our own hero: the game only creates it once the pick is locked. No position -- GSI does not say it.
  if (update.ownHeroId !== null && update.side !== null) observations.push({ type: "pick", side: update.side, heroId: update.ownHeroId, position: null });
  return observations;
}
