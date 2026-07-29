import { describe, expect, test } from "bun:test";
import { buildSimulatorEnvelopes, runSimulatorPlayback } from "./simulator";
import { SIMULATOR_SCENARIOS } from "./simulator-scripts";

const captainsMode = SIMULATOR_SCENARIOS.captainsMode;
const allPick = SIMULATOR_SCENARIOS.allPick;

describe("buildSimulatorEnvelopes", () => {
  test("un envelope por evento del guion, seq incremental desde 1, delayMs propagado", () => {
    const envelopes = buildSimulatorEnvelopes(captainsMode);

    expect(envelopes).toHaveLength(captainsMode.events.length);
    envelopes.forEach((envelope, index) => {
      expect(envelope.seq).toBe(index + 1);
      expect(envelope.payload).toEqual(captainsMode.events[index]!.event);
      expect(envelope.delayMs).toBe(captainsMode.events[index]!.delayMs ?? 0);
    });
  });
});

describe("runSimulatorPlayback", () => {
  test("emite en orden, esperando delayMs/speed entre cada evento", async () => {
    const envelopes = buildSimulatorEnvelopes(allPick);
    const sleepCalls: number[] = [];
    const posted: { sessionId: string; seq: number }[] = [];

    await runSimulatorPlayback(envelopes, {
      sessionId: "session-2x",
      speed: 2,
      post: async (sessionId, seq) => {
        posted.push({ sessionId, seq });
        return { accepted: true };
      },
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    expect(posted).toHaveLength(envelopes.length);
    expect(posted.map((p) => p.seq)).toEqual(envelopes.map((e) => e.seq));
    const expectedDelays = envelopes.filter((e) => e.delayMs > 0).map((e) => e.delayMs / 2);
    expect(sleepCalls).toEqual(expectedDelays);
  });

  test("se detiene apenas isCancelled() es true, sin emitir el resto del guion", async () => {
    const envelopes = buildSimulatorEnvelopes(captainsMode);
    const posted: number[] = [];
    let cancelled = false;

    await runSimulatorPlayback(envelopes, {
      sessionId: "session-cancel",
      speed: 1,
      post: async (_sessionId, seq) => {
        posted.push(seq);
        if (posted.length === 2) cancelled = true; // cancela a mitad de camino
        return { accepted: true };
      },
      sleep: async () => {},
      isCancelled: () => cancelled,
    });

    expect(posted.length).toBeGreaterThan(0);
    expect(posted.length).toBeLessThan(envelopes.length);
  });
});
