import "@/test-support/happy-dom";

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { HeroId, TeamSide } from "@/features/draft/types";
import { useRandomDraftSession } from "../use-random-draft-session";
import { useRandomDraftStore } from "../store";

const HEROES = Array.from({ length: 40 }, (_, index) => ({ id: index + 1, localizedName: `Hero ${index + 1}`, roles: ["Carry"] }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

class FakeProtocolEngine {
  readonly requests: { url: string; body: Record<string, unknown> }[] = [];
  private sessionId = "protocol-browser-session";
  private side: TeamSide = "radiant";
  private round: 1 | 2 | 3 = 1;
  private status: "ACTIVE" | "WAITING_FOR_COLLISION_AUTHORITY" | "COMPLETE" = "ACTIVE";
  private phase: "BAN_RESOLUTION" | "PICK_ROUND_1" | "PICK_ROUND_2" | "PICK_ROUND_3" | "COMPLETE" = "BAN_RESOLUTION";
  private bans: HeroId[] = [];
  private ownConfirmed: HeroId[] = [];
  private enemyConfirmed: HeroId[] = [];
  private ownSealed: HeroId[] = [];
  private enemySealed: HeroId[] = [];
  private nextBotHero = 30;
  private authorityUsed = false;

  constructor(private readonly pauseForCollisionAuthority = false) {}

  private capacity(): number {
    return this.round === 3 ? 1 : 2;
  }

  private snapshot() {
    const remaining = Math.max(0, this.capacity() - this.ownSealed.length);
    return {
      view: {
        schema: "draft-protocol-perspective/v1",
        sessionId: this.sessionId,
        status: this.status,
        viewerSide: this.side,
        bannedHeroes: this.bans,
        ownPicks: [...this.ownConfirmed, ...this.ownSealed].map((heroId) => ({ visibility: "KNOWN", heroId })),
        enemyPicks: [
          ...this.enemyConfirmed.map((heroId) => ({ visibility: "REVEALED", heroId })),
          ...this.enemySealed.map(() => ({ visibility: "HIDDEN" })),
        ],
        rankedAp: { phase: this.phase, banResolutionComplete: this.phase !== "BAN_RESOLUTION" },
      },
      legalActions: Array.from({ length: remaining }, (_, slotIndex) => ({ type: "SUBMIT_SEALED_SELECTION", side: this.side, slotIndex: this.ownSealed.length + slotIndex })),
    };
  }

  private closeRoundIfReady(): void {
    if (this.ownSealed.length !== this.capacity() || this.enemySealed.length !== this.capacity()) return;
    if (this.pauseForCollisionAuthority && !this.authorityUsed) {
      this.status = "WAITING_FOR_COLLISION_AUTHORITY";
      return;
    }
    this.ownConfirmed.push(...this.ownSealed);
    this.enemyConfirmed.push(...this.enemySealed);
    this.ownSealed = [];
    this.enemySealed = [];
    if (this.round === 3) {
      this.status = "COMPLETE";
      this.phase = "COMPLETE";
      return;
    }
    this.round = (this.round + 1) as 2 | 3;
    this.phase = this.round === 2 ? "PICK_ROUND_2" : "PICK_ROUND_3";
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    this.requests.push({ url, body });
    if (url.endsWith("/api/heroes")) return json(HEROES);
    if (url.endsWith("/api/meta/hero-stats")) return json({ patchStats: {}, heroPositions: {} });
    if (url.endsWith("/api/auth/engine-token")) return json({ token: "fixture" });
    if (url.endsWith("/recommendations")) {
      // R1 S5 (blocker 1) -- the ONLY recommendation source the browser hook may call. Shape
      // mirrors RecommendationSet/v2 closely enough to satisfy protocol-client.ts's own validator.
      const remaining = Math.max(0, this.capacity() - this.ownSealed.length);
      const openSlots = Array.from({ length: remaining }, (_, slotIndex) => ({ side: this.side, slotIndex: this.ownSealed.length + slotIndex }));
      const recommendations = openSlots.length >= 2
        ? [{
            actions: [{ slot: openSlots[0]!, hero: 29 }, { slot: openSlots[1]!, hero: 28 }],
            score: 199,
            confidence: "alta" as const,
            roleImpact: {},
            risks: [],
            legacy: null,
          }]
        : openSlots.length === 1
          ? [{
              actions: [{ slot: openSlots[0]!, hero: 29 }],
              score: 100,
              confidence: "alta" as const,
              roleImpact: {},
              risks: [],
              legacy: { hero: 29, signals: [], evidenceCoverage: 1, guessingIndex: 0, reason: "fixture" },
            }]
          : [];
      return json({
        schema: "recommendation-set/v2",
        sessionId: this.sessionId,
        decision: { actor: this.side, actionKind: openSlots.length > 0 ? "PICK" : null, controlledSlots: openSlots, actionCount: openSlots.length },
        recommendations,
        degradations: [],
        deferred: { opponentResponse: "NOT_COMPUTED", steal: "NOT_COMPUTED", lookahead: "NOT_COMPUTED" },
        decisionContext: "team_opening",
      });
    }
    if (url.endsWith("/api/session/protocol")) {
      this.side = body.localSide as TeamSide;
      return json({ sessionId: this.sessionId, ruleset: {}, status: "ACTIVE" }, 201);
    }
    if (url.endsWith("/command")) {
      const command = body.command as { type: string; heroes?: HeroId[]; heroId?: HeroId };
      if (command.type === "RECORD_RESOLVED_BANS") this.bans = [...(command.heroes ?? [])];
      if (command.type === "BAN_RESOLUTION_COMPLETE") this.phase = "PICK_ROUND_1";
      if (command.type === "SUBMIT_SEALED_SELECTION" && command.heroId) this.ownSealed.push(command.heroId);
      return json({ accepted: true, ...this.snapshot() }, 202);
    }
    if (url.endsWith("/bot-selection")) {
      this.enemySealed.push(this.nextBotHero);
      this.nextBotHero += 1;
      this.closeRoundIfReady();
      return json({ accepted: true, ...this.snapshot() });
    }
    if (url.endsWith("/simulator-authority")) {
      if (this.status !== "WAITING_FOR_COLLISION_AUTHORITY") return json({ error: "no_collision_pending" }, 409);
      this.authorityUsed = true;
      this.status = "ACTIVE";
      this.closeRoundIfReady();
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
  useRandomDraftStore.getState().resetSession();
});

test("el browser completa AP usando exclusivamente la API de ProtocolSession", async () => {
  const engine = new FakeProtocolEngine();
  globalThis.fetch = engine.fetch as typeof fetch;
  const { result, unmount } = renderHook(() => useRandomDraftSession({ fetchImpl: engine.fetch as typeof fetch }));
  await act(async () => result.current.startDraft({ draftSeed: "ABCDEFGH", userSide: "radiant", personalBanList: [], partySize: 5 }));
  expect(result.current.state.phase).toMatchObject({ type: "blind_round", round: 1 });

  const used = new Set<number>();
  for (const round of [1, 2, 3] as const) {
    const count = round === 3 ? 1 : 2;
    const available = HEROES.map((hero) => hero.id).filter((heroId) => !result.current.state.draftState!.banned.includes(heroId) && !used.has(heroId)).slice(0, count);
    for (const heroId of available) {
      used.add(heroId);
      act(() => result.current.actions.confirmPick(heroId));
    }
    await act(async () => result.current.confirmRound());
    if (round < 3) expect(result.current.state.phase).toMatchObject({ type: "blind_round", round: round + 1 });
  }
  expect(result.current.state.phase.type).toBe("complete");
  expect(engine.requests.some((request) => request.url.endsWith("/api/session/manual"))).toBe(false);
  expect(engine.requests.some((request) => request.url.includes("/ws/draft"))).toBe(false);
  expect(engine.requests.filter((request) => request.url.endsWith("/bot-selection")).every((request) => Object.keys(request.body).length === 0)).toBe(true);
  unmount();
}, 20_000);

test("los picks pendientes del usuario nunca entran al request de bot-selection", async () => {
  const engine = new FakeProtocolEngine();
  globalThis.fetch = engine.fetch as typeof fetch;
  const { result, unmount } = renderHook(() => useRandomDraftSession({ fetchImpl: engine.fetch as typeof fetch }));
  await act(async () => result.current.startDraft({ draftSeed: "ABCDEFGH", userSide: "radiant", personalBanList: [], partySize: 5 }));
  const picks = HEROES.map((hero) => hero.id).filter((heroId) => !result.current.state.draftState!.banned.includes(heroId)).slice(0, 2);
  for (const heroId of picks) act(() => result.current.actions.confirmPick(heroId));
  await act(async () => result.current.confirmRound());
  const botRequests = engine.requests.filter((request) => request.url.endsWith("/bot-selection"));
  expect(botRequests.length).toBe(2);
  expect(botRequests.every((request) => request.body.side === undefined && request.body.pendingUserPicks === undefined)).toBe(true);
  unmount();
}, 10_000);

test("el browser delega WAITING_FOR_COLLISION_AUTHORITY al endpoint simulator-authority", async () => {
  const engine = new FakeProtocolEngine(true);
  globalThis.fetch = engine.fetch as typeof fetch;
  const { result, unmount } = renderHook(() => useRandomDraftSession({ fetchImpl: engine.fetch as typeof fetch }));
  await act(async () => result.current.startDraft({ draftSeed: "ABCDEFGH", userSide: "radiant", personalBanList: [], partySize: 5 }));
  const picks = HEROES.map((hero) => hero.id).filter((heroId) => !result.current.state.draftState!.banned.includes(heroId)).slice(0, 2);
  for (const heroId of picks) act(() => result.current.actions.confirmPick(heroId));

  await act(async () => result.current.confirmRound());

  expect(engine.requests.filter((request) => request.url.endsWith("/simulator-authority"))).toHaveLength(1);
  expect(result.current.state.phase).toMatchObject({ type: "blind_round", round: 2 });
  unmount();
}, 10_000);

// R1 S5 (blockers 1 + 2 del checklist de tests) -- el Copilot humano del simulador debe consumir
// SIEMPRE RecommendationSet/v2 (GET .../recommendations) y jamás /api/suggestions/preview, que
// quedó exclusivamente para el camino legacy (no este simulador kernel-backed).
test("el Copilot humano llama al endpoint de recomendaciones V2 del protocolo, nunca /api/suggestions/preview", async () => {
  const engine = new FakeProtocolEngine();
  globalThis.fetch = engine.fetch as typeof fetch;
  const { result, unmount } = renderHook(() => useRandomDraftSession({ fetchImpl: engine.fetch as typeof fetch }));
  await act(async () => result.current.startDraft({ draftSeed: "ABCDEFGH", userSide: "radiant", personalBanList: [], partySize: 5 }));
  await waitFor(() => expect(result.current.state.recommendations).not.toBeNull());

  expect(result.current.state.recommendations?.schema).toBe("recommendation-set/v2");
  expect(engine.requests.some((request) => request.url.endsWith("/recommendations"))).toBe(true);
  expect(engine.requests.some((request) => request.url.endsWith("/api/suggestions/preview"))).toBe(false);
  unmount();
});

test("una nueva ronda pide una recomendación compuesta fresca (2 slots abiertos -> 2 acciones)", async () => {
  const engine = new FakeProtocolEngine();
  globalThis.fetch = engine.fetch as typeof fetch;
  const { result, unmount } = renderHook(() => useRandomDraftSession({ fetchImpl: engine.fetch as typeof fetch }));
  await act(async () => result.current.startDraft({ draftSeed: "ABCDEFGH", userSide: "radiant", personalBanList: [], partySize: 5 }));
  await waitFor(() => expect(result.current.state.recommendations).not.toBeNull());

  const recommendation = result.current.state.recommendations!.recommendations[0]!;
  expect(recommendation.actions).toHaveLength(2); // round 1: capacity 2, nada pickeado todavía
  expect(recommendation.legacy).toBeNull();
  unmount();
});
