import "@/test-support/happy-dom";

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { useRandomDraftSession } from "../use-random-draft-session";
import { useRandomDraftStore } from "../store";

// P0-3 (INV-YIELD-001 / INV-YIELD-002) -- focused web regression. The independent oracle for
// INV-YIELD-001 (qa/invariants/yield-parity.test.ts) drives the REAL server and proves the
// precondition itself; it cannot reach this hook (React/DOM, apps/web's own test setup -- see that
// file's header). This test proves the OTHER half: that the hook reads the server's own `canYield`
// truth verbatim (never re-derives an approximation), and that a domain-level /yield rejection is
// never classified as engine/network unreachability. It does not re-implement the server's Ally Bot
// absorption formula -- `serverCanYield`/`yieldStatus` below are directly controlled by the test,
// not computed from a simulated capacity model.

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const SESSION_ID = "yield-gate-session";

const EMPTY_COACH_BODY = {
  output: null,
  recommendationSet: {
    schema: "recommendation-set/v2",
    sessionId: SESSION_ID,
    decision: { actor: "radiant", actionKind: "PICK", controlledSlots: [], actionCount: 0 },
    recommendations: [],
    degradations: [],
    deferred: { opponentResponse: "NOT_COMPUTED", steal: "NOT_COMPUTED", lookahead: "NOT_COMPUTED" },
    decisionContext: "team_opening",
  },
};

/**
 * Party2 [1,2] fixture, directly controllable: `serverCanYield` is whatever this test says the
 * server's `ProtocolSessionStore.canYield` precondition would return right now; `yieldStatus` is
 * whatever `POST /yield` itself would answer. A real server keeps these consistent by construction
 * (same `yieldPrecondition()`, see protocol-session.ts) -- this fixture lets the test force them
 * independently, including the deliberately inconsistent case (canYield was true a moment ago, the
 * actual /yield attempt now 409s) that INV-YIELD-002 is about.
 */
class FakeYieldEngine {
  round: 1 | 2 = 1;
  serverCanYield = true;
  yieldStatus: 200 | 409 = 200;

  private snapshot(extra: Record<string, unknown> = {}) {
    return {
      view: {
        schema: "draft-protocol-perspective/v1",
        sessionId: SESSION_ID,
        status: "ACTIVE",
        viewerSide: "radiant",
        bannedHeroes: [],
        ownPicks: [],
        enemyPicks: [],
        rankedAp: { phase: `PICK_ROUND_${this.round}`, banResolutionComplete: true },
        captainsMode: null,
      },
      legalActions: [0, 1].map((slotIndex) => ({ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex })),
      simulator: { round: this.round, durationMs: 25000, remainingMs: 25000, penaltyActive: false, pendingSeats: [], goldPenaltyBySlot: [0, 0, 0, 0, 0], penaltyRatePerSecond: 2 },
      ownAssignedPositions: [],
      canYield: this.serverCanYield,
      ...extra,
    };
  }

  fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/api/heroes")) return json([]);
    if (url.endsWith("/api/meta/hero-stats")) return json({ patchStats: {}, heroPositions: {} });
    if (url.endsWith("/api/auth/engine-token")) return json({ token: "fixture" });
    if (url.endsWith("/api/session/protocol")) return json({ sessionId: SESSION_ID, ruleset: {}, status: "ACTIVE" }, 201);
    if (url.endsWith("/resolve-bans")) return json({ resolvedBans: [], ...this.snapshot() });
    if (url.includes("/recommendations")) return json(EMPTY_COACH_BODY);
    if (url.endsWith("/auto-drive")) return json({ ...this.snapshot(), stopReason: "human_input", completedRound: null });
    if (url.endsWith("/yield")) {
      if (this.yieldStatus === 409) return json({ error: "ally_bot_cannot_absorb_capacity" }, 409);
      // Canonical counterexample outcome: round 1's yield succeeds, but the Ally Bot can no longer
      // absorb round 2's own-side capacity -- the server's own truth flips to false.
      this.round = 2;
      this.serverCanYield = false;
      return json(this.snapshot());
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

async function startParty2(engine: FakeYieldEngine) {
  globalThis.fetch = engine.fetch as typeof fetch;
  const hook = renderHook(() => useRandomDraftSession({ fetchImpl: engine.fetch as typeof fetch, revealPauseMs: 0 }));
  await act(async () =>
    hook.result.current.startDraft({
      draftSeed: "YIELDGATE",
      userSide: "radiant",
      playerPosition: 1,
      personalBanList: [],
      partySize: 2,
      partyPositions: [1, 2],
    }),
  );
  return hook;
}

test("INV-YIELD-001: canYield en la fase viene del servidor, nunca de una fórmula local -- cambia entre rondas cuando el servidor lo dice", async () => {
  const engine = new FakeYieldEngine();
  const { result, unmount } = await startParty2(engine);

  // Round 1: the Ally Bot has full capacity -- the server says Yield is legal.
  await waitFor(() => expect(result.current.state.phase).toMatchObject({ type: "blind_round", round: 1, canYield: true }));

  // Party2's controlledPositions/attemptPositions do NOT change between round 1 and round 2 -- the
  // OLD local formula (attemptPositions.length > 0 && controlledPositions.length < 5) would have
  // stayed `true` here regardless. Only reading the server's own canYield catches the flip.
  await act(async () => result.current.actions.yieldRound());
  await waitFor(() => expect(result.current.state.phase).toMatchObject({ type: "blind_round", round: 2, canYield: false }));
  unmount();
});

test("INV-YIELD-002: un rechazo de dominio de /yield (409) nunca se clasifica como motor inalcanzable", async () => {
  const engine = new FakeYieldEngine();
  engine.yieldStatus = 409;
  const { result, unmount } = await startParty2(engine);
  await waitFor(() => expect(result.current.state.phase).toMatchObject({ type: "blind_round", round: 1, canYield: true }));

  await act(async () => result.current.actions.yieldRound());

  // The server responded (409, not a network failure): engineStatus must stay "ok", and the
  // rejection must be visible as a round notice -- the same existing pattern lockPick already uses
  // for a rejected pick, never a silent state or "unreachable".
  expect(result.current.state.engineStatus).toBe("ok");
  const phase = result.current.state.phase;
  expect(phase.type === "blind_round" && phase.notice).toContain("Ally Bot");
  unmount();
});
