import "@/test-support/happy-dom";

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { CaptureAutoPanel, captureReadiness } from "./components/CaptureAutoPanel";
import { capturePill, captureSourceLine, LiveCaptureStatusBar } from "./components/LiveCaptureStatusBar";
import { buildLiveDiagnostics, formatLiveDiagnosticReport } from "./live-diagnostics";
import type { LiveCaptureStatus, LiveOverwolfStatus } from "./types";
import { parseCapturePairingCode, parseCapturePairingState, parseLiveCaptureStatus } from "./validation";

// Overwolf automatic capture, web side: the pairing panel (S5-style fake fetch behind /engine, no network),
// the CAPTURE source line, the degraded notice, the diagnostics rows, and the mirrored validation.

afterEach(cleanup);

function overwolf(overrides: Partial<LiveOverwolfStatus> = {}): LiveOverwolfStatus {
  return { connected: true, roster: true, bans: true, draft: true, players: true, lastUpdateAgeMs: 420, authoritative: true, ...overrides };
}

function status(overrides: Partial<LiveCaptureStatus> = {}): LiveCaptureStatus {
  return {
    schema: "live-capture-status/v1",
    sessionId: "session-aaaaaaaa",
    connection: "connected",
    lastEventAt: "2026-10-04T20:00:00.000Z",
    captureHealth: "ok",
    captureDetail: null,
    draftPhase: "hero_selection",
    localSide: "radiant",
    lastDetectedPick: null,
    bans: 3,
    picks: 7,
    deferredPicks: 0,
    rejectedFacts: 0,
    gsi: null,
    overwolf: overwolf(),
    ...overrides,
  };
}

describe("validation (mirror of the engine contract)", () => {
  test("live status accepts the overwolf block, rejects a malformed one, and tolerates older engines", () => {
    expect(parseLiveCaptureStatus(status())).not.toBeNull();
    const older: Record<string, unknown> = { ...status() };
    delete older.overwolf;
    expect(parseLiveCaptureStatus(older)).not.toBeNull();
    expect(parseLiveCaptureStatus(status({ overwolf: null }))).not.toBeNull();
    expect(parseLiveCaptureStatus({ ...status(), overwolf: { ...overwolf(), connected: "yes" } })).toBeNull();
    expect(parseLiveCaptureStatus({ ...status(), overwolf: { ...overwolf(), lastUpdateAgeMs: -1 } })).toBeNull();
    expect(parseLiveCaptureStatus({ ...status(), overwolf: { connected: true } })).toBeNull();
  });

  test("pairing code and pairing state responses", () => {
    expect(parseCapturePairingCode({ schema: "live-capture-pairing/v1", code: "ABCD-2345", expiresAt: "2026-10-04T20:10:00.000Z" })).toEqual({ code: "ABCD-2345", expiresAt: "2026-10-04T20:10:00.000Z" });
    for (const bad of ["ABCD2345", "ABCI-2345", "ABCD-234", ""]) expect(parseCapturePairingCode({ schema: "live-capture-pairing/v1", code: bad, expiresAt: "x" })).toBeNull();
    expect(parseCapturePairingCode({ schema: "other", code: "ABCD-2345", expiresAt: "x" })).toBeNull();
    expect(parseCapturePairingState({ schema: "live-capture-pairing-state/v1", paired: true, expiresAt: "x", overwolf: overwolf() })).not.toBeNull();
    expect(parseCapturePairingState({ schema: "live-capture-pairing-state/v1", paired: false, expiresAt: null, overwolf: null })).not.toBeNull();
    expect(parseCapturePairingState({ schema: "live-capture-pairing-state/v1", paired: "no", expiresAt: null, overwolf: null })).toBeNull();
  });
});

describe("readiness (before queueing)", () => {
  test("one honest answer per situation", () => {
    expect(captureReadiness(false, null)).toBe("not_paired");
    expect(captureReadiness(true, null)).toBe("waiting_adapter");
    expect(captureReadiness(true, status({ overwolf: null }))).toBe("waiting_adapter");
    expect(captureReadiness(true, status({ overwolf: overwolf({ connected: false, authoritative: false }) }))).toBe("waiting_adapter");
    expect(captureReadiness(true, status({ overwolf: overwolf({ authoritative: false, draft: false, players: false }), captureDetail: "DOTA_NOT_RUNNING" }))).toBe("dota_not_running");
    expect(captureReadiness(true, status({ overwolf: overwolf({ authoritative: false, draft: false, players: false }), captureDetail: "DOTA_CAPTURE_NOT_ENABLED" }))).toBe("needs_launch_option");
    expect(captureReadiness(true, status({ overwolf: overwolf({ authoritative: false, draft: false, players: false }), captureDetail: "WAITING_FOR_DRAFT", draftPhase: "waiting" }))).toBe("ready");
    expect(captureReadiness(true, status())).toBe("capturing");
    expect(captureReadiness(true, status({ captureHealth: "degraded", captureDetail: "OVERWOLF_LOST", overwolf: overwolf({ connected: false, authoritative: false }) }))).toBe("lost");
  });
});

describe("CAPTURE source", () => {
  test("automatic source with visible heroes; waiting / lost / absent", () => {
    expect(captureSourceLine(status())).toBe("Automática · Overwolf · 7/10 héroes visibles");
    expect(captureSourceLine(status({ picks: 10 }))).toBe("Automática · Overwolf · 10/10 héroes visibles");
    expect(captureSourceLine(status({ overwolf: overwolf({ authoritative: false, bans: false, draft: false, players: false }), bans: 0, picks: 0 }))).toContain("esperando el draft");
    expect(captureSourceLine(status({ overwolf: overwolf({ authoritative: false, draft: false, players: false }), bans: 3, picks: 0 }))).toBe("Automática · Overwolf · 3 bans capturados · esperando los picks");
    expect(captureSourceLine(status({ overwolf: overwolf({ connected: false, authoritative: false }) }))).toContain("esperando a Overwolf");
    expect(captureSourceLine(status({ captureHealth: "degraded", captureDetail: "OVERWOLF_LOST", overwolf: overwolf({ connected: false, authoritative: false }) }))).toContain("desconectado");
    expect(captureSourceLine(status({ overwolf: null }))).toBeNull();
    expect(captureSourceLine(null)).toBeNull();
  });

  test("the status bar names the source and needs no manual notice while Overwolf is healthy", () => {
    const { getByTestId, queryByTestId } = render(<LiveCaptureStatusBar status={status()} heroCatalog={new Map()} />);
    expect(getByTestId("live-capture-source").textContent).toBe("Automática · Overwolf · 7/10 héroes visibles");
    expect(queryByTestId("live-capture-degraded")).toBeNull();
    expect(queryByTestId("live-capture-partial")).toBeNull();
    expect(capturePill(status()).text).toBe("● Hero Selection");
  });

  test("Overwolf lost mid-draft is shown as degraded -- never silent -- with the manual way out", () => {
    const lost = status({ captureHealth: "degraded", captureDetail: "OVERWOLF_LOST", overwolf: overwolf({ connected: false, authoritative: false, lastUpdateAgeMs: 30_000 }) });
    const { getByTestId } = render(<LiveCaptureStatusBar status={lost} heroCatalog={new Map()} />);
    expect(getByTestId("live-capture-overwolf-lost").textContent).toContain("Overwolf dejó de informar");
    expect(capturePill(lost).text).toContain("captura automática perdida");
  });
});

describe("CaptureAutoPanel", () => {
  const CODE = { schema: "live-capture-pairing/v1", code: "ABCD-2345", expiresAt: "2026-10-04T20:10:00.000Z" };

  function fakeEngine(state: { paired: boolean }) {
    return mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toContain("/engine/api/live/capture-pairing");
      if (init?.method === "POST") return Response.json(CODE, { status: 201 });
      if (init?.method === "DELETE") {
        state.paired = false;
        return Response.json({ schema: "live-capture-pairing-state/v1", paired: false, expiresAt: null, overwolf: null });
      }
      return Response.json({ schema: "live-capture-pairing-state/v1", paired: state.paired, expiresAt: state.paired ? "2026-10-05T08:00:00.000Z" : null, overwolf: null });
    });
  }

  test("click -> the one-time code and the steps; the page flips to 'lista' by itself once the adapter pairs", async () => {
    const state = { paired: false };
    const fetchImpl = fakeEngine(state);
    const view = render(<CaptureAutoPanel status={status({ overwolf: null, draftPhase: "waiting" })} fetchImpl={fetchImpl as unknown as typeof fetch} origin="https://d2kiro-test.up.railway.app" />);
    await waitFor(() => expect(view.getByTestId("capture-auto-readiness").textContent).toContain("sin conectar"));
    fireEvent.click(view.getByTestId("capture-pairing-start"));
    await waitFor(() => expect(view.getByTestId("capture-pairing-code").textContent).toBe("ABCD-2345"));
    expect(view.getByTestId("capture-pairing-origin").textContent).toBe("https://d2kiro-test.up.railway.app");
    view.rerender(<CaptureAutoPanel status={status({ overwolf: overwolf({ authoritative: false, draft: false, players: false }), captureDetail: "WAITING_FOR_DRAFT", draftPhase: "waiting" })} fetchImpl={fetchImpl as unknown as typeof fetch} origin="https://d2kiro-test.up.railway.app" />);
    state.paired = true;
    await waitFor(() => expect(view.getByTestId("capture-auto").getAttribute("data-readiness")).toBe("ready"), { timeout: 4_000 });
    expect(view.getByTestId("capture-auto-readiness").textContent).toBe("● Captura automática lista");
    expect(view.queryByTestId("capture-pairing-code-box")).toBeNull();
  });

  test("unpairing asks the engine to revoke and goes back to 'sin conectar'", async () => {
    const state = { paired: true };
    const fetchImpl = fakeEngine(state);
    const view = render(<CaptureAutoPanel status={status()} fetchImpl={fetchImpl as unknown as typeof fetch} origin="https://d2kiro-test.up.railway.app" />);
    await waitFor(() => expect(view.getByTestId("capture-auto").getAttribute("data-readiness")).toBe("capturing"));
    fireEvent.click(view.getByTestId("capture-pairing-unpair"));
    await waitFor(() => expect(view.getByTestId("capture-auto").getAttribute("data-readiness")).toBe("not_paired"));
    expect(fetchImpl.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });

  test("a failed code request says so in plain words, never silently", async () => {
    const fetchImpl = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(null, { status: 409 });
      return Response.json({ schema: "live-capture-pairing-state/v1", paired: false, expiresAt: null, overwolf: null });
    });
    const view = render(<CaptureAutoPanel status={null} fetchImpl={fetchImpl as unknown as typeof fetch} origin="https://d2kiro-test.up.railway.app" />);
    await waitFor(() => view.getByTestId("capture-pairing-start"));
    fireEvent.click(view.getByTestId("capture-pairing-start"));
    await waitFor(() => expect(view.getByTestId("capture-pairing-error").textContent).toContain("No se pudo completar"));
  });
});

describe("diagnostics: overwolf presence, never a payload", () => {
  test("rows and the copied report carry presence + age only", () => {
    const diagnostics = buildLiveDiagnostics({ engine: "ok", dotaLink: true, status: status({ overwolf: overwolf({ bans: false, lastUpdateAgeMs: 1234.7 }) }) });
    expect(diagnostics.overwolf).toEqual({ connected: "YES", roster: "YES", bans: "NO", draft: "YES", players: "YES", lastUpdateAgeMs: 1235 });
    const report = formatLiveDiagnosticReport(diagnostics);
    for (const line of ["overwolf.connected: YES", "overwolf.roster: YES", "overwolf.bans: NO", "overwolf.draft: YES", "overwolf.players: YES", "overwolf.lastUpdateAgeMs: 1235"]) expect(report).toContain(line);
    expect(report).not.toMatch(/captureId|token|steam|session-aaaaaaaa/i);
  });

  test("no adapter -> everything NO / n/a, nothing invented", () => {
    const diagnostics = buildLiveDiagnostics({ engine: "ok", dotaLink: true, status: status({ overwolf: null }) });
    expect(diagnostics.overwolf).toEqual({ connected: "NO", roster: "NO", bans: "NO", draft: "NO", players: "NO", lastUpdateAgeMs: null });
    expect(formatLiveDiagnosticReport(diagnostics)).toContain("overwolf.lastUpdateAgeMs: n/a");
  });
});
