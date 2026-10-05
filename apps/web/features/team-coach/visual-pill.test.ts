import { describe, expect, test } from "bun:test";
import { visualPill } from "./components/LiveCaptureStatusBar";
import type { LiveCaptureStatus } from "./types";

function status(overrides: Partial<LiveCaptureStatus>): LiveCaptureStatus {
  return { schema: "live-capture-status/v1", sessionId: "s", connection: "connected", lastEventAt: null, captureHealth: "ok", captureDetail: null, draftPhase: "waiting", localSide: null, lastDetectedPick: null, bans: 0, picks: 0, deferredPicks: 0, rejectedFacts: 0, ...overrides };
}

const OK = { active: true, health: "ok" as const, detail: "VISUAL_OK", lastEventAgeMs: 100 };

describe("visualPill (captura visual en lenguaje llano)", () => {
  test("sin ayudante: esperando, nunca un error", () => {
    expect(visualPill(null).text).toContain("esperando al ayudante local");
    expect(visualPill(status({ visual: null })).text).toContain("esperando al ayudante local");
  });

  test("ventana encontrada, todavía sin selección de héroes", () => {
    expect(visualPill(status({ visual: OK })).text).toContain("esperando selección de héroes");
  });

  test("durante la selección muestra N/10 héroes reconocidos (sin bans no se bloquea nada)", () => {
    expect(visualPill(status({ visual: OK, draftPhase: "hero_selection", picks: 6, bans: 0 })).text).toBe("● 6/10 héroes reconocidos");
  });

  test("el ayudante desaparece o reporta pérdida -> degradada", () => {
    expect(visualPill(status({ visual: { ...OK, active: false } })).text).toContain("degradada");
    expect(visualPill(status({ visual: { ...OK, health: "lost" } })).text).toContain("degradada");
  });

  test("draft terminado", () => {
    expect(visualPill(status({ visual: OK, draftPhase: "ended", picks: 10 })).text).toBe("● Draft terminado");
  });

  test("sin jerga de desarrollo", () => {
    const text = visualPill(status({ visual: OK, draftPhase: "hero_selection", picks: 3 })).text.toLowerCase();
    for (const jargon of ["score", "confidence", "ocr", "cv", "layout", "debug"]) expect(text).not.toContain(jargon);
  });
});
