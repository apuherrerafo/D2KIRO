import "@/test-support/happy-dom";

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { LiveDiagnosticsPanel } from "./components/LiveDiagnosticsPanel";
import { LiveDotaView } from "./components/LiveDotaView";
import { buildLiveDiagnostics, formatLiveDiagnosticReport } from "./live-diagnostics";
import { useLiveTeamCoachStore } from "./live-store";
import type { GsiLinkView, LiveCaptureStatus, LiveGsiStatus } from "./types";
import { parseLiveCaptureStatus } from "./validation";

// /live-draft "Diagnóstico de conexión": sanitized capability/status only, live, copyable. The engine is a
// fake fetch behind the /engine proxy paths (S5-style, no real network). Identity values are SENTINELS:
// finding one in the panel or the copied text is a leak.

afterEach(cleanup);

const SENTINEL_SESSION = "SENTINEL-SESSION-ID-0000";
const SENTINEL_STEAM_ID = "SENTINEL-STEAMID-76561197960265728";
const SENTINEL_ACCOUNT_ID = "SENTINEL-ACCOUNTID-0000";
const SENTINEL_PLAYER_NAME = "SENTINEL-PLAYER-NAME";
const SENTINEL_MATCH_ID = "SENTINEL-MATCHID-1234567890";
const SENTINEL_TOKEN = "f".repeat(64);
const SENTINEL_LIVE_ID = "SENTINEL_LIVE_ID_aaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SENTINEL_RAW = "SENTINEL-RAW-GSI-PAYLOAD";
const SENTINELS = [SENTINEL_SESSION, SENTINEL_STEAM_ID, SENTINEL_ACCOUNT_ID, SENTINEL_PLAYER_NAME, SENTINEL_MATCH_ID, SENTINEL_TOKEN, SENTINEL_LIVE_ID, SENTINEL_RAW];

function gsi(overrides: Partial<LiveGsiStatus> = {}): LiveGsiStatus {
  return {
    gameState: "DOTA_GAMERULES_STATE_HERO_SELECTION",
    phase: "draft",
    draft: { draftBlock: false, side: true, ownHero: true, bans: false, allyPicks: false, enemyPicks: false },
    draftProgression: false,
    telemetry: [],
    lastPacketAgeMs: 532,
    active: true,
    ...overrides,
  };
}

function liveStatus(sessionId: string, overrides: Partial<LiveCaptureStatus> = {}): LiveCaptureStatus {
  return { schema: "live-capture-status/v1", sessionId, connection: "waiting", lastEventAt: null, captureHealth: "unknown", captureDetail: null, draftPhase: "waiting", localSide: null, lastDetectedPick: null, bans: 0, picks: 0, deferredPicks: 0, rejectedFacts: 0, gsi: null, ...overrides };
}

/** A status that passed validation but carries every identifier the server could ever hold, plus junk. */
function hostileStatus(): LiveCaptureStatus {
  const parsed = parseLiveCaptureStatus({
    ...liveStatus(SENTINEL_SESSION, {
      connection: "connected",
      lastEventAt: "2026-10-02T21:00:00.000Z",
      captureHealth: "degraded",
      captureDetail: `GSI_DRAFT_PARTIAL ${SENTINEL_TOKEN}`,
      draftPhase: "hero_selection",
      localSide: "dire",
      lastDetectedPick: { side: "dire", heroId: 30, position: null, source: "gsi", at: "2026-10-02T21:00:00.000Z" },
      picks: 1,
    }),
    gsi: {
      // A hostile structure list: unknown labels (identity-looking strings) are ignored, known ones survive.
      ...gsi({ gameState: SENTINEL_MATCH_ID, telemetry: ["kda", SENTINEL_PLAYER_NAME], structure: ["section.draft", SENTINEL_PLAYER_NAME, SENTINEL_STEAM_ID] }),
      steamid: SENTINEL_STEAM_ID,
      accountid: SENTINEL_ACCOUNT_ID,
      name: SENTINEL_PLAYER_NAME,
      matchid: SENTINEL_MATCH_ID,
      auth: { token: SENTINEL_TOKEN },
      raw: SENTINEL_RAW,
    },
    liveId: SENTINEL_LIVE_ID,
    token: SENTINEL_TOKEN,
    player: { steamid: SENTINEL_STEAM_ID, name: SENTINEL_PLAYER_NAME },
  });
  expect(parsed).not.toBeNull();
  return parsed!;
}

function report(status: LiveCaptureStatus | null, dotaLink = true): string {
  return formatLiveDiagnosticReport(buildLiveDiagnostics({ engine: "ok", dotaLink, status }));
}

function line(text: string, key: string): string | undefined {
  return text.split("\n").find((entry) => entry.startsWith(`${key}: `))?.slice(key.length + 2);
}

describe("live diagnostics -- sanitized by construction", () => {
  test("no identity field, no token, no raw GSI reaches the copied text", () => {
    const text = report(hostileStatus());
    for (const secret of SENTINELS) expect(text).not.toContain(secret);
    // The structure block names Dota SECTIONS (e.g. "allplayers"): fixed vocabulary, checked separately below.
    const identityText = text.split("\n").filter((entry) => !entry.startsWith("structure.")).join("\n");
    expect(identityText).not.toMatch(/steam|account|player|token|session|liveId|heroId/i);
    for (const entry of text.split("\n").filter((value) => value.startsWith("structure."))) expect(entry).toMatch(/^structure\.[a-zA-Z0-9.]+: (present|absent)( \(unverified\))?$/);
    // No timestamp either (lastEventAt / detected pick time).
    expect(text).not.toContain("2026-10-02");
    // A non-allowlisted value is reported as "other", never echoed.
    expect(line(text, "gsi.gameState")).toBe("other");
    expect(line(text, "captureDetail")).toBe("other");
    // Every line is a known key with a bounded value.
    for (const entry of text.trim().split("\n").filter((value) => value !== "" && value !== "D2KIRO LIVE DIAGNOSTIC")) {
      expect(entry).toMatch(/^[a-zA-Z0-9.]+: [a-zA-Z0-9_/]+( \(unverified\))?$/);
    }
  });

  test("no identity field, no token, no raw GSI reaches the rendered panel", () => {
    const view = render(<LiveDiagnosticsPanel engine="ok" dotaLink status={hostileStatus()} />);
    const panel = view.getByTestId("live-diagnostics");
    for (const secret of SENTINELS) expect(panel.innerHTML).not.toContain(secret);
    view.unmount();
  });
});

describe("live diagnostics -- states", () => {
  test("no link yet: nothing received, nothing claimed", () => {
    const text = report(null, false);
    expect(line(text, "dotaLink")).toBe("NO");
    expect(line(text, "connection")).toBe("none");
    expect(line(text, "firstGsiPacket")).toBe("NO");
    expect(line(text, "lastUpdateAgeMs")).toBe("n/a");
    expect(line(text, "remoteGsiHttps")).toBe("NO");
    expect(text).not.toContain(": YES");
  });

  test("capability transitions: menu heartbeat -> partial draft -> full draft with progression -> match telemetry", () => {
    const linked = liveStatus("s", { connection: "waiting" });
    expect(line(report(linked), "firstGsiPacket")).toBe("NO");

    const menu = report(liveStatus("s", { connection: "connected", gsi: gsi({ phase: "idle", gameState: null, draft: { draftBlock: false, side: false, ownHero: false, bans: false, allyPicks: false, enemyPicks: false } }) }));
    expect([line(menu, "firstGsiPacket"), line(menu, "remoteGsiHttps"), line(menu, "gsi.gameState"), line(menu, "draft.side")]).toEqual(["YES", "YES", "none", "NO"]);

    const partial = report(liveStatus("s", { connection: "connected", draftPhase: "hero_selection", captureHealth: "degraded", captureDetail: "GSI_DRAFT_PARTIAL", gsi: gsi() }));
    expect([line(partial, "draft.side"), line(partial, "draft.ownHero"), line(partial, "draft.bans"), line(partial, "draft.allyPicks"), line(partial, "draft.enemyPicks"), line(partial, "draft.progression")]).toEqual(["YES", "YES", "NO", "NO", "NO", "NO"]);
    expect(line(partial, "captureDetail")).toBe("GSI_DRAFT_PARTIAL");

    const full = report(liveStatus("s", { connection: "connected", draftPhase: "hero_selection", captureHealth: "ok", gsi: gsi({ draft: { draftBlock: true, side: true, ownHero: true, bans: true, allyPicks: true, enemyPicks: true }, draftProgression: true }) }));
    expect(["side", "ownHero", "bans", "allyPicks", "enemyPicks", "progression"].map((key) => line(full, `draft.${key}`))).toEqual(["YES", "YES", "YES", "YES", "YES", "YES"]);

    const match = report(liveStatus("s", { connection: "connected", draftPhase: "ended", gsi: gsi({ phase: "match", gameState: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", telemetry: ["clock_time", "game_time", "hero_level", "hero_health", "kda", "items", "item_changes", "ability_cooldowns"] }) }));
    expect(line(match, "gsi.gameState")).toBe("DOTA_GAMERULES_STATE_GAME_IN_PROGRESS");
    expect(line(match, "telemetry.clock")).toBe("YES");
    expect(line(match, "telemetry.heroLevel")).toBe("YES");
    // HP observed, mana not: said as such, not rounded up to YES.
    expect(line(match, "telemetry.hpMana")).toBe("PARTIAL");
    expect(line(match, "telemetry.items")).toBe("YES");
    expect(line(match, "telemetry.itemChanges")).toBe("YES");
    expect(line(match, "telemetry.cooldowns")).toBe("PARTIAL");
    expect(line(match, "telemetry.netWorth")).toBe("NO");
    expect(line(match, "telemetry.gpmXpm")).toBe("NO");
  });

  test("stale connection: the age keeps growing and HTTPS GSI is no longer active", () => {
    const text = report(liveStatus("s", { connection: "stale", draftPhase: "hero_selection", gsi: gsi({ lastPacketAgeMs: 16_000, active: false }) }));
    expect(line(text, "connection")).toBe("stale");
    expect(line(text, "lastUpdateAgeMs")).toBe("16000");
    expect(line(text, "firstGsiPacket")).toBe("YES");
    expect(line(text, "remoteGsiHttps")).toBe("NO");
  });

  test("engine unreachable: the last status is not presented as an active connection", () => {
    const text = formatLiveDiagnosticReport(buildLiveDiagnostics({ engine: "unreachable", dotaLink: true, status: liveStatus("s", { connection: "connected", gsi: gsi() }) }));
    expect(line(text, "engine")).toBe("unreachable");
    expect(line(text, "remoteGsiHttps")).toBe("NO");
    // The cached connection/age are said to be last-known, not a live reading.
    expect(line(text, "reading")).toBe("last_known");
    expect(line(report(liveStatus("s", { connection: "connected", gsi: gsi() })), "reading")).toBe("live");
    expect(line(report(null), "reading")).toBe("none");
  });

  test("engine unreachable: the panel labels the cached connection and packet age as last-known", () => {
    const view = render(<LiveDiagnosticsPanel engine="unreachable" dotaLink status={liveStatus("s", { connection: "connected", gsi: gsi() })} />);
    expect(view.getByTestId("live-diagnostics-summary").textContent).toContain("último estado conocido");
    expect(view.getByTestId("diag-connection-state").textContent).toContain("último conocido");
    expect(view.getByTestId("diag-connection-age").textContent).toContain("último conocido");
    view.unmount();
    const live = render(<LiveDiagnosticsPanel engine="ok" dotaLink status={liveStatus("s", { connection: "connected", gsi: gsi() })} />);
    expect(live.getByTestId("live-diagnostics").textContent).not.toContain("conocido");
    live.unmount();
  });

  test("validation: the additive diagnostics fields are optional, and refused when malformed", () => {
    const base = liveStatus("s", { gsi: gsi() });
    expect(parseLiveCaptureStatus(base)).not.toBeNull();
    const legacy: Record<string, unknown> = { ...gsi() };
    delete legacy.lastPacketAgeMs;
    delete legacy.active;
    delete legacy.draftProgression;
    expect(parseLiveCaptureStatus({ ...base, gsi: legacy })).not.toBeNull();
    expect(parseLiveCaptureStatus({ ...base, gsi: gsi({ lastPacketAgeMs: -1 }) })).toBeNull();
    expect(parseLiveCaptureStatus({ ...base, gsi: { ...gsi(), active: "yes" } })).toBeNull();
    expect(parseLiveCaptureStatus({ ...base, gsi: { ...gsi(), draftProgression: 1 } })).toBeNull();
  });
});

describe("Copiar diagnóstico", () => {
  function stubClipboard(writeText: (text: string) => Promise<void>): () => void {
    const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    return function restore() {
      if (previous) Object.defineProperty(navigator, "clipboard", previous);
      else Reflect.deleteProperty(navigator, "clipboard");
    };
  }

  test("copies exactly the sanitized report", async () => {
    const writeText = mock(async (_text: string) => undefined);
    const restore = stubClipboard(writeText);
    try {
      const status = liveStatus(SENTINEL_SESSION, { connection: "connected", draftPhase: "hero_selection", captureHealth: "degraded", captureDetail: "GSI_DRAFT_PARTIAL", localSide: "dire", picks: 1, gsi: gsi({ telemetry: ["clock_time", "game_time"] }) });
      const view = render(<LiveDiagnosticsPanel engine="ok" dotaLink status={status} />);
      await act(async () => {
        fireEvent.click(view.getByTestId("live-diagnostics-copy"));
      });
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText.mock.calls[0]?.[0]).toBe(
        [
          "D2KIRO LIVE DIAGNOSTIC",
          "engine: ok",
          "dotaLink: YES",
          "reading: live",
          "connection: connected",
          "firstGsiPacket: YES",
          "lastUpdateAgeMs: 532",
          "remoteGsiHttps: YES",
          "gsi.phase: draft",
          "gsi.gameState: DOTA_GAMERULES_STATE_HERO_SELECTION",
          "draftPhase: hero_selection",
          "captureHealth: degraded",
          "captureDetail: GSI_DRAFT_PARTIAL",
          "counts.bans: 0",
          "counts.picks: 1",
          "counts.deferredPicks: 0",
          "counts.rejectedFacts: 0",
          "",
          "draft.side: YES",
          "draft.ownHero: YES",
          "draft.bans: NO",
          "draft.allyPicks: NO",
          "draft.enemyPicks: NO",
          "draft.progression: NO",
          "",
          "telemetry.clock: YES",
          "telemetry.heroLevel: NO",
          "telemetry.hpMana: NO",
          "telemetry.alive: NO",
          "telemetry.kda: NO",
          "telemetry.lhDn: NO",
          "telemetry.gold: NO",
          "telemetry.gpmXpm: NO",
          "telemetry.netWorth: NO",
          "telemetry.items: NO",
          "telemetry.itemChanges: NO",
          "telemetry.abilities: NO",
          "telemetry.cooldowns: NO",
          "",
          "structure.provider: absent",
          "structure.map: absent",
          "structure.player: absent",
          "structure.hero: absent",
          "structure.abilities: absent",
          "structure.items: absent",
          "structure.draft: absent",
          "structure.draft.team2: absent",
          "structure.draft.team3: absent",
          "structure.draft.slots: absent",
          "structure.allplayers: absent",
          "structure.roster.teamKeyed: absent",
          "structure.roster.entries: absent",
          "structure.roster.multi: absent",
          "structure.roster.full: absent",
          "structure.roster.heroFields: absent",
          "structure.roster.teamFields: absent",
          "structure.rosterCandidate: absent (unverified)",
          "",
          "party.poolPositions: 0/5",
          "",
        ].join("\n"),
      );
      expect(view.getByTestId("live-diagnostics").textContent).toContain("Copiado");
      view.unmount();
    } finally {
      restore();
    }
  });

  test("clipboard refused: the same report is shown to copy by hand, never silently lost", async () => {
    const restore = stubClipboard(async () => {
      throw new Error("denied");
    });
    try {
      const view = render(<LiveDiagnosticsPanel engine="ok" dotaLink status={hostileStatus()} />);
      await act(async () => {
        fireEvent.click(view.getByTestId("live-diagnostics-copy"));
      });
      const shown = view.getByTestId("live-diagnostics-report").textContent ?? "";
      expect(shown.startsWith("D2KIRO LIVE DIAGNOSTIC\n")).toBe(true);
      for (const secret of SENTINELS) expect(shown).not.toContain(secret);
      view.unmount();
    } finally {
      restore();
    }
  });
});

const LINK: GsiLinkView = { sessionId: "gsi-session-1", createdAt: "2026-10-02T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("/live-draft -- the diagnostics follow the live status by themselves", () => {
  test("no link: the section is there and says nothing was received", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input) === "/engine/api/live/gsi-link") return json({ schema: "live-gsi-link/v1", link: null });
      throw new Error(`fetch not mocked: ${String(input)}`);
    }) as typeof fetch;
    try {
      const view = render(<LiveDotaView />);
      await waitFor(() => expect(view.getByTestId("live-diagnostics")).toBeTruthy());
      expect(view.getByTestId("diag-connection-first-packet").getAttribute("data-presence")).toBe("NO");
      expect(view.getByTestId("diag-connection-remote-https").getAttribute("data-presence")).toBe("NO");
      view.unmount();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("linked: the panel updates on the next status poll, with no reload or click", async () => {
    let status = liveStatus(LINK.sessionId, { connection: "waiting" });
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/engine/api/live/gsi-link") return json({ schema: "live-gsi-link/v1", link: LINK });
      if (url.endsWith("/api/session/protocol/live")) return json({ sessionId: LINK.sessionId }, 201);
      if (url.endsWith("/live-status")) return json(status);
      if (url.endsWith("/team-recommendations")) return json({}, 503);
      if (url.endsWith(`/api/session/protocol/${LINK.sessionId}`)) return json({}, 503);
      if (url.endsWith("/api/heroes")) return json([]);
      if (url.endsWith("/api/telemetry/error")) return json({}, 202);
      throw new Error(`fetch not mocked: ${url}`);
    }) as typeof fetch;
    useLiveTeamCoachStore.setState({ captureStatus: null, sessionId: null });
    try {
      const view = render(<LiveDotaView />);
      await waitFor(() => expect(view.getByTestId("diag-connection-state").textContent).toContain("esperando a Dota"));
      expect(view.getByTestId("diag-connection-first-packet").getAttribute("data-presence")).toBe("NO");

      status = liveStatus(LINK.sessionId, { connection: "connected", draftPhase: "hero_selection", captureHealth: "ok", bans: 1, gsi: gsi({ draft: { draftBlock: true, side: true, ownHero: false, bans: true, allyPicks: false, enemyPicks: false } }) });
      await waitFor(() => expect(view.getByTestId("diag-draft-bans").getAttribute("data-presence")).toBe("YES"), { timeout: 3_000 });
      expect(view.getByTestId("diag-connection-first-packet").getAttribute("data-presence")).toBe("YES");
      expect(view.getByTestId("diag-connection-remote-https").getAttribute("data-presence")).toBe("YES");
      expect(view.getByTestId("diag-connection-age").textContent).toContain("532 ms");

      status = liveStatus(LINK.sessionId, { connection: "stale", draftPhase: "hero_selection", bans: 1, gsi: gsi({ lastPacketAgeMs: 16_000, active: false }) });
      await waitFor(() => expect(view.getByTestId("diag-connection-remote-https").getAttribute("data-presence")).toBe("NO"), { timeout: 3_000 });
      expect(view.getByTestId("diag-connection-age").textContent).toContain("16.0 s");
      expect(view.getByTestId("live-diagnostics").innerHTML).not.toContain(LINK.sessionId);
      view.unmount();
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("live diagnostics -- structural capability discovery", () => {
  test("reports present / absent per section from the engine's labels; a roster candidate needs several entries WITH hero fields", () => {
    const none = report(liveStatus("s", { connection: "connected", gsi: gsi({ structure: ["section.player", "section.hero"] }) }));
    expect(line(none, "structure.player")).toBe("present");
    expect(line(none, "structure.draft")).toBe("absent");
    expect(line(none, "structure.allplayers")).toBe("absent");
    expect(line(none, "structure.rosterCandidate")).toBe("absent (unverified)");

    const roster = report(liveStatus("s", { connection: "connected", gsi: gsi({ structure: ["section.allplayers", "roster.player_entries", "roster.multi_entries", "roster.hero_fields", "roster.team_fields"] }) }));
    expect(line(roster, "structure.allplayers")).toBe("present");
    expect(line(roster, "structure.roster.heroFields")).toBe("present");
    expect(line(roster, "structure.rosterCandidate")).toBe("present (unverified)");

    const noHeroes = report(liveStatus("s", { connection: "connected", gsi: gsi({ structure: ["roster.player_entries", "roster.multi_entries"] }) }));
    expect(line(noHeroes, "structure.rosterCandidate")).toBe("absent (unverified)");
  });

  test("no Dota update yet: every structural row is absent, nothing claimed", () => {
    const text = report(null, false);
    expect(text.split("\n").filter((entry) => entry.startsWith("structure.") && !entry.endsWith(": absent") && !entry.endsWith("absent (unverified)"))).toEqual([]);
  });

  test("the panel shows the structure block", () => {
    const view = render(<LiveDiagnosticsPanel engine="ok" dotaLink status={liveStatus("s", { connection: "connected", gsi: gsi({ structure: ["section.draft"] }) })} />);
    expect(view.getByTestId("diag-structure-draft").getAttribute("data-presence")).toBe("YES");
    expect(view.getByTestId("diag-structure-allplayers").getAttribute("data-presence")).toBe("NO");
    expect(view.getByTestId("diag-structure-roster-candidate").textContent).toContain("no");
    view.unmount();
  });
});
