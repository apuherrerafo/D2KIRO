import { describe, expect, test } from "bun:test";
import { companionPill, connectionPill, phasePill } from "./components/LiveCaptureStatusBar";
import type { LiveCaptureStatus, LiveCompanionStatus } from "./types";
import { parseLiveCaptureStatus } from "./validation";

// D2KIRO Companion on /live-draft: COMPANION connected / missing, DOTA connected / waiting, PHASE -- in player
// language, and an old heartbeat is never presented as current.

function status(overrides: Partial<LiveCaptureStatus>): LiveCaptureStatus {
  return { schema: "live-capture-status/v1", sessionId: "s", connection: "waiting", lastEventAt: null, captureHealth: "unknown", captureDetail: null, draftPhase: "waiting", localSide: null, lastDetectedPick: null, bans: 0, picks: 0, deferredPicks: 0, rejectedFacts: 0, ...overrides };
}

const COMPANION: LiveCompanionStatus = { version: "0.1.0", dota: "not_running", phase: null, restartNeeded: false, active: true, lastSeenAgeMs: 2_000 };

describe("companionPill", () => {
  test("missing before any heartbeat (or older engines without the field)", () => {
    expect(companionPill(null).text).toBe("● Companion no detectado");
    expect(companionPill(status({})).text).toBe("● Companion no detectado");
    expect(companionPill(status({ companion: null })).text).toBe("● Companion no detectado");
  });

  test("connected while beating -- even with Dota closed", () => {
    expect(companionPill(status({ companion: COMPANION })).text).toBe("● Companion conectado");
  });

  test("a stale heartbeat says so instead of claiming connected", () => {
    expect(companionPill(status({ companion: { ...COMPANION, active: false } })).text).toContain("sin señal");
  });
});

describe("connectionPill with the Companion", () => {
  test("Dota closed / open but silent / needs one restart, as the Companion sees it", () => {
    expect(connectionPill(status({ companion: COMPANION })).text).toContain("abre Dota 2");
    expect(connectionPill(status({ companion: { ...COMPANION, dota: "waiting" } })).text).toContain("esperando datos");
    expect(connectionPill(status({ companion: { ...COMPANION, dota: "waiting", restartNeeded: true } })).text).toContain("Reinicia Dota 2 una vez");
  });

  test("GSI reaching the session wins; without a live Companion the old wording stays", () => {
    expect(connectionPill(status({ connection: "connected", companion: COMPANION })).text).toBe("● Dota conectado");
    expect(connectionPill(status({ companion: { ...COMPANION, active: false } })).text).toBe("● Esperando Dota...");
    expect(connectionPill(status({})).text).toBe("● Esperando Dota...");
  });
});

describe("phasePill", () => {
  test("the Companion's local phase while Dota is connected", () => {
    expect(phasePill(status({ companion: { ...COMPANION, dota: "connected", phase: "HERO_SELECTION" } })).text).toBe("Hero Selection");
    expect(phasePill(status({ companion: { ...COMPANION, dota: "connected", phase: "STRATEGY_TIME" } })).text).toBe("Strategy Time");
    expect(phasePill(status({ companion: { ...COMPANION, dota: "connected", phase: "MENU" } })).text).toBe("Menú");
  });

  test("falls back to the GSI phase the session received; nothing known -> a dash", () => {
    const gsi = { gameState: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", phase: "match" as const, draft: { draftBlock: false, side: true, ownHero: true, bans: false, allyPicks: false, enemyPicks: false }, telemetry: [], active: true };
    expect(phasePill(status({ gsi })).text).toBe("Partida en curso");
    expect(phasePill(status({ gsi: { ...gsi, active: false } })).text).toBe("—");
    expect(phasePill(null).text).toBe("—");
  });
});

describe("status mirror validation", () => {
  const base = status({});
  test("accepts a valid companion block, null, or none at all", () => {
    expect(parseLiveCaptureStatus({ ...base, companion: COMPANION })?.companion).toEqual(COMPANION);
    expect(parseLiveCaptureStatus({ ...base, companion: null })).not.toBeNull();
    expect(parseLiveCaptureStatus(base)).not.toBeNull();
  });

  test("refuses a malformed companion block", () => {
    for (const bad of [{ ...COMPANION, dota: "maybe" }, { ...COMPANION, phase: "DRAFT" }, { ...COMPANION, active: "yes" }, { ...COMPANION, lastSeenAgeMs: -1 }, { ...COMPANION, version: 1 }]) {
      expect(parseLiveCaptureStatus({ ...base, companion: bad })).toBeNull();
    }
  });
});
