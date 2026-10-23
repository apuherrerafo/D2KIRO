import "@/test-support/happy-dom";

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { HeroId, TeamSide } from "@/features/draft/types";
import { useRandomDraftStore } from "@/features/random-draft-simulator/store";
import { useRandomDraftSession } from "@/features/random-draft-simulator/use-random-draft-session";
import { flightRecorder } from "../recorder";
import type { FlightEntry } from "../types";

// El Flight Recorder contra el hook REAL de la sesión y un motor falso: una partida Party 5 completa. El motor falso
// guarda los picks enemigos de cada ronda como HIDDEN hasta que la ronda cierra, y cambia su Top 5 con cada pick propio.

type Position = 1 | 2 | 3 | 4 | 5;
const ROUND_CAPACITY: Record<number, number> = { 1: 2, 2: 2, 3: 1 };
const ENEMY_SECRET: Record<number, HeroId[]> = { 1: [200, 201], 2: [202, 203], 3: [204] };
const MINTED_VALUE = "sentinel-value-0123456789"; // what the fake engine mints for the WS handshake; must never reach the recording
const FULL_SESSION_ID = "protocol-browser-session-0123456789";
const HEROES = Array.from({ length: 40 }, (_, index) => ({ id: index + 1, localizedName: `Hero ${index + 1}`, roles: ["Carry"] }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

class FakeEngine {
  readonly urls: string[] = [];
  private bans: HeroId[] = [];
  private round: 0 | 1 | 2 | 3 | 4 = 0;
  private own: HeroId[] = [];
  private revealed: HeroId[] = [];
  private openSlots: number[] = [];
  private bindings: { round: 1 | 2 | 3; slotIndex: number; assignedPosition: Position; heroId: HeroId }[] = [];
  private revision = 0;

  private stateIdentity(): string {
    return `state-${this.own.length}-${this.revealed.length}`;
  }

  private snapshot(extra: Record<string, unknown> = {}) {
    const pickRound = this.round >= 1 && this.round <= 3 ? this.round : null;
    const hidden = pickRound !== null && this.openSlots.length > 0 ? ENEMY_SECRET[pickRound]!.map(() => ({ visibility: "HIDDEN" })) : [];
    return {
      view: {
        schema: "draft-protocol-perspective/v1",
        sessionId: FULL_SESSION_ID,
        status: this.round === 4 ? "COMPLETE" : "ACTIVE",
        viewerSide: "radiant" as TeamSide,
        bannedHeroes: this.bans,
        ownPicks: this.own.map((heroId) => ({ visibility: "KNOWN", heroId })),
        enemyPicks: [...this.revealed.map((heroId) => ({ visibility: "REVEALED", heroId })), ...hidden],
        rankedAp: { phase: this.round === 0 ? "BAN_RESOLUTION" : this.round === 4 ? "COMPLETE" : `PICK_ROUND_${this.round}`, banResolutionComplete: this.round > 0 },
        captainsMode: null,
      },
      legalActions: this.openSlots.map((slotIndex) => ({ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex })),
      simulator: pickRound === null ? null : { round: pickRound, durationMs: 25000, remainingMs: 25000, penaltyActive: false, pendingSeats: [], goldPenaltyBySlot: [0, 0, 0, 0, 0], penaltyRatePerSecond: 2 },
      ownAssignedPositions: this.bindings,
      canYield: false,
      ...extra,
    };
  }

  private boardBody() {
    const stateIdentity = this.stateIdentity();
    const bound = new Map(this.bindings.map((binding) => [binding.assignedPosition, binding.heroId]));
    const roundOpen = this.openSlots.length > 0;
    const positions = ([1, 2, 3, 4, 5] as Position[]).map((position) => {
      const filledHeroId = bound.get(position) ?? null;
      const top = filledHeroId !== null || !roundOpen ? [] : [0, 1, 2, 3, 4].map((offset) => ({ heroId: 100 + position * 10 + offset + this.own.length, rank: offset + 1, score: 50 - offset - this.own.length, reasons: ["fixture"], isPrimary: offset === 0 }));
      return { position, eligibleNow: filledHeroId === null && roundOpen, alreadyFilled: filledHeroId !== null, filledHeroId, state: filledHeroId !== null ? "FILLED" : roundOpen ? "RANKED" : "WAITING", primaryHeroId: top[0]?.heroId ?? null, top, stateIdentity, note: null };
    });
    const actionable = positions.filter((column) => column.eligibleNow).map((column) => column.position);
    return {
      schema: "team-coach-board/v1",
      sessionId: FULL_SESSION_ID,
      stateIdentity,
      currentDecision: { recommendedPosition: actionable[0] ?? null, recommendedHeroId: actionable[0] === undefined ? null : 100 + actionable[0] * 10, targetBasis: actionable[0] === undefined ? null : "DETERMINISTIC_DEFAULT", reason: "fixture", actionablePositions: actionable, roundCapacity: Math.min(this.openSlots.length, actionable.length) },
      positions,
      unboundOwnHeroIds: [],
    };
  }

  private decisionBody() {
    this.revision += 1;
    const bound = new Set(this.bindings.map((binding) => binding.assignedPosition));
    const actionablePositions = ([1, 2, 3, 4, 5] as Position[]).filter((position) => !bound.has(position));
    const roundCapacity = Math.min(this.openSlots.length, actionablePositions.length);
    const targetPosition = actionablePositions[0];
    const decision = roundCapacity === 0 || targetPosition === undefined
      ? { kind: "NO_HUMAN_ACTION", actionablePositions: [], roundCapacity: 0, reason: this.round === 4 ? "DRAFT_COMPLETE" : "ROUND_COMPLETE" }
      : {
          kind: "ACTIONABLE",
          actionablePositions,
          roundCapacity,
          targetPosition,
          targetBasis: "DETERMINISTIC_DEFAULT",
          targetRationale: "fixture",
          viewedPosition: targetPosition,
          candidates: { state: "RANKED", targetPosition, cards: [{ heroId: 10 + this.own.length, position: targetPosition, rank: 1, score: 10, confidence: "media", roleStatus: "LIKELY", badges: [], rationale: "fixture", isFromPool: false, poolMembership: "NO_POOL", basis: { kind: "curated", sources: [{ kind: "curated", sampleSize: null }] }, risks: [] }], degradations: [] },
          personalPoolApplied: false,
          poolState: "NONE",
          poolOwner: null,
        };
    return {
      output: {
        schema: "recommendation-output/v4",
        sessionId: FULL_SESSION_ID,
        decision,
        roleBeliefs: { own: [], enemy: [] },
        meta: { round: this.round >= 1 && this.round <= 3 ? this.round : null, phase: null, decisionContext: "team_opening", trigger: this.own.length === 0 ? "DRAFT_PICKS_STARTED" : "OWN_PICK_CONFIRMED", revision: this.revision, basedOn: { stateIdentity: this.stateIdentity(), evidenceVersion: "v" } },
      },
    };
  }

  private closeRound(): void {
    const round = this.round as 1 | 2 | 3;
    this.revealed.push(...ENEMY_SECRET[round]!);
    this.round = (round + 1) as 2 | 3 | 4;
    this.openSlots = [];
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    this.urls.push(url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (url.endsWith("/api/heroes")) return json(HEROES);
    if (url.endsWith("/api/meta/hero-stats")) return json({ patchStats: {}, heroPositions: {} });
    if (url.endsWith("/api/auth/engine-token")) return json({ token: MINTED_VALUE });
    if (url.endsWith("/api/session/protocol")) return json({ sessionId: FULL_SESSION_ID, ruleset: {}, status: "ACTIVE" }, 201);
    if (url.endsWith("/api/team-groups")) return json([]);
    if (url.endsWith("/api/hero-pool")) return json([{ hero: 5, source: "manual", personalWinrate: 0.61, personalGames: 99, updatedAt: "2026-10-01" }, { hero: 6, source: "manual", personalWinrate: null, personalGames: 0, updatedAt: "2026-10-01" }]);
    if (url.endsWith("/resolve-bans")) {
      this.bans = [30, 31, 32];
      this.round = 1;
      return json({ resolvedBans: this.bans, ...this.snapshot() });
    }
    if (url.includes("/team-recommendations")) return json(this.boardBody());
    if (url.includes("format=v4")) return json(this.decisionBody());
    if (url.endsWith("/auto-drive")) {
      if (this.round === 4) return json({ ...this.snapshot(), stopReason: "complete", completedRound: null });
      if (this.openSlots.length === 0) this.openSlots = Array.from({ length: ROUND_CAPACITY[this.round]! }, (_, index) => index);
      return json({ ...this.snapshot(), stopReason: "human_input", completedRound: null });
    }
    if (url.endsWith("/command")) {
      const command = body.command as { slotIndex: number; heroId: HeroId };
      this.own.push(command.heroId);
      this.openSlots = this.openSlots.filter((slotIndex) => slotIndex !== command.slotIndex);
      this.bindings = [...this.bindings, { round: this.round as 1 | 2 | 3, slotIndex: command.slotIndex, assignedPosition: body.assignedPosition as Position, heroId: command.heroId }];
      if (this.openSlots.length === 0) this.closeRound();
      return json({ accepted: true, ...this.snapshot() }, 202);
    }
    throw new Error(`fetch not mocked: ${url}`);
  };
}

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  flightRecorder.disarm();
  useRandomDraftStore.getState().resetSession();
});

const PICKS: { heroId: HeroId; position: Position }[] = [
  { heroId: 1, position: 3 },
  { heroId: 2, position: 1 },
  { heroId: 3, position: 5 },
  { heroId: 4, position: 2 },
  { heroId: 5, position: 4 },
];

async function playFullParty5Draft() {
  const engine = new FakeEngine();
  globalThis.fetch = engine.fetch as typeof fetch;
  const hook = renderHook(() => useRandomDraftSession({ fetchImpl: engine.fetch as typeof fetch, revealPauseMs: 0 }));
  await act(async () => hook.result.current.startDraft({ draftSeed: "ABCDEFGH", userSide: "radiant", playerPosition: 2, personalBanList: [], partySize: 5 }));
  await waitFor(() => expect(hook.result.current.state.teamBoard).not.toBeNull());
  for (const pick of PICKS) {
    await act(async () => hook.result.current.actions.lockPick(pick.heroId, pick.position));
  }
  await waitFor(() => expect(hook.result.current.state.phase.type).toBe("complete"));
  return { engine, ...hook };
}

function kinds(entries: readonly FlightEntry[], kind: FlightEntry["kind"]): FlightEntry[] {
  return entries.filter((entry) => entry.kind === kind);
}

test("una partida Party 5 completa queda grabada: semilla, config, pools, transiciones, picks y respuestas del motor", async () => {
  flightRecorder.arm();
  const { result, unmount } = await playFullParty5Draft();
  await waitFor(() => expect(kinds(flightRecorder.entries(), "pools_effective")).toHaveLength(1));
  const entries = flightRecorder.entries();

  const start = kinds(entries, "session_start")[0]!;
  expect(start.data.config).toMatchObject({ draftSeed: "ABCDEFGH", userSide: "radiant", playerPosition: 2, partySize: 5, mode: "simulation" });

  const pools = kinds(entries, "pools_effective")[0]!.data.pools as { position: number; source: string; heroIds: number[] }[];
  expect(pools.find((pool) => pool.position === 2)).toEqual({ position: 2, source: "personal_pool", heroIds: [5, 6] });

  const sources = kinds(entries, "transition").map((entry) => entry.data.source);
  for (const expected of ["bans_resolved", "enemy_auto_drive", "own_pick_submitted", "attempt_opened", "round_revealed", "draft_complete"]) expect(sources).toContain(expected);
  expect(kinds(entries, "transition").find((entry) => entry.data.source === "bans_resolved")!.data.resolvedBans).toEqual([30, 31, 32]);

  expect(kinds(entries, "user_action").filter((entry) => entry.data.action === "lock_pick").map((entry) => [entry.data.heroId, entry.data.position])).toEqual(PICKS.map((pick) => [pick.heroId, pick.position]));

  // Every accepted board is a verbatim Top 5 per open position, with ids, ranks, scores and the state it answered.
  const boards = kinds(entries, "engine_team_board").filter((entry) => entry.data.disposition === "accepted");
  expect(boards.length).toBeGreaterThanOrEqual(PICKS.length);
  const firstBoard = boards[0]!.data.board as { stateIdentity: string; positions: { position: number; topCount: number; top: { heroId: number; rank: number; score: number }[]; stateIdentity: string }[] };
  expect(firstBoard.positions.every((column) => column.stateIdentity === firstBoard.stateIdentity)).toBe(true);
  expect(firstBoard.positions.find((column) => column.position === 1)!.top.map((candidate) => [candidate.heroId, candidate.rank, candidate.score])).toEqual([[110, 1, 50], [111, 2, 49], [112, 3, 48], [113, 4, 47], [114, 5, 46]]);
  expect(kinds(entries, "engine_current_decision").some((entry) => entry.data.disposition === "accepted")).toBe(true);

  // Each engine answer cites the transition it was asked after (so a stale answer is visible).
  const transitionSeqs = new Set(kinds(entries, "transition").map((entry) => entry.seq));
  for (const entry of [...boards, ...kinds(entries, "engine_current_decision")]) {
    expect(transitionSeqs.has(entry.data.requestedAfterTransitionSeq as number)).toBe(true);
    expect(entry.data.requestedAfterTransitionSeq as number).toBeLessThan(entry.seq);
  }

  // The Top 5 of position 1 changed along the draft (the fake shifts it with each own pick) -- the analysis sees it.
  const exported = flightRecorder.buildExport({ flagEnabled: true, userAgentFamily: null });
  expect(exported.analysis.perPosition.find((position) => position.position === 1)!.distinctTop5.length).toBeGreaterThan(1);
  expect(exported.analysis.distinctBoardStateIdentities).toBeGreaterThan(2);
  expect(result.current.state.phase.type).toBe("complete");
  unmount();
});

test("picks enemigos ocultos: ningún héroe rival aparece en la grabación antes de revelarse, y los ocultos sólo se cuentan", async () => {
  flightRecorder.arm();
  const { unmount } = await playFullParty5Draft();
  const entries = flightRecorder.entries();
  const firstLeak = entries.findIndex((entry) => /"heroId":20[0-4]\b|\[20[0-4]|,20[0-4]\b/.test(JSON.stringify(entry.data)));
  expect(firstLeak).toBeGreaterThan(0);
  // The first entry that names a round-1 enemy hero is the transition that carries the REVEAL (closing own pick), never earlier.
  const leaking = entries[firstLeak]!;
  expect(leaking.kind).toBe("transition");
  expect(leaking.data.source).toBe("own_pick_submitted");
  const view = leaking.data.view as { enemyPicks: { visibility: string }[]; enemyHiddenCount: number };
  expect(view.enemyPicks.every((slot) => slot.visibility === "REVEALED")).toBe(true);

  const withHidden = entries.filter((entry) => entry.kind === "transition" && ((entry.data.view as { enemyHiddenCount?: number } | undefined)?.enemyHiddenCount ?? 0) > 0);
  expect(withHidden.length).toBeGreaterThan(0);
  for (const entry of withHidden) {
    const slots = (entry.data.view as { enemyPicks: Record<string, unknown>[] }).enemyPicks;
    for (const slot of slots.filter((candidate) => candidate.visibility === "HIDDEN")) expect(Object.keys(slot)).toEqual(["visibility"]);
  }
  unmount();
});

test("la exportación no contiene secretos: ni el token del motor, ni el sessionId completo, ni cookies", async () => {
  flightRecorder.arm();
  const { unmount } = await playFullParty5Draft();
  await waitFor(() => expect(kinds(flightRecorder.entries(), "pools_effective")).toHaveLength(1));
  const text = JSON.stringify(flightRecorder.buildExport({ flagEnabled: true, userAgentFamily: null }));
  expect(text).not.toContain(MINTED_VALUE);
  expect(text).not.toContain(FULL_SESSION_ID);
  expect(text).toContain("protocol…");
  expect(text).not.toMatch(/cookie|authorization|x-account|x-capture/i);
  expect(text).not.toContain("0.61"); // personal winrate from /api/hero-pool never enters
  unmount();
});

test("desarmada (producción): el draft termina idéntico, no se graba nada y no hay lecturas extra de pools", async () => {
  const armedRun = await (async () => {
    flightRecorder.arm();
    const run = await playFullParty5Draft();
    const snapshot = { picks: run.result.current.state.draftState?.picks, banned: run.result.current.state.draftState?.banned, phase: run.result.current.state.phase.type, bindings: run.result.current.state.ownAssignedPositions };
    run.unmount();
    flightRecorder.disarm();
    useRandomDraftStore.getState().resetSession();
    return snapshot;
  })();

  expect(flightRecorder.isArmed()).toBe(false);
  const before = flightRecorder.count();
  const { engine, result, unmount } = await playFullParty5Draft();
  expect(flightRecorder.count()).toBe(before); // nothing recorded while disarmed
  expect(engine.urls.some((url) => url.endsWith("/api/team-groups") || url.endsWith("/api/hero-pool"))).toBe(false);
  expect({ picks: result.current.state.draftState?.picks, banned: result.current.state.draftState?.banned, phase: result.current.state.phase.type, bindings: result.current.state.ownAssignedPositions }).toEqual(armedRun);
  unmount();
});

test("si la lectura de pools falla, el draft sigue y queda grabado el motivo (pools_unavailable)", async () => {
  flightRecorder.arm();
  const engine = new FakeEngine();
  const failingFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/api/team-groups")) return json({ error: "x" }, 500);
    return engine.fetch(input, init);
  }) as typeof fetch;
  globalThis.fetch = failingFetch;
  const hook = renderHook(() => useRandomDraftSession({ fetchImpl: failingFetch, revealPauseMs: 0 }));
  await act(async () => hook.result.current.startDraft({ draftSeed: "ABCDEFGH", userSide: "radiant", playerPosition: 2, personalBanList: [], partySize: 5 }));
  await waitFor(() => expect(hook.result.current.state.phase.type).toBe("blind_round"));
  await waitFor(() => expect(kinds(flightRecorder.entries(), "pools_unavailable")).toHaveLength(1));
  expect(kinds(flightRecorder.entries(), "pools_unavailable")[0]!.data.message).toContain("500");
  hook.unmount();
});
