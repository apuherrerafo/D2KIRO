import { describe, expect, test } from "bun:test";
import { applyDraftEvent, createIdleDraftState, type DraftEventEnvelope, type DraftState } from "../draft/reducer";
import { buildEnvelopes, createStepPlayer, httpEmit, runSimulator, type DraftScript, type PlaybackClock } from "./player";
import scripts from "./scripts.json";

const captainsMode = scripts.captainsMode as DraftScript;
const allPick = scripts.allPick as DraftScript;

const fixedClock: PlaybackClock = { now: () => 0, genId: (() => {
  let n = 0;
  return () => `evt-${++n}`;
})() };

function replay(envelopes: DraftEventEnvelope[]): DraftState {
  let state = createIdleDraftState(envelopes[0]!.sessionId);
  for (const envelope of envelopes) {
    const result = applyDraftEvent(state, envelope);
    // Un evento rechazado nunca debería aparecer en un guion de prueba bien formado -- si pasa,
    // que la prueba lo delate en vez de seguir en silencio con el estado anterior.
    expect(result.rejected).toBeUndefined();
    state = result.state;
  }
  return state;
}

describe("buildEnvelopes", () => {
  test("genera DraftEventEnvelope con confidence 1.0, source simulator y seq incremental desde 1", () => {
    const envelopes = buildEnvelopes(captainsMode, "session-1", fixedClock);

    expect(envelopes).toHaveLength(captainsMode.events.length);
    envelopes.forEach((envelope, index) => {
      expect(envelope.schema).toBe("draft-event/v1");
      expect(envelope.sessionId).toBe("session-1");
      expect(envelope.source).toBe("simulator");
      expect(envelope.confidence).toBe(1.0);
      expect(envelope.seq).toBe(index + 1);
      expect(envelope.payload).toEqual(captainsMode.events[index]!.event);
    });
  });
});

describe("runSimulator", () => {
  test("modo instant no espera ningún delayMs real", async () => {
    const emitted: DraftEventEnvelope[] = [];
    const sleepCalls: number[] = [];
    const start = Date.now();

    await runSimulator(captainsMode, {
      sessionId: "session-instant",
      speed: "instant",
      emit: (envelope) => {
        emitted.push(envelope);
      },
      clock: fixedClock,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    expect(emitted).toHaveLength(captainsMode.events.length);
    expect(sleepCalls).toHaveLength(0);
    expect(Date.now() - start).toBeLessThan(50);
  });

  test("velocidad configurable: un multiplicador de 2x pide la mitad del delayMs original", async () => {
    const sleepCalls: number[] = [];

    await runSimulator(allPick, {
      sessionId: "session-2x",
      speed: 2,
      emit: () => {},
      clock: fixedClock,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    const expectedDelays = allPick.events.filter((e) => (e.delayMs ?? 0) > 0).map((e) => (e.delayMs ?? 0) / 2);
    expect(sleepCalls).toEqual(expectedDelays);
  });
});

describe("reproducción completa de un guion (sin Dota 2 real, sin perder eventos)", () => {
  test("Captain Mode: 5 picks por lado, el pick_reverted corrige el falso positivo, termina en complete", () => {
    const envelopes = buildEnvelopes(captainsMode, "cm-session", fixedClock);
    const finalState = replay(envelopes);

    expect(finalState.phase).toBe("complete");
    expect(finalState.format).toBe("captains_mode");
    expect(finalState.localSide).toBe("radiant");
    expect(finalState.picks.radiant).toEqual([8, 9, 7, 3, 10]);
    expect(finalState.picks.dire).toEqual([86, 46, 2, 1, 4]);
    // El hero 35 fue "pickeado" y revertido -- no debe quedar en ningún lado del estado final.
    expect(finalState.picks.dire).not.toContain(35);
    expect(finalState.picks.radiant).not.toContain(35);
    expect(finalState.banned).not.toContain(35);
    expect(finalState.banned.sort((a, b) => a - b)).toEqual([5, 6, 14, 26, 44, 74, 101, 120].sort((a, b) => a - b));
    expect(finalState.appliedEventIds).toHaveLength(envelopes.length);
  });

  test("All Pick: reproduce igual (picks, bans, revert) y también termina en complete", () => {
    const envelopes = buildEnvelopes(allPick, "ap-session", fixedClock);
    const finalState = replay(envelopes);

    expect(finalState.phase).toBe("complete");
    expect(finalState.format).toBe("all_pick");
    expect(finalState.localSide).toBe("dire");
    expect(finalState.picks.radiant).toEqual([19, 23, 25, 27, 30]);
    expect(finalState.picks.dire).toEqual([18, 24, 26, 28, 21]);
    expect(finalState.picks.dire).not.toContain(20);
    expect(finalState.appliedEventIds).toHaveLength(envelopes.length);
  });

  test("format:'unknown' no rompe nada aguas abajo del reductor", () => {
    const unknownFormatScript: DraftScript = {
      schema: "draft-script/v1",
      name: "unknown-format-demo",
      events: [
        { event: { type: "session_started", format: "unknown", patch: "" } },
        { event: { type: "local_side_identified", side: "radiant" } },
        { event: { type: "hero_picked", hero: 1, side: "radiant" } },
        { event: { type: "session_ended", reason: "completed" } },
      ],
    };

    const envelopes = buildEnvelopes(unknownFormatScript, "unknown-session", fixedClock);
    const finalState = replay(envelopes);

    expect(finalState.format).toBe("unknown");
    expect(finalState.phase).toBe("complete");
    expect(finalState.picks.radiant).toEqual([1]);
  });
});

describe("createStepPlayer", () => {
  test("expone los mismos envelopes que buildEnvelopes, uno por llamada a next()", () => {
    // Reloj propio de esta prueba -- fixedClock es compartido por todo el archivo, y comparar
    // eventId exigiría que ningún otro test hubiera avanzado su contador antes que este.
    const clock: PlaybackClock = { now: () => 0, genId: (() => {
      let n = 0;
      return () => `step-evt-${++n}`;
    })() };
    const expected = buildEnvelopes(captainsMode, "step-session", clock);
    const player = createStepPlayer(captainsMode, "step-session", { now: () => 0, genId: (() => {
      let n = 0;
      return () => `step-evt-${++n}`;
    })() });

    const collected: DraftEventEnvelope[] = [];
    while (player.hasNext()) {
      collected.push(player.next());
    }

    expect(collected).toEqual(expected);
  });

  test("remaining() decrece con cada next() y hasNext() es false al agotar el guion", () => {
    const player = createStepPlayer(allPick, "step-session-2", fixedClock);
    const total = allPick.events.length;

    expect(player.remaining()).toBe(total);
    player.next();
    expect(player.remaining()).toBe(total - 1);
    expect(player.hasNext()).toBe(true);

    for (let i = 1; i < total; i++) player.next();
    expect(player.hasNext()).toBe(false);
    expect(player.remaining()).toBe(0);
  });

  test("next() lanza si ya no quedan eventos -- nunca inventa un evento vacío", () => {
    const player = createStepPlayer(allPick, "step-session-3", fixedClock);
    for (let i = 0; i < allPick.events.length; i++) player.next();

    expect(() => player.next()).toThrow();
  });
});

describe("httpEmit", () => {
  test("emite hacia POST /ingest/draft-event con x-capture-token, misma ruta que un capturador real", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch: typeof fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init! });
      return new Response(null, { status: 202 });
    }) as typeof fetch;

    const emit = httpEmit("http://127.0.0.1:4000", "test-token", fakeFetch);
    const [envelope] = buildEnvelopes(captainsMode, "http-session", fixedClock);
    await emit(envelope!);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:4000/ingest/draft-event");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>)["x-capture-token"]).toBe("test-token");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(envelope);
  });
});
