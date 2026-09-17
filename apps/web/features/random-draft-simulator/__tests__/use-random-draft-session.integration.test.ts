import "@/test-support/happy-dom";

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { HeroId } from "@/features/draft/types";
import { useRandomDraftSession } from "../use-random-draft-session";
import { useRandomDraftStore } from "../store";

const HEROES = Array.from({ length: 40 }, (_, index) => ({ id: index + 1, localizedName: `Hero ${index + 1}`, roles: ["Carry"] }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Browser-contract fixture for the reduced AP Solo Mid product model.
 * The server owns all nine external decisions; the browser only receives the human slot. */
class FakeSoloMidProtocolEngine {
  readonly requests: { url: string; body: Record<string, unknown> }[] = [];
  private readonly sessionId = "protocol-browser-session";
  private bans: HeroId[] = [];
  private humanHero: HeroId | null = null;
  private atHumanSlot = false;
  private complete = false;

  private snapshot() {
    const own = this.atHumanSlot ? [21, 22, 23, 24, ...(this.humanHero === null ? [] : [this.humanHero])] : [];
    const enemy = this.atHumanSlot ? [30, 31, 32, 33, ...(this.complete ? [34] : [])] : [];
    return {
      view: {
        schema: "draft-protocol-perspective/v1",
        sessionId: this.sessionId,
        status: this.complete ? "COMPLETE" : "ACTIVE",
        viewerSide: "radiant",
        bannedHeroes: this.bans,
        ownPicks: own.map((heroId) => ({ visibility: "KNOWN", heroId })),
        enemyPicks: enemy.map((heroId) => ({ visibility: "REVEALED", heroId })),
        rankedAp: { phase: this.complete ? "COMPLETE" : this.atHumanSlot ? "PICK_ROUND_3" : "BAN_RESOLUTION", banResolutionComplete: this.atHumanSlot },
        captainsMode: null,
      },
      legalActions: this.atHumanSlot && this.humanHero === null
        ? [{ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0 }]
        : [],
    };
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    this.requests.push({ url, body });
    if (url.endsWith("/api/heroes")) return json(HEROES);
    if (url.endsWith("/api/meta/hero-stats")) return json({ patchStats: {}, heroPositions: {} });
    if (url.endsWith("/api/auth/engine-token")) return json({ token: "fixture" });
    if (url.endsWith("/api/session/protocol")) return json({ sessionId: this.sessionId, ruleset: {}, status: "ACTIVE" }, 201);
    if (url.endsWith("/recommendations")) {
      const recommendations = [35, 36, 37, 38, 39, 40].map((hero) => ({
        actions: [{ slot: { side: "radiant", slotIndex: 0 }, hero }],
        score: 100 - hero,
        confidence: "alta" as const,
        roleImpact: {},
        risks: [],
        legacy: { hero, signals: [], evidenceCoverage: 1, guessingIndex: 0, reason: "fixture" },
      }));
      return json({
        schema: "recommendation-set/v2",
        sessionId: this.sessionId,
        decision: { actor: "radiant", actionKind: "PICK", controlledSlots: [{ side: "radiant", slotIndex: 0 }], actionCount: 1 },
        recommendations,
        degradations: [],
        deferred: { opponentResponse: "NOT_COMPUTED", steal: "NOT_COMPUTED", lookahead: "NOT_COMPUTED" },
        decisionContext: "closing_pick",
      });
    }
    if (url.endsWith("/command")) {
      const command = body.command as { type: string; heroes?: HeroId[]; heroId?: HeroId };
      if (command.type === "RECORD_RESOLVED_BANS") this.bans = [...(command.heroes ?? [])];
      if (command.type === "SUBMIT_SEALED_SELECTION" && command.heroId !== undefined) this.humanHero = command.heroId;
      return json({ accepted: true, ...this.snapshot() }, 202);
    }
    if (url.endsWith("/auto-drive")) {
      if (!this.atHumanSlot) {
        this.atHumanSlot = true;
        return json({ ...this.snapshot(), stopReason: "human_input", completedRound: null, externalPicks: [] });
      }
      if (this.humanHero === null) return json({ error: "human_input_required" }, 409);
      this.complete = true;
      return json({ ...this.snapshot(), stopReason: "complete", completedRound: null, externalPicks: [] });
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

async function startSoloMid() {
  const engine = new FakeSoloMidProtocolEngine();
  globalThis.fetch = engine.fetch as typeof fetch;
  const hook = renderHook(() => useRandomDraftSession({ fetchImpl: engine.fetch as typeof fetch }));
  await act(async () => hook.result.current.startDraft({ draftSeed: "ABCDEFGH", userSide: "radiant", playerPosition: 2, personalBanList: [], partySize: 1 }));
  return { engine, ...hook };
}

test("el browser hace un solo pick humano y el server completa los otros nueve", async () => {
  const { engine, result, unmount } = await startSoloMid();
  expect(result.current.state.phase).toMatchObject({ type: "blind_round", round: 3 });

  act(() => result.current.actions.confirmPick(17));
  await act(async () => result.current.confirmRound());

  expect(result.current.state.phase.type).toBe("complete");
  expect(result.current.state.draftState?.picks.radiant).toHaveLength(5);
  expect(result.current.state.draftState?.picks.dire).toHaveLength(5);
  const humanCommands = engine.requests.filter((entry) => {
    const command = entry.body.command as { type?: string } | undefined;
    return command?.type === "SUBMIT_SEALED_SELECTION";
  });
  expect(humanCommands).toHaveLength(1);
  expect(engine.requests.filter((entry) => entry.url.endsWith("/auto-drive"))).toHaveLength(2);
  expect(engine.requests.some((entry) => entry.url.endsWith("/bot-selection"))).toBe(false);
  expect(engine.requests.some((entry) => entry.url.endsWith("/simulator-authority"))).toBe(false);
  unmount();
});

test("la sesión transporta explícitamente Solo Radiant Mid, roster slot 4 y seed", async () => {
  const { engine, unmount } = await startSoloMid();
  const create = engine.requests.find((entry) => entry.url.endsWith("/api/session/protocol"))!;
  expect(create.body).toMatchObject({
    localSide: "radiant",
    humanPosition: 2,
    humanRosterSlot: 4,
    simulatorSeed: "ABCDEFGH",
    partyContext: {
      partySize: 1,
      controlledSlots: [{ side: "radiant", slotIndex: 4, controllerId: "simulator-human" }],
    },
  });
  unmount();
});

test("el browser no envía picks pendientes ni decisiones externas al auto-drive", async () => {
  const { engine, result, unmount } = await startSoloMid();
  act(() => result.current.actions.confirmPick(17));
  await act(async () => result.current.confirmRound());
  const autoDriveRequests = engine.requests.filter((entry) => entry.url.endsWith("/auto-drive"));
  expect(autoDriveRequests).toHaveLength(2);
  expect(autoDriveRequests.every((entry) => Object.keys(entry.body).length === 0)).toBe(true);
  unmount();
});

test("el Copilot humano consume RecommendationSet/v2 Top6 de una sola acción", async () => {
  const { engine, result, unmount } = await startSoloMid();
  await waitFor(() => expect(result.current.state.recommendations).not.toBeNull());

  expect(result.current.state.recommendations?.schema).toBe("recommendation-set/v2");
  expect(result.current.state.recommendations?.recommendations).toHaveLength(6);
  expect(result.current.state.recommendations?.recommendations.every((entry) => entry.actions.length === 1)).toBe(true);
  expect(engine.requests.some((entry) => entry.url.endsWith("/recommendations"))).toBe(true);
  expect(engine.requests.some((entry) => entry.url.endsWith("/api/suggestions/preview"))).toBe(false);
  unmount();
});
