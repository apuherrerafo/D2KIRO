import { describe, expect, test } from "bun:test";
import {
  CAPTURE_NOT_ENABLED,
  HERO_SELECTION,
  REQUIRED_FEATURES,
  batchUrl,
  buildBatch,
  buildHeroNameIndex,
  capturePresence,
  createCaptureState,
  createCloudEventFactory,
  createEnvelopeFactory,
  handleInfoUpdate,
  handleNewEvents,
  hasGameStateIntegration,
  healthPayload,
  heroesUrl,
  pairUrl,
  parseCaptureConfig,
  parseCredentialResponse,
  parsePairingCode,
  parseSiteUrl,
  parseStoredCredential,
  roleToPosition,
  sanitizeEntry,
  setDotaRunning,
  setGsiStatus,
} from "./capture-core.js";

// Overwolf adapter core: pure, no `overwolf.*`. Payload shapes follow the official Dota 2 GEP docs
// (players with team/team_slot/role/heroId|hero/pickConfirmed; bans/draft with heroId + team, ids as
// numbers OR numeric strings).

type Payload = { type: string; hero?: number; side?: string; position?: number; format?: string; patch?: string; status?: string; detail?: string; reason?: string };

const CATALOG = buildHeroNameIndex([
  { id: 93, name: "npc_dota_hero_slark", localizedName: "Slark" },
  { id: 129, name: "npc_dota_hero_mars", localizedName: "Mars" },
  { id: 1, name: "npc_dota_hero_antimage", localizedName: "Anti-Mage" },
]);
const ctx = { heroIdByName: CATALOG };

function matchState(value: string) {
  return { events: [{ name: "match_state_changed", data: JSON.stringify({ match_state: value }) }] };
}
function players(list: unknown[]) {
  return { feature: "roster", info: { roster: { players: JSON.stringify(list) } } };
}
function bans(list: unknown[]) {
  return { feature: "roster", info: { roster: { bans: JSON.stringify(list) } } };
}

/** A capture already in hero selection, GSI enabled, local side radiant. */
function started() {
  const state = createCaptureState();
  setDotaRunning(state, true);
  setGsiStatus(state, true, ctx);
  const opening = [
    ...handleInfoUpdate(state, { feature: "me", info: { me: { team: "radiant" } } }, ctx),
    ...handleNewEvents(state, matchState(HERO_SELECTION), ctx),
  ] as Payload[];
  return { state, opening };
}

describe("session start + side", () => {
  test("HERO_SELECTION emite session_started all_pick 7.41e UNA vez, y el lado local", () => {
    const { state, opening } = started();
    expect(opening).toEqual([
      { type: "session_started", format: "all_pick", patch: "7.41e" },
      { type: "local_side_identified", side: "radiant" },
    ]);
    expect(handleNewEvents(state, matchState(HERO_SELECTION), ctx)).toEqual([]);
  });

  test("11. side detection: me.team dire -> local_side_identified dire", () => {
    const state = createCaptureState();
    setGsiStatus(state, true, ctx);
    handleNewEvents(state, matchState(HERO_SELECTION), ctx);
    expect(handleInfoUpdate(state, { feature: "me", info: { me: { team: "dire" } } }, ctx)).toEqual([{ type: "local_side_identified", side: "dire" }]);
  });

  test("nada de draft se emite antes de la selección de héroes", () => {
    const state = createCaptureState();
    setGsiStatus(state, true, ctx);
    expect(handleInfoUpdate(state, bans([{ heroId: "75", team: "0" }]), ctx)).toEqual([]);
    expect(handleNewEvents(state, matchState(HERO_SELECTION), ctx)).toEqual([
      { type: "session_started", format: "all_pick", patch: "7.41e" },
      { type: "hero_banned", hero: 75, side: "unknown" },
    ]);
  });
});

describe("bans", () => {
  test("9. diff de bans: sólo heroId nuevos, no cero, ids string o número", () => {
    const { state } = started();
    expect(handleInfoUpdate(state, bans([{ heroId: "75", team: "0" }, { heroId: "14", team: "0" }]), ctx)).toEqual([
      { type: "hero_banned", hero: 75, side: "unknown" },
      { type: "hero_banned", hero: 14, side: "unknown" },
    ]);
    expect(handleInfoUpdate(state, bans([{ heroId: "75", team: "0" }, { heroId: "14", team: "0" }, { heroId: 0, team: 2 }, { heroId: 22, team: 3 }]), ctx)).toEqual([
      { type: "hero_banned", hero: 22, side: "dire" },
    ]);
  });
});

describe("picks", () => {
  test("10. diff de picks: asiento nuevo -> hero_picked con la posición propia mapeada desde role", () => {
    const { state } = started();
    const out = handleInfoUpdate(state, players([
      { steamId: "1", team: 2, team_slot: 0, role: 2, heroId: 129, pickConfirmed: true },
      { steamId: "2", team: 2, team_slot: 1, role: 16, heroId: 0 },
      { steamId: "6", team: 3, team_slot: 0, role: 1, heroId: 0 },
    ]), ctx);
    expect(out).toEqual([{ type: "hero_picked", hero: 129, side: "radiant", position: 3 }]);
  });

  test("nombre de héroe (formato `hero: \"slark\"` de la doc oficial) se resuelve contra el catálogo", () => {
    const { state } = started();
    expect(handleInfoUpdate(state, players([{ steamId: "8", team: 3, team_slot: 3, role: 1, hero: "slark", pickConfirmed: true }]), ctx)).toEqual([
      { type: "hero_picked", hero: 93, side: "dire" },
    ]);
  });

  test("8. el mismo roster update dos veces (y reordenado) no produce un segundo hero_picked", () => {
    const { state } = started();
    const roster = [
      { team: 2, team_slot: 0, role: 2, heroId: 129, pickConfirmed: true },
      { team: 2, team_slot: 4, role: 1, heroId: 1, pickConfirmed: true },
    ];
    expect(handleInfoUpdate(state, players(roster), ctx)).toHaveLength(2);
    expect(handleInfoUpdate(state, players(roster), ctx)).toEqual([]);
    expect(handleInfoUpdate(state, players([...roster].reverse()), ctx)).toEqual([]);
  });

  test("hover sin confirmar (pickConfirmed:false) no es un pick", () => {
    const { state } = started();
    expect(handleInfoUpdate(state, players([{ team: 2, team_slot: 0, role: 2, heroId: 129, pickConfirmed: false }]), ctx)).toEqual([]);
  });

  test("12. mismo asiento, otro héroe confirmado durante la selección -> pick_reverted + hero_picked", () => {
    const { state } = started();
    handleInfoUpdate(state, players([{ team: 2, team_slot: 0, role: 2, heroId: 129, pickConfirmed: true }]), ctx);
    expect(handleInfoUpdate(state, players([{ team: 2, team_slot: 0, role: 2, heroId: 1, pickConfirmed: true }]), ctx)).toEqual([
      { type: "pick_reverted", hero: 129, side: "radiant" },
      { type: "hero_picked", hero: 1, side: "radiant", position: 3 },
    ]);
  });

  test("un cambio en el mismo asiento DESPUÉS de la selección no inventa un revert", () => {
    const { state } = started();
    handleInfoUpdate(state, players([{ team: 2, team_slot: 0, role: 2, heroId: 129, pickConfirmed: true }]), ctx);
    handleNewEvents(state, matchState("DOTA_GAMERULES_STATE_STRATEGY_TIME"), ctx);
    expect(handleInfoUpdate(state, players([{ team: 2, team_slot: 0, role: 2, heroId: 0 }]), ctx)).toEqual([]);
  });

  test("13. héroe cero / desconocido se ignora", () => {
    const { state } = started();
    expect(handleInfoUpdate(state, players([
      { team: 2, team_slot: 0, role: 2, heroId: 0, pickConfirmed: true },
      { team: 2, team_slot: 1, role: 4, hero: "not_a_hero", pickConfirmed: true },
      { team: 2, team_slot: 2, role: 4, heroId: "abc", pickConfirmed: true },
      { team: 0, team_slot: 3, role: 4, heroId: 5, pickConfirmed: true },
    ]), ctx)).toEqual([]);
    expect(handleInfoUpdate(state, bans([{ heroId: 0, team: 0 }, { heroId: "", team: 0 }]), ctx)).toEqual([]);
  });

  test("roster.draft sin asiento -> hero_picked; luego el asiento sólo completa la posición, nunca duplica", () => {
    const { state } = started();
    expect(handleInfoUpdate(state, { info: { roster: { draft: JSON.stringify([{ heroId: 129, team: 2 }, { heroId: 93, team: 3 }]) } } }, ctx)).toEqual([
      { type: "hero_picked", hero: 129, side: "radiant" },
      { type: "hero_picked", hero: 93, side: "dire" },
    ]);
    expect(handleInfoUpdate(state, players([{ team: 2, team_slot: 2, role: 2, heroId: 129, pickConfirmed: true }]), ctx)).toEqual([
      { type: "hero_picked", hero: 129, side: "radiant", position: 3 },
    ]);
    expect(handleInfoUpdate(state, players([{ team: 3, team_slot: 0, role: 1, heroId: 93, pickConfirmed: true }]), ctx)).toEqual([]);
  });

  test("role -> posición: 1 Safelane=1, 4 Mid=2, 2 Offlane=3, 16 HardSupport=5; 8 Other NO se adivina como Pos4", () => {
    expect([1, 4, 2, 16].map(roleToPosition)).toEqual([1, 2, 3, 5]);
    expect([8, 0, 3, "8", undefined].map(roleToPosition)).toEqual([null, null, null, null, null]);
  });

  test("un asiento con role 8 (Other) se emite SIN posición: el Player la asigna, nada se inventa", () => {
    const { state } = started();
    expect(handleInfoUpdate(state, players([{ team: 2, team_slot: 3, role: 8, heroId: 129, pickConfirmed: true }]), ctx)).toEqual([
      { type: "hero_picked", hero: 129, side: "radiant" },
    ]);
  });
});

describe("14. -gamestateintegration", () => {
  test("detecta la opción en ProcessCommandLine", () => {
    expect(hasGameStateIntegration({ gameInfo: { GameInfo: { ProcessCommandLine: "\"dota2.exe\" -novid -gamestateintegration" } } })).toBe(true);
    expect(hasGameStateIntegration({ gameInfo: { GameInfo: { ProcessCommandLine: "\"dota2.exe\" -novid" } } })).toBe(false);
    expect(hasGameStateIntegration({ success: true })).toBeNull();
  });

  test("sin la opción: warning DOTA_CAPTURE_NOT_ENABLED y CERO eventos de draft, aunque lleguen datos", () => {
    const state = createCaptureState();
    setDotaRunning(state, true);
    expect(setGsiStatus(state, false, ctx)).toEqual([{ type: "capture_health", status: "degraded", detail: CAPTURE_NOT_ENABLED }]);
    expect(handleNewEvents(state, matchState(HERO_SELECTION), ctx)).toEqual([]);
    expect(handleInfoUpdate(state, players([{ team: 2, team_slot: 0, role: 2, heroId: 129, pickConfirmed: true }]), ctx)).toEqual([]);
    expect(handleInfoUpdate(state, bans([{ heroId: 75, team: 0 }]), ctx)).toEqual([]);
    expect(healthPayload(state)).toEqual({ type: "capture_health", status: "degraded", detail: CAPTURE_NOT_ENABLED });
  });

  test("al habilitarla, la captura se pone al día desde el último snapshot", () => {
    const state = createCaptureState();
    setDotaRunning(state, true);
    setGsiStatus(state, false, ctx);
    handleNewEvents(state, matchState(HERO_SELECTION), ctx);
    handleInfoUpdate(state, players([{ team: 2, team_slot: 0, role: 2, heroId: 129, pickConfirmed: true }]), ctx);
    const out = setGsiStatus(state, true, ctx) as Payload[];
    expect(out.map((payload) => payload.type)).toEqual(["capture_health", "session_started", "hero_picked"]);
  });
});

describe("match lifecycle", () => {
  test("POST_GAME emite session_ended; una nueva selección arranca otra partida", () => {
    const { state } = started();
    handleInfoUpdate(state, players([{ team: 2, team_slot: 0, role: 2, heroId: 129, pickConfirmed: true }]), ctx);
    expect(handleNewEvents(state, matchState("DOTA_GAMERULES_STATE_POST_GAME"), ctx)).toEqual([{ type: "session_ended", reason: "completed" }]);
    const next = handleNewEvents(state, matchState(HERO_SELECTION), ctx) as Payload[];
    expect(next[0]).toEqual({ type: "session_started", format: "all_pick", patch: "7.41e" });
  });
});

describe("config + envelopes", () => {
  test("config local: sólo 127.0.0.1, sessionId válido, token presente", () => {
    expect(parseCaptureConfig({ engineUrl: "http://127.0.0.1:4000", sessionId: "11111111-2222-3333-4444-555555555555", captureToken: "x".repeat(32) })).not.toBeNull();
    expect(parseCaptureConfig({ engineUrl: "http://0.0.0.0:4000", sessionId: "11111111-2222", captureToken: "x".repeat(32) })).toBeNull();
    expect(parseCaptureConfig({ engineUrl: "https://evil.example", sessionId: "11111111-2222", captureToken: "x".repeat(32) })).toBeNull();
    expect(parseCaptureConfig({ engineUrl: "http://127.0.0.1:4000", sessionId: "../../etc", captureToken: "x".repeat(32) })).toBeNull();
    expect(parseCaptureConfig({ engineUrl: "http://127.0.0.1:4000", sessionId: "11111111-2222", captureToken: "" })).toBeNull();
  });

  test("envelope draft-event/v1, source overwolf, eventId y seq únicos", () => {
    const make = createEnvelopeFactory({ sessionId: "s-123456789", runId: "abc", now: () => 0 });
    const a = make({ type: "hero_banned", hero: 1, side: "unknown" });
    const b = make({ type: "hero_banned", hero: 2, side: "unknown" });
    expect(a).toMatchObject({ schema: "draft-event/v1", sessionId: "s-123456789", source: "overwolf", confidence: 1, seq: 1, eventId: "ow-abc-1" });
    expect(b.eventId).not.toBe(a.eventId);
  });
});

// ---- Automatic capture over the Internet (paired adapter) ----------------------------------------------------

const SENTINEL_STEAM = "SENTINEL-STEAMID-76561198000000000";
const SENTINEL_NAME = "SENTINEL-PLAYER-NAME";
const SITE = "https://d2kiro-test.up.railway.app";

/** A synthetic GEP roster in the shape of the official docs, identity fields included on purpose. */
function fullRoster() {
  const radiant = [129, 93, 1, 11, 14];
  const dire = [2, 3, 4, 5, 6];
  const rolesBySlot = [1, 4, 2, 8, 16];
  return [
    ...radiant.map((heroId, slot) => ({ steamId: SENTINEL_STEAM, name: SENTINEL_NAME, rank: 80, medal_name: "Divine", medal_stars: 3, pickConfirmed: true, hero: String(heroId), heroId, team: 2, role: rolesBySlot[slot], team_slot: slot, player_index: slot })),
    ...dire.map((heroId, slot) => ({ steamId: SENTINEL_STEAM, name: SENTINEL_NAME, rank: 70, pickConfirmed: true, heroId, team: 3, role: rolesBySlot[slot], team_slot: slot, player_index: 5 + slot })),
  ];
}

describe("privacy: identity never leaves the adapter boundary", () => {
  test("a full 10-player roster yields exactly 10 unique hero/side facts and no identity anywhere in the output", () => {
    const { state } = started();
    const out = handleInfoUpdate(state, players(fullRoster()), ctx) as Payload[];
    const picks = out.filter((payload) => payload.type === "hero_picked");
    expect(picks).toHaveLength(10);
    expect(new Set(picks.map((payload) => payload.hero)).size).toBe(10);
    expect(picks.filter((payload) => payload.side === "radiant")).toHaveLength(5);
    expect(picks.filter((payload) => payload.side === "dire")).toHaveLength(5);
    // Own positions only from unambiguous roles: slot 3 (role 8 "Other") stays unassigned.
    expect(picks.filter((payload) => payload.side === "radiant").map((payload) => payload.position ?? null)).toEqual([1, 2, 3, null, 5]);
    expect(picks.filter((payload) => payload.side === "dire").every((payload) => payload.position === undefined)).toBe(true);
    const everything = JSON.stringify([out, state, capturePresence(state), buildBatch(out, capturePresence(state))]);
    expect(everything).not.toContain("SENTINEL");
    expect(everything).not.toContain("76561198");
    expect(everything).not.toContain("Divine");
  });

  test("sanitizeEntry keeps only hero / team / seat / role / confirmation, whatever else the payload carries", () => {
    const clean = sanitizeEntry({ steamId: SENTINEL_STEAM, name: SENTINEL_NAME, rank: 5, medal_name: "x", heroId: "75", team: 3, team_slot: "2", role: 16, pickConfirmed: true, extra: { nested: SENTINEL_NAME }, hero: `bad ${SENTINEL_NAME}` });
    expect(clean).toEqual({ heroId: "75", team: 3, team_slot: 2, role: 16, pickConfirmed: true });
    expect(JSON.stringify(clean)).not.toContain("SENTINEL");
    expect(sanitizeEntry("nope")).toBeNull();
    expect(sanitizeEntry(null)).toBeNull();
  });

  test("the batch body is allowlisted: schema, events, boolean presence -- nothing else", () => {
    const make = createCloudEventFactory({ runId: "r1", now: () => 0 });
    const events = [make({ type: "hero_banned", hero: 75, side: "unknown" })];
    const body = buildBatch(events, { roster: true, bans: 1 as unknown as boolean, draft: false, players: true });
    expect(Object.keys(body).sort()).toEqual(["events", "presence", "schema"]);
    expect(body.schema).toBe("overwolf-capture/v1");
    expect(body.presence).toEqual({ roster: true, bans: false, draft: false, players: true });
    expect(events[0]).toEqual({ eventId: "ow-r1-1", seq: 1, emittedAt: "1970-01-01T00:00:00.000Z", payload: { type: "hero_banned", hero: 75, side: "unknown" } });
    // The adapter cannot aim a batch: no session id and no account id exist in what it sends.
    expect(JSON.stringify(body)).not.toMatch(/sessionId|accountId|steam/i);
  });
});

describe("snapshots, ordering and presence", () => {
  test("repeated full snapshots never duplicate facts (deterministic dedupe)", () => {
    const { state } = started();
    const roster = fullRoster();
    expect((handleInfoUpdate(state, players(roster), ctx) as Payload[]).length).toBe(10);
    for (let i = 0; i < 4; i += 1) expect(handleInfoUpdate(state, players(roster), ctx)).toEqual([]);
    expect(handleInfoUpdate(state, players([...roster].reverse()), ctx)).toEqual([]);
  });

  test("updates arriving out of order converge: draft first, then players, then bans", () => {
    const { state } = started();
    const first = handleInfoUpdate(state, { info: { roster: { draft: JSON.stringify([{ heroId: 129, team: 2 }, { heroId: 2, team: 3 }]) } } }, ctx) as Payload[];
    const second = handleInfoUpdate(state, players(fullRoster()), ctx) as Payload[];
    const third = handleInfoUpdate(state, bans([{ heroId: 75, team: 2 }, { heroId: 22, team: 3 }]), ctx) as Payload[];
    const all = [...first, ...second, ...third];
    const picked = all.filter((payload) => payload.type === "hero_picked").map((payload) => payload.hero);
    expect(new Set(picked)).toEqual(new Set([129, 93, 1, 11, 14, 2, 3, 4, 5, 6]));
    // A hero first seen in `draft` may be repeated once by the roster to complete its position; the engine merges that.
    expect(picked.filter((hero) => hero === 3)).toHaveLength(1);
    expect(picked.filter((hero) => hero === 129).length).toBeLessThanOrEqual(2);
    expect(all.filter((payload) => payload.type === "hero_banned").map((payload) => payload.hero)).toEqual([75, 22]);
  });

  test("a banned hero in the roster is never a pick", () => {
    const { state } = started();
    handleInfoUpdate(state, bans([{ heroId: 129, team: 3 }]), ctx);
    expect(handleInfoUpdate(state, players([{ team: 2, team_slot: 0, role: 1, heroId: 129, pickConfirmed: true }]), ctx)).toEqual([]);
  });

  test("malformed hero ids are rejected: negative, fractional, text, huge, object", () => {
    const { state } = started();
    const out = handleInfoUpdate(state, players([
      { team: 2, team_slot: 0, role: 1, heroId: -5, pickConfirmed: true },
      { team: 2, team_slot: 1, role: 4, heroId: 7.5, pickConfirmed: true },
      { team: 2, team_slot: 2, role: 2, heroId: "9; DROP", pickConfirmed: true },
      { team: 2, team_slot: 3, role: 16, heroId: { id: 5 }, pickConfirmed: true },
      { team: 3, team_slot: 0, role: 1, heroId: "9999999999", pickConfirmed: true },
    ]), ctx);
    expect(out).toEqual([]);
  });

  test("presence reports which roster keys carried data -- booleans only", () => {
    const { state } = started();
    expect(capturePresence(state)).toEqual({ roster: false, bans: false, draft: false, players: false });
    handleInfoUpdate(state, bans([{ heroId: 75, team: 0 }]), ctx);
    expect(capturePresence(state)).toEqual({ roster: true, bans: true, draft: false, players: false });
    handleInfoUpdate(state, players(fullRoster()), ctx);
    handleInfoUpdate(state, { info: { roster: { draft: JSON.stringify([{ heroId: 129, team: 2 }]) } } }, ctx);
    expect(capturePresence(state)).toEqual({ roster: true, bans: true, draft: true, players: true });
    // An empty array is not data.
    const fresh = started().state;
    handleInfoUpdate(fresh, players([]), ctx);
    expect(capturePresence(fresh)).toEqual({ roster: true, bans: false, draft: false, players: false });
  });

  test("a new match clears the presence of the previous one", () => {
    const { state } = started();
    handleInfoUpdate(state, players(fullRoster()), ctx);
    handleNewEvents(state, matchState("DOTA_GAMERULES_STATE_POST_GAME"), ctx);
    handleNewEvents(state, matchState(HERO_SELECTION), ctx);
    expect(capturePresence(state)).toEqual({ roster: false, bans: false, draft: false, players: false });
  });

  test("a simulated draft: bans, 4 initial picks, the rest, 10 heroes, match start", () => {
    const { state } = started();
    const all: Payload[] = [];
    all.push(...(handleInfoUpdate(state, bans([{ heroId: 75, team: 2 }, { heroId: 22, team: 3 }, { heroId: 30, team: 2 }]), ctx) as Payload[]));
    const roster = fullRoster();
    const radiant = roster.filter((entry) => entry.team === 2);
    const dire = roster.filter((entry) => entry.team === 3);
    all.push(...(handleInfoUpdate(state, players([...radiant.slice(0, 2), ...dire.slice(0, 2)]), ctx) as Payload[]));
    all.push(...(handleInfoUpdate(state, players([...radiant.slice(0, 5), ...dire.slice(0, 3)]), ctx) as Payload[]));
    all.push(...(handleInfoUpdate(state, players(roster), ctx) as Payload[]));
    all.push(...(handleNewEvents(state, matchState("DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"), ctx) as Payload[]));
    expect(all.filter((payload) => payload.type === "hero_banned")).toHaveLength(3);
    expect(all.filter((payload) => payload.type === "hero_picked")).toHaveLength(10);
    // Match start after a full draft is NOT an end: the facts of the draft stay valid.
    expect(all.some((payload) => payload.type === "session_ended")).toBe(false);
  });
});

describe("pairing config", () => {
  test("site url: https only (or a local dev site), no path, no credentials in it", () => {
    expect(parseSiteUrl("https://d2kiro-test.up.railway.app/")).toBe(SITE);
    expect(parseSiteUrl("HTTPS://D2KIRO-TEST.up.railway.app")).toBe(SITE);
    expect(parseSiteUrl("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(parseSiteUrl("http://localhost:3000")).toBe("http://localhost:3000");
    for (const bad of ["http://d2kiro-test.up.railway.app", "https://user:pw@d2kiro.example", "https://d2kiro.example/path", "ftp://x.example", "javascript:alert(1)", "https://", "", 5, null]) {
      expect(parseSiteUrl(bad as string)).toBeNull();
    }
  });

  test("pairing code: 8 unambiguous characters, typed any way a person would", () => {
    expect(parsePairingCode("abcd-2345")).toBe("ABCD2345");
    expect(parsePairingCode(" ABCD 2345 ")).toBe("ABCD2345");
    for (const bad of ["ABCD-234", "ABCD-23456", "ABCI-2345", "ABC0-2345", "", "x".repeat(40), 12345678]) expect(parsePairingCode(bad as string)).toBeNull();
  });

  test("credential response: exactly the shape the engine issues; a stored credential expires", () => {
    const good = { captureId: "A".repeat(43), token: "ab".repeat(32), expiresAt: "2026-10-05T10:00:00.000Z" };
    expect(parseCredentialResponse(good, SITE)).toEqual({ siteUrl: SITE, ...good });
    expect(parseCredentialResponse({ ...good, token: "short" }, SITE)).toBeNull();
    expect(parseCredentialResponse({ ...good, captureId: "../../x" }, SITE)).toBeNull();
    expect(parseCredentialResponse(good, "http://evil.example")).toBeNull();
    expect(parseCredentialResponse(null, SITE)).toBeNull();
    const stored = { siteUrl: SITE, ...good };
    expect(parseStoredCredential(stored, Date.parse("2026-10-05T09:00:00.000Z"))).not.toBeNull();
    expect(parseStoredCredential(stored, Date.parse("2026-10-05T10:00:00.000Z"))).toBeNull();
    expect(parseStoredCredential({ ...stored, token: "x" }, 0)).toBeNull();
    expect(parseStoredCredential(undefined, 0)).toBeNull();
  });

  test("endpoints are built from the credential and the site only", () => {
    const credential = { siteUrl: SITE, captureId: "A".repeat(43), token: "ab".repeat(32), expiresAt: "2026-10-05T10:00:00.000Z" };
    expect(batchUrl(credential)).toBe(`${SITE}/api/live/overwolf/${"A".repeat(43)}`);
    expect(heroesUrl(credential)).toBe(`${SITE}/api/live/overwolf/${"A".repeat(43)}/heroes`);
    expect(pairUrl(SITE)).toBe(`${SITE}/api/live/overwolf/pair`);
    expect(batchUrl(credential)).not.toContain(credential.token);
  });

  test("the GEP features requested include roster, game_state and me", () => {
    for (const feature of ["roster", "game_state", "me"]) expect(REQUIRED_FEATURES).toContain(feature);
  });
});
