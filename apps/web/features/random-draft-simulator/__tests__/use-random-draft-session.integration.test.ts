import "@/test-support/happy-dom";

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { HeroId, TeamSide } from "@/features/draft/types";
import { useRandomDraftSession } from "../use-random-draft-session";
import { useRandomDraftStore } from "../store";

const HEROES = Array.from({ length: 40 }, (_, index) => ({ id: index + 1, localizedName: `Hero ${index + 1}`, roles: ["Carry"] }));
const ROUND_CAPACITY: Record<number, number> = { 1: 2, 2: 2, 3: 1 };
const ROUND_TIMER_MS: Record<number, number> = { 1: 25000, 2: 25000, 3: 20000 };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

interface FakeOptions {
  /** Resolve-bans answers 422 (retryable) this many times before succeeding. */
  banFailures?: number;
  /** The Player's LAST pick of round 1 collides with the bot: hero banned, that seat reopens. */
  collideRoundOnce?: boolean;
  /** Every Coach response after the first arrives "late": it carries an OLDER revision than the one already held. */
  outOfOrderCoach?: boolean;
}

/**
 * Browser-contract fixture for AP Ranked Roles V1. The engine owns bans, the Enemy Bot, the
 * reveal and collisions; the browser only ever submits the Player's own seal for each of the 5 seats.
 */
class FakeApProtocolEngine {
  readonly requests: { url: string; body: Record<string, unknown> }[] = [];
  private readonly sessionId = "protocol-browser-session";
  private side: TeamSide = "radiant";
  private banFailuresLeft: number;
  private collidePending: boolean;
  private bans: HeroId[] = [];
  private round: 1 | 2 | 3 | 0 | 4 = 0; // 0 = still in bans, 4 = complete
  private own: HeroId[] = [];
  private enemy: HeroId[] = [];
  private openSlots: number[] = [];
  private coachRevision = 0;
  private readonly outOfOrderCoach: boolean;

  constructor(options: FakeOptions = {}) {
    this.outOfOrderCoach = options.outOfOrderCoach ?? false;
    this.banFailuresLeft = options.banFailures ?? 0;
    this.collidePending = options.collideRoundOnce ?? false;
  }

  private phaseName(): string {
    if (this.round === 0) return "BAN_RESOLUTION";
    if (this.round === 4) return "COMPLETE";
    return `PICK_ROUND_${this.round}`;
  }

  // AP Ranked Roles V1 / Wave 2: what the engine's `?format=v3` returns. The trigger/revision follow
  // the Player's own seals, exactly like the real Coach orchestrator (the enemy never has to reveal).
  private coachBody() {
    this.coachRevision += 1;
    const revision = this.outOfOrderCoach && this.coachRevision > 1 ? 0 : this.coachRevision;
    const controlledSlots = this.openSlots.map((slotIndex) => ({ side: this.side, slotIndex }));
    const recommendationHeroes = controlledSlots.map((slot) => 10 + slot.slotIndex + this.own.length);
    const recommendationActions = controlledSlots.map((slot, index) => ({ slot, hero: recommendationHeroes[index]! }));
    return {
      output: {
        schema: "recommendation-output/v3",
        sessionId: this.sessionId,
        primaryAction: { strategy: { kind: "REVEAL_POSITION", position: 5, rationale: "fixture" }, label: `Sugerencia: revela Hard support (Pos 5) #${this.coachRevision}` },
        shortlist: [{ heroId: 7, position: 5, roleStatus: "LIKELY", confidence: "media", badges: [], rationale: "fixture", score: 10, isFromPool: false }],
        meta: {
          round: this.round >= 1 && this.round <= 3 ? this.round : null,
          phase: this.phaseName(),
          ownPicksRemaining: 5 - this.own.length,
          confidence: "media",
          decisionContext: this.own.length === 0 ? "team_opening" : "blind_second_pick",
          trigger: this.own.length === 0 ? "DRAFT_PICKS_STARTED" : "OWN_PICK_CONFIRMED",
          revision,
          basedOn: { stateIdentity: `state-${this.own.length}-${this.enemy.length}`, evidenceVersion: "v" },
        },
      },
      recommendationSet: {
        schema: "recommendation-set/v2",
        sessionId: this.sessionId,
        decision: { actor: this.side, actionKind: "PICK", controlledSlots, actionCount: controlledSlots.length },
        recommendations: recommendationActions.length === 0 ? [] : [{
          actions: recommendationActions,
          score: 80,
          confidence: "media",
          roleImpact: Object.fromEntries(recommendationHeroes.map((hero, index) => [hero, {
            status: "LIKELY",
            position: this.round === 1 ? (index === 0 ? 5 : 4) : this.round === 2 ? (index === 0 ? 3 : 1) : 2,
            marginals: { 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.2, 5: 0.2 },
            entropy: 1,
          }])),
          risks: [],
          legacy: recommendationActions.length === 1 ? {
            hero: recommendationHeroes[0], signals: [], evidenceCoverage: 1, guessingIndex: 0, reason: "fixture",
          } : null,
        }],
        degradations: [],
        deferred: { opponentResponse: "NOT_COMPUTED", steal: "NOT_COMPUTED", lookahead: "NOT_COMPUTED" },
        decisionContext: "team_opening",
      },
    };
  }

  private snapshot(extra: Record<string, unknown> = {}) {
    const pickRound = this.round >= 1 && this.round <= 3 ? (this.round as 1 | 2 | 3) : null;
    return {
      view: {
        schema: "draft-protocol-perspective/v1",
        sessionId: this.sessionId,
        status: this.round === 4 ? "COMPLETE" : "ACTIVE",
        viewerSide: this.side,
        bannedHeroes: this.bans,
        ownPicks: this.own.map((heroId) => ({ visibility: "KNOWN", heroId })),
        enemyPicks: this.enemy.map((heroId) => ({ visibility: "REVEALED", heroId })),
        rankedAp: { phase: this.phaseName(), banResolutionComplete: this.round > 0 },
        captainsMode: null,
      },
      legalActions: this.openSlots.map((slotIndex) => ({ type: "SUBMIT_SEALED_SELECTION", side: this.side, slotIndex })),
      simulator: pickRound === null
        ? null
        : {
            round: pickRound,
            durationMs: ROUND_TIMER_MS[pickRound],
            remainingMs: ROUND_TIMER_MS[pickRound],
            penaltyActive: false,
            pendingSeats: this.openSlots.map((slotIndex) => (pickRound === 1 ? 0 : pickRound === 2 ? 2 : 4) + slotIndex),
            goldPenaltyBySlot: [0, 0, 0, 0, 0],
            penaltyRatePerSecond: 2,
          },
      ...extra,
    };
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    this.requests.push({ url, body });
    if (url.endsWith("/api/heroes")) return json(HEROES);
    if (url.endsWith("/api/meta/hero-stats")) return json({ patchStats: {}, heroPositions: {} });
    if (url.endsWith("/api/auth/engine-token")) return json({ token: "fixture" });
    if (url.endsWith("/api/session/protocol")) {
      this.side = body.localSide as TeamSide;
      return json({ sessionId: this.sessionId, ruleset: {}, status: "ACTIVE" }, 201);
    }
    if (url.endsWith("/resolve-bans")) {
      if (this.banFailuresLeft > 0) {
        this.banFailuresLeft -= 1;
        return json({ error: "ban_resolution_failed", reason: "policy_failed", retryable: true }, 422);
      }
      this.bans = [30, 31, 32];
      this.round = 1;
      return json({ resolvedBans: this.bans, ...this.snapshot() });
    }
    if (url.includes("/recommendations")) {
      return json(this.coachBody());
    }
    if (url.endsWith("/auto-drive")) {
      if (this.round === 0) return json({ error: "no_open_round" }, 409);
      if (this.round === 4) return json({ ...this.snapshot(), stopReason: "complete", completedRound: null });
      if (this.openSlots.length === 0) {
        this.openSlots = Array.from({ length: ROUND_CAPACITY[this.round]! }, (_, index) => index);
      }
      return json({ ...this.snapshot(), stopReason: "human_input", completedRound: null });
    }
    if (url.endsWith("/command")) {
      const command = body.command as { type: string; side: TeamSide; slotIndex: number; heroId: HeroId };
      if (command.type !== "SUBMIT_SEALED_SELECTION") return json({ error: "action_forbidden" }, 403);
      if (this.bans.includes(command.heroId) || this.own.includes(command.heroId) || this.enemy.includes(command.heroId)) {
        return json({ accepted: false, rejected: "HERO_ALREADY_TAKEN", ...this.snapshot() }, 202);
      }
      this.own.push(command.heroId);
      this.openSlots = this.openSlots.filter((slotIndex) => slotIndex !== command.slotIndex);
      if (this.openSlots.length === 0) this.closeRound(command);
      return json({ accepted: true, ...this.snapshot() }, 202);
    }
    throw new Error(`fetch not mocked: ${url}`);
  };

  private closeRound(last: { slotIndex: number; heroId: HeroId }): void {
    const round = this.round as 1 | 2 | 3;
    if (this.collidePending && round === 1) {
      this.collidePending = false;
      this.bans = [...this.bans, last.heroId];
      this.own = this.own.slice(0, -1);
      this.openSlots = [last.slotIndex];
      return;
    }
    const capacity = ROUND_CAPACITY[round]!;
    for (let index = 0; index < capacity; index += 1) this.enemy.push(200 + this.enemy.length);
    this.round = (round + 1) as 1 | 2 | 3 | 4;
    this.openSlots = [];
  }
}

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  useRandomDraftStore.getState().resetSession();
});

async function startDraft(
  side: TeamSide,
  position: 1 | 2 | 3 | 4 | 5,
  options: FakeOptions = {},
  personalBanList: HeroId[] = [],
  partySize: 1 | 2 | 3 | 5 = 5,
  partyPositions?: (1 | 2 | 3 | 4 | 5)[],
) {
  const engine = new FakeApProtocolEngine(options);
  globalThis.fetch = engine.fetch as typeof fetch;
  const hook = renderHook(() => useRandomDraftSession({ fetchImpl: engine.fetch as typeof fetch, revealPauseMs: 0 }));
  await act(async () =>
    hook.result.current.startDraft({
      draftSeed: "ABCDEFGH",
      userSide: side,
      playerPosition: position,
      personalBanList,
      partySize,
      partyPositions,
    }),
  );
  return { engine, ...hook };
}

async function lock(result: { current: ReturnType<typeof useRandomDraftSession> }, heroId: HeroId, slotIndex?: number): Promise<void> {
  await act(async () => result.current.actions.lockPick(heroId, slotIndex));
}

function commands(engine: FakeApProtocolEngine) {
  return engine.requests
    .filter((entry) => entry.url.endsWith("/command"))
    .map((entry) => entry.body.command as { type: string; side: string; slotIndex: number; heroId: number });
}

for (const side of ["radiant", "dire"] as TeamSide[]) {
  test(`${side}: BANS -> R1 -> R2 -> R3 -> COMPLETE con los 5 picks del Player en el navegador`, async () => {
    const { engine, result, unmount } = await startDraft(side, 4, {}, [10, 11]);
    expect(result.current.state.phase).toMatchObject({ type: "blind_round", round: 1, timerDurationMs: 25000, attemptSeats: [0, 1] });

    // Support/Mid picks can happen in ANY round: the order below is arbitrary on purpose.
    for (const heroId of [1, 2, 3, 4, 5]) await lock(result, heroId);

    expect(result.current.state.phase.type).toBe("complete");
    expect(result.current.state.draftState?.picks[side]).toEqual([1, 2, 3, 4, 5]);
    const enemy = side === "radiant" ? "dire" : "radiant";
    expect(result.current.state.draftState?.picks[enemy]).toHaveLength(5);
    expect(result.current.state.draftState?.banned).toEqual([30, 31, 32]);
    if (result.current.state.phase.type === "complete") expect(result.current.state.phase.summary.picksByRound.map((round) => round.userPicks.length)).toEqual([2, 2, 1]);

    // Exactly five own seals, all for the Player's side, slots 0,1 / 0,1 / 0.
    expect(commands(engine)).toEqual([
      { type: "SUBMIT_SEALED_SELECTION", side, slotIndex: 0, heroId: 1 },
      { type: "SUBMIT_SEALED_SELECTION", side, slotIndex: 1, heroId: 2 },
      { type: "SUBMIT_SEALED_SELECTION", side, slotIndex: 0, heroId: 3 },
      { type: "SUBMIT_SEALED_SELECTION", side, slotIndex: 1, heroId: 4 },
      { type: "SUBMIT_SEALED_SELECTION", side, slotIndex: 0, heroId: 5 },
    ]);
    unmount();
  });
}

test("la sesión transporta el lado, la posición personal, la seed y los 5 asientos controlados (nada de Solo Mid)", async () => {
  const { engine, unmount } = await startDraft("dire", 5);
  const create = engine.requests.find((entry) => entry.url.endsWith("/api/session/protocol"))!;
  expect(create.body).toMatchObject({
    localSide: "dire",
    humanPosition: 5,
    simulatorSeed: "ABCDEFGH",
    partyContext: { partySize: 5, side: "dire" },
  });
  expect((create.body.partyContext as { controlledSlots: { slotIndex: number; side: string }[] }).controlledSlots.map((slot) => [slot.side, slot.slotIndex])).toEqual([
    ["dire", 0], ["dire", 1], ["dire", 2], ["dire", 3], ["dire", 4],
  ]);
  expect("humanRosterSlot" in create.body).toBe(false);
  unmount();
});

test("la sesión transporta Solo (partySize: 1) controlando únicamente el asiento de la posición elegida", async () => {
  // Pos 1 -> seat 3
  const { engine, unmount } = await startDraft("radiant", 1, {}, [], 1);
  const create = engine.requests.find((entry) => entry.url.endsWith("/api/session/protocol"))!;
  expect(create.body).toMatchObject({
    localSide: "radiant",
    humanPosition: 1,
    simulatorSeed: "ABCDEFGH",
    partyContext: { partySize: 1, side: "radiant" },
  });
  expect((create.body.partyContext as { controlledSlots: { slotIndex: number; side: string }[] }).controlledSlots.map((slot) => [slot.side, slot.slotIndex])).toEqual([
    ["radiant", 3],
  ]);
  unmount();
});

test("la sesión transporta Party 2 y Party 3 con los asientos correspondientes a sus posiciones asignadas", async () => {
  // Party 2: Pos 2 (seat 4) + Pos 5 (seat 0)
  const party2 = await startDraft("dire", 2, {}, [], 2, [2, 5]);
  const req2 = party2.engine.requests.find((entry) => entry.url.endsWith("/api/session/protocol"))!;
  expect((req2.body.partyContext as { controlledSlots: { slotIndex: number; side: string }[] }).controlledSlots.map((slot) => [slot.side, slot.slotIndex])).toEqual([
    ["dire", 4], ["dire", 0],
  ]);
  party2.unmount();

  // Party 3: Pos 1 (seat 3) + Pos 3 (seat 2) + Pos 5 (seat 0)
  const party3 = await startDraft("radiant", 5, {}, [], 3, [1, 3, 5]);
  const req3 = party3.engine.requests.find((entry) => entry.url.endsWith("/api/session/protocol"))!;
  expect((req3.body.partyContext as { controlledSlots: { slotIndex: number; side: string }[] }).controlledSlots.map((slot) => [slot.side, slot.slotIndex])).toEqual([
    ["radiant", 3], ["radiant", 2], ["radiant", 0],
  ]);
  party3.unmount();
});

test("los bans los resuelve el motor: el navegador envía sólo sus nominaciones y nunca graba bans por /command", async () => {
  const { engine, unmount } = await startDraft("radiant", 2, {}, [10, 11, 12, 13]);
  const resolve = engine.requests.find((entry) => entry.url.endsWith("/resolve-bans"))!;
  expect(resolve.body).toEqual({ playerBanPreferences: [10, 11, 12, 13] });
  expect(commands(engine).some((command) => command.type === "RECORD_RESOLVED_BANS" || command.type === "BAN_RESOLUTION_COMPLETE")).toBe(false);
  unmount();
});

test("FAIL CLOSED: si los bans fallan no se inicia la Ronda 1; el reintento funciona con los mismos datos", async () => {
  const { engine, result, unmount } = await startDraft("radiant", 2, { banFailures: 1 }, [10]);
  expect(result.current.state.phase.type).toBe("ban_failed");
  expect(engine.requests.some((entry) => entry.url.endsWith("/auto-drive"))).toBe(false);
  expect(result.current.state.draftState).toBeNull();

  await act(async () => result.current.actions.retryBans());
  expect(result.current.state.phase).toMatchObject({ type: "blind_round", round: 1 });
  const resolves = engine.requests.filter((entry) => entry.url.endsWith("/resolve-bans"));
  expect(resolves).toHaveLength(2);
  expect(resolves[1]!.body).toEqual(resolves[0]!.body);
  unmount();
});

test("colisión: el héroe baneado y el asiento reabierto se muestran; el Player vuelve a elegir sólo ese asiento", async () => {
  const { result, unmount } = await startDraft("dire", 3, { collideRoundOnce: true });
  await lock(result, 1);
  await lock(result, 2); // last of round 1 -> the fake engine reports a collision on it
  expect(result.current.state.phase).toMatchObject({ type: "blind_round", round: 1, attemptSeats: [1], conflictBans: [2] });
  const phase = result.current.state.phase;
  expect(phase.type === "blind_round" && phase.notice).toContain("Colisión");
  expect(result.current.state.draftState?.banned).toContain(2);

  await lock(result, 6);
  expect(result.current.state.phase).toMatchObject({ type: "blind_round", round: 2 });
  unmount();
});

test("un pick rechazado por el motor se explica en pantalla y no ocupa el asiento", async () => {
  const { result, unmount } = await startDraft("radiant", 1);
  await lock(result, 30); // banned
  const phase = result.current.state.phase;
  expect(phase).toMatchObject({ type: "blind_round", pendingUserPicks: [] });
  expect(phase.type === "blind_round" && phase.notice).toContain("HERO_ALREADY_TAKEN");
  unmount();
});

test("al vencer el timer NO se elige nada por el Player: sólo empieza la penalización visual", async () => {
  const { engine, result, unmount } = await startDraft("radiant", 2);
  const before = commands(engine).length;
  act(() => useRandomDraftStore.getState().tickTimer(60_000));
  const phase = result.current.state.phase;
  expect(phase).toMatchObject({ type: "blind_round", timerRemainingMs: 0, pendingUserPicks: [] });
  expect(phase.type === "blind_round" && phase.penaltyElapsedMs).toBeGreaterThan(30_000);
  expect(commands(engine)).toHaveLength(before);
  unmount();
});

test("el Copilot humano sigue leyendo RecommendationSet/v2 (nunca /api/suggestions/preview)", async () => {
  const { engine, result, unmount } = await startDraft("radiant", 2);
  await waitFor(() => expect(engine.requests.some((entry) => entry.url.includes("/recommendations"))).toBe(true));
  expect(engine.requests.some((entry) => entry.url.endsWith("/api/suggestions/preview"))).toBe(false);
  expect(result.current.state.phase.type).toBe("blind_round");
  unmount();
});

// AP Ranked Roles V1 / Wave 2 -- Coach in the browser hook.
test("COACH: hay acción primaria al abrir la Ronda 1 (antes del primer pick) y se recomputa tras el primer pick propio, sin esperar al rival", async () => {
  const { engine, result, unmount } = await startDraft("radiant", 2);
  await waitFor(() => expect(result.current.state.coach).not.toBeNull());
  const first = result.current.state.coach!;
  expect(first.primaryAction.label.length).toBeGreaterThan(0);
  expect(first.meta.trigger).toBe("DRAFT_PICKS_STARTED");

  await lock(result, 1); // one of the two Round-1 seats: the round has NOT closed, no enemy hero is revealed
  await waitFor(() => expect(result.current.state.coach!.meta.revision).toBeGreaterThan(first.meta.revision));
  const second = result.current.state.coach!;
  expect(second.meta.trigger).toBe("OWN_PICK_CONFIRMED");
  expect(second.meta.basedOn.stateIdentity).not.toBe(first.meta.basedOn.stateIdentity);
  expect(result.current.state.draftState?.picks.dire).toEqual([]); // still nothing revealed
  expect(engine.requests.filter((entry) => entry.url.includes("/recommendations")).length).toBeGreaterThanOrEqual(2);
  unmount();
});

test("UX-02: cualquier slot controlado puede sellarse primero y sólo el restante se recalcula", async () => {
  const { engine, result, unmount } = await startDraft("radiant", 5);
  await waitFor(() => expect(result.current.state.recommendations?.decision.actionCount).toBe(2));

  await lock(result, 7, 1);

  expect(commands(engine)[0]).toEqual({ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1, heroId: 7 });
  expect(result.current.state.phase).toMatchObject({ type: "blind_round", lockedUserPicks: { 1: 7 } });
  await waitFor(() => expect(result.current.state.recommendations?.decision).toMatchObject({
    controlledSlots: [{ side: "radiant", slotIndex: 0 }],
    actionCount: 1,
  }));
  expect(engine.requests.filter((entry) => entry.url.includes("/recommendations")).length).toBeGreaterThanOrEqual(2);
  unmount();
});

test("COACH: el Player ignora el consejo (elige un héroe que no está en la shortlist): se acepta, sin aviso, y el Coach recomputa", async () => {
  const { result, unmount } = await startDraft("dire", 4);
  await waitFor(() => expect(result.current.state.coach).not.toBeNull());
  const suggested = result.current.state.coach!.shortlist.map((card) => card.heroId);
  const chosen = [1, 2, 3, 4].find((heroId) => !suggested.includes(heroId))!;
  const before = result.current.state.coach!.meta.revision;
  await lock(result, chosen);
  expect(result.current.state.draftState?.picks.dire).toContain(chosen);
  const phase = result.current.state.phase;
  expect(phase.type === "blind_round" && phase.notice).toBeNull();
  await waitFor(() => expect(result.current.state.coach!.meta.revision).toBeGreaterThan(before));
  unmount();
});

test("COACH: una respuesta más vieja (revision menor) nunca pisa a una más nueva", async () => {
  const { engine, result, unmount } = await startDraft("radiant", 2, { outOfOrderCoach: true });
  await waitFor(() => expect(result.current.state.coach).not.toBeNull());
  const held = result.current.state.coach!;
  expect(held.meta.revision).toBe(1);

  await lock(result, 1); // triggers a second recomputation, which the fake engine answers with revision 0
  await waitFor(() => expect(engine.requests.filter((entry) => entry.url.includes("/recommendations")).length).toBeGreaterThanOrEqual(2));
  await waitFor(() => expect(result.current.state.previewStatus).toBe("ready"));
  expect(result.current.state.coach).toEqual(held); // the late, older output was discarded
  unmount();
});
