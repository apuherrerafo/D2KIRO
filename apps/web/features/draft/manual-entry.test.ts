import { afterEach, describe, expect, test } from "bun:test";
import { describeRejection, postManualEvent } from "./manual-entry";

const originalFetch = global.fetch;

describe("postManualEvent", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("envía un DraftEventEnvelope válido a /api/session/manual con source:'manual' y confidence:1", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    global.fetch = (async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    }) as typeof fetch;

    const result = await postManualEvent("session-1", 5, { type: "hero_picked", hero: 1, side: "radiant" });

    expect(capturedUrl).toContain("/api/session/manual");
    expect(capturedBody).toMatchObject({
      schema: "draft-event/v1",
      sessionId: "session-1",
      seq: 6, // lastSeq + 1
      source: "manual",
      confidence: 1,
      payload: { type: "hero_picked", hero: 1, side: "radiant" },
    });
    expect(typeof capturedBody.eventId).toBe("string");
    expect(result).toEqual({ accepted: true });
  });

  test("propaga accepted:false y el motivo de rechazo del motor", async () => {
    global.fetch = (async () =>
      new Response(JSON.stringify({ accepted: false, rejected: "hero_already_taken" }), { status: 202 })) as unknown as typeof fetch;

    const result = await postManualEvent("session-1", 5, { type: "hero_picked", hero: 1, side: "radiant" });

    expect(result).toEqual({ accepted: false, rejected: "hero_already_taken" });
  });
});

// TSK-071: ManualEntryPanel y el "Pickear" directo de DraftView (ActiveDraftState.handleQuickPick)
// llaman a este mismo helper -- una sola prueba cubre a los dos puntos de entrada, en vez de
// duplicar el candado de "nunca un código crudo en pantalla" en dos archivos de componente.
describe("describeRejection", () => {
  test("mapea cada RejectionReason real del motor a una frase sin el código crudo", () => {
    const reasons = ["hero_already_taken", "wrong_phase", "stale_seq", "duplicate_event", "unknown_hero", "roster_full", "wrong_turn"];
    for (const reason of reasons) {
      const message = describeRejection(reason);
      expect(message).not.toBe(reason);
      expect(message.length).toBeGreaterThan(0);
    }
  });

  test("un motivo no reconocido no se traga en silencio -- se muestra igual, con contexto", () => {
    expect(describeRejection("algo_nuevo_del_motor")).toContain("algo_nuevo_del_motor");
  });

  test("sin motivo (undefined) -> mensaje propio, nunca 'undefined' en pantalla", () => {
    expect(describeRejection(undefined)).not.toContain("undefined");
  });
});
