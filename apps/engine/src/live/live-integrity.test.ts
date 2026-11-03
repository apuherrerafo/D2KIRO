import { describe, expect, test } from "bun:test";
import type { DraftEventEnvelope } from "../draft/reducer";
import { ProtocolSessionStore } from "../server/protocol-session";
import { createProtocolSessionRoutes } from "../server/routes/protocol-sessions";
import { emptyLiveFacts, replayLiveFacts } from "./live-capture";
import { GSI_DRAFT_PARTIAL, LiveCaptureRegistry, liveRecommendationReadiness } from "./live-capture-registry";

// Live integrity: what the screen shows is what the board shows, and a recommendation is never computed on a
// draft the system knows it only half-read. Real kernel, real store, real registry; no HTTP.

const SESSION = "live-integrity-0001";
let clock = 1_790_000_000_000;
let seq = 0;

function setup() {
  const store = new ProtocolSessionStore();
  const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41e", now: () => clock });
  registry.ensureSession(SESSION);
  registry.observe(SESSION, { type: "draft_started", patch: "7.41e" });
  registry.observe(SESSION, { type: "side", side: "radiant" });
  registry.observe(SESSION, { type: "ban", heroId: 5 });
  const send = (payload: DraftEventEnvelope["payload"]) => {
    seq += 1;
    const envelope: DraftEventEnvelope = { schema: "draft-event/v1", eventId: `ocr-i-${seq}`, sessionId: SESSION, seq, emittedAt: "2026-10-13T12:00:00.000Z", source: "ocr", confidence: 0.95, payload };
    return registry.ingestEnvelope(envelope);
  };
  const pick = (side: "radiant" | "dire", hero: number) => send({ type: "hero_picked", hero, side });
  /** The visual helper's own word (source "ocr"). */
  const visualHealth = (status: "ok" | "degraded", detail: string) => send({ type: "capture_health", status, detail });
  /** What Dota's own GSI says when it sends no draft block (source "overwolf" is the engine's non-visual health path). */
  const gsiPartial = () => {
    seq += 1;
    registry.ingestEnvelope({ schema: "draft-event/v1", eventId: `ow-i-${seq}`, sessionId: SESSION, seq, emittedAt: "2026-10-13T12:00:00.000Z", source: "overwolf", confidence: 1, payload: { type: "capture_health", status: "degraded", detail: GSI_DRAFT_PARTIAL } });
  };
  return { store, registry, send, pick, visualHealth, gsiPartial };
}

/** Routes with the live gate wired exactly like app.ts, and a recommender that counts how often it is reached. */
function routesOf(t: ReturnType<typeof setup>, gate: (id: string) => ReturnType<LiveCaptureRegistry["recommendationGate"]> = (id) => t.registry.recommendationGate(id)) {
  let evaluated = 0;
  const routes = createProtocolSessionRoutes({
    store: t.store,
    computeSuggestions: async () => {
      evaluated += 1;
      throw new Error("recommender reached");
    },
    liveRecommendationGate: gate,
  });
  const url = (suffix: string) => new URL(`http://127.0.0.1/api/session/protocol/${SESSION}/${suffix}`);
  return {
    evaluations: () => evaluated,
    team: () => routes.getTeamRecommendations(SESSION, url("team-recommendations")),
    v3: () => routes.getRecommendations(SESSION, url("recommendations?format=v3"), 1),
    v4: () => routes.getRecommendations(SESSION, url("recommendations?format=v4"), 1),
    assign: () => routes.postPositionAssignment(new Request("http://127.0.0.1/x", { method: "POST", body: JSON.stringify({ heroId: 11, position: 1 }) }), SESSION, 1),
  };
}

/** Heroes the Player's board shows for the enemy / own team (what the browser renders). */
function board(store: ProtocolSessionStore) {
  const view = store.view(SESSION)!;
  const heroes = (slots: typeof view.ownPicks) => slots.flatMap((slot) => (slot.visibility === "HIDDEN" ? [] : [slot.heroId]));
  return { own: heroes(view.ownPicks), enemy: heroes(view.enemyPicks), enemySlots: view.enemyPicks.length };
}

describe("VISIBLE_OCR_MATERIALIZATION -- a pick the screen shows stays visible", () => {
  test("an enemy pick confirmed while one ally pick of the round is missing is NOT hidden", () => {
    const t = setup();
    t.pick("radiant", 11); // ally #1 of round 1
    // ally #2 of round 1 was never read; the enemy picks ARE on screen and confirmed.
    t.pick("dire", 21);
    t.pick("dire", 22);
    expect(board(t.store).enemy.sort()).toEqual([21, 22]);
    expect(board(t.store).own).toEqual([11]);
  });

  test("a visible pick confirmed LATER stays visible next to the one already shown", () => {
    const t = setup();
    t.pick("radiant", 11);
    t.pick("dire", 21);
    expect(board(t.store).enemy).toEqual([21]);
    t.pick("dire", 22);
    expect(board(t.store).enemy.sort()).toEqual([21, 22]);
  });

  test("when the missing ally pick finally arrives nothing changes for the Player", () => {
    const t = setup();
    t.pick("radiant", 11);
    t.pick("dire", 21);
    t.pick("dire", 22);
    t.pick("radiant", 12);
    expect(board(t.store).enemy.sort()).toEqual([21, 22]);
    expect(board(t.store).own.sort()).toEqual([11, 12]);
  });
});

describe("STATUS_BOARD_CONSISTENCY -- the status line and the board count the same heroes", () => {
  test("a rival correction at the SAME pick count moves factsRevision, so the browser re-reads the board", () => {
    const t = setup();
    t.pick("dire", 21);
    const before = t.registry.status(SESSION)!;
    t.send({ type: "pick_reverted", hero: 21, side: "dire" });
    t.pick("dire", 23);
    const after = t.registry.status(SESSION)!;
    expect(after.picks).toBe(before.picks);
    expect(after.factsRevision).not.toBe(before.factsRevision);
    expect(board(t.store).enemy).toEqual([23]);
  });

  test("picks reported = heroes rendered, however the kernel sealed them", () => {
    const t = setup();
    t.pick("radiant", 11);
    t.pick("dire", 21);
    t.pick("dire", 22);
    const status = t.registry.status(SESSION)!;
    const rendered = board(t.store);
    expect(status.picks).toBe(rendered.own.length + rendered.enemy.length);
  });
});

describe("COMPLETENESS -- picks known is not capture health", () => {
  test("NONE -> PARTIAL -> PICKS_COMPLETE follows the picks, whatever the helper says", () => {
    const t = setup();
    t.visualHealth("ok", "VISUAL_OK");
    expect(t.registry.status(SESSION)!.completeness).toBe("NONE");
    t.pick("radiant", 11);
    expect(t.registry.status(SESSION)!.completeness).toBe("PARTIAL");
    for (const [side, hero] of [["dire", 21], ["radiant", 12], ["dire", 22], ["radiant", 13], ["dire", 23], ["radiant", 14], ["dire", 24], ["radiant", 15], ["dire", 25]] as const) t.pick(side, hero);
    const status = t.registry.status(SESSION)!;
    expect(status.completeness).toBe("PICKS_COMPLETE");
    expect(status.picks).toBe(10);
    expect(board(t.store).own.length + board(t.store).enemy.length).toBe(10);
  });

  test("an early draft does not need ten picks: a healthy read with no picks yet may recommend", () => {
    const t = setup();
    t.visualHealth("ok", "VISUAL_OK");
    expect(t.registry.status(SESSION)!.recommendation).toEqual({ available: true, reason: null });
    t.pick("radiant", 11);
    expect(t.registry.status(SESSION)!.recommendation.available).toBe(true);
  });

  test("VISUAL_OK never vouches for a draft whose own facts do not add up", () => {
    const t = setup();
    t.visualHealth("ok", "VISUAL_OK");
    t.pick("radiant", 11);
    t.pick("dire", 21);
    t.pick("dire", 22);
    t.pick("dire", 23); // a THIRD rival lock: round 1 closed in the game, so our second round-1 lock was never read
    expect(t.registry.status(SESSION)!.captureHealth).toBe("ok");
    expect(t.registry.status(SESSION)!.deferredPicks).toBe(1);
    expect(t.registry.status(SESSION)!.recommendation).toEqual({ available: false, reason: "FACTS_UNRESOLVED" });
    t.pick("radiant", 12);
    expect(t.registry.status(SESSION)!.recommendation).toEqual({ available: true, reason: null });
  });

  test("Dota reporting only part of the draft blocks until the helper reads it, and again if it stops reading", () => {
    const t = setup();
    t.gsiPartial();
    expect(t.registry.status(SESSION)!.recommendation).toEqual({ available: false, reason: "CAPTURE_PARTIAL" });
    t.visualHealth("ok", "VISUAL_OK");
    expect(t.registry.status(SESSION)!.recommendation.available).toBe(true);
    t.visualHealth("degraded", "VISUAL_SLOTS_UNREAD");
    expect(t.registry.status(SESSION)!.recommendation).toEqual({ available: false, reason: "SLOTS_UNREAD" });
  });
});

describe("ASYNC_ROUND -- known locks are draft information, whichever side locked first", () => {
  async function reachesRecommender(t: ReturnType<typeof setup>): Promise<boolean> {
    const r = routesOf(t);
    const response = await r.team().catch(() => null);
    return response?.status !== 409 && r.evaluations() > 0;
  }
  const open = { available: true, reason: null };

  test("enemy locks first -> board available", async () => {
    const t = setup();
    t.visualHealth("ok", "VISUAL_OK");
    t.pick("dire", 21);
    expect(t.registry.status(SESSION)!.recommendation).toEqual(open);
    expect(await reachesRecommender(t)).toBe(true);
  });

  test("enemy locks BOTH round-1 picks before ours -> board available (both are known)", async () => {
    const t = setup();
    t.visualHealth("ok", "VISUAL_OK");
    t.pick("dire", 21);
    t.pick("dire", 22);
    expect(t.registry.status(SESSION)!.recommendation).toEqual(open);
    expect(t.registry.status(SESSION)!.deferredPicks).toBe(0);
    expect(await reachesRecommender(t)).toBe(true);
  });

  test("our pick first -> board available", async () => {
    const t = setup();
    t.visualHealth("ok", "VISUAL_OK");
    t.pick("radiant", 11);
    expect(t.registry.status(SESSION)!.recommendation).toEqual(open);
    expect(await reachesRecommender(t)).toBe(true);
  });

  test("a partial real round (one lock each side, then two enemy, ours pending) -> board available at every step", async () => {
    const t = setup();
    t.visualHealth("ok", "VISUAL_OK");
    for (const [side, hero] of [["radiant", 11], ["dire", 21], ["dire", 22], ["radiant", 12], ["radiant", 13], ["dire", 23]] as const) {
      t.pick(side, hero);
      expect({ side, hero, recommendation: t.registry.status(SESSION)!.recommendation }).toEqual({ side, hero, recommendation: open });
    }
    expect(await reachesRecommender(t)).toBe(true);
  });

  test("a visible lock the capturer could not read -> 409 SLOTS_UNREAD, whatever else reports the draft", async () => {
    const t = setup();
    t.visualHealth("ok", "VISUAL_OK");
    t.pick("dire", 21);
    t.visualHealth("degraded", "VISUAL_SLOTS_UNREAD");
    const r = routesOf(t);
    const response = await r.team();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "live_draft_incomplete", reason: "SLOTS_UNREAD", completeness: "PARTIAL" });
    expect(r.evaluations()).toBe(0);
  });

  test("a contradiction the kernel refuses -> FACTS_UNRESOLVED -> 409", async () => {
    // The fact layer already drops a pick of a banned hero, so this can only come from facts that bypassed it:
    // the kernel itself refuses the selection, and the gate stays closed.
    const replay = replayLiveFacts({ ...emptyLiveFacts("7.41e"), started: true, localSide: "radiant", bans: [5], picks: [{ side: "dire", heroId: 5, position: null }] }, {
      sessionId: "contradiction",
      rulesetId: "dota2/ranked-all-pick",
      partyContext: null,
      defaultSide: "radiant",
    })!;
    expect(replay.rejected).toHaveLength(1);
    const readiness = liveRecommendationReadiness({ captureHealth: "ok", captureDetail: null, visual: null, deferredPicks: 0, rejectedFacts: replay.rejected.length }, 0);
    expect(readiness).toEqual({ available: false, reason: "FACTS_UNRESOLVED" });
    const t = setup();
    const r = routesOf(t, () => ({ ...readiness, completeness: "PARTIAL" }));
    expect((await r.team()).status).toBe(409);
    expect(r.evaluations()).toBe(0);
  });
});

describe("ENGINE_FAIL_CLOSED -- the engine itself refuses to recommend on a half-read draft", () => {
  test("every recommendation route answers 409 live_draft_incomplete and never reaches the recommender", async () => {
    const t = setup();
    t.visualHealth("ok", "VISUAL_OK");
    t.pick("radiant", 11);
    t.pick("dire", 21);
    t.pick("dire", 22);
    t.pick("dire", 23); // past the round boundary: a lock of the closed round is missing
    const r = routesOf(t);
    for (const call of [r.team, r.v3, r.v4, r.assign]) {
      const response = await call();
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "live_draft_incomplete", reason: "FACTS_UNRESOLVED", completeness: "PARTIAL" });
    }
    expect(r.evaluations()).toBe(0);
  });

  test("a complete-enough draft reaches the recommender again", async () => {
    const t = setup();
    t.visualHealth("ok", "VISUAL_OK");
    t.pick("radiant", 11);
    t.pick("dire", 21);
    t.pick("dire", 22);
    t.pick("dire", 23);
    t.pick("radiant", 12);
    const r = routesOf(t);
    await r.team().catch(() => undefined);
    expect(r.evaluations()).toBeGreaterThan(0);
  });

  test("a session that is not live capture is never gated", () => {
    const t = setup();
    expect(t.registry.recommendationGate("not-a-live-session")).toBeNull();
  });

  test("a forgotten live session (link rotated or revoked) stays closed and starts again from nothing", async () => {
    const t = setup();
    t.visualHealth("ok", "VISUAL_OK");
    t.pick("radiant", 11);
    t.pick("dire", 21);
    t.pick("dire", 22);
    const r = routesOf(t);
    t.registry.forget(SESSION);
    expect(t.registry.recommendationGate(SESSION)).toEqual({ available: false, reason: "FACTS_UNRESOLVED", completeness: "NONE" });
    expect((await r.team()).status).toBe(409);
    expect(r.evaluations()).toBe(0);
    // A fresh capture on the same session: nothing of the old draft survives on the board, and status agrees.
    t.registry.ensureSession(SESSION);
    expect(board(t.store)).toEqual({ own: [], enemy: [], enemySlots: 0 });
    expect(t.registry.status(SESSION)!.picks).toBe(0);
  });
});
