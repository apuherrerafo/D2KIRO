import { describe, expect, test } from "bun:test";
import { visualPill } from "./components/LiveCaptureStatusBar";
import type { LiveCaptureStatus, LiveCompanionVisual } from "./types";

function status(overrides: Partial<LiveCaptureStatus>): LiveCaptureStatus {
  return { schema: "live-capture-status/v1", sessionId: "s", connection: "connected", lastEventAt: null, captureHealth: "ok", captureDetail: null, draftPhase: "waiting", localSide: null, lastDetectedPick: null, bans: 0, picks: 0, deferredPicks: 0, rejectedFacts: 0, ...overrides };
}

const OK = { active: true, health: "ok" as const, detail: "VISUAL_OK", lastEventAgeMs: 100 };
const UNREAD = { active: true, health: "degraded" as const, detail: "VISUAL_SLOTS_UNREAD", lastEventAgeMs: 100 };
const UNVERIFIED = { active: true, health: "degraded" as const, detail: "VISUAL_LAYOUT_UNVERIFIED", lastEventAgeMs: 100 };

function companion(visual: LiveCompanionVisual | null, active = true) {
  return { version: "0.1.0", dota: "not_running" as const, phase: null, restartNeeded: false, visual, active, lastSeenAgeMs: 1000 };
}

describe("visualPill (draft automático en lenguaje llano)", () => {
  test("sin captura visual y sin Companion que diga nada: no disponible, nunca un proceso que reiniciar", () => {
    expect(visualPill(null).text).toBe("● Draft automático no disponible");
    expect(visualPill(status({ visual: null })).text).toBe("● Draft automático no disponible");
    expect(visualPill(status({ visual: null, companion: companion("absent") })).text).toBe("● Draft automático no disponible");
    expect(visualPill(status({ visual: null, companion: companion("failed") })).text).toBe("● Draft automático no disponible");
  });

  test("el Companion lo está preparando (descarga, arranque, reinicio): 'preparando...', no un fallo", () => {
    for (const helper of ["downloading", "restarting", "running"] as const) {
      expect(visualPill(status({ visual: null, companion: companion(helper) })).text).toBe("● Draft automático preparando...");
    }
  });

  test("un Companion que ya no late no puede afirmar que algo se está preparando", () => {
    expect(visualPill(status({ visual: null, companion: companion("downloading", false) })).text).toBe("● Draft automático no disponible");
  });

  test("activo, todavía sin selección de héroes", () => {
    const text = visualPill(status({ visual: OK })).text;
    expect(text).toContain("Draft automático activo");
    expect(text).toContain("esperando selección de héroes");
  });

  test("durante la selección, con cobertura confirmada: N/10 héroes detectados", () => {
    expect(visualPill(status({ visual: OK, draftPhase: "hero_selection", picks: 3 })).text).toBe("● 3/10 héroes detectados");
    expect(visualPill(status({ visual: OK, draftPhase: "hero_selection", picks: 6, bans: 0 })).text).toBe("● 6/10 héroes detectados");
  });

  test("el helper no puede afirmar que leyó todo: 'incompleto', nunca como completo", () => {
    const text = visualPill(status({ visual: UNREAD, draftPhase: "hero_selection", picks: 3 })).text;
    expect(text).toBe("● Draft automático incompleto · 3/10 héroes detectados");
    expect(text).not.toBe("● 3/10 héroes detectados");
  });

  test("todavía sin una lectura que valide la captura: preparando (si ya hay picks, incompleto)", () => {
    expect(visualPill(status({ visual: UNVERIFIED, draftPhase: "hero_selection", picks: 0 })).text).toBe("● Draft automático preparando...");
    expect(visualPill(status({ visual: UNVERIFIED, draftPhase: "hero_selection", picks: 2 })).text).toBe("● Draft automático incompleto · 2/10 héroes detectados");
  });

  test("la captura desaparece o reporta pérdida -> no disponible, sin pedir reiniciar nada", () => {
    for (const visual of [{ ...OK, active: false }, { ...OK, health: "lost" as const }]) {
      const text = visualPill(status({ visual })).text;
      expect(text).toContain("Draft automático no disponible");
      expect(text.toLowerCase()).not.toMatch(/ayudante|reinici/);
    }
  });

  test("draft terminado", () => {
    expect(visualPill(status({ visual: OK, draftPhase: "ended", picks: 10 })).text).toBe("● Draft terminado");
  });

  test("sin jerga de desarrollo ni instrucciones internas, en ningún estado", () => {
    const states = [
      visualPill(null),
      visualPill(status({ visual: null, companion: companion("downloading") })),
      visualPill(status({ visual: OK })),
      visualPill(status({ visual: OK, draftPhase: "hero_selection", picks: 3 })),
      visualPill(status({ visual: UNREAD, draftPhase: "hero_selection", picks: 3 })),
    ];
    for (const pill of states) {
      const text = pill.text.toLowerCase();
      for (const jargon of ["score", "confidence", "ocr", "cv", "layout", "debug", "python", "helper", "ayudante", "proceso", "terminal", "reinicia"]) expect(text).not.toContain(jargon);
    }
  });
});
