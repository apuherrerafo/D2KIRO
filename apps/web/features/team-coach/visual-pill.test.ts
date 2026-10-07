import { describe, expect, test } from "bun:test";
import { visualPill } from "./components/LiveCaptureStatusBar";
import type { LiveCaptureStatus } from "./types";

function status(overrides: Partial<LiveCaptureStatus>): LiveCaptureStatus {
  return { schema: "live-capture-status/v1", sessionId: "s", connection: "connected", lastEventAt: null, captureHealth: "ok", captureDetail: null, draftPhase: "waiting", localSide: null, lastDetectedPick: null, bans: 0, picks: 0, deferredPicks: 0, rejectedFacts: 0, ...overrides };
}

const OK = { active: true, health: "ok" as const, detail: "VISUAL_OK", lastEventAgeMs: 100 };

describe("visualPill (captura visual en lenguaje llano)", () => {
  test("sin captura visual: neutral, nunca un error ni un proceso que reiniciar", () => {
    expect(visualPill(null).text).toBe("● Captura automática no disponible");
    expect(visualPill(status({ visual: null })).text).toBe("● Captura automática no disponible");
  });

  test("ventana encontrada, todavía sin selección de héroes", () => {
    expect(visualPill(status({ visual: OK })).text).toContain("esperando selección de héroes");
  });

  test("durante la selección muestra N/10 héroes reconocidos (sin bans no se bloquea nada)", () => {
    expect(visualPill(status({ visual: OK, draftPhase: "hero_selection", picks: 6, bans: 0 })).text).toBe("● 6/10 héroes reconocidos");
  });

  test("la captura desaparece o reporta pérdida -> no disponible, sin pedir reiniciar nada", () => {
    for (const visual of [{ ...OK, active: false }, { ...OK, health: "lost" as const }]) {
      const text = visualPill(status({ visual })).text;
      expect(text).toContain("Captura automática no disponible");
      expect(text.toLowerCase()).not.toMatch(/ayudante|reinici/);
    }
  });

  test("draft terminado", () => {
    expect(visualPill(status({ visual: OK, draftPhase: "ended", picks: 10 })).text).toBe("● Draft terminado");
  });

  test("sin jerga de desarrollo", () => {
    const text = visualPill(status({ visual: OK, draftPhase: "hero_selection", picks: 3 })).text.toLowerCase();
    for (const jargon of ["score", "confidence", "ocr", "cv", "layout", "debug"]) expect(text).not.toContain(jargon);
  });
});
