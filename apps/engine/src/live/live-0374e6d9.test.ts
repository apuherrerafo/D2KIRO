import { describe, expect, test } from "bun:test";
import type { DraftEventEnvelope } from "../draft/reducer";
import { ProtocolSessionStore } from "../server/protocol-session";
import { emptyLiveFacts, replayLiveFacts, type LiveFacts } from "./live-capture";
import { LiveCaptureRegistry } from "./live-capture-registry";

// Draft 0374e6d9 (2026-10-16), ground truth from the scoreboard video. The visual helper read 8 of 10 heroes with the normal
// threshold; Phantom Assassin (0.634 / margin 0.269) and Mars (0.675 / 0.203) were correct but under min_score 0.68, so two
// Dire picks never reached the engine. This is the engine's side of that story: the facts it receives, in the order the screen
// revealed them, with and without those two. Real kernel, real store, real registry; no HTTP, no real data.

const SESSION = "live-0374e6d9-0001";
const RINGMASTER = 131;
const BROODMOTHER = 61;
const TECHIES = 105;
const NATURES_PROPHET = 53; // "Furion" in the kernel's own deferred wording
const LIFESTEALER = 54;
const JAKIRO = 64;
const PHANTOM_ASSASSIN = 44;
const VENGEFUL_SPIRIT = 20;
const MARS = 129;
const LION = 26;

let clock = 1_790_100_000_000;
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
    return registry.ingestEnvelope({ schema: "draft-event/v1", eventId: `ocr-0374-${seq}`, sessionId: SESSION, seq, emittedAt: "2026-10-16T04:17:06.000Z", source: "ocr", confidence: 0.95, payload });
  };
  const pick = (side: "radiant" | "dire", hero: number) => send({ type: "hero_picked", hero, side });
  const visualHealth = (status: "ok" | "degraded", detail: string) => send({ type: "capture_health", status, detail });
  return { store, registry, pick, visualHealth };
}

/** The order the screen revealed the cards in (diagnostics 0374e6d9). Phantom Assassin and Mars are the two the matcher left behind. */
const REVEAL_ORDER = [
  ["radiant", BROODMOTHER],
  ["radiant", TECHIES],
  ["dire", VENGEFUL_SPIRIT],
  ["dire", MARS],
  ["radiant", RINGMASTER],
  ["radiant", LIFESTEALER],
  ["dire", JAKIRO],
  ["dire", LION],
  ["radiant", NATURES_PROPHET],
  ["dire", PHANTOM_ASSASSIN],
] as const;

const MISSED = new Set<number>([PHANTOM_ASSASSIN, MARS]);

describe("0374e6d9 -- what the engine does with the 8 picks the normal threshold gave, and with the 10 it now gets", () => {
  test("8 of 10 (the old read): the helper says SLOTS_UNREAD and the board is not recommendable", () => {
    const t = setup();
    for (const [side, hero] of REVEAL_ORDER) if (!MISSED.has(hero)) t.pick(side, hero);
    t.visualHealth("degraded", "VISUAL_SLOTS_UNREAD");
    const status = t.registry.status(SESSION)!;
    expect(status.picks).toBe(8);
    expect(status.recommendation.available).toBe(false);
  });

  test("8 of 10 with the helper still calling it OK: the engine's own gate still refuses (deferred picks)", () => {
    const t = setup();
    for (const [side, hero] of REVEAL_ORDER) if (!MISSED.has(hero)) t.pick(side, hero);
    t.visualHealth("ok", "VISUAL_OK");
    const status = t.registry.status(SESSION)!;
    expect(status.recommendation).toEqual({ available: false, reason: "FACTS_UNRESOLVED" });
    expect(status.deferredPicks).toBeGreaterThan(0);
  });

  test("10 of 10: nothing deferred, PICKS_COMPLETE, and the recommendation opens", () => {
    const t = setup();
    for (const [side, hero] of REVEAL_ORDER) t.pick(side, hero);
    t.visualHealth("ok", "VISUAL_OK");
    const status = t.registry.status(SESSION)!;
    expect(status.picks).toBe(10);
    expect(status.deferredPicks).toBe(0);
    expect(status.completeness).toBe("PICKS_COMPLETE");
    expect(status.recommendation).toEqual({ available: true, reason: null });
  });

  test("the recovered picks arrive LATE (Phantom Assassin was the last reveal): the deferred pick resolves when it lands", () => {
    const t = setup();
    for (const [side, hero] of REVEAL_ORDER) if (hero !== PHANTOM_ASSASSIN) t.pick(side, hero);
    t.visualHealth("ok", "VISUAL_OK");
    const before = t.registry.status(SESSION)!;
    t.pick("dire", PHANTOM_ASSASSIN);
    const after = t.registry.status(SESSION)!;
    expect(after.picks).toBe(10);
    expect(after.deferredPicks).toBe(0);
    expect(after.recommendation).toEqual({ available: true, reason: null });
    expect(after.deferredPicks).toBeLessThanOrEqual(before.deferredPicks);
  });
});

describe("0374e6d9 -- the kernel's own deferred pick", () => {
  const BASE = { sessionId: "live-0374e6d9-replay", rulesetId: "dota2/ranked-all-pick" as const, partyContext: null, defaultSide: "radiant" as const };
  const factsWithout = (missed: ReadonlySet<number>): LiveFacts => ({
    ...emptyLiveFacts("7.41e"),
    started: true,
    localSide: "radiant",
    bans: [5],
    picks: REVEAL_ORDER.filter(([, hero]) => !missed.has(hero)).map(([side, heroId]) => ({ side, heroId, position: null })),
  });

  test("without Phantom Assassin and Mars the kernel has no slot for Nature's Prophet: it stays deferred", () => {
    const replay = replayLiveFacts(factsWithout(MISSED), BASE)!;
    expect(replay.deferred.map((pick) => pick.heroId)).toEqual([NATURES_PROPHET]);
    expect(replay.rejected).toEqual([]);
  });

  test("with all 10 nothing is deferred and nothing is rejected", () => {
    const replay = replayLiveFacts(factsWithout(new Set()), BASE)!;
    expect(replay.deferred).toEqual([]);
    expect(replay.rejected).toEqual([]);
  });
});
