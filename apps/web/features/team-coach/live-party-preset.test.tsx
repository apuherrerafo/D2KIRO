import "@/test-support/happy-dom";

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LivePartyPresetPanel } from "./components/LivePartyPresetPanel";
import { LIVE_PRESET_STORAGE_KEY } from "./constants";
import type { LiveTeamContext } from "./types";
import { parseLivePartyPresets, parseLiveTeamGroupResult } from "./validation";

// Live Dota + Party 5: the preset selector. The engine is a fake fetch behind the /engine proxy paths
// (S5-style, no real network). The screen shows the preset's NAME only; the request carries only its id.

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const SESSION = "live-session-1";
const NONE: LiveTeamContext = { teamGroupId: null, positions: { "1": false, "2": false, "3": false, "4": false, "5": false } };
const ALL_ON = (teamGroupId: number): LiveTeamContext => ({ teamGroupId, positions: { "1": true, "2": true, "3": true, "4": true, "5": true } });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function member(slot: number, heroPool: number[]) {
  return { id: slot, teamGroupId: 7, slot, name: `Jugador ${slot}`, heroPool, updatedAt: "x" };
}

const GROUPS = [
  { id: 7, name: "Team Julio", partySize: 5, updatedAt: "x", members: [1, 2, 3, 4, 5].map((slot) => member(slot, [slot * 10 + 1])) },
  { id: 8, name: "Dúo del sábado", partySize: 2, updatedAt: "x", members: [member(1, [11]), member(2, [21])] },
];

class FakeEngine {
  readonly puts: unknown[] = [];
  /** What PUT answers; default = applied with all five pools. */
  respond: (body: { teamGroupId: number | null }) => Response = (body) =>
    json({ schema: "live-team-group/v1", applied: body.teamGroupId !== null, reason: null, teamContext: body.teamGroupId === null ? NONE : ALL_ON(body.teamGroupId) });

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/api/team-groups")) return json(GROUPS);
    if (url.endsWith("/api/live/team-group") && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { teamGroupId: number | null };
      this.puts.push(body);
      return this.respond(body);
    }
    throw new Error(`fetch not mocked: ${url}`);
  };
}

function renderPanel(engine: FakeEngine, teamContext: LiveTeamContext | undefined) {
  return render(<LivePartyPresetPanel sessionId={SESSION} teamContext={teamContext} fetchImpl={engine.fetch as typeof fetch} />);
}

describe("LivePartyPresetPanel", () => {
  test("lists only Party 5 presets by NAME (no ids, no hero data on screen) and starts with no pools active", async () => {
    const engine = new FakeEngine();
    const view = renderPanel(engine, NONE);
    await waitFor(() => expect(view.getByTestId("live-preset-inactive")).toBeTruthy());
    const options = Array.from((view.getByTestId("live-preset-select") as HTMLSelectElement).options).map((option) => option.textContent);
    expect(options).toEqual(["Sin preset (el Team Coach no usa pools de tu equipo)", "Team Julio"]);
    const visible = view.getByTestId("live-party-preset").textContent ?? "";
    expect(visible).not.toMatch(/\b7\b|\b8\b|\b11\b/);
    expect(view.queryByTestId("live-preset-pools")).toBeNull();
    view.unmount();
  });

  test("choosing a preset sends ONLY its id; 'Pools activos' then follows what the ENGINE reports, per position", async () => {
    const engine = new FakeEngine();
    const view = renderPanel(engine, NONE);
    await waitFor(() => expect((view.getByTestId("live-preset-select") as HTMLSelectElement).disabled).toBe(false));
    await act(async () => {
      fireEvent.change(view.getByTestId("live-preset-select"), { target: { value: "7" } });
    });
    expect(engine.puts).toEqual([{ teamGroupId: 7 }]); // never a pools payload
    expect(window.localStorage.getItem(LIVE_PRESET_STORAGE_KEY)).toBe("7");

    // The engine's next live status confirms the preset: five positions ✓.
    view.rerender(<LivePartyPresetPanel sessionId={SESSION} teamContext={ALL_ON(7)} fetchImpl={engine.fetch as typeof fetch} />);
    expect(view.getByTestId("live-preset-active").textContent).toBe("Pools de equipo activos");
    for (const position of [1, 2, 3, 4, 5]) {
      const item = view.getByTestId(`live-preset-pos-${position}`);
      expect(item.getAttribute("data-active")).toBe("true");
      expect(item.textContent).toContain(`Pos ${position} ✓`);
    }
    view.unmount();
  });

  test("a partial preset marks only the positions the engine says carry a pool", async () => {
    const engine = new FakeEngine();
    const partial: LiveTeamContext = { teamGroupId: 7, positions: { "1": true, "2": false, "3": true, "4": false, "5": true } };
    const view = renderPanel(engine, partial);
    await waitFor(() => expect(view.getByTestId("live-preset-pools")).toBeTruthy());
    expect(["1", "2", "3", "4", "5"].map((p) => view.getByTestId(`live-preset-pos-${p}`).getAttribute("data-active"))).toEqual(["true", "false", "true", "false", "true"]);
    view.unmount();
  });

  test("clearing the preset sends null and forgets the choice", async () => {
    window.localStorage.setItem(LIVE_PRESET_STORAGE_KEY, "7");
    const engine = new FakeEngine();
    const view = renderPanel(engine, ALL_ON(7));
    await waitFor(() => expect((view.getByTestId("live-preset-select") as HTMLSelectElement).value).toBe("7"));
    await act(async () => {
      fireEvent.change(view.getByTestId("live-preset-select"), { target: { value: "" } });
    });
    expect(engine.puts).toEqual([{ teamGroupId: null }]);
    expect(window.localStorage.getItem(LIVE_PRESET_STORAGE_KEY)).toBeNull();
    view.unmount();
  });

  test("a remembered preset is re-applied ONCE when the engine reports a different one (engine restart / new link), never in a loop", async () => {
    window.localStorage.setItem(LIVE_PRESET_STORAGE_KEY, "7");
    const engine = new FakeEngine();
    const view = renderPanel(engine, NONE);
    await waitFor(() => expect(engine.puts).toEqual([{ teamGroupId: 7 }]));
    // The engine keeps saying "none" (e.g. the PUT has not landed yet): no second automatic attempt.
    view.rerender(<LivePartyPresetPanel sessionId={SESSION} teamContext={{ ...NONE }} fetchImpl={engine.fetch as typeof fetch} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(engine.puts).toHaveLength(1);
    // Confirmed -> later the engine restarts and forgets: re-applied once more.
    view.rerender(<LivePartyPresetPanel sessionId={SESSION} teamContext={ALL_ON(7)} fetchImpl={engine.fetch as typeof fetch} />);
    view.rerender(<LivePartyPresetPanel sessionId={SESSION} teamContext={NONE} fetchImpl={engine.fetch as typeof fetch} />);
    await waitFor(() => expect(engine.puts).toHaveLength(2));
    view.unmount();
  });

  test("a preset the engine refuses (deleted / not yours) is dropped with a plain-language notice, not an error", async () => {
    window.localStorage.setItem(LIVE_PRESET_STORAGE_KEY, "7");
    const engine = new FakeEngine();
    engine.respond = () => json({ schema: "live-team-group/v1", applied: false, reason: "not_found", teamContext: NONE });
    const view = renderPanel(engine, NONE);
    await waitFor(() => expect(view.getByTestId("live-preset-notice").textContent).toContain("ya no existe"));
    expect((view.getByTestId("live-preset-select") as HTMLSelectElement).value).toBe("");
    expect(window.localStorage.getItem(LIVE_PRESET_STORAGE_KEY)).toBeNull();
    view.unmount();
  });

  test("a remembered id that is no longer among the account's presets is forgotten without calling the engine", async () => {
    window.localStorage.setItem(LIVE_PRESET_STORAGE_KEY, "999");
    const engine = new FakeEngine();
    const view = renderPanel(engine, NONE);
    await waitFor(() => expect(view.getByTestId("live-preset-notice")).toBeTruthy());
    expect(engine.puts).toHaveLength(0);
    await waitFor(() => expect(window.localStorage.getItem(LIVE_PRESET_STORAGE_KEY)).toBeNull());
    view.unmount();
  });
});

describe("Party 5 status line -- SERVER truth, never the dropdown", () => {
  test("engine reports a full preset: 'Party 5: <name> · pools 5/5'", async () => {
    const view = renderPanel(new FakeEngine(), ALL_ON(7));
    await waitFor(() => expect(view.getByTestId("live-party-status").textContent).toBe("Party 5: Team Julio · pools 5/5"));
    expect(view.getByTestId("live-party-status").getAttribute("data-state")).toBe("active");
    view.unmount();
  });

  test("engine reports nothing: 'Party 5: SIN PRESET'", async () => {
    const view = renderPanel(new FakeEngine(), NONE);
    await waitFor(() => expect(view.getByTestId("live-party-status").textContent).toBe("Party 5: SIN PRESET"));
    expect(view.getByTestId("live-party-status").getAttribute("data-state")).toBe("none");
    view.unmount();
  });

  test("a preset chosen in the dropdown but NOT confirmed by the engine still reads SIN PRESET, with an explicit hint", async () => {
    window.localStorage.setItem(LIVE_PRESET_STORAGE_KEY, "7");
    const engine = new FakeEngine();
    engine.respond = () => json({ schema: "live-team-group/v1", applied: true, reason: null, teamContext: NONE }); // PUT ok, status still none
    const view = renderPanel(engine, NONE);
    await waitFor(() => expect((view.getByTestId("live-preset-select") as HTMLSelectElement).value).toBe("7"));
    expect(view.getByTestId("live-party-status").textContent).toBe("Party 5: SIN PRESET");
    await waitFor(() => expect(view.getByTestId("live-party-unconfirmed").textContent).toContain("Team Julio"));
    view.unmount();
  });

  test("no engine status read yet is neither active nor SIN PRESET", async () => {
    const view = renderPanel(new FakeEngine(), undefined);
    expect(view.getByTestId("live-party-status").getAttribute("data-state")).toBe("unknown");
    view.unmount();
  });

  test("a partial preset shows the real count of positions with a pool", async () => {
    const partial: LiveTeamContext = { teamGroupId: 7, positions: { "1": true, "2": false, "3": true, "4": false, "5": true } };
    const view = renderPanel(new FakeEngine(), partial);
    await waitFor(() => expect(view.getByTestId("live-party-status").textContent).toBe("Party 5: Team Julio · pools 3/5"));
    view.unmount();
  });
});

describe("validation mirrors for the live preset", () => {
  test("parseLivePartyPresets keeps only Party 5, reduced to name + which positions have a pool (no hero ids)", () => {
    const presets = parseLivePartyPresets([
      { id: 7, name: "Team Julio", partySize: 5, members: [{ slot: 1, heroPool: [11] }, { slot: 2, heroPool: [] }] },
      { id: 8, name: "Dúo", partySize: 2, members: [] },
    ]);
    expect(presets).toEqual([{ id: 7, name: "Team Julio", positions: { "1": true, "2": false, "3": false, "4": false, "5": false } }]);
    expect(JSON.stringify(presets)).not.toContain("11");
    expect(parseLivePartyPresets({ error: "x" })).toBeNull();
    expect(parseLivePartyPresets([{ id: "7", name: "x", partySize: 5, members: [] }])).toBeNull();
  });

  test("parseLiveTeamGroupResult accepts the engine's answer and refuses a malformed one", () => {
    expect(parseLiveTeamGroupResult({ schema: "live-team-group/v1", applied: true, reason: null, teamContext: ALL_ON(7) })).toEqual({ applied: true, reason: null, teamContext: ALL_ON(7) });
    expect(parseLiveTeamGroupResult({ schema: "live-team-group/v1", applied: false, reason: "not_found", teamContext: null })?.reason).toBe("not_found");
    expect(parseLiveTeamGroupResult({ schema: "live-team-group/v1", applied: false, reason: "who_knows", teamContext: null })).toBeNull();
    expect(parseLiveTeamGroupResult({ schema: "x", applied: true, reason: null, teamContext: null })).toBeNull();
    expect(parseLiveTeamGroupResult({ schema: "live-team-group/v1", applied: true, reason: null, teamContext: { teamGroupId: 7, positions: { "1": true } } })).toBeNull();
  });
});
