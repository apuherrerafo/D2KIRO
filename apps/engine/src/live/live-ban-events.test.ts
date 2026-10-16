import { describe, expect, test } from "bun:test";
import { ProtocolSessionStore } from "../server/protocol-session";
import { createLiveGsiRoutes } from "../server/routes/live-gsi";
import { banEvent, createGsiLinkTestDb, gsiPayload, SENTINELS } from "./gsi.fixtures";
import { createGsiLinkStore } from "./gsi-links";
import { draftFactCount, normalizeGsi, observationsFromGsi } from "./gsi-normalize";
import { LiveCaptureRegistry } from "./live-capture-registry";

// STEP 2B -- ban evidence from Dota GSI `events[]` (CHAT_MESSAGE_HERO_BANNED, hero id in `value`).
// Shapes come from real Ranked captures: the chat event is JSON TEXT inside `data`, the draft block is empty,
// and all ~16 bans arrive in ONE payload at the start of hero selection (later payloads carry no events).
//
// Semantics under test: an event PROVES a ban; the absence of events proves nothing. Cero red, fixtures inline.

const T0 = 1_790_000_000_000;
const A = 101;
const HEROES = [73, 74, 128, 66];

describe("normalizeGsi -- ban events (pure)", () => {
  test("one valid event => one proven ban; the draft block stays absent (capture still honestly partial)", () => {
    const update = normalizeGsi(gsiPayload({ teamName: "radiant", draft: "empty", banEvents: [73] }));
    expect(update.eventBans).toEqual([73]);
    expect(update.draft).toBeNull();
    expect(update.capabilities).toMatchObject({ draftBlock: false, bans: true });
  });

  test("a real-shaped burst keeps every distinct hero, in order", () => {
    expect(normalizeGsi(gsiPayload({ banEvents: HEROES })).eventBans).toEqual(HEROES);
  });

  test("the same event repeated inside one payload is one ban", () => {
    expect(normalizeGsi(gsiPayload({ banEvents: [73, 73, 73, 74] })).eventBans).toEqual([73, 74]);
  });

  test("malformed or unknown hero ids are ignored safely -- numeric strings, zero, negatives, fractions, out of range, null", () => {
    const events = ["73", 0, -1, 1.5, 5000, null, undefined, true, {}, [], NaN, Infinity].map((value) => banEvent(value));
    const update = normalizeGsi(gsiPayload({ events }));
    expect(update.eventBans).toEqual([]);
    expect(update.capabilities.bans).toBe(false);
  });

  test("malformed events never throw and never leak: junk entries, bad JSON, oversize data, non-array events", () => {
    const junk: unknown[] = [null, 7, "x", [], { data: 5 }, { data: "{not json" }, { data: "null" }, { data: JSON.stringify({ type: "CHAT_MESSAGE_HERO_BANNED", value: 73, pad: "x".repeat(600) }) }, banEvent(73, "chat_message_hero_banned")];
    expect(normalizeGsi(gsiPayload({ events: junk })).eventBans).toEqual([]);
    for (const events of [null, "CHAT_MESSAGE_HERO_BANNED", 5, { 0: banEvent(73) }, true]) {
      expect(normalizeGsi(gsiPayload({ events })).eventBans).toEqual([]);
    }
  });

  test("other chat events are not bans, and their fields are never read", () => {
    const events = [banEvent(73, "CHAT_MESSAGE_ITEM_PURCHASE"), banEvent(74, "CHAT_MESSAGE_INTHEBAG"), banEvent(66)];
    expect(normalizeGsi(gsiPayload({ events })).eventBans).toEqual([66]);
  });

  test("a hostile events array is bounded: only the first 256 entries are scanned", () => {
    const events = [...Array.from({ length: 256 }, () => banEvent("x")), banEvent(73)];
    expect(normalizeGsi(gsiPayload({ events })).eventBans).toEqual([]);
  });

  test("no events (absent, empty) => no ban evidence at all: unknown, not zero", () => {
    for (const options of [{}, { events: [] }, { draft: "empty" as const }]) {
      const update = normalizeGsi(gsiPayload(options));
      expect(update.eventBans).toEqual([]);
      expect(update.capabilities.bans).toBe(false);
      expect(observationsFromGsi(update, "7.41e").filter((observation) => observation.type === "ban")).toEqual([]);
    }
  });

  test("the output carries no identity from the event or the payload", () => {
    const text = JSON.stringify(normalizeGsi(gsiPayload({ banEvents: HEROES })));
    for (const sentinel of SENTINELS) expect(text).not.toContain(sentinel);
    expect(text).not.toContain("playerid");
  });
});

describe("observationsFromGsi -- ban events", () => {
  test("each proven ban becomes one ban observation, and no event ever closes or completes anything extra", () => {
    const observations = observationsFromGsi(normalizeGsi(gsiPayload({ teamName: "dire", draft: "empty", banEvents: [73, 74] })), "7.41e");
    expect(observations.filter((observation) => observation.type === "ban")).toEqual([
      { type: "ban", heroId: 73 },
      { type: "ban", heroId: 74 },
    ]);
    // Same lifecycle observations as a payload without events (draft_started, bans_closed, side, local_hero): bans add facts, not claims.
    const without = observationsFromGsi(normalizeGsi(gsiPayload({ teamName: "dire", draft: "empty" })), "7.41e");
    const lifecycle = (list: typeof observations) => list.filter((observation) => observation.type !== "ban");
    expect(lifecycle(observations)).toEqual(lifecycle(without));
  });

  test("events outside the draft are not draft facts (a match payload may carry unrelated events)", () => {
    const update = normalizeGsi(gsiPayload({ gameState: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", banEvents: [73] }));
    expect(observationsFromGsi(update, "7.41e")).toEqual([]);
  });

  test("a ban stated by both the draft block and an event counts once in the draft progress", () => {
    const both = normalizeGsi(gsiPayload({ draft: { radiant: { bans: [73] } }, banEvents: [73, 74] }));
    expect(draftFactCount(both)).toBe(2);
  });
});

function setup() {
  const store = new ProtocolSessionStore();
  const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41e", now: () => T0 });
  const routes = createLiveGsiRoutes({ links: createGsiLinkStore(createGsiLinkTestDb().db), registry, now: () => T0 });
  async function link() {
    const response = routes.postIssue(A);
    expect(response.status).toBe(201);
    return (await response.json()) as { liveId: string; token: string; sessionId: string };
  }
  async function send(live: { liveId: string; token: string }, options: Parameters<typeof gsiPayload>[0] = {}) {
    const body = gsiPayload({ teamName: "radiant", token: live.token, ...options });
    const response = await routes.postIngest(new Request(`http://127.0.0.1/api/live/gsi/${live.liveId}`, { method: "POST", body: JSON.stringify(body) }), live.liveId);
    expect(response.status).toBe(200);
  }
  const bannedInState = (sessionId: string) => [...(store.get(sessionId)?.rankedAp?.bannedHeroes ?? [])].sort((a, b) => a - b);
  return { store, registry, link, send, bannedInState };
}

describe("ban events through the real ingest route, registry and kernel", () => {
  test("one valid event => one known ban in the draft state, and the capture says Dota informs bans", async () => {
    const t = setup();
    const live = await t.link();
    await t.send(live, { draft: "empty", banEvents: [73] });
    const status = t.registry.status(live.sessionId)!;
    expect(status.bans).toBe(1);
    expect(status.banKnowledge).toBe("PARTIAL");
    expect(t.bannedInState(live.sessionId)).toEqual([73]);
    expect(status.gsi?.draft).toMatchObject({ bans: true, draftBlock: false });
  });

  test("the burst, then the same burst over and over (and Dota's empty updates between): still the same facts, no churn", async () => {
    const t = setup();
    const live = await t.link();
    await t.send(live, { draft: "empty", banEvents: HEROES });
    const first = t.registry.status(live.sessionId)!;
    expect(first.bans).toBe(HEROES.length);
    expect(first.banKnowledge).toBe("PARTIAL");
    for (let index = 0; index < 5; index += 1) {
      await t.send(live, { draft: "empty", banEvents: HEROES });
      await t.send(live, { draft: "empty", banEvents: [73, 73] });
      await t.send(live, { draft: "empty", events: [] });
    }
    const after = t.registry.status(live.sessionId)!;
    expect(after.bans).toBe(HEROES.length);
    expect(after.banKnowledge).toBe("PARTIAL");
    expect(after.factsRevision).toBe(first.factsRevision);
    expect(t.bannedInState(live.sessionId)).toEqual([...HEROES].sort((a, b) => a - b));
  });

  test("malformed / unknown hero ids are ignored: nothing is banned, nothing is rejected", async () => {
    const t = setup();
    const live = await t.link();
    await t.send(live, { draft: "empty", events: ["73", 0, -1, 5000, null].map((value) => banEvent(value)) });
    const status = t.registry.status(live.sessionId)!;
    expect(status.bans).toBe(0);
    expect(status.banKnowledge).toBe("UNKNOWN");
    expect(status.rejectedFacts).toBe(0);
    expect(status.gsi?.draft.bans).toBe(false);
    expect(t.bannedInState(live.sessionId)).toEqual([]);
  });

  test("no events: ban knowledge stays UNKNOWN -- Dota never reported bans, and the capture says so", async () => {
    const t = setup();
    const live = await t.link();
    await t.send(live, { draft: "empty", heroId: 8 });
    await t.send(live, { draft: "empty", heroId: 8, events: [] });
    const status = t.registry.status(live.sessionId)!;
    expect(status.gsi?.draft.bans).toBe(false); // "Dota informa bans: no" -- the unknown marker
    expect(status.bans).toBe(0);
    expect(status.banKnowledge).toBe("UNKNOWN");
    expect(t.bannedInState(live.sessionId)).toEqual([]);
  });

  test("1. no events + draft picks present -> banKnowledge UNKNOWN", async () => {
    const t = setup();
    const live = await t.link();
    await t.send(live, { draft: { radiant: { picks: [66] } } });
    const status = t.registry.status(live.sessionId)!;
    expect(status.picks).toBeGreaterThan(0);
    expect(status.bans).toBe(0);
    expect(status.banKnowledge).toBe("UNKNOWN");
  });

  test("2. protocol ban phase progressed + no ban events -> still UNKNOWN in live knowledge", async () => {
    const t = setup();
    const live = await t.link();
    await t.send(live, { draft: { radiant: { picks: [66] } } });
    const state = t.store.get(live.sessionId)!;
    expect(state.rankedAp?.phase).not.toBe("BAN_RESOLUTION");
    expect(state.rankedAp?.bannedHeroes).toEqual([]);
    const status = t.registry.status(live.sessionId)!;
    expect(status.banKnowledge).toBe("UNKNOWN");
  });

  test("3. first positive ban -> PARTIAL", async () => {
    const t = setup();
    const live = await t.link();
    await t.send(live, { draft: "empty", banEvents: [73] });
    const status = t.registry.status(live.sessionId)!;
    expect(status.bans).toBe(1);
    expect(status.banKnowledge).toBe("PARTIAL");
  });

  test("4. repeated bans remain idempotent", async () => {
    const t = setup();
    const live = await t.link();
    await t.send(live, { draft: "empty", banEvents: [73] });
    const first = t.registry.status(live.sessionId)!;
    expect(first.bans).toBe(1);
    expect(first.banKnowledge).toBe("PARTIAL");

    await t.send(live, { draft: "empty", banEvents: [73, 73] });
    await t.send(live, { draft: "empty", events: [] });
    const second = t.registry.status(live.sessionId)!;
    expect(second.bans).toBe(1);
    expect(second.banKnowledge).toBe("PARTIAL");
    expect(second.factsRevision).toBe(first.factsRevision);
  });

  test("5. new draft resets knowledge to UNKNOWN", async () => {
    const t = setup();
    const live = await t.link();
    await t.send(live, { draft: "empty", banEvents: [73], matchId: "11111111" });
    expect(t.registry.status(live.sessionId)!.banKnowledge).toBe("PARTIAL");

    // A different match starts on the same session
    await t.send(live, { draft: "empty", heroId: 8, matchId: "22222222" });
    const resetStatus = t.registry.status(live.sessionId)!;
    expect(resetStatus.bans).toBe(0);
    expect(resetStatus.banKnowledge).toBe("UNKNOWN");
  });

  test("6. late join without event burst remains UNKNOWN", async () => {
    const t = setup();
    const live = await t.link();
    // The player joins late in strategy time without ban events
    await t.send(live, { draft: "empty", heroId: 8, gameState: "DOTA_GAMERULES_STATE_STRATEGY_TIME" });
    const status = t.registry.status(live.sessionId)!;
    expect(status.bans).toBe(0);
    expect(status.banKnowledge).toBe("UNKNOWN");

    // If an event arrives late, it transitions to PARTIAL
    await t.send(live, { draft: "empty", heroId: 8, banEvents: [73] });
    expect(t.registry.status(live.sessionId)!.banKnowledge).toBe("PARTIAL");
  });

  test("late join with no events never becomes 'zero bans': nothing in the status states a ban fact, and a later burst still lands", async () => {
    const t = setup();
    const live = await t.link();
    // The Player joined after the burst: only side + own hero reach us.
    await t.send(live, { draft: "empty", heroId: 8 });
    expect(t.registry.status(live.sessionId)!.gsi?.draft.bans).toBe(false);
    expect(t.registry.status(live.sessionId)!.banKnowledge).toBe("UNKNOWN");
    // Even after more updates and a pick, the capability stays "not informed".
    await t.send(live, { draft: "empty", heroId: 8, gameState: "DOTA_GAMERULES_STATE_STRATEGY_TIME" });
    expect(t.registry.status(live.sessionId)!.gsi?.draft.bans).toBe(false);
    expect(t.registry.status(live.sessionId)!.banKnowledge).toBe("UNKNOWN");
    // Ban knowledge is never frozen as empty: a ban that arrives late is still recorded.
    await t.send(live, { draft: "empty", heroId: 8, banEvents: [73] });
    expect(t.bannedInState(live.sessionId)).toEqual([73]);
    expect(t.registry.status(live.sessionId)!.gsi?.draft.bans).toBe(true);
    expect(t.registry.status(live.sessionId)!.banKnowledge).toBe("PARTIAL");
  });

  test("a ban event never completes the ban set: later events keep adding bans after earlier ones", async () => {
    const t = setup();
    const live = await t.link();
    await t.send(live, { draft: "empty", banEvents: [73, 74] });
    await t.send(live, { draft: "empty", banEvents: [128] });
    expect(t.bannedInState(live.sessionId)).toEqual([73, 74, 128]);
  });

  test("a hero already picked earlier is not banned by a later event (the fact layer keeps its own rule)", async () => {
    const t = setup();
    const live = await t.link();
    await t.send(live, { draft: { radiant: { picks: [66] } } });
    await t.send(live, { draft: { radiant: { picks: [66] } }, banEvents: [66, 73] });
    expect(t.bannedInState(live.sessionId)).toEqual([73]);
  });

  test("ban events in a match payload are ignored: the draft already ended", async () => {
    const t = setup();
    const live = await t.link();
    await t.send(live, { draft: "empty", banEvents: [73] });
    await t.send(live, { gameState: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", banEvents: [74] });
    expect(t.registry.status(live.sessionId)!.bans).toBe(1);
  });

  test("the status never carries identity or raw event text", async () => {
    const t = setup();
    const live = await t.link();
    await t.send(live, { draft: "empty", banEvents: HEROES });
    const text = JSON.stringify(t.registry.status(live.sessionId));
    for (const sentinel of SENTINELS) expect(text).not.toContain(sentinel);
    expect(text).not.toContain("CHAT_MESSAGE");
    expect(text).not.toContain("playerid");
  });
});
