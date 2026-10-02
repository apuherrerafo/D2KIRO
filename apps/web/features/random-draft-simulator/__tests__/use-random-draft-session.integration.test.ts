import "@/test-support/happy-dom";

import { act, render, renderHook, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import type { HeroId, TeamSide } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { SimulatorTeamRoster } from "../components/SimulatorTeamRoster";
import { useRandomDraftSession } from "../use-random-draft-session";
import { useRandomDraftStore } from "../store";

const HEROES = Array.from({ length: 40 }, (_, index) => ({ id: index + 1, localizedName: `Hero ${index + 1}`, roles: ["Carry"] }));
const ROUND_CAPACITY: Record<number, number> = { 1: 2, 2: 2, 3: 1 };
const ROUND_TIMER_MS: Record<number, number> = { 1: 25000, 2: 25000, 3: 20000 };
type Position = 1 | 2 | 3 | 4 | 5;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

interface FakeOptions {
  /** Resolve-bans answers 422 (retryable) this many times before succeeding. */
  banFailures?: number;
  /** The Player's LAST pick of round 1 collides with the bot: hero banned, that seat reopens. */
  collideRoundOnce?: boolean;
  /** With `collideRoundOnce`: the collision hits the Player's FIRST round-1 seal (slot 0) instead of the last. */
  collideFirstOwnPick?: boolean;
  /** Every binding is served with a malformed heroId -- the client must not trust any of it. */
  malformedBindingHeroId?: boolean;
  /** Every Coach response after the first arrives "late": it carries an OLDER revision than the one already held. */
  outOfOrderCoach?: boolean;
  /** The FIRST `?format=v4` response is held until `releaseHeld()` -- a slow response that lands after the Player acted. */
  holdFirstDecision?: boolean;
}

interface OwnBinding {
  round: 1 | 2 | 3;
  slotIndex: number;
  assignedPosition: Position;
  /** Joined server-side from kernel state on (round, slotIndex) -- mirrors the real snapshot projection. */
  heroId: HeroId;
}

/**
 * Browser-contract fixture for AP Ranked Roles V1 / PD-026/PD-027. The engine owns bans, the Enemy
 * Bot, the reveal, collisions AND the Own Team position binding; the browser only ever submits the
 * Player's own seal for an open round slot plus its chosen `assignedPosition` (sibling field).
 */
class FakeApProtocolEngine {
  readonly requests: { url: string; body: Record<string, unknown> }[] = [];
  private readonly sessionId = "protocol-browser-session";
  private side: TeamSide = "radiant";
  private banFailuresLeft: number;
  private collidePending: boolean;
  private readonly collideFirstOwnPick: boolean;
  private readonly malformedBindingHeroId: boolean;
  private bans: HeroId[] = [];
  private round: 1 | 2 | 3 | 0 | 4 = 0; // 0 = still in bans, 4 = complete
  private own: HeroId[] = [];
  private enemy: HeroId[] = [];
  private openSlots: number[] = [];
  private ownBindings: OwnBinding[] = [];
  private coachRevision = 0;
  private readonly outOfOrderCoach: boolean;
  private holdNextDecision: boolean;
  private release: (() => void) | null = null;
  /** Server truth for `canYield` (the real engine computes it; this fixture lets a test force it). */
  yieldable = false;

  constructor(options: FakeOptions = {}) {
    this.outOfOrderCoach = options.outOfOrderCoach ?? false;
    this.holdNextDecision = options.holdFirstDecision ?? false;
    this.banFailuresLeft = options.banFailures ?? 0;
    this.collidePending = options.collideRoundOnce ?? false;
    this.collideFirstOwnPick = options.collideFirstOwnPick ?? false;
    this.malformedBindingHeroId = options.malformedBindingHeroId ?? false;
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
    const boundPositions = new Set(this.ownBindings.map((binding) => binding.assignedPosition));
    const openPositions = ([1, 2, 3, 4, 5] as Position[]).filter((position) => !boundPositions.has(position));
    // PD-001: a generic round slot is positionless; positions are only a role inference on `roleImpact`.
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
            position: openPositions[index] ?? null,
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

  /** Hold the NEXT `?format=v4` response until `releaseHeld()` (same mechanism as `holdFirstDecision`). */
  holdNext(): void {
    this.holdNextDecision = true;
  }

  releaseHeld(): void {
    this.release?.();
    this.release = null;
  }

  // Product Semantics Recovery WP3: what the engine's `?format=v4` returns, derived from this fake's own
  // state -- actionable = unbound human positions, capacity = min(open own slots, actionable), one target.
  private currentDecisionBody(url: string) {
    this.coachRevision += 1;
    const boundPositions = new Set(this.ownBindings.map((binding) => binding.assignedPosition));
    const actionablePositions = ([1, 2, 3, 4, 5] as Position[]).filter((position) => !boundPositions.has(position));
    const roundCapacity = Math.min(this.openSlots.length, actionablePositions.length);
    const requested = Number(new URL(url, "http://fixture.local").searchParams.get("target"));
    // PSR-002: the recommendation (default = lowest eligible) never follows `target`; only the viewed position does.
    const targetPosition = actionablePositions[0];
    const viewedPosition = actionablePositions.includes(requested as Position) ? (requested as Position) : targetPosition;
    const decision = roundCapacity === 0 || targetPosition === undefined || viewedPosition === undefined
      ? { kind: "NO_HUMAN_ACTION", actionablePositions: [], roundCapacity: 0, reason: this.round === 4 ? "DRAFT_COMPLETE" : "ROUND_COMPLETE" }
      : {
          kind: "ACTIONABLE",
          actionablePositions,
          roundCapacity,
          targetPosition,
          targetBasis: "DETERMINISTIC_DEFAULT",
          targetRationale: "fixture",
          viewedPosition,
          candidates: {
            state: "RANKED",
            targetPosition: viewedPosition,
            cards: [{ heroId: 10 + this.own.length, position: viewedPosition, rank: 1, score: 10, confidence: "media", roleStatus: "LIKELY", badges: [], rationale: "fixture", isFromPool: false }],
            degradations: [],
          },
          personalPoolApplied: false,
        };
    return {
      output: {
        schema: "recommendation-output/v4",
        sessionId: this.sessionId,
        decision,
        roleBeliefs: { own: [], enemy: [] },
        meta: {
          round: this.round >= 1 && this.round <= 3 ? this.round : null,
          phase: this.phaseName(),
          decisionContext: this.own.length === 0 ? "team_opening" : "blind_second_pick",
          trigger: this.own.length === 0 ? "DRAFT_PICKS_STARTED" : "OWN_PICK_CONFIRMED",
          revision: this.coachRevision,
          basedOn: { stateIdentity: `state-${this.own.length}-${this.enemy.length}`, evidenceVersion: "v" },
        },
      },
    };
  }

  // Team Coach Board: what `GET .../team-recommendations` returns, derived from this fake's own state --
  // bound positions are FILLED, every other human position RANKED against the same snapshot identity.
  private teamBoardBody() {
    const stateIdentity = `state-${this.own.length}-${this.enemy.length}`;
    const bound = new Map(this.ownBindings.map((binding) => [binding.assignedPosition, binding.heroId]));
    const roundOpen = this.openSlots.length > 0;
    const positions = ([1, 2, 3, 4, 5] as Position[]).map((position) => {
      const filledHeroId = bound.get(position) ?? null;
      const top = filledHeroId !== null || !roundOpen ? [] : [0, 1, 2].map((offset) => ({ heroId: 100 + position * 10 + offset, rank: offset + 1, score: 10 - offset, reasons: ["fixture"], isPrimary: offset === 0 }));
      return { position, eligibleNow: filledHeroId === null && roundOpen, alreadyFilled: filledHeroId !== null, filledHeroId, state: filledHeroId !== null ? "FILLED" : roundOpen ? "RANKED" : "WAITING", primaryHeroId: top[0]?.heroId ?? null, top, stateIdentity, note: null };
    });
    const actionable = positions.filter((column) => column.eligibleNow).map((column) => column.position);
    return {
      schema: "team-coach-board/v1",
      sessionId: this.sessionId,
      stateIdentity,
      currentDecision: { recommendedPosition: actionable[0] ?? null, recommendedHeroId: actionable[0] === undefined ? null : 100 + actionable[0] * 10, targetBasis: actionable[0] === undefined ? null : "DETERMINISTIC_DEFAULT", reason: "fixture", actionablePositions: actionable, roundCapacity: Math.min(this.openSlots.length, actionable.length) },
      positions,
      unboundOwnHeroIds: [],
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
      ownAssignedPositions: this.malformedBindingHeroId ? this.ownBindings.map((binding) => ({ ...binding, heroId: 0 })) : this.ownBindings,
      canYield: this.yieldable,
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
    if (url.includes("/team-recommendations")) return json(this.teamBoardBody());
    if (url.includes("/recommendations") && url.includes("format=v4")) {
      const body = this.currentDecisionBody(url);
      if (this.holdNextDecision) {
        this.holdNextDecision = false;
        await new Promise<void>((resolve) => {
          this.release = resolve;
        });
      }
      return json(body);
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
    if (url.endsWith("/yield")) {
      this.closeRound({ slotIndex: 0, heroId: -1 });
      return json(this.snapshot());
    }
    if (url.endsWith("/command")) {
      const command = body.command as { type: string; side: TeamSide; slotIndex: number; heroId: HeroId };
      if (command.type !== "SUBMIT_SEALED_SELECTION") return json({ error: "action_forbidden" }, 403);
      if (this.bans.includes(command.heroId) || this.own.includes(command.heroId) || this.enemy.includes(command.heroId)) {
        return json({ accepted: false, rejected: "HERO_ALREADY_TAKEN", ...this.snapshot() }, 202);
      }
      this.own.push(command.heroId);
      this.openSlots = this.openSlots.filter((slotIndex) => slotIndex !== command.slotIndex);
      const assignedPosition = body.assignedPosition as Position | undefined;
      if (assignedPosition !== undefined) {
        this.ownBindings = [...this.ownBindings, { round: this.round as 1 | 2 | 3, slotIndex: command.slotIndex, assignedPosition, heroId: command.heroId }];
      }
      if (this.openSlots.length === 0) this.closeRound(command);
      return json({ accepted: true, ...this.snapshot() }, 202);
    }
    throw new Error(`fetch not mocked: ${url}`);
  };

  private closeRound(last: { slotIndex: number; heroId: HeroId }): void {
    const round = this.round as 1 | 2 | 3;
    if (this.collidePending && round === 1) {
      this.collidePending = false;
      const first = this.ownBindings.find((binding) => binding.round === round);
      const collided = this.collideFirstOwnPick && first ? { slotIndex: first.slotIndex, heroId: first.heroId } : last;
      this.bans = [...this.bans, collided.heroId];
      // Like the kernel: the survivor stays (confirmed first), the collided hero leaves own picks.
      this.own = this.own.filter((heroId) => heroId !== collided.heroId);
      this.openSlots = [collided.slotIndex];
      // PD-026/PD-027 COLLISION REOPEN: the reopened slot's position binding is pruned.
      this.ownBindings = this.ownBindings.filter((binding) => !(binding.round === round && binding.slotIndex === collided.slotIndex));
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

async function lock(result: { current: ReturnType<typeof useRandomDraftSession> }, heroId: HeroId, position?: Position): Promise<void> {
  await act(async () => result.current.actions.lockPick(heroId, position));
}

function commands(engine: FakeApProtocolEngine) {
  return engine.requests
    .filter((entry) => entry.url.endsWith("/command"))
    .map((entry) => entry.body.command as { type: string; side: string; slotIndex: number; heroId: number });
}

for (const side of ["radiant", "dire"] as TeamSide[]) {
  test(`${side}: BANS -> R1 -> R2 -> R3 -> COMPLETE con los 5 picks del Player en el navegador`, async () => {
    const { engine, result, unmount } = await startDraft(side, 4, {}, [10, 11]);
    expect(result.current.state.phase).toMatchObject({ type: "blind_round", round: 1, timerDurationMs: 25000, attemptPositions: [1, 2, 3, 4, 5] });

    // PD-026/PD-027: position != pick chronology -- the order below is deliberately NOT ascending.
    const picks: { heroId: HeroId; position: Position }[] = [
      { heroId: 1, position: 3 },
      { heroId: 2, position: 1 },
      { heroId: 3, position: 5 },
      { heroId: 4, position: 2 },
      { heroId: 5, position: 4 },
    ];
    for (const pick of picks) await lock(result, pick.heroId, pick.position);

    expect(result.current.state.phase.type).toBe("complete");
    expect(result.current.state.draftState?.picks[side]).toEqual([1, 2, 3, 4, 5]);
    const enemy = side === "radiant" ? "dire" : "radiant";
    expect(result.current.state.draftState?.picks[enemy]).toHaveLength(5);
    expect(result.current.state.draftState?.banned).toEqual([30, 31, 32]);
    if (result.current.state.phase.type === "complete") expect(result.current.state.phase.summary.picksByRound.map((round) => round.userPicks.length)).toEqual([2, 2, 1]);
    expect(result.current.state.ownAssignedPositions.map((binding) => binding.assignedPosition).sort()).toEqual([1, 2, 3, 4, 5]);

    // Exactly five own seals, all for the Player's side, slots 0,1 / 0,1 / 0 (round-scoped, FIFO).
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

test("la sesión transporta el lado, la posición personal, la seed y las 5 posiciones controladas (nada de Solo Mid)", async () => {
  const { engine, unmount } = await startDraft("dire", 5);
  const create = engine.requests.find((entry) => entry.url.endsWith("/api/session/protocol"))!;
  expect(create.body).toMatchObject({
    localSide: "dire",
    humanPosition: 5,
    simulatorSeed: "ABCDEFGH",
    // PD-026/PD-027: controlledSlots is structural/inert for AP -- Own Team truth is controlledPositions.
    partyContext: { partySize: 5, side: "dire", controlledSlots: [] },
    controlledPositions: [1, 2, 3, 4, 5],
  });
  expect("humanRosterSlot" in create.body).toBe(false);
  unmount();
});

test("la sesión transporta Solo (partySize: 1) controlando únicamente la posición elegida", async () => {
  const { engine, unmount } = await startDraft("radiant", 1, {}, [], 1);
  const create = engine.requests.find((entry) => entry.url.endsWith("/api/session/protocol"))!;
  expect(create.body).toMatchObject({
    localSide: "radiant",
    humanPosition: 1,
    simulatorSeed: "ABCDEFGH",
    partyContext: { partySize: 1, side: "radiant", controlledSlots: [] },
    controlledPositions: [1],
  });
  unmount();
});

test("la sesión transporta Party 2 y Party 3 con las posiciones asignadas exactas (nunca un asiento)", async () => {
  const party2 = await startDraft("dire", 2, {}, [], 2, [2, 5]);
  const req2 = party2.engine.requests.find((entry) => entry.url.endsWith("/api/session/protocol"))!;
  expect(req2.body.controlledPositions).toEqual([2, 5]);
  expect((req2.body.partyContext as { controlledSlots: unknown[] }).controlledSlots).toEqual([]);
  party2.unmount();

  const party3 = await startDraft("radiant", 5, {}, [], 3, [1, 3, 5]);
  const req3 = party3.engine.requests.find((entry) => entry.url.endsWith("/api/session/protocol"))!;
  expect(req3.body.controlledPositions).toEqual([1, 3, 5]);
  expect((req3.body.partyContext as { controlledSlots: unknown[] }).controlledSlots).toEqual([]);
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

test("colisión: el héroe baneado se muestra y la posición reabierta vuelve a estar disponible", async () => {
  const { result, unmount } = await startDraft("dire", 3, { collideRoundOnce: true });
  await lock(result, 1, 1);
  await lock(result, 2, 2); // last of round 1 -> the fake engine reports a collision on it, pruning Pos2's binding
  expect(result.current.state.phase).toMatchObject({ type: "blind_round", round: 1, conflictBans: [2] });
  const collided = result.current.state.phase;
  expect(collided.type === "blind_round" && collided.attemptPositions).toContain(2);
  expect(collided.type === "blind_round" && collided.attemptPositions).not.toContain(1); // Pos1's binding survived the collision
  expect(collided.type === "blind_round" && collided.notice).toContain("Colisión");
  expect(result.current.state.draftState?.banned).toContain(2);

  await lock(result, 6, 2);
  expect(result.current.state.phase).toMatchObject({ type: "blind_round", round: 2 });
  unmount();
});

const ROSTER_CATALOG = new Map<number, HeroMeta>(
  HEROES.map((hero) => [hero.id, { id: hero.id, name: `npc_dota_hero_${hero.id}`, localizedName: hero.localizedName, imgUrl: "", primaryAttr: "str", attackType: "Melee", roles: hero.roles }]),
);

function renderOwnRoster(state: ReturnType<typeof useRandomDraftSession>["state"]) {
  const view = render(
    createElement(SimulatorTeamRoster, {
      draftState: state.draftState!,
      config: state.config!,
      phase: state.phase,
      heroCatalog: ROSTER_CATALOG,
      ownAssignedPositions: state.ownAssignedPositions,
    }),
  );
  return { seat: (position: Position) => within(view.getByTestId(`own-roster-pos-${position}`)), unmountRoster: view.unmount };
}

const LICH = 5;
const TINKER = 7;
const REPICK = 1;

// RELEASE BLOCKER (collision survivor), end to end through the hook: Lich sealed for Pos5, Tinker for
// Pos2, Tinker collides. Both slot orderings. The roster renders straight from the hook state.
test.each([
  ["sobreviviente slot 0 / colisión slot 1", false, [{ heroId: LICH, position: 5 }, { heroId: TINKER, position: 2 }], 0, 1],
  ["sobreviviente slot 1 / colisión slot 0", true, [{ heroId: TINKER, position: 2 }, { heroId: LICH, position: 5 }], 1, 0],
] as const)("colisión (%s): Pos5 conserva a Lich y no es elegible; sólo Pos2 reabre; la ronda cerrada no intercambia héroes", async (_label, collideFirstOwnPick, seals, survivorSlot, collisionSlot) => {
  const { engine, result, unmount } = await startDraft("radiant", 2, { collideRoundOnce: true, collideFirstOwnPick });
  for (const seal of seals) await lock(result, seal.heroId, seal.position);

  // Reopened collision state.
  const reopened = result.current.state.phase;
  expect(reopened).toMatchObject({ type: "blind_round", round: 1, conflictBans: [TINKER] });
  expect(reopened.type === "blind_round" && reopened.pendingPositions).toContain(2);
  expect(reopened.type === "blind_round" && reopened.pendingPositions).not.toContain(5);
  expect(reopened.type === "blind_round" && reopened.attemptPositions).not.toContain(5);
  expect(result.current.state.ownAssignedPositions).toEqual([{ round: 1, slotIndex: survivorSlot, assignedPosition: 5, heroId: LICH }]);
  expect(result.current.state.draftState?.banned).toContain(TINKER);
  expect(result.current.state.draftState?.picks.radiant).toEqual([LICH]);
  const reopenedRoster = renderOwnRoster(result.current.state);
  expect(reopenedRoster.seat(5).getByText("Hero 5")).toBeDefined();
  expect(reopenedRoster.seat(2).getByText("Sin elegir")).toBeDefined();
  expect(reopenedRoster.seat(2).queryByText("Hero 7")).toBeNull();
  reopenedRoster.unmountRoster();

  // Pos5 cannot be re-chosen: the hook refuses it without ever reaching the engine.
  const before = commands(engine).length;
  await lock(result, 3, 5);
  expect(commands(engine)).toHaveLength(before);

  // Re-pick into the reopened slot closes the round.
  await lock(result, REPICK, 2);
  expect(result.current.state.phase).toMatchObject({ type: "blind_round", round: 2 });
  expect(commands(engine).map((command) => command.slotIndex)).toEqual([0, 1, collisionSlot]);
  const closedRoster = renderOwnRoster(result.current.state);
  expect(closedRoster.seat(5).getByText("Hero 5")).toBeDefined();
  expect(closedRoster.seat(2).getByText("Hero 1")).toBeDefined();
  closedRoster.unmountRoster();
  unmount();
});

test("una binding con heroId malformado nunca se vuelve un hecho del roster propio", async () => {
  const { result, unmount } = await startDraft("radiant", 2, { malformedBindingHeroId: true });
  await lock(result, LICH, 5);
  expect(result.current.state.ownAssignedPositions).toEqual([]);
  const roster = renderOwnRoster(result.current.state);
  expect(roster.seat(5).getByText("Sin elegir")).toBeDefined();
  roster.unmountRoster();
  unmount();
});

test("un pick rechazado por el motor se explica en pantalla y no ocupa la posición", async () => {
  const { result, unmount } = await startDraft("radiant", 1);
  await lock(result, 30, 1); // banned
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

// Product Semantics Recovery WP3 -- the Simulator's Coach in the browser hook reads ONLY the V4
// CurrentHumanDecision; V3 (`coach`) and V2 (`recommendations`) are never populated next to it.
function actionable(result: { current: ReturnType<typeof useRandomDraftSession> }) {
  const decision = result.current.state.currentDecision?.decision;
  if (!decision || decision.kind !== "ACTIONABLE") throw new Error("expected an ACTIONABLE current decision");
  return decision;
}

test("COACH: hay decisión actual al abrir la Ronda 1 (antes del primer pick) y se recomputa tras el primer pick propio, sin esperar al rival", async () => {
  const { engine, result, unmount } = await startDraft("radiant", 2);
  await waitFor(() => expect(result.current.state.currentDecision).not.toBeNull());
  const first = result.current.state.currentDecision!;
  expect(first.meta.trigger).toBe("DRAFT_PICKS_STARTED");
  expect(actionable(result).actionablePositions).toEqual([1, 2, 3, 4, 5]);
  expect(actionable(result).roundCapacity).toBe(2);
  expect(engine.requests.some((entry) => entry.url.includes("format=v4"))).toBe(true);
  expect(engine.requests.some((entry) => entry.url.includes("format=v3"))).toBe(false);
  expect(result.current.state.coach).toBeNull(); // COHERENCE-010: no legacy decision next to V4
  expect(result.current.state.recommendations).toBeNull();

  await lock(result, 1, 1); // one of the two Round-1 seats: the round has NOT closed, no enemy hero is revealed
  await waitFor(() => expect(result.current.state.currentDecision?.meta.revision ?? 0).toBeGreaterThan(first.meta.revision));
  const second = result.current.state.currentDecision!;
  expect(second.meta.trigger).toBe("OWN_PICK_CONFIRMED");
  expect(second.meta.basedOn.stateIdentity).not.toBe(first.meta.basedOn.stateIdentity);
  expect(actionable(result).actionablePositions).toEqual([2, 3, 4, 5]);
  expect(result.current.state.draftState?.picks.dire).toEqual([]); // still nothing revealed
  unmount();
});

test("UX-02: cualquier posición controlada puede sellarse primero y sólo el resto se recalcula", async () => {
  const { engine, result, unmount } = await startDraft("radiant", 5);
  await waitFor(() => expect(actionable(result).roundCapacity).toBe(2));

  await lock(result, 7, 2);

  expect(commands(engine)[0]).toEqual({ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 7 });
  expect(result.current.state.phase).toMatchObject({ type: "blind_round", lockedUserPicks: { 2: 7 } });
  await waitFor(() => expect(result.current.state.currentDecision?.decision.roundCapacity).toBe(1));
  expect(actionable(result).actionablePositions).toEqual([1, 3, 4, 5]);
  expect(engine.requests.filter((entry) => entry.url.includes("/recommendations")).length).toBeGreaterThanOrEqual(2);
  unmount();
});

test("COACH: el Player ignora el consejo (elige un héroe fuera de los candidatos): se acepta, sin aviso, y la decisión se recalcula", async () => {
  const { result, unmount } = await startDraft("dire", 4);
  await waitFor(() => expect(result.current.state.currentDecision).not.toBeNull());
  const decision = actionable(result);
  const suggested = decision.candidates.state === "RANKED" ? decision.candidates.cards.map((card) => card.heroId) : [];
  const chosen = [1, 2, 3, 4].find((heroId) => !suggested.includes(heroId))!;
  const before = result.current.state.currentDecision!.meta.revision;
  await lock(result, chosen, 4);
  expect(result.current.state.draftState?.picks.dire).toContain(chosen);
  const phase = result.current.state.phase;
  expect(phase.type === "blind_round" && phase.notice).toBeNull();
  await waitFor(() => expect(result.current.state.currentDecision?.meta.revision ?? 0).toBeGreaterThan(before));
  unmount();
});

test("COHERENCE-014: tras un pick la decisión anterior desaparece al instante y una respuesta lenta previa al pick nunca reaparece", async () => {
  const { engine, result, unmount } = await startDraft("radiant", 2, { holdFirstDecision: true });
  // The first V4 response (pre-pick state: 5 actionable positions) is still in flight.
  await waitFor(() => expect(engine.requests.some((entry) => entry.url.includes("format=v4"))).toBe(true));
  expect(result.current.state.currentDecision).toBeNull();

  await lock(result, 1, 1);
  await waitFor(() => expect(result.current.state.currentDecision).not.toBeNull());
  expect(actionable(result).actionablePositions).toEqual([2, 3, 4, 5]);

  await act(async () => engine.releaseHeld()); // the slow, pre-pick response finally lands
  await waitFor(() => expect(result.current.state.previewStatus).toBe("ready"));
  expect(actionable(result).actionablePositions).toEqual([2, 3, 4, 5]); // never the stale [1..5] decision
  expect(actionable(result).actionablePositions).not.toContain(1);
  unmount();
});

// P1 (Greptile PR #9) -- clearing the decision must invalidate requests already in flight. Both tests
// hold the LAST round's V4 request (no later attempt exists to supersede it), run the transition that
// clears the decision, then let the old response land. The old pre-action decision must never return.
async function reachLastPickWithHeldDecision() {
  const { engine, result, unmount } = await startDraft("radiant", 2);
  for (const [heroId, position] of [[1, 1], [2, 2], [3, 3]] as [HeroId, Position][]) await lock(result, heroId, position);
  engine.yieldable = true; // round 3 opens advertising Yield (server truth)
  engine.holdNext();
  await lock(result, 4, 4); // closes round 2 -> round 3 opens -> its V4 request is now held in flight
  await waitFor(() => expect(result.current.state.phase).toMatchObject({ type: "blind_round", round: 3 }));
  await waitFor(() => expect(engine.requests.filter((entry) => entry.url.includes("format=v4")).length).toBeGreaterThanOrEqual(5));
  expect(result.current.state.currentDecision).toBeNull(); // still pending
  return { engine, result, unmount };
}

test("P1: el pick final del draft invalida la petición V4 en vuelo -- su respuesta tardía nunca reaparece", async () => {
  const { engine, result, unmount } = await reachLastPickWithHeldDecision();
  await lock(result, 5, 5);
  expect(result.current.state.phase.type).toBe("complete");
  expect(result.current.state.currentDecision).toBeNull();

  await act(async () => engine.releaseHeld()); // the pre-pick response (target 5, cards) finally lands
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  expect(result.current.state.currentDecision).toBeNull();
  unmount();
});

test("P1: un Yield exitoso invalida la petición V4 en vuelo -- su respuesta tardía nunca reaparece", async () => {
  const { engine, result, unmount } = await reachLastPickWithHeldDecision();
  await act(async () => result.current.actions.yieldRound());
  expect(result.current.state.phase.type).toBe("complete");
  expect(result.current.state.currentDecision).toBeNull();

  await act(async () => engine.releaseHeld());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  expect(result.current.state.currentDecision).toBeNull();
  unmount();
});

test("navegación del selector (PSR-002): pedir otra posición retira la decisión vigente; la posición VISTA cambia y la recomendación del Coach no", async () => {
  const { engine, result, unmount } = await startDraft("radiant", 2);
  await waitFor(() => expect(result.current.state.currentDecision).not.toBeNull());
  const recommended = actionable(result).targetPosition;
  act(() => result.current.actions.selectTarget(4));
  expect(result.current.state.currentDecision).toBeNull(); // no stale cards while the engine recomputes
  expect(result.current.state.requestedTarget).toBe(4);
  await waitFor(() => expect(result.current.state.currentDecision).not.toBeNull());
  expect(actionable(result).viewedPosition).toBe(4);
  expect(actionable(result).targetPosition).toBe(recommended);
  expect(actionable(result).candidates.targetPosition).toBe(4);
  expect(engine.requests.some((entry) => entry.url.includes("format=v4&target=4"))).toBe(true);

  act(() => result.current.actions.selectTarget(5));
  await waitFor(() => expect(actionable(result).viewedPosition).toBe(5));
  expect(actionable(result).targetPosition).toBe(recommended);
  expect(actionable(result).candidates.targetPosition).toBe(5); // no stale Pos4 cards

  await lock(result, 9, 4);
  expect(result.current.state.requestedTarget).toBeNull(); // a pick resets navigation: the next decision is recomputed
  unmount();
});

test("Team Coach Board: aparece al abrir la ronda, un pick de una posición NO recomendada es legal y el board se recalcula", async () => {
  const { engine, result, unmount } = await startDraft("radiant", 2);
  await waitFor(() => expect(result.current.state.teamBoard?.stateIdentity).toBe("state-0-0"));
  const before = result.current.state.teamBoard!;
  expect(before.positions).toHaveLength(5);
  expect(before.currentDecision.recommendedPosition).toBe(1);
  const boardRequests = () => engine.requests.filter((entry) => entry.url.includes("/team-recommendations")).length;
  const requestsBefore = boardRequests();

  // Pos5 even though the board recommends Pos1: the SAME protocol selection, with Pos5 as assignedPosition.
  await lock(result, 155, 5);
  expect(commands(engine).at(-1)).toEqual({ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 155 });
  expect(engine.requests.filter((entry) => entry.url.endsWith("/command")).at(-1)!.body.assignedPosition).toBe(5);
  await waitFor(() => expect(result.current.state.teamBoard?.stateIdentity).toBe("state-1-0"));
  expect(boardRequests()).toBeGreaterThan(requestsBefore);
  const after = result.current.state.teamBoard!;
  expect(after.positions.find((column) => column.position === 5)).toMatchObject({ state: "FILLED", filledHeroId: 155 });
  expect(after.currentDecision.actionablePositions).toEqual([1, 2, 3, 4]);
  unmount();
});
