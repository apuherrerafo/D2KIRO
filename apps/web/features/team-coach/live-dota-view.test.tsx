import "@/test-support/happy-dom";

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import { LiveDotaView } from "./components/LiveDotaView";
import { LiveManualEntry } from "./components/LiveManualEntry";
import { useLiveTeamCoachStore } from "./live-store";
import type { GsiLinkView, LiveCaptureStatus, LiveGsiStatus, TeamCoachBoardData } from "./types";
import { parseGsiLink, parseLiveCaptureStatus } from "./validation";

// TSK-219 -- /live-draft on the deployed site: connect Dota once, then the live Team Coach follows the
// account's link. The engine is a fake fetch behind the /engine proxy paths (S5-style, no real network).

afterEach(cleanup);

/** Normal-user UI must never mention developer tooling, ports or local processes. */
const DEVELOPER_TERMS = /127\.0\.0\.1|localhost|:4000|:4001|\bport\b|\bbun\b|\bnpm\b|powershell|overwolf|capture token|dev:live|probe:gsi|engine process|motor local|terminal/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function gsi(overrides: Partial<LiveGsiStatus> = {}): LiveGsiStatus {
  return { gameState: "DOTA_GAMERULES_STATE_HERO_SELECTION", phase: "draft", draft: { draftBlock: false, side: true, ownHero: true, bans: false, allyPicks: false, enemyPicks: false }, telemetry: [], ...overrides };
}

function liveStatus(sessionId: string, overrides: Partial<LiveCaptureStatus> = {}): LiveCaptureStatus {
  return { schema: "live-capture-status/v1", sessionId, connection: "waiting", lastEventAt: null, captureHealth: "unknown", captureDetail: null, draftPhase: "waiting", localSide: null, lastDetectedPick: null, bans: 0, picks: 0, deferredPicks: 0, rejectedFacts: 0, gsi: null, ...overrides };
}

function board(sessionId: string): TeamCoachBoardData {
  return {
    schema: "team-coach-board/v1",
    sessionId,
    stateIdentity: "s0",
    currentDecision: { recommendedPosition: 1, recommendedHeroId: 11, targetBasis: "DETERMINISTIC_DEFAULT", reason: "fixture", actionablePositions: [1, 2, 3, 4, 5], roundCapacity: 2 },
    positions: ([1, 2, 3, 4, 5] as const).map((position) => ({
      position,
      eligibleNow: true,
      alreadyFilled: false,
      filledHeroId: null,
      state: "RANKED" as const,
      primaryHeroId: position * 10 + 1,
      top: [1, 2].map((k) => ({ heroId: position * 10 + k, rank: k, score: 10 - k, reasons: ["fixture"], isPrimary: k === 1 })),
      stateIdentity: "s0",
      note: null,
    })),
    unboundOwnHeroIds: [],
  };
}

const LINK: GsiLinkView = { sessionId: "gsi-session-1", createdAt: "2026-10-02T00:00:00.000Z", expiresAt: "2026-11-01T00:00:00.000Z" };

class FakeSite {
  readonly requests: { url: string; method: string }[] = [];
  link: GsiLinkView | null = null;
  status: LiveCaptureStatus | null = null;

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    this.requests.push({ url, method });
    if (url === "/engine/api/live/gsi-link" && method === "DELETE") {
      this.link = null;
      return json({ schema: "live-gsi-link/v1", link: null });
    }
    if (url === "/engine/api/live/gsi-link") return json({ schema: "live-gsi-link/v1", link: this.link });
    const sessionId = this.link?.sessionId ?? "none";
    if (url.endsWith("/api/session/protocol/live")) return json({ sessionId }, 201);
    if (url.endsWith("/live-status")) return json(this.status ?? liveStatus(sessionId));
    if (url.endsWith("/team-recommendations")) return json(board(sessionId));
    if (url.endsWith(`/api/session/protocol/${sessionId}`)) {
      return json({ view: { schema: "draft-protocol-perspective/v1", sessionId, status: "ACTIVE", viewerSide: "radiant", bannedHeroes: [], ownPicks: [], enemyPicks: [], rankedAp: { phase: "BAN_PHASE", banResolutionComplete: false }, captainsMode: null }, legalActions: [], simulator: null, ownAssignedPositions: [], canYield: false });
    }
    if (url.endsWith("/api/heroes")) return json([]);
    if (url.endsWith("/api/telemetry/error")) return json({}, 202);
    throw new Error(`fetch not mocked: ${method} ${url}`);
  };

  count(predicate: (entry: { url: string; method: string }) => boolean): number {
    return this.requests.filter(predicate).length;
  }
}

async function withSite<T>(site: FakeSite, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = site.fetch as typeof fetch;
  useLiveTeamCoachStore.setState({ captureStatus: null, sessionId: null });
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function stopRealSubmit(form: HTMLFormElement): void {
  form.addEventListener("submit", function preventNavigation(event) {
    event.preventDefault();
  });
}

describe("LiveDotaView -- connect Dota", () => {
  test("no link: 'Dota desconectado' + 'Conectar Dota' opens the one-time setup (Windows installer first, manual fallback kept)", async () => {
    const site = new FakeSite();
    await withSite(site, async () => {
      const view = render(<LiveDotaView />);
      await waitFor(() => expect(view.getByTestId("dota-disconnected").textContent).toBe("● Dota desconectado"));
      expect(view.queryByTestId("dota-setup-steps")).toBeNull();
      await act(async () => {
        fireEvent.click(view.getByTestId("dota-connect-button"));
      });
      const steps = view.getByTestId("dota-setup-steps");
      // Recommended first: the one-time D2KIRO Companion (same-origin form POST, never a script asking for the link).
      const companion = view.getByTestId("companion-installer-download");
      expect(companion.textContent).toBe("Instalar D2KIRO Companion");
      expect(companion.closest("form")!.getAttribute("method")).toBe("post");
      expect(companion.closest("form")!.getAttribute("action")).toBe("/api/live/companion-installer");
      expect(view.getByTestId("companion-install").textContent).toContain("arranca solo con Windows");
      // Normal path: one double-click installer, honest about the unsigned-file warning before it happens.
      const installer = view.getByTestId("gsi-installer-download");
      expect(installer.textContent).toBe("Descargar instalador para Windows");
      const installerForm = installer.closest("form")!;
      expect(installerForm.getAttribute("method")).toBe("post");
      expect(installerForm.getAttribute("action")).toBe("/api/live/gsi-installer");
      expect(steps.textContent).toContain("Abrilo con doble clic");
      expect(view.getByTestId("gsi-installer-warning").textContent).toContain("Ejecutar de todas formas");
      // A PC that blocks unsigned scripts outright (Smart App Control, work machines) is sent to the manual way, up front.
      expect(view.getByTestId("gsi-installer-warning").textContent).toContain("Control inteligente de aplicaciones");
      expect(view.getByTestId("gsi-uninstaller-download").getAttribute("href")).toBe("/api/live/gsi-uninstaller");
      // Fallback: the raw cfg and the exact folder, folded away.
      expect((view.getByTestId("gsi-manual-install") as HTMLDetailsElement).open).toBe(false);
      expect(steps.textContent).toContain("Instala este archivo una sola vez y reinicia Dota 2.");
      expect(steps.textContent).toContain("game\\dota\\cfg\\gamestate_integration");
      expect(steps.textContent).toContain("D:\\SteamLibrary\\steamapps\\common\\dota 2 beta\\game\\dota\\cfg\\gamestate_integration\\");
      expect(steps.textContent).toContain("-gamestateintegration");
      const download = view.getByTestId("gsi-download");
      expect(download.textContent).toBe("Descargar configuración D2KIRO");
      const form = download.closest("form")!;
      expect(form.getAttribute("method")).toBe("post");
      expect(form.getAttribute("action")).toBe("/api/live/gsi-config");
      expect(view.getByTestId("live-dota").textContent).not.toMatch(DEVELOPER_TERMS);
      view.unmount();
    });
  });

  test("after the download, the page picks up the new link by itself and shows the live board waiting for Dota", async () => {
    const site = new FakeSite();
    await withSite(site, async () => {
      const view = render(<LiveDotaView fetchImpl={site.fetch as typeof fetch} />);
      await waitFor(() => expect(view.getByTestId("dota-connect-button")).toBeTruthy());
      await act(async () => {
        fireEvent.click(view.getByTestId("dota-connect-button"));
      });
      const form = view.getByTestId("gsi-download").closest("form")!;
      stopRealSubmit(form);
      await act(async () => {
        fireEvent.submit(form);
      });
      site.link = LINK;
      await waitFor(() => expect(view.getByTestId("live-team-coach")).toBeTruthy(), { timeout: 5_000 });
      await waitFor(() => expect(site.count((entry) => entry.url.endsWith(`/${LINK.sessionId}/live-status`))).toBeGreaterThan(0));
      await waitFor(() => expect(view.getByTestId("live-capture-status").textContent).toContain("● Esperando Dota..."));
      expect((view.getByTestId("dota-link-controls") as HTMLDetailsElement).open).toBe(true);
      expect(view.getByTestId("dota-link-controls").textContent).toContain("Esperando Dota...");
      expect(view.getByTestId("live-team-coach").textContent).not.toMatch(DEVELOPER_TERMS);
      view.unmount();
    });
  });

  test("Dota reporting a partial draft: connected, Hero Selection, honest 'usar entrada manual' with what Dota sent", async () => {
    const site = new FakeSite();
    site.link = LINK;
    site.status = liveStatus(LINK.sessionId, { connection: "connected", lastEventAt: "2026-10-02T00:00:01.000Z", captureHealth: "degraded", captureDetail: "GSI_DRAFT_PARTIAL", draftPhase: "hero_selection", localSide: "dire", picks: 1, gsi: gsi() });
    await withSite(site, async () => {
      const view = render(<LiveDotaView />);
      await waitFor(() => expect(view.getByTestId("live-capture-partial")).toBeTruthy());
      const statusText = view.getByTestId("live-capture-status").textContent ?? "";
      expect(statusText).toContain("● Dota conectado");
      expect(statusText).toContain("● Hero Selection · captura parcial");
      expect(statusText).toContain("Dire");
      expect(view.getByTestId("live-capture-partial").textContent).toContain("Captura no disponible — usar entrada manual");
      expect(view.getByTestId("live-capture-capabilities").textContent).toBe("Dota informa — bando: sí · tu héroe: sí · bans: no · picks aliados: no · picks rivales: no");
      expect((view.getByTestId("live-manual-entry") as HTMLDetailsElement).open).toBe(true);
      // Dota has spoken: the setup collapses.
      expect((view.getByTestId("dota-link-controls") as HTMLDetailsElement).open).toBe(false);
      expect(view.getByTestId("live-team-coach").textContent).not.toMatch(DEVELOPER_TERMS);
      view.unmount();
    });
  });

  test("Dota quiet after connecting: 'Reconectando...', the draft and manual entry stay", async () => {
    const site = new FakeSite();
    site.link = LINK;
    site.status = liveStatus(LINK.sessionId, { connection: "stale", lastEventAt: "2026-10-02T00:00:01.000Z", captureHealth: "ok", draftPhase: "hero_selection", localSide: "radiant", picks: 2, gsi: gsi({ draft: { draftBlock: true, side: true, ownHero: true, bans: true, allyPicks: true, enemyPicks: true } }) });
    await withSite(site, async () => {
      const view = render(<LiveDotaView />);
      await waitFor(() => expect(view.getByTestId("live-capture-status").textContent).toContain("● Reconectando..."));
      expect(view.getByTestId("live-capture-degraded").textContent).toContain("El draft no se perdió");
      view.unmount();
    });
  });

  test("'Desconectar Dota' revokes the link and returns to 'Dota desconectado'", async () => {
    const site = new FakeSite();
    site.link = LINK;
    await withSite(site, async () => {
      const view = render(<LiveDotaView />);
      await waitFor(() => expect(view.getByTestId("dota-disconnect")).toBeTruthy());
      await act(async () => {
        fireEvent.click(view.getByTestId("dota-disconnect"));
      });
      await waitFor(() => expect(view.getByTestId("dota-disconnected")).toBeTruthy());
      expect(site.count((entry) => entry.method === "DELETE" && entry.url === "/engine/api/live/gsi-link")).toBe(1);
      view.unmount();
    });
  });

  test("a failed download comes back with a plain-language reason", async () => {
    const site = new FakeSite();
    await withSite(site, async () => {
      const view = render(<LiveDotaView setupError="session" />);
      await waitFor(() => expect(view.getByTestId("gsi-setup-error").textContent).toContain("Tu sesión venció"));
      expect(view.getByTestId("dota-setup-steps")).toBeTruthy();
      view.unmount();
    });
  });
});

describe("LiveDotaView -- a finished draft never says PICK NOW", () => {
  function degradedStatus(draftPhase: "hero_selection" | "ended"): LiveCaptureStatus {
    return liveStatus(LINK.sessionId, { connection: "connected", lastEventAt: "2026-10-02T00:00:01.000Z", captureHealth: "degraded", captureDetail: "GSI_DRAFT_PARTIAL", draftPhase, localSide: "radiant", picks: 1, gsi: gsi() });
  }

  test("control: during hero selection the board recommends a pick now and offers manual picks", async () => {
    const site = new FakeSite();
    site.link = LINK;
    site.status = degradedStatus("hero_selection");
    await withSite(site, async () => {
      const view = render(<LiveDotaView />);
      await waitFor(() => expect(view.getByTestId("team-coach-decision")).toBeTruthy());
      expect(view.getByTestId("team-coach-board").textContent).toContain("RECOMMENDED PICK NOW");
      expect(view.getAllByTestId("team-coach-pick-now")).toHaveLength(1);
      expect(view.queryByTestId("team-coach-draft-ended")).toBeNull();
      expect(view.getAllByRole("button", { name: /^Elegir / }).length).toBeGreaterThan(0);
      view.unmount();
    });
  });

  test("draftPhase=ended: no PICK NOW anywhere, the draft-ended notice instead, nothing pickable; the last reading stays as reference", async () => {
    const site = new FakeSite();
    site.link = LINK;
    site.status = degradedStatus("ended");
    await withSite(site, async () => {
      const view = render(<LiveDotaView />);
      await waitFor(() => expect(view.getByTestId("team-coach-draft-ended")).toBeTruthy());
      const text = view.getByTestId("live-team-coach").textContent ?? "";
      expect(text).not.toMatch(/PICK NOW/i);
      expect(view.queryByTestId("team-coach-decision")).toBeNull();
      expect(view.queryByTestId("team-coach-pick-now")).toBeNull();
      expect(view.getByTestId("team-coach-draft-ended").textContent).toContain("DRAFT TERMINADO");
      expect(view.queryAllByRole("button", { name: /^Elegir / })).toHaveLength(0);
      // The board is kept as reference (five columns), and the session is NOT torn down.
      expect(view.getAllByTestId(/^team-coach-column-/)).toHaveLength(5);
      expect(view.getByTestId("live-capture-status").textContent).toContain("Draft terminado");
      view.unmount();
    });
  });

  test("the same session going from hero selection to ended flips the banner without a reload", async () => {
    const site = new FakeSite();
    site.link = LINK;
    site.status = degradedStatus("hero_selection");
    await withSite(site, async () => {
      const view = render(<LiveDotaView />);
      await waitFor(() => expect(view.getByTestId("team-coach-decision")).toBeTruthy());
      site.status = degradedStatus("ended");
      await waitFor(() => expect(view.getByTestId("team-coach-draft-ended")).toBeTruthy(), { timeout: 5_000 });
      expect(view.queryByTestId("team-coach-decision")).toBeNull();
      view.unmount();
    });
  });
});

describe("validation mirrors (engine -> web)", () => {
  test("gsi link view: link, no link, garbage", () => {
    expect(parseGsiLink({ schema: "live-gsi-link/v1", link: LINK })).toEqual(LINK);
    expect(parseGsiLink({ schema: "live-gsi-link/v1", link: null })).toBeNull();
    expect(parseGsiLink({ schema: "live-gsi-link/v1", link: { sessionId: 1 } })).toBeUndefined();
    expect(parseGsiLink({ link: LINK })).toBeUndefined();
  });

  test("live status accepts the additive gsi block and the 'gsi' pick source; refuses a malformed gsi block", () => {
    const withGsi = liveStatus("s", { gsi: gsi(), lastDetectedPick: { side: "radiant", heroId: 8, position: null, source: "gsi", at: "x" } });
    expect(parseLiveCaptureStatus(withGsi)).not.toBeNull();
    const withoutGsi: Record<string, unknown> = { ...withGsi };
    delete withoutGsi.gsi;
    expect(parseLiveCaptureStatus(withoutGsi)).not.toBeNull();
    expect(parseLiveCaptureStatus({ ...withGsi, gsi: { ...gsi(), phase: "lobby" } })).toBeNull();
    expect(parseLiveCaptureStatus({ ...withGsi, gsi: { ...gsi(), draft: { side: "yes" } } })).toBeNull();
  });
});

describe("LiveManualEntry -- corrections (Greptile TSK-219)", () => {
  test("a mistaken ban / own pick / enemy pick can be removed; each sends the matching correction", async () => {
    const reports: unknown[] = [];
    function handleReport(observation: unknown) {
      reports.push(observation);
    }
    const heroes = new Map([[8, { id: 8, name: "npc_dota_hero_juggernaut", localizedName: "Juggernaut", imgUrl: "", primaryAttr: "agi", attackType: "Melee", roles: [] }]]);
    const view = render(
      <LiveManualEntry heroCatalog={heroes} unavailableHeroIds={new Set([8, 21, 30])} bans={[30]} ownPicks={[8]} enemyPicks={[21]} localSide="dire" position={null} onSelectPosition={() => undefined} draftStarted open error={null} onReport={handleReport} />,
    );
    expect(view.getByTestId("live-manual-corrections").textContent).toContain("Juggernaut");
    await act(async () => {
      fireEvent.click(view.getByTestId("live-correction-30"));
      fireEvent.click(view.getByTestId("live-correction-8"));
      fireEvent.click(view.getByTestId("live-correction-21"));
    });
    expect(reports).toEqual([
      { type: "unban", heroId: 30 },
      { type: "revert", side: "dire", heroId: 8 },
      { type: "revert", side: "radiant", heroId: 21 },
    ]);
    view.unmount();
  });
});
