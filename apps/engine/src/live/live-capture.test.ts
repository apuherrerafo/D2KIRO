import { describe, expect, test } from "bun:test";
import type { TeamCoachBoard } from "../coach";
import { fakeCompute } from "../coach/session-harness.fixtures";
import type { DraftEventEnvelope } from "../draft/reducer";
import { isValidDraftEventEnvelope } from "../server/edge";
import { ProtocolSessionStore } from "../server/protocol-session";
import { parseLiveObservationBody } from "../server/routes/live-capture";
import { createProtocolSessionRoutes } from "../server/routes/protocol-sessions";
import type { HeroPositions } from "../signals/hero-positions";
import { applyLiveObservation, emptyLiveFacts, MAX_LIVE_BANS, MAX_LIVE_PICKS_PER_SIDE, replayLiveFacts, type LiveFacts } from "./live-capture";
import { LiveCaptureRegistry } from "./live-capture-registry";

// Live capture, engine side: observed facts -> REAL kernel -> REAL ProtocolSessionStore -> REAL Team
// Coach Board route. Only V6's scorer is the deterministic fixture; positions are inline (S10).

const POSITIONS: HeroPositions = Object.fromEntries(
  [1, 2, 3, 4, 5].flatMap((position) => [0, 1, 2, 3].map((k) => [position * 10 + k, [{ position: position as 1 | 2 | 3 | 4 | 5, matches: 1000 }]])),
);
const POOL = Object.keys(POSITIONS).map(Number);
const BASE = { sessionId: "live-1", rulesetId: "dota2/ranked-all-pick" as const, partyContext: { partySize: 5, side: "radiant" as const, controlledSlots: [] }, defaultSide: "radiant" as const };

function facts(partial: Partial<LiveFacts>): LiveFacts {
  return { ...emptyLiveFacts("7.41e"), started: true, localSide: "radiant", ...partial };
}

let counter = 0;
function envelope(sessionId: string, payload: DraftEventEnvelope["payload"] & { position?: number }, eventId = `evt-${(counter += 1)}`): DraftEventEnvelope {
  return { schema: "draft-event/v1", eventId, sessionId, seq: counter, emittedAt: "2026-10-01T00:00:00.000Z", source: "overwolf", confidence: 1, payload };
}

function setup(now = () => 1_000_000) {
  const store = new ProtocolSessionStore();
  const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41e", now });
  const routes = createProtocolSessionRoutes({ store, computeSuggestions: fakeCompute(POOL, POSITIONS), heroPositions: POSITIONS, heroCounters: new Map() });
  async function board(sessionId: string): Promise<TeamCoachBoard> {
    const response = await routes.getTeamRecommendations(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/team-recommendations`));
    expect(response.status).toBe(200);
    return (await response.json()) as TeamCoachBoard;
  }
  return { store, registry, routes, board };
}

describe("replayLiveFacts -- the kernel places every observed fact", () => {
  test("bans + picks de ambos lados: rondas resueltas por el kernel, posiciones propias ligadas", () => {
    const replay = replayLiveFacts(facts({
      bans: [99, 98],
      picks: [
        { side: "radiant", heroId: 30, position: 3 },
        { side: "radiant", heroId: 50, position: 5 },
        { side: "dire", heroId: 11, position: null },
        { side: "dire", heroId: 21, position: null },
        { side: "radiant", heroId: 10, position: 1 },
      ],
    }), BASE)!;
    expect(replay.state.rankedAp!.bannedHeroes).toEqual([99, 98]);
    expect(replay.state.rankedAp!.phase).toBe("PICK_ROUND_2");
    expect(replay.state.rankedAp!.confirmedPicks.map((pick) => pick.heroId).sort((a, b) => a - b)).toEqual([11, 21, 30, 50]);
    expect(replay.ownBindings.map((binding) => binding.assignedPosition)).toEqual([3, 5, 1]);
    expect(replay.deferred).toEqual([]);
  });

  test("un pick propio sin slot abierto (rival aún sin revelar) queda diferido, nunca forzado", () => {
    const replay = replayLiveFacts(facts({
      picks: [
        { side: "radiant", heroId: 30, position: 3 },
        { side: "radiant", heroId: 50, position: 5 },
        { side: "radiant", heroId: 10, position: 1 },
      ],
    }), BASE)!;
    expect(replay.state.rankedAp!.phase).toBe("PICK_ROUND_1");
    expect(replay.deferred.map((pick) => pick.heroId)).toEqual([10]);
  });

  test("antes de que empiece la selección no hay ronda abierta", () => {
    const replay = replayLiveFacts(emptyLiveFacts("7.41e"), BASE)!;
    expect(replay.state.rankedAp!.phase).toBe("BAN_RESOLUTION");
  });
});

describe("applyLiveObservation -- facts are idempotent", () => {
  test("el mismo pick dos veces no duplica; el lado contrario no puede robar un héroe ya elegido", () => {
    let current = facts({});
    current = applyLiveObservation(current, { type: "pick", side: "radiant", heroId: 30, position: 3 }).facts;
    const repeat = applyLiveObservation(current, { type: "pick", side: "radiant", heroId: 30, position: 3 });
    expect(repeat.changed).toBe(false);
    expect(applyLiveObservation(current, { type: "pick", side: "dire", heroId: 30, position: null }).ignored).toBe("picked_by_other_side");
    expect(current.picks).toHaveLength(1);
  });

  test("un pick sin posición se completa cuando la posición llega después", () => {
    let current = facts({});
    current = applyLiveObservation(current, { type: "pick", side: "radiant", heroId: 30, position: null }).facts;
    const completed = applyLiveObservation(current, { type: "pick", side: "radiant", heroId: 30, position: 3 });
    expect(completed.changed).toBe(true);
    expect(completed.facts.picks).toEqual([{ side: "radiant", heroId: 30, position: 3 }]);
  });

  test("revert quita sólo ese pick; héroe cero/inválido se ignora", () => {
    let current = facts({});
    current = applyLiveObservation(current, { type: "pick", side: "radiant", heroId: 30, position: 3 }).facts;
    current = applyLiveObservation(current, { type: "revert", side: "radiant", heroId: 30 }).facts;
    expect(current.picks).toEqual([]);
    expect(applyLiveObservation(current, { type: "pick", side: "radiant", heroId: 0, position: 3 }).ignored).toBe("invalid_hero");
    expect(applyLiveObservation(current, { type: "ban", heroId: Number.NaN }).ignored).toBe("invalid_hero");
  });
});

describe("applyLiveObservation -- corrections (Greptile TSK-219)", () => {
  test("unban removes exactly that ban; an unknown ban is a no-op, never an error", () => {
    let current = facts({ bans: [11, 12] });
    current = applyLiveObservation(current, { type: "unban", heroId: 11 }).facts;
    expect(current.bans).toEqual([12]);
    expect(applyLiveObservation(current, { type: "unban", heroId: 11 })).toMatchObject({ changed: false, ignored: "unknown_ban" });
    expect(parseLiveObservationBody({ type: "unban", heroId: 12 })).toEqual({ type: "unban", heroId: 12 });
    expect(parseLiveObservationBody({ type: "unban", heroId: "12" })).toBeNull();
  });
});

describe("applyLiveObservation -- a live draft never outgrows a legal draft (Sentinel TSK-219)", () => {
  test("bans stop at MAX_LIVE_BANS, picks at MAX_LIVE_PICKS_PER_SIDE per side, hero ids above 999 are invalid", () => {
    let current = facts({});
    for (let hero = 1; hero <= MAX_LIVE_BANS + 5; hero += 1) current = applyLiveObservation(current, { type: "ban", heroId: hero }).facts;
    expect(current.bans).toHaveLength(MAX_LIVE_BANS);
    expect(applyLiveObservation(current, { type: "ban", heroId: 900 }).ignored).toBe("draft_full");
    for (let hero = 100; hero < 100 + MAX_LIVE_PICKS_PER_SIDE + 3; hero += 1) current = applyLiveObservation(current, { type: "pick", side: "dire", heroId: hero, position: null }).facts;
    expect(current.picks.filter((pick) => pick.side === "dire")).toHaveLength(MAX_LIVE_PICKS_PER_SIDE);
    expect(applyLiveObservation(current, { type: "pick", side: "dire", heroId: 200, position: null }).ignored).toBe("draft_full");
    // The other side still has room.
    expect(applyLiveObservation(current, { type: "pick", side: "radiant", heroId: 200, position: null }).changed).toBe(true);
    expect(applyLiveObservation(current, { type: "ban", heroId: 1000 }).ignored).toBe("invalid_hero");
  });
});

describe("LiveCaptureRegistry + Team Coach Board", () => {
  test("eventos Overwolf -> sesión live Party5 -> board de 5 columnas; un pick detectado llena su posición y recalcula", async () => {
    const { registry, board } = setup();
    const id = "11111111-aaaa-bbbb-cccc-000000000001";
    registry.ingestEnvelope(envelope(id, { type: "session_started", format: "all_pick", patch: "7.41e" }));
    registry.ingestEnvelope(envelope(id, { type: "local_side_identified", side: "dire" }));
    registry.ingestEnvelope(envelope(id, { type: "hero_banned", hero: 99, side: "unknown" }));
    const before = await board(id);
    expect(before.positions).toHaveLength(5);
    expect(before.positions.every((column) => column.state === "RANKED" && column.eligibleNow)).toBe(true);
    expect(before.currentDecision.recommendedPosition).not.toBeNull();

    const picked = registry.ingestEnvelope(envelope(id, { type: "hero_picked", hero: 30, side: "dire", position: 3 }));
    expect(picked.accepted && picked.status.lastDetectedPick).toMatchObject({ side: "dire", heroId: 30, position: 3, source: "overwolf" });
    registry.ingestEnvelope(envelope(id, { type: "hero_picked", hero: 11, side: "radiant" }));
    expect(registry.status(id)!.lastDetectedPick).toMatchObject({ side: "dire", heroId: 30 }); // an enemy pick never replaces it
    const after = await board(id);
    expect(after.stateIdentity).not.toBe(before.stateIdentity);
    expect(after.positions.find((column) => column.position === 3)).toMatchObject({ state: "FILLED", filledHeroId: 30 });
    expect(after.positions.flatMap((column) => column.top.map((card) => card.heroId))).not.toContain(30);
    expect(after.positions.flatMap((column) => column.top.map((card) => card.heroId))).not.toContain(99);
  });

  test("el mismo envelope (mismo eventId) dos veces no produce doble pick", () => {
    const { registry, store } = setup();
    const id = "11111111-aaaa-bbbb-cccc-000000000002";
    registry.ingestEnvelope(envelope(id, { type: "session_started", format: "all_pick", patch: "7.41e" }));
    const pick = envelope(id, { type: "hero_picked", hero: 30, side: "radiant", position: 3 });
    registry.ingestEnvelope(pick);
    const second = registry.ingestEnvelope(pick);
    expect(second.accepted && second.ignored).toBe("duplicate_event");
    expect(store.view(id)!.ownPicks.filter((slot) => slot.visibility !== "HIDDEN")).toHaveLength(1);
  });

  test("pick_reverted reconstruye: el héroe vuelve a estar disponible y la posición se libera", async () => {
    const { registry, board } = setup();
    const id = "11111111-aaaa-bbbb-cccc-000000000003";
    registry.ingestEnvelope(envelope(id, { type: "session_started", format: "all_pick", patch: "7.41e" }));
    registry.ingestEnvelope(envelope(id, { type: "hero_picked", hero: 30, side: "radiant", position: 3 }));
    registry.ingestEnvelope(envelope(id, { type: "pick_reverted", hero: 30, side: "radiant" }));
    registry.ingestEnvelope(envelope(id, { type: "hero_picked", hero: 31, side: "radiant", position: 3 }));
    const current = await board(id);
    expect(current.positions.find((column) => column.position === 3)).toMatchObject({ state: "FILLED", filledHeroId: 31 });
  });

  test("capture_health degradado queda en el estado; la conexión envejece sin eventos", () => {
    let clock = 1_000_000;
    const { registry } = setup(() => clock);
    const id = "11111111-aaaa-bbbb-cccc-000000000004";
    registry.ingestEnvelope(envelope(id, { type: "capture_health", status: "degraded", detail: "DOTA_CAPTURE_NOT_ENABLED" }));
    expect(registry.status(id)).toMatchObject({ connection: "connected", captureHealth: "degraded", captureDetail: "DOTA_CAPTURE_NOT_ENABLED", draftPhase: "waiting", picks: 0 });
    clock += 60_000;
    expect(registry.status(id)!.connection).toBe("stale");
  });

  test("fallback manual: la misma sesión sigue con observaciones a mano, sin perder estado", () => {
    const { registry, store } = setup();
    const id = "11111111-aaaa-bbbb-cccc-000000000005";
    registry.ingestEnvelope(envelope(id, { type: "session_started", format: "all_pick", patch: "7.41e" }));
    registry.ingestEnvelope(envelope(id, { type: "hero_picked", hero: 30, side: "radiant", position: 3 }));
    const manual = registry.observe(id, { type: "pick", side: "radiant", heroId: 50, position: 5 });
    expect(manual.accepted && manual.status.lastDetectedPick?.source).toBe("manual");
    expect(store.ownAssignedPositions(id)!.map((binding) => binding.assignedPosition).sort()).toEqual([3, 5]);
  });

  test("session_ended + nuevo session_started en la misma sesión -> partida nueva, sin arrastrar picks", () => {
    const { registry, store } = setup();
    const id = "11111111-aaaa-bbbb-cccc-000000000007";
    registry.ingestEnvelope(envelope(id, { type: "session_started", format: "all_pick", patch: "7.41e" }));
    registry.ingestEnvelope(envelope(id, { type: "hero_picked", hero: 30, side: "radiant", position: 3 }));
    registry.ingestEnvelope(envelope(id, { type: "session_ended", reason: "completed" }));
    expect(registry.status(id)!.draftPhase).toBe("ended");
    registry.ingestEnvelope(envelope(id, { type: "session_started", format: "all_pick", patch: "7.41e" }));
    expect(registry.status(id)).toMatchObject({ draftPhase: "hero_selection", picks: 0 });
    expect(store.view(id)!.ownPicks.filter((slot) => slot.visibility !== "HIDDEN")).toHaveLength(0);
  });

  test("una sesión live no acepta comandos crudos del protocolo (409) y el dueño se reclama una vez", async () => {
    const { registry, routes } = setup();
    const id = "11111111-aaaa-bbbb-cccc-000000000006";
    registry.ingestEnvelope(envelope(id, { type: "session_started", format: "all_pick", patch: "7.41e" }));
    const response = await routes.postCommand(new Request("http://127.0.0.1/x", {
      method: "POST",
      body: JSON.stringify({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 30 }, assignedPosition: 3 }),
    }), id);
    expect(response.status).toBe(409);
    expect(registry.ensureSession(id, 7)).toBe(true);
    expect(registry.ensureSession(id, 8)).toBe(false);
  });
});

describe("edge validation", () => {
  test("hero_picked admite position 1..5 opcional y rechaza cualquier otra", () => {
    const base = { schema: "draft-event/v1", eventId: "e", sessionId: "s", seq: 1, emittedAt: "x", source: "overwolf", confidence: 1 };
    expect(isValidDraftEventEnvelope({ ...base, payload: { type: "hero_picked", hero: 1, side: "radiant" } })).toBe(true);
    expect(isValidDraftEventEnvelope({ ...base, payload: { type: "hero_picked", hero: 1, side: "radiant", position: 3 } })).toBe(true);
    expect(isValidDraftEventEnvelope({ ...base, payload: { type: "hero_picked", hero: 1, side: "radiant", position: 6 } })).toBe(false);
    expect(isValidDraftEventEnvelope({ ...base, payload: { type: "hero_picked", hero: 1, side: "radiant", position: "3" } })).toBe(false);
  });

  test("observación manual: cuerpo inválido -> null", () => {
    expect(parseLiveObservationBody({ type: "pick", side: "radiant", heroId: 5, position: 2 })).toEqual({ type: "pick", side: "radiant", heroId: 5, position: 2 });
    expect(parseLiveObservationBody({ type: "pick", side: "left", heroId: 5 })).toBeNull();
    expect(parseLiveObservationBody({ type: "pick", side: "radiant", heroId: -1 })).toBeNull();
    expect(parseLiveObservationBody({ type: "pick", side: "radiant", heroId: 5, position: 9 })).toBeNull();
    expect(parseLiveObservationBody({ type: "drop_table" })).toBeNull();
  });
});
