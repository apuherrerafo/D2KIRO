import "@/test-support/happy-dom";

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { putLiveHumanPosition } from "./client";
import { LiveLocalPositionPanel } from "./components/LiveLocalPositionPanel";
import { useLiveTeamCoachStore } from "./live-store";
import type { LiveCaptureStatus, LiveLocalPlayer } from "./types";
import { liveDraftChangeKey } from "./use-live-team-coach";
import { parseLiveCaptureStatus, parseLiveHumanPositionResult } from "./validation";

// Live Dota: "Soy Pos N". The engine is a fake fetch behind the /engine proxy path (no real network). The screen shows
// what the ENGINE reports back; a click alone never marks a seat as active.

const SESSION = "live-session-1";
const NONE: LiveLocalPlayer = { position: null, heroId: null, bound: false };

afterEach(cleanup);
beforeEach(() => useLiveTeamCoachStore.getState().reset(SESSION));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function status(overrides: Partial<LiveCaptureStatus> = {}): LiveCaptureStatus {
  return {
    schema: "live-capture-status/v1", sessionId: SESSION, connection: "connected", lastEventAt: null, captureHealth: "ok", captureDetail: null,
    draftPhase: "hero_selection", localSide: "radiant", lastDetectedPick: null, bans: 0, picks: 0, deferredPicks: 0, rejectedFacts: 0, ...overrides,
  };
}

class FakeEngine {
  readonly puts: unknown[] = [];
  /** What PUT answers; default = the engine echoes the declared seat, with no hero yet. */
  respond: (body: { humanPosition: number | null }) => Response = (body) => json({ schema: "live-human-position/v1", localPlayer: { position: body.humanPosition, heroId: null, bound: false } });

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/api/live/human-position") && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { humanPosition: number | null };
      this.puts.push(body);
      return this.respond(body);
    }
    throw new Error(`fetch not mocked: ${url}`);
  };
}

function renderPanel(engine: FakeEngine, localPlayer: LiveLocalPlayer | undefined) {
  return render(<LiveLocalPositionPanel sessionId={SESSION} localPlayer={localPlayer} fetchImpl={engine.fetch as typeof fetch} />);
}

const stateOf = (view: ReturnType<typeof renderPanel>) => view.getByTestId("live-seat-status").getAttribute("data-state");

describe("LiveLocalPositionPanel", () => {
  test("shows Pos 1..5 and 'Sin declarar'; nothing is selected until the engine says so", () => {
    const view = renderPanel(new FakeEngine(), NONE);
    for (const position of [1, 2, 3, 4, 5]) expect(view.getByTestId(`live-seat-${position}`).getAttribute("aria-pressed")).toBe("false");
    expect(stateOf(view)).toBe("undeclared");
    expect((view.getByTestId("live-seat-clear") as HTMLButtonElement).disabled).toBe(true);
  });

  test("clicking Pos 3 sends ONE position and nothing else, and the engine's answer becomes the status", async () => {
    const engine = new FakeEngine();
    useLiveTeamCoachStore.getState().setCaptureStatus(status({ localPlayer: NONE }));
    const view = renderPanel(engine, NONE);
    fireEvent.click(view.getByTestId("live-seat-3"));
    await waitFor(() => expect(useLiveTeamCoachStore.getState().captureStatus?.localPlayer).toEqual({ position: 3, heroId: null, bound: false }));
    expect(engine.puts).toEqual([{ humanPosition: 3 }]);
  });

  test("the selected seat is what the ENGINE reports: a click the engine has not confirmed does not light the button", async () => {
    const engine = new FakeEngine();
    const view = renderPanel(engine, NONE); // the parent still passes the old status
    fireEvent.click(view.getByTestId("live-seat-2"));
    await waitFor(() => expect(engine.puts).toHaveLength(1));
    expect(view.getByTestId("live-seat-2").getAttribute("aria-pressed")).toBe("false");
    view.rerender(<LiveLocalPositionPanel sessionId={SESSION} localPlayer={{ position: 2, heroId: null, bound: false }} fetchImpl={engine.fetch as typeof fetch} />);
    expect(view.getByTestId("live-seat-2").getAttribute("aria-pressed")).toBe("true");
  });

  test("'Sin declarar' sends null", async () => {
    const engine = new FakeEngine();
    const view = renderPanel(engine, { position: 4, heroId: null, bound: false });
    fireEvent.click(view.getByTestId("live-seat-clear"));
    await waitFor(() => expect(engine.puts).toEqual([{ humanPosition: null }]));
  });

  test("four states, four different explanations -- 'bound' is only shown when the engine bound the hero", () => {
    const texts = new Map<string, string>();
    const cases: [string, LiveLocalPlayer][] = [
      ["undeclared", NONE],
      ["waiting_hero", { position: 2, heroId: null, bound: false }],
      ["unbound", { position: 2, heroId: 39, bound: false }],
      ["bound", { position: 2, heroId: 39, bound: true }],
    ];
    for (const [expected, localPlayer] of cases) {
      const view = renderPanel(new FakeEngine(), localPlayer);
      expect(stateOf(view)).toBe(expected);
      texts.set(expected, view.getByTestId("live-seat-status").textContent ?? "");
      view.unmount();
    }
    expect(new Set(texts.values()).size).toBe(4);
  });

  test("no status from the engine yet: says it is verifying, not 'sin declarar'", () => {
    expect(stateOf(renderPanel(new FakeEngine(), undefined))).toBe("unknown");
  });

  test("a refused declaration says why, in plain words, and changes nothing", async () => {
    const engine = new FakeEngine();
    engine.respond = () => json({ error: "live_not_linked" }, 409);
    useLiveTeamCoachStore.getState().setCaptureStatus(status({ localPlayer: NONE }));
    const view = renderPanel(engine, NONE);
    fireEvent.click(view.getByTestId("live-seat-1"));
    await waitFor(() => expect(view.getByTestId("live-seat-notice").textContent).toContain("Conecta Dota"));
    expect(useLiveTeamCoachStore.getState().captureStatus?.localPlayer).toEqual(NONE);
  });

  test("a server failure or a malformed answer is a visible notice, never silent", async () => {
    const engine = new FakeEngine();
    engine.respond = () => json({ nope: true });
    const view = renderPanel(engine, NONE);
    fireEvent.click(view.getByTestId("live-seat-5"));
    await waitFor(() => expect(view.getByTestId("live-seat-notice").textContent).toContain("No se pudo guardar"));
  });

  test("an answer for another session never overwrites this session's status", async () => {
    const engine = new FakeEngine();
    useLiveTeamCoachStore.getState().setCaptureStatus(status({ sessionId: "another-session", localPlayer: NONE }));
    const view = renderPanel(engine, NONE);
    fireEvent.click(view.getByTestId("live-seat-2"));
    await waitFor(() => expect(engine.puts).toHaveLength(1));
    await waitFor(() => expect((view.getByTestId("live-seat-2") as HTMLButtonElement).disabled).toBe(false));
    expect(useLiveTeamCoachStore.getState().captureStatus?.localPlayer).toEqual(NONE);
  });
});

describe("putLiveHumanPosition -- the browser's single call site", () => {
  test("goes through the /engine proxy path, PUT, one field in the body", async () => {
    const seen: { url: string; method: string | undefined; body: string }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), method: init?.method, body: String(init?.body) });
      return json({ schema: "live-human-position/v1", localPlayer: { position: 4, heroId: 39, bound: true } });
    }) as typeof fetch;
    const result = await putLiveHumanPosition(4, fetchImpl);
    expect(result.localPlayer).toEqual({ position: 4, heroId: 39, bound: true });
    expect(seen).toEqual([{ url: expect.stringContaining("/engine/api/live/human-position"), method: "PUT", body: JSON.stringify({ humanPosition: 4 }) }]);
    expect(seen[0]!.url).not.toContain("127.0.0.1");
  });
});

describe("validation at the edge", () => {
  test("parseLiveHumanPositionResult accepts the engine's shape and rejects everything else", () => {
    expect(parseLiveHumanPositionResult({ schema: "live-human-position/v1", localPlayer: { position: 2, heroId: 39, bound: true } })).toEqual({ localPlayer: { position: 2, heroId: 39, bound: true } });
    expect(parseLiveHumanPositionResult({ schema: "live-human-position/v1", localPlayer: NONE })).toEqual({ localPlayer: NONE });
    for (const bad of [null, {}, { schema: "x", localPlayer: NONE }, { schema: "live-human-position/v1" }, { schema: "live-human-position/v1", localPlayer: { position: 6, heroId: null, bound: false } }, { schema: "live-human-position/v1", localPlayer: { position: 2, heroId: -1, bound: false } }, { schema: "live-human-position/v1", localPlayer: { position: 2, heroId: null, bound: "yes" } }]) {
      expect(parseLiveHumanPositionResult(bad)).toBeNull();
    }
  });

  test("the live status accepts localPlayer when valid, tolerates its absence (older engines), and rejects a malformed one", () => {
    expect(parseLiveCaptureStatus(status({ localPlayer: { position: 2, heroId: 39, bound: true } }))?.localPlayer).toEqual({ position: 2, heroId: 39, bound: true });
    expect(parseLiveCaptureStatus(status())).not.toBeNull();
    expect(parseLiveCaptureStatus(status({ localPlayer: { position: 9, heroId: null, bound: false } as unknown as LiveLocalPlayer }))).toBeNull();
  });
});

describe("the board is recomputed when the Player's seat changes", () => {
  test("same draft, different seat => different change key; same seat => same key", () => {
    const none = status({ localPlayer: NONE });
    const declared = status({ localPlayer: { position: 2, heroId: null, bound: false } });
    const bound = status({ localPlayer: { position: 2, heroId: 39, bound: true } });
    expect(liveDraftChangeKey(declared)).not.toBe(liveDraftChangeKey(none));
    expect(liveDraftChangeKey(bound)).not.toBe(liveDraftChangeKey(declared));
    expect(liveDraftChangeKey(bound)).toBe(liveDraftChangeKey(status({ localPlayer: { position: 2, heroId: 39, bound: true } })));
    expect(liveDraftChangeKey(status())).toBe(liveDraftChangeKey(status()));
  });
});
