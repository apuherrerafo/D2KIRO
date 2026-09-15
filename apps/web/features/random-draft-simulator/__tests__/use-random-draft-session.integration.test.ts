import "@/test-support/happy-dom";

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { DraftState, HeroId, SuggestionSet, TeamSide } from "@/features/draft/types";
import { useRandomDraftSession } from "../use-random-draft-session";
import { useRandomDraftStore } from "../store";

const HEROES = Array.from({ length: 40 }, (_, index) => ({ id: index + 1, localizedName: `Hero ${index + 1}`, roles: ["Carry"] }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

class FakeProtocolEngine {
  readonly requests: { url: string; body: Record<string, unknown> }[] = [];
  readonly previews: { picks: DraftState["picks"]; archetypeIntent?: string; targetPosition?: number; teamOpening?: boolean; token?: string }[] = [];
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
    if (url.endsWith("/api/suggestions/preview")) {
      const preview = body as { picks: DraftState["picks"]; archetypeIntent?: string; targetPosition?: number; teamOpening?: boolean };
      this.previews.push({ ...preview, token: new Headers(init?.headers).get("x-account-token") ?? undefined });
      const response: SuggestionSet = {
        schema: "suggestions/v1",
        sessionId: this.sessionId,
        basedOnSeq: 0,
        decisionContext: "blind_second_pick",
        suggestions: [{ hero: 29, rank: 1, score: 1, signals: [], reason: "fixture", confidence: "alta", evidenceCoverage: 1, guessingIndex: 0 }],
        comparison: null,
        degraded: [],
        computedInMs: 1,
      };
      return json(response);
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
  await act(async () => result.current.startDraft({ draftSeed: "ABCDEFGH", userSide: "radiant", personalBanList: [] }));
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
  await act(async () => result.current.startDraft({ draftSeed: "ABCDEFGH", userSide: "radiant", personalBanList: [] }));
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
  await act(async () => result.current.startDraft({ draftSeed: "ABCDEFGH", userSide: "radiant", personalBanList: [] }));
  const picks = HEROES.map((hero) => hero.id).filter((heroId) => !result.current.state.draftState!.banned.includes(heroId)).slice(0, 2);
  for (const heroId of picks) act(() => result.current.actions.confirmPick(heroId));

  await act(async () => result.current.confirmRound());

  expect(engine.requests.filter((request) => request.url.endsWith("/simulator-authority"))).toHaveLength(1);
  expect(result.current.state.phase).toMatchObject({ type: "blind_round", round: 2 });
  unmount();
}, 10_000);

test("el preview conserva intención, rol y token sin interferir con autoridad de protocolo", async () => {
  const engine = new FakeProtocolEngine();
  globalThis.fetch = engine.fetch as typeof fetch;
  const { result, unmount } = renderHook(() => useRandomDraftSession({ fetchImpl: engine.fetch as typeof fetch }));
  await act(async () => result.current.startDraft({ draftSeed: "ABCDEFGH", userSide: "radiant", personalBanList: [], playerPosition: 2 }));
  await waitFor(() => expect(engine.previews.length).toBeGreaterThan(0));
  act(() => result.current.actions.setArchetypeIntent("push"));
  await waitFor(() => expect(engine.previews.some((preview) => preview.archetypeIntent === "push")).toBe(true));
  expect(engine.previews.every((preview) => preview.targetPosition === 2)).toBe(true);
  unmount();
});
