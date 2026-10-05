// D2KIRO live capture -- PURE core of the Overwolf adapter (no `overwolf.*`, no network, no clock).
//
// Turns Overwolf Game Events Provider (GEP) updates for Dota 2 into draft-event/v1 payloads:
//
//   match_state -> DOTA_GAMERULES_STATE_HERO_SELECTION   => session_started (once per match)
//   me.team                                              => local_side_identified
//   roster.bans  (new non-zero heroId)                   => hero_banned
//   roster.players (seat = team + team_slot)             => hero_picked (+ own position from role)
//   same seat, different confirmed hero, in selection    => pick_reverted + hero_picked
//   roster.draft (no seat)                               => hero_picked (never a revert: no seat identity)
//
// It is DIFF-BASED: every update replaces the latest snapshot and only what was never emitted before is
// emitted, so a repeated/duplicated Overwolf update can never produce a second pick. Array ORDER is never
// identity -- a player is identified by (team, team_slot), so a reordered roster changes nothing.
//
// Field names follow the official Dota 2 GEP docs (players: heroId|hero, team|teamId, team_slot|index|
// player_index, role, pickConfirmed; bans/draft: heroId, team), tolerating numeric strings, since the
// docs' own examples mix `"75"` and `56`.
//
// When Dota was started without `-gamestateintegration` the GEP data cannot be trusted: NO draft event is
// emitted at all, only a degraded capture_health (DOTA_CAPTURE_NOT_ENABLED).

export const DOTA2_GAME_CLASS_ID = 7314;
export const LIVE_PATCH = "7.41e";
export const REQUIRED_FEATURES = ["roster", "game_state", "match_state_changed", "match_info", "me"];
export const CAPTURE_NOT_ENABLED = "DOTA_CAPTURE_NOT_ENABLED";
export const HERO_SELECTION = "DOTA_GAMERULES_STATE_HERO_SELECTION";
export const DOTA_NOT_RUNNING = "DOTA_NOT_RUNNING";

// States in which the draft is (or has been) observable this match. A late adapter start still catches up.
const DRAFT_OBSERVABLE_STATES = new Set([HERO_SELECTION, "DOTA_GAMERULES_STATE_STRATEGY_TIME", "DOTA_GAMERULES_STATE_TEAM_SHOWCASE", "DOTA_GAMERULES_STATE_WAIT_FOR_MAP_TO_LOAD", "DOTA_GAMERULES_STATE_PRE_GAME", "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"]);
// States that mean "no draft of this match is running": a later HERO_SELECTION is a new match.
const PRE_DRAFT_STATES = new Set(["DOTA_GAMERULES_STATE_INIT", "DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD", "DOTA_GAMERULES_STATE_CUSTOM_GAME_SETUP", "DOTA_GAMERULES_STATE_PLAYER_DRAFT"]);
const POST_GAME = "DOTA_GAMERULES_STATE_POST_GAME";

/**
 * Overwolf roster role -> Dota position, ONLY where the role names the position: 1 Safelane = Pos1, 4 Midlane =
 * Pos2, 2 Offlane = Pos3, 16 HardSupport = Pos5. `8` ("Other") is deliberately absent: it is not Pos4 by itself
 * (it is whatever the game could not classify), so the seat keeps no position and the Player assigns it -- never
 * a guess. Only describes the real roster, never decides legality.
 */
export const ROLE_TO_POSITION = Object.freeze({ 1: 1, 4: 2, 2: 3, 16: 5 });

const LOCAL_ENGINE_URL = /^http:\/\/127\.0\.0\.1:\d{2,5}$/;
const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;
// Cloud mode: the paired adapter talks to the D2KIRO site over HTTPS (http only for a local dev site).
const SITE_URL = /^(https:\/\/[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:\d{2,5})?|http:\/\/(127\.0\.0\.1|localhost):\d{2,5})$/i;
const PAIRING_CODE = /^[A-HJKMNP-Z2-9]{8}$/;
const CAPTURE_ID = /^[A-Za-z0-9_-]{43}$/;
const CAPTURE_TOKEN = /^[0-9a-f]{64}$/;
export const CAPTURE_BATCH_SCHEMA = "overwolf-capture/v1";
/** The engine accepts at most 64 events per batch (apps/engine routes/live-overwolf.ts). */
export const MAX_BATCH_EVENTS = 32;

/** "https://d2kiro.example/" -> "https://d2kiro.example"; anything that is not an https site (or a local dev site) -> null. */
export function parseSiteUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  return SITE_URL.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** What the Player types in the pairing window: "ABCD-2345" / "abcd2345" -> "ABCD2345"; anything else -> null. */
export function parsePairingCode(value) {
  if (typeof value !== "string" || value.length > 32) return null;
  const compact = value.replace(/[\s-]/g, "").toUpperCase();
  return PAIRING_CODE.test(compact) ? compact : null;
}

/** The credential the site handed back (never logged). `null` when its shape is not exactly what the engine issues. */
export function parseCredentialResponse(value, siteUrl) {
  if (typeof value !== "object" || value === null) return null;
  const { captureId, token, expiresAt } = value;
  if (typeof captureId !== "string" || !CAPTURE_ID.test(captureId)) return null;
  if (typeof token !== "string" || !CAPTURE_TOKEN.test(token)) return null;
  if (typeof expiresAt !== "string" || Number.isNaN(Date.parse(expiresAt))) return null;
  const site = parseSiteUrl(siteUrl);
  return site === null ? null : { siteUrl: site, captureId, token, expiresAt };
}

/** The credential as stored locally (same shape). `null` when absent, malformed or expired at `nowMs`. */
export function parseStoredCredential(value, nowMs) {
  const parsed = parseCredentialResponse(value, value?.siteUrl);
  if (parsed === null || Date.parse(parsed.expiresAt) <= nowMs) return null;
  return parsed;
}

export const batchUrl = (credential) => `${credential.siteUrl}/api/live/overwolf/${credential.captureId}`;
export const heroesUrl = (credential) => `${batchUrl(credential)}/heroes`;
export const pairUrl = (siteUrl) => `${siteUrl}/api/live/overwolf/pair`;

// ---- Privacy boundary -------------------------------------------------------------------------------------
// A GEP roster update carries identity (steamId, name, rank, medal...). Only the fields below EVER enter the
// adapter's state; everything else is dropped on arrival, so it can neither be sent, logged nor displayed.
const SMALL_VALUE = /^[0-9]{1,6}$/;
const HERO_NAME = /^[a-z0-9_]{1,64}$/i;

function smallNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && SMALL_VALUE.test(value)) return Number(value);
  return undefined;
}

function heroField(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && (SMALL_VALUE.test(value) || HERO_NAME.test(value) || value === "")) return value;
  return undefined;
}

/** One roster/ban/draft entry reduced to hero / team / seat / role / confirmation. Anything else is dropped. */
export function sanitizeEntry(entry) {
  if (typeof entry !== "object" || entry === null) return null;
  const clean = {};
  for (const key of ["heroId", "hero_id", "heroid", "hero", "hero_name"]) {
    const value = heroField(entry[key]);
    if (value !== undefined) clean[key] = value;
  }
  for (const key of ["team", "teamId", "team_id"]) {
    const value = entry[key] === "radiant" || entry[key] === "dire" ? entry[key] : smallNumber(entry[key]);
    if (value !== undefined) clean[key] = value;
  }
  for (const key of ["team_slot", "player_index", "index", "role"]) {
    const value = smallNumber(entry[key]);
    if (value !== undefined) clean[key] = value;
  }
  for (const key of ["pickConfirmed", "pick_confirmed"]) {
    if (typeof entry[key] === "boolean") clean[key] = entry[key];
  }
  return clean;
}

function sanitizeList(value) {
  return value.map(sanitizeEntry).filter((entry) => entry !== null);
}

/** Validates the local, gitignored capture config written by `bun run dev:live`. `null` when unusable. */
export function parseCaptureConfig(value) {
  if (typeof value !== "object" || value === null) return null;
  const { engineUrl, sessionId, captureToken } = value;
  if (typeof engineUrl !== "string" || !LOCAL_ENGINE_URL.test(engineUrl)) return null;
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return null;
  if (typeof captureToken !== "string" || captureToken.length < 16) return null;
  return { engineUrl, sessionId, captureToken };
}

export function parseMaybeJson(value) {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isZero(value) {
  return value === 0 || value === "0";
}

/** Dota ids this adapter reads (heroes, roles, seats) are all well below 1000; anything larger is not one. */
function toPositiveInt(value) {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number > 0 && number < 1000 ? number : null;
}

/** 2 / "2" / "radiant" -> radiant; 3 / "3" / "dire" -> dire; anything else (0, unassigned) -> null. */
export function teamToSide(team) {
  if (team === 2 || team === "2" || team === "radiant") return "radiant";
  if (team === 3 || team === "3" || team === "dire") return "dire";
  return null;
}

export function roleToPosition(role) {
  const key = toPositiveInt(role);
  return key === null ? null : ROLE_TO_POSITION[key] ?? null;
}

export function normalizeHeroName(name) {
  return String(name).toLowerCase().replace(/^npc_dota_hero_/, "").replace(/[^a-z0-9]/g, "");
}

/** Hero catalog rows (`GET /api/heroes`: { id, name, localizedName }) -> lookup by any normalized name. */
export function buildHeroNameIndex(heroes) {
  const index = new Map();
  for (const hero of Array.isArray(heroes) ? heroes : []) {
    const id = toPositiveInt(hero?.id);
    if (id === null) continue;
    for (const name of [hero.name, hero.localizedName]) if (typeof name === "string" && name.length > 0) index.set(normalizeHeroName(name), id);
  }
  return index;
}

/** heroId (number or numeric string) first, then a hero name through the catalog. Zero/unknown -> null. */
export function resolveHeroId(entry, heroIdByName) {
  if (typeof entry !== "object" || entry === null) return null;
  const direct = toPositiveInt(entry.heroId ?? entry.hero_id ?? entry.heroid);
  if (direct !== null) return direct;
  const name = entry.hero ?? entry.hero_name;
  if (typeof name === "string" && name.length > 0 && heroIdByName) return heroIdByName.get(normalizeHeroName(name)) ?? null;
  return toPositiveInt(name);
}

/**
 * Reads Overwolf's game info for the Dota launch option. `true`/`false` when the command line is
 * readable, `null` when this Overwolf build did not report one (the capture then proceeds unverified).
 */
export function hasGameStateIntegration(gameInfoResult) {
  const candidates = [
    gameInfoResult?.gameInfo?.GameInfo?.ProcessCommandLine,
    gameInfoResult?.gameInfo?.ProcessCommandLine,
    gameInfoResult?.GameInfo?.ProcessCommandLine,
    gameInfoResult?.ProcessCommandLine,
    gameInfoResult?.gameInfo?.commandLine,
    gameInfoResult?.commandLine,
  ];
  const commandLine = candidates.find((value) => typeof value === "string");
  if (commandLine === undefined) return null;
  return /(^|\s)-gamestateintegration(\s|$)/i.test(commandLine);
}

export function createCaptureState(options = {}) {
  return {
    patch: options.patch ?? LIVE_PATCH,
    gsi: null,
    dotaRunning: false,
    matchState: null,
    localSide: null,
    players: [],
    bans: [],
    draft: [],
    /** Which GEP roster keys carried data this match (presence only; reported to the site's diagnostics). */
    presence: { roster: false, bans: false, draft: false, players: false },
    started: false,
    ended: false,
    emittedSide: null,
    emittedBans: new Set(),
    /** seatKey -> heroId currently emitted for that seat. */
    seatHeroes: new Map(),
    /** heroId -> { side, seatKey|null, position|null } for every emitted pick. */
    emittedHeroes: new Map(),
  };
}

function resetMatch(state) {
  state.started = false;
  state.ended = false;
  state.emittedSide = null;
  state.emittedBans = new Set();
  state.seatHeroes = new Map();
  state.emittedHeroes = new Map();
  state.players = [];
  state.bans = [];
  state.draft = [];
  state.presence = { roster: false, bans: false, draft: false, players: false };
}

/** Which GEP roster keys carried data this match. Booleans only -- never a hero, a player or a value. */
export function capturePresence(state) {
  return { ...state.presence };
}

/** The `-gamestateintegration` check result. `false` emits ONE degraded health event; draft events stay off until it is fixed. */
export function setGsiStatus(state, enabled, ctx = {}) {
  const previous = state.gsi;
  state.gsi = enabled;
  if (enabled === false && previous !== false) return [healthPayload(state)];
  if (enabled !== false && previous === false) return [healthPayload(state), ...flush(state, ctx)];
  return [];
}

/** Overwolf reported Dota 2 starting/stopping. */
export function setDotaRunning(state, running) {
  state.dotaRunning = running === true;
}

/** Heartbeat payload: how the capture is doing right now. */
export function healthPayload(state) {
  if (state.gsi === false) return { type: "capture_health", status: "degraded", detail: CAPTURE_NOT_ENABLED };
  if (!state.dotaRunning) return { type: "capture_health", status: "ok", detail: DOTA_NOT_RUNNING };
  return { type: "capture_health", status: "ok", detail: state.started ? "HERO_SELECTION" : "WAITING_FOR_DRAFT" };
}

function setMatchState(state, matchState) {
  if (typeof matchState !== "string" || matchState === state.matchState) return [];
  const payloads = [];
  if (state.started && (PRE_DRAFT_STATES.has(matchState) || matchState === POST_GAME) && !state.ended) {
    payloads.push({ type: "session_ended", reason: matchState === POST_GAME ? "completed" : "aborted" });
    state.ended = true;
  }
  if ((PRE_DRAFT_STATES.has(matchState) && state.started) || (matchState === HERO_SELECTION && state.ended)) resetMatch(state);
  state.matchState = matchState;
  return payloads;
}

function setLocalSide(state, team) {
  const side = teamToSide(team);
  if (side !== null) state.localSide = side;
}

/** One `overwolf.games.events.onInfoUpdates2` payload -> draft-event/v1 payloads to send, in order. */
export function handleInfoUpdate(state, update, ctx = {}) {
  const info = update?.info ?? {};
  const payloads = [];
  if (info.game?.match_state !== undefined) payloads.push(...setMatchState(state, info.game.match_state));
  if (info.game?.player_team !== undefined) setLocalSide(state, info.game.player_team);
  if (info.me?.team !== undefined) setLocalSide(state, info.me.team);
  const roster = info.roster;
  if (roster) {
    // Every entry is reduced to the allowlist HERE (sanitizeEntry): steamId / name / rank never enter the state.
    if (roster.players !== undefined) {
      const players = parseMaybeJson(roster.players);
      if (Array.isArray(players)) {
        state.players = sanitizeList(players);
        if (state.players.length > 0) state.presence.players = true;
      }
    }
    if (roster.bans !== undefined) {
      const bans = parseMaybeJson(roster.bans);
      if (Array.isArray(bans)) {
        state.bans = sanitizeList(bans);
        if (state.bans.length > 0) state.presence.bans = true;
      }
    }
    if (roster.draft !== undefined) {
      const draft = parseMaybeJson(roster.draft);
      if (Array.isArray(draft)) {
        state.draft = sanitizeList(draft);
        if (state.draft.length > 0) state.presence.draft = true;
      }
    }
    state.presence.roster = true;
  }
  return [...payloads, ...flush(state, ctx)];
}

/** One `overwolf.games.events.onNewEvents` payload (match_state_changed, game_state_changed). */
export function handleNewEvents(state, update, ctx = {}) {
  const payloads = [];
  for (const event of Array.isArray(update?.events) ? update.events : []) {
    const data = parseMaybeJson(event?.data) ?? {};
    if (event?.name === "match_state_changed" || event?.name === "game_state_changed") {
      if (data.player_team !== undefined) setLocalSide(state, data.player_team);
      payloads.push(...setMatchState(state, data.match_state));
    }
  }
  return [...payloads, ...flush(state, ctx)];
}

function seatOf(player) {
  let side = teamToSide(player.team ?? player.teamId ?? player.team_id);
  const index = toPositiveInt(player.player_index ?? player.index) ?? (player.player_index === 0 || player.index === 0 ? 0 : null);
  if (side === null && index !== null) side = index < 5 ? "radiant" : "dire";
  let slot = player.team_slot;
  if (typeof slot === "string" && slot.trim() !== "") slot = Number(slot);
  if (!(Number.isInteger(slot) && slot >= 0 && slot <= 4) && index !== null) slot = index % 5;
  if (side === null || !(Number.isInteger(slot) && slot >= 0 && slot <= 4)) return null;
  return { side, key: `${side}:${slot}` };
}

function pickedPayload(state, side, heroId, position) {
  const payload = { type: "hero_picked", hero: heroId, side };
  // Positions describe our own roster only; an unknown side keeps it (the engine binds own-side picks only).
  if (position !== null && (state.localSide === null || state.localSide === side)) payload.position = position;
  return payload;
}

/** The diff between the latest snapshots and everything already emitted. Never re-emits. */
function flush(state, ctx) {
  if (state.gsi === false) return [];
  const payloads = [];
  if (!state.started && !state.ended && DRAFT_OBSERVABLE_STATES.has(state.matchState)) {
    state.started = true;
    payloads.push({ type: "session_started", format: "all_pick", patch: state.patch });
  }
  if (!state.started || state.ended) return payloads;
  const heroIdByName = ctx.heroIdByName;
  const inSelection = state.matchState === HERO_SELECTION;

  if (state.localSide !== null && state.localSide !== state.emittedSide) {
    state.emittedSide = state.localSide;
    payloads.push({ type: "local_side_identified", side: state.localSide });
  }

  for (const ban of state.bans) {
    const heroId = resolveHeroId(ban, heroIdByName);
    if (heroId === null || state.emittedBans.has(heroId) || state.emittedHeroes.has(heroId)) continue;
    state.emittedBans.add(heroId);
    payloads.push({ type: "hero_banned", hero: heroId, side: teamToSide(ban.team) ?? "unknown" });
  }

  for (const player of state.players) {
    if (typeof player !== "object" || player === null) continue;
    const seat = seatOf(player);
    if (seat === null) continue;
    const confirmed = player.pickConfirmed !== false && player.pick_confirmed !== false;
    const heroId = confirmed ? resolveHeroId(player, heroIdByName) : null;
    // ROLE -> POSITION only describes OUR roster (an unknown side keeps it; the engine binds own-side picks only).
    const position = state.localSide === null || state.localSide === seat.side ? roleToPosition(player.role) : null;
    const previous = state.seatHeroes.get(seat.key) ?? null;

    if (previous !== null && previous !== heroId) {
      // Same seat, the confirmed hero changed or was removed: only a revert DURING selection, never later.
      if (!inSelection) continue;
      // An explicit removal (hero 0 / unconfirmed) is a revert; a player row merely missing data is not.
      const explicitRemoval = heroId === null && (player.pickConfirmed === false || isZero(player.heroId) || isZero(player.hero_id) || player.hero === "");
      if (heroId === null && !explicitRemoval) continue;
      payloads.push({ type: "pick_reverted", hero: previous, side: seat.side });
      state.seatHeroes.delete(seat.key);
      state.emittedHeroes.delete(previous);
    }
    if (heroId === null || state.emittedBans.has(heroId)) continue;
    const known = state.emittedHeroes.get(heroId);
    if (known && known.side !== seat.side) continue;
    if (known && known.seatKey === seat.key && (known.position !== null || position === null)) continue;
    state.seatHeroes.set(seat.key, heroId);
    state.emittedHeroes.set(heroId, { side: seat.side, seatKey: seat.key, position });
    // A repeat for a hero already known from roster.draft only adds what was missing (its seat/position).
    if (known && (position === null || known.position !== null)) continue;
    payloads.push(pickedPayload(state, seat.side, heroId, position));
  }

  for (const entry of state.draft) {
    const heroId = resolveHeroId(entry, heroIdByName);
    const side = teamToSide(entry?.team);
    if (heroId === null || side === null || state.emittedHeroes.has(heroId) || state.emittedBans.has(heroId)) continue;
    state.emittedHeroes.set(heroId, { side, seatKey: null, position: null });
    payloads.push(pickedPayload(state, side, heroId, null));
  }
  return payloads;
}

/** draft-event/v1 envelope factory. eventIds are stable per payload, so a retried POST is deduplicated by the engine. */
export function createEnvelopeFactory({ sessionId, runId, now }) {
  let seq = 0;
  return function envelope(payload) {
    seq += 1;
    return {
      schema: "draft-event/v1",
      eventId: `ow-${runId}-${seq}`,
      sessionId,
      seq,
      emittedAt: new Date(now()).toISOString(),
      source: "overwolf",
      confidence: 1,
      payload,
    };
  };
}

/**
 * Cloud mode (paired adapter): events carry no session id -- the credential names the session server side, so the
 * adapter cannot aim a batch anywhere else. eventIds are stable per payload, so a retried POST is deduplicated.
 */
export function createCloudEventFactory({ runId, now }) {
  let seq = 0;
  return function event(payload) {
    seq += 1;
    return { eventId: `ow-${runId}-${seq}`, seq, emittedAt: new Date(now()).toISOString(), payload };
  };
}

/** One POST body for the site: allowlisted draft facts + which GEP keys carried data. Nothing else, ever. */
export function buildBatch(events, presence) {
  return { schema: CAPTURE_BATCH_SCHEMA, events, presence: { roster: presence.roster === true, bans: presence.bans === true, draft: presence.draft === true, players: presence.players === true } };
}
