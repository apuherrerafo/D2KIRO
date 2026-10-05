import "@/test-support/happy-dom";

import { act, cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { LiveCaptureStatusBar } from "./components/LiveCaptureStatusBar";
import { LiveTeamCoachView } from "./components/LiveTeamCoachView";
import { useLiveTeamCoachStore } from "./live-store";
import type { LiveCaptureStatus, TeamCoachBoardData } from "./types";
import { liveDraftChangeKey, useLiveTeamCoach } from "./use-live-team-coach";

afterEach(cleanup);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function status(overrides: Partial<LiveCaptureStatus> = {}): LiveCaptureStatus {
  return {
    schema: "live-capture-status/v1",
    sessionId: "live-session-1",
    connection: "connected",
    lastEventAt: "2026-10-01T00:00:00.000Z",
    captureHealth: "ok",
    captureDetail: "HERO_SELECTION",
    draftPhase: "hero_selection",
    localSide: "radiant",
    lastDetectedPick: null,
    bans: 0,
    picks: 0,
    deferredPicks: 0,
    rejectedFacts: 0,
    ...overrides,
  };
}

function board(stateIdentity: string, filledPos3: number | null = null): TeamCoachBoardData {
  return {
    schema: "team-coach-board/v1",
    sessionId: "live-session-1",
    stateIdentity,
    currentDecision: { recommendedPosition: 1, recommendedHeroId: 11, targetBasis: "DETERMINISTIC_DEFAULT", reason: "fixture", actionablePositions: [1, 2, 3, 4, 5].filter((p) => p !== 3 || filledPos3 === null) as (1 | 2 | 3 | 4 | 5)[], roundCapacity: 2 },
    positions: ([1, 2, 3, 4, 5] as const).map((position) => {
      const filled = position === 3 && filledPos3 !== null;
      return {
        position,
        eligibleNow: !filled,
        alreadyFilled: filled,
        filledHeroId: filled ? filledPos3 : null,
        state: filled ? "FILLED" : "RANKED",
        primaryHeroId: filled ? null : position * 10 + 1,
        top: filled ? [] : [1, 2, 3].map((k) => ({ heroId: position * 10 + k, rank: k, score: 10 - k, reasons: ["fixture"], isPrimary: k === 1 })),
        stateIdentity,
        note: null,
      };
    }),
    unboundOwnHeroIds: [],
  };
}

class FakeLiveEngine {
  readonly requests: { url: string; method: string; body: unknown }[] = [];
  current = status();
  currentBoard = board("s0");

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    this.requests.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.endsWith("/api/session/protocol/live")) return json({ sessionId: "live-session-1", status: this.current }, 201);
    if (url.endsWith("/live-status")) return json(this.current);
    if (url.endsWith("/team-recommendations")) return json(this.currentBoard);
    if (url.endsWith("/live-observation")) return json({ accepted: true, changed: true, status: this.current }, 202);
    if (url.endsWith("/api/session/protocol/live-session-1")) {
      return json({ view: { schema: "draft-protocol-perspective/v1", sessionId: "live-session-1", status: "ACTIVE", viewerSide: "radiant", bannedHeroes: [], ownPicks: [], enemyPicks: [], rankedAp: { phase: "PICK_ROUND_1", banResolutionComplete: true }, captainsMode: null }, legalActions: [], simulator: null, ownAssignedPositions: [], canYield: false });
    }
    if (url.endsWith("/api/heroes")) return json([]);
    if (url.endsWith("/api/telemetry/error")) return json({}, 202);
    throw new Error(`fetch not mocked: ${url}`);
  };

  count(suffix: string): number {
    return this.requests.filter((entry) => entry.url.endsWith(suffix)).length;
  }
}

describe("useLiveTeamCoach", () => {
  test("abre/reclama la sesión, y recalcula el board SÓLO cuando cambia el draft (nunca por un heartbeat)", async () => {
    const engine = new FakeLiveEngine();
    const hook = renderHook(() => useLiveTeamCoach("live-session-1", { fetchImpl: engine.fetch as typeof fetch, pollMs: 15 }));
    await waitFor(() => expect(useLiveTeamCoachStore.getState().board?.stateIdentity).toBe("s0"));
    expect(engine.count("/api/session/protocol/live")).toBe(1);

    // Heartbeats only (lastEventAt moves): several polls, zero recomputes.
    engine.current = status({ lastEventAt: "2026-10-01T00:00:05.000Z" });
    const statusPolls = engine.count("/live-status");
    await waitFor(() => expect(engine.count("/live-status")).toBeGreaterThan(statusPolls + 3));
    expect(engine.count("/team-recommendations")).toBe(1);

    // Dota registers a pick: the key changes -> the board is recomputed on the next poll (recálculo visible).
    engine.currentBoard = board("s1", 129);
    engine.current = status({ picks: 1, lastDetectedPick: { side: "radiant", heroId: 129, position: 3, source: "overwolf", at: "2026-10-01T00:00:06.000Z" } });
    await waitFor(() => expect(useLiveTeamCoachStore.getState().board?.stateIdentity).toBe("s1"));
    expect(engine.count("/team-recommendations")).toBe(2);
    hook.unmount();
  });

  test("el fallback manual manda el MISMO tipo de hecho que el capturador", async () => {
    const engine = new FakeLiveEngine();
    const hook = renderHook(() => useLiveTeamCoach("live-session-1", { fetchImpl: engine.fetch as typeof fetch, pollMs: 60_000 }));
    await waitFor(() => expect(useLiveTeamCoachStore.getState().board).not.toBeNull());
    await act(async () => hook.result.current.report({ type: "pick", side: "radiant", heroId: 129, position: 3 }));
    expect(engine.requests.find((entry) => entry.url.endsWith("/live-observation"))!.body).toEqual({ type: "pick", side: "radiant", heroId: 129, position: 3 });
    hook.unmount();
  });

  test("la clave de cambio ignora el heartbeat y sí ve picks/bans/lado", () => {
    expect(liveDraftChangeKey(status({ lastEventAt: "a" }))).toBe(liveDraftChangeKey(status({ lastEventAt: "b" })));
    expect(liveDraftChangeKey(status({ picks: 1 }))).not.toBe(liveDraftChangeKey(status()));
    expect(liveDraftChangeKey(status({ localSide: "dire" }))).not.toBe(liveDraftChangeKey(status()));
  });

  test("Team Context entra en la clave: mismo draft, distinto contexto => clave distinta", () => {
    const all = { "1": true, "2": true, "3": true, "4": true, "5": true };
    const none = status();
    const teamA = status({ teamContext: { teamGroupId: 1, positions: all } });
    const teamB = status({ teamContext: { teamGroupId: 2, positions: { ...all } } });
    const cleared = status({ teamContext: { teamGroupId: null, positions: { "1": false, "2": false, "3": false, "4": false, "5": false } } });
    expect(liveDraftChangeKey(teamA)).not.toBe(liveDraftChangeKey(none));
    expect(liveDraftChangeKey(teamA)).not.toBe(liveDraftChangeKey(teamB));
    expect(liveDraftChangeKey(teamA)).not.toBe(liveDraftChangeKey(cleared));
    expect(liveDraftChangeKey(teamA)).toBe(liveDraftChangeKey(status({ teamContext: { teamGroupId: 1, positions: { ...all } } })));
  });

  test("elegir un preset recalcula el board SIN ningún pick/ban nuevo", async () => {
    const engine = new FakeLiveEngine();
    const hook = renderHook(() => useLiveTeamCoach("live-session-1", { fetchImpl: engine.fetch as typeof fetch, pollMs: 15 }));
    await waitFor(() => expect(useLiveTeamCoachStore.getState().board?.stateIdentity).toBe("s0"));
    const statusPolls = engine.count("/live-status");
    await waitFor(() => expect(engine.count("/live-status")).toBeGreaterThan(statusPolls + 2));
    expect(engine.count("/team-recommendations")).toBe(1);

    engine.currentBoard = board("with-team");
    engine.current = status({ teamContext: { teamGroupId: 7, positions: { "1": true, "2": true, "3": true, "4": true, "5": true } } });
    await waitFor(() => expect(useLiveTeamCoachStore.getState().board?.stateIdentity).toBe("with-team"));
    expect(engine.count("/team-recommendations")).toBe(2);

    engine.current = status();
    await waitFor(() => expect(engine.count("/team-recommendations")).toBe(3));
    hook.unmount();
  });
});

const HEROES = new Map<number, HeroMeta>([[129, { id: 129, name: "npc_dota_hero_mars", localizedName: "Mars", imgUrl: "https://cdn.cloudflare.steamstatic.com/mars.png", primaryAttr: "str", attackType: "Melee", roles: [] }]]);

describe("LiveCaptureStatusBar", () => {
  test("CONNECTION / CAPTURE / SIDE y TEAM PICK DETECTED Pos3 → Mars", () => {
    const view = render(<LiveCaptureStatusBar status={status({ lastDetectedPick: { side: "radiant", heroId: 129, position: 3, source: "overwolf", at: "x" } })} heroCatalog={HEROES} />);
    const text = view.getByTestId("live-capture-status").textContent ?? "";
    expect(text).toContain("CONNECTION");
    expect(text).toContain("● Dota conectado");
    expect(text).toContain("● Hero Selection");
    expect(text).toContain("Radiant");
    expect(view.getByTestId("live-pick-detected").textContent).toContain("TEAM PICK DETECTED");
    expect(view.getByTestId("live-pick-detected").textContent).toContain("Pos3 Offlane → Mars");
  });

  test("sin -gamestateintegration: DOTA_CAPTURE_NOT_ENABLED con la acción exacta", () => {
    const view = render(<LiveCaptureStatusBar status={status({ captureHealth: "degraded", captureDetail: "DOTA_CAPTURE_NOT_ENABLED", draftPhase: "waiting" })} heroCatalog={HEROES} />);
    const alert = view.getByTestId("live-capture-not-enabled").textContent ?? "";
    expect(alert).toContain("DOTA_CAPTURE_NOT_ENABLED");
    expect(alert).toContain("Agrega -gamestateintegration a Launch Options");
  });
});

describe("LiveTeamCoachView -- fallback manual", () => {
  test("captura degradada: se muestra, el board acepta clics y la entrada manual queda abierta; el estado no se pierde", async () => {
    const engine = new FakeLiveEngine();
    engine.current = status({ connection: "stale", captureHealth: "lost", picks: 1 });
    engine.currentBoard = board("s1", 129);
    const original = globalThis.fetch;
    globalThis.fetch = engine.fetch as typeof fetch;
    try {
      const view = render(<LiveTeamCoachView sessionId="live-session-1" />);
      await waitFor(() => expect(view.getByTestId("live-capture-degraded")).toBeTruthy());
      await waitFor(() => expect(view.getByTestId("team-coach-column-3").getAttribute("data-state")).toBe("FILLED"));
      expect((view.getByTestId("live-manual-entry") as HTMLDetailsElement).open).toBe(true);
      const pickButtons = view.getAllByRole("button", { name: /^Elegir / });
      expect(pickButtons.length).toBeGreaterThan(0);
      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Elegir Héroe 51 como Pos5 Hard Support" }));
      });
      await waitFor(() => expect(engine.requests.some((entry) => entry.url.endsWith("/live-observation"))).toBe(true));
      expect(engine.requests.find((entry) => entry.url.endsWith("/live-observation"))!.body).toEqual({ type: "pick", side: "radiant", heroId: 51, position: 5 });
      view.unmount();
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("useLiveTeamCoach -- a failed board is retried (Greptile TSK-219)", () => {
  test("board request fails once with the draft unchanged -> the next poll fetches it again", async () => {
    const engine = new FakeLiveEngine();
    const base = engine.fetch;
    let failures = 1;
    engine.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/team-recommendations") && failures > 0) {
        failures -= 1;
        engine.requests.push({ url: String(input), method: "GET", body: null });
        return json({ error: "boom" }, 503);
      }
      return base(input, init);
    };
    const hook = renderHook(() => useLiveTeamCoach("live-session-1", { fetchImpl: engine.fetch as typeof fetch, pollMs: 15 }));
    await waitFor(() => expect(useLiveTeamCoachStore.getState().boardStatus).toBe("ready"));
    expect(engine.count("/team-recommendations")).toBe(2);
    hook.unmount();
  });
});
