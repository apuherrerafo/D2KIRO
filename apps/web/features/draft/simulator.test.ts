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

  test("con pool vacío, el comportamiento es idéntico al guion fijo (regresión cero)", () => {
    const envelopes = buildSimulatorEnvelopes(captainsMode, []);

    envelopes.forEach((envelope, index) => {
      expect(envelope.payload).toEqual(captainsMode.events[index]!.event);
    });
  });

  test("TSK-028: los picks del lado local salen del pool en orden, el resto sigue el guion", () => {
    // captainsMode: local_side_identified=radiant, 5 picks radiant en el guion (8, 9, 7, 3, 10).
    const pool = [9001, 9002];
    const envelopes = buildSimulatorEnvelopes(captainsMode, pool);

    const radiantPicks = envelopes
      .map((e) => e.payload)
      .filter((p): p is Extract<typeof p, { type: "hero_picked" }> => p.type === "hero_picked" && p.side === "radiant");

    expect(radiantPicks.map((p) => p.hero)).toEqual([9001, 9002, 7, 3, 10]);

    // El lado rival (dire) nunca se toca.
    const direPicks = envelopes
      .map((e) => e.payload)
      .filter((p): p is Extract<typeof p, { type: "hero_picked" }> => p.type === "hero_picked" && p.side === "dire");
    expect(direPicks.map((p) => p.hero)).toEqual([86, 35, 46, 2, 1, 4]);
  });

  test("un héroe del pool que el guion ya usa (ban o pick de cualquier lado) nunca se usa como sustituto", () => {
    // 86 ya está pickeado por dire en captainsMode -- debe descartarse, no duplicarse.
    const pool = [86, 9001];
    const envelopes = buildSimulatorEnvelopes(captainsMode, pool);

    const radiantPicks = envelopes
      .map((e) => e.payload)
      .filter((p): p is Extract<typeof p, { type: "hero_picked" }> => p.type === "hero_picked" && p.side === "radiant");

    // Solo 9001 es válido -- el primer pick local lo usa, el resto cae al guion original.
    expect(radiantPicks.map((p) => p.hero)).toEqual([9001, 9, 7, 3, 10]);
  });

  test("un pick_reverted del lado local revierte el héroe realmente sustituido, no el del guion", () => {
    // allPick: local_side_identified=dire. Picks locales en orden: 18, 20(revertido), 24, 26, 28, 21.
    const pool = [9001, 9002];
    const envelopes = buildSimulatorEnvelopes(allPick, pool);
    const payloads = envelopes.map((e) => e.payload);

    const firstLocalPick = payloads.find((p) => p.type === "hero_picked" && p.side === "dire");
    expect(firstLocalPick).toMatchObject({ hero: 9001 });

    const secondLocalPick = payloads.filter((p) => p.type === "hero_picked" && p.side === "dire")[1];
    expect(secondLocalPick).toMatchObject({ hero: 9002 });

    const reverted = payloads.find((p) => p.type === "pick_reverted");
    expect(reverted).toMatchObject({ hero: 9002, side: "dire" });

    // Pool agotado (2 héroes, 2 ya usados) -- el resto de los picks locales cae al guion original.
    const localPicksAfterRevert = payloads.filter(
      (p): p is Extract<typeof p, { type: "hero_picked" }> => p.type === "hero_picked" && p.side === "dire",
    );
    expect(localPicksAfterRevert.map((p) => p.hero)).toEqual([9001, 9002, 24, 26, 28, 21]);

    // Ningún héroe se repite entre todos los eventos emitidos.
    const allHeroIds = payloads
      .filter((p): p is Extract<typeof p, { hero: number }> => "hero" in p && p.type !== "pick_reverted")
      .map((p) => p.hero);
    expect(new Set(allHeroIds).size).toBe(allHeroIds.length);
  });
});

describe("runSimulatorPlayback", () => {
  test("emite en orden: los baneos no esperan, los picks conservan delayMs/speed", async () => {
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
    const expectedDelays = envelopes.filter((e) => e.payload.type !== "hero_banned" && e.delayMs > 0).map((e) => e.delayMs / 2);
    expect(sleepCalls).toEqual(expectedDelays);
  });

  test("TSK-035: onWaitStart se invoca justo antes de cada espera real, con el mismo ms que sleep", async () => {
    const envelopes = buildSimulatorEnvelopes(allPick);
    const waitStarts: number[] = [];

    await runSimulatorPlayback(envelopes, {
      sessionId: "session-timer",
      speed: 2,
      post: async () => ({ accepted: true }),
      sleep: async () => {},
      onWaitStart: (waitMs) => {
        waitStarts.push(waitMs);
      },
    });

    const expectedWaits = envelopes.filter((e) => e.payload.type !== "hero_banned" && e.delayMs > 0).map((e) => e.delayMs / 2);
    expect(waitStarts).toEqual(expectedWaits);
  });

  test("sin onWaitStart (comportamiento por defecto), no cambia nada -- regresión cero", async () => {
    const envelopes = buildSimulatorEnvelopes(captainsMode);
    const posted: number[] = [];

    await runSimulatorPlayback(envelopes, {
      sessionId: "session-no-timer",
      speed: 1,
      post: async (_sessionId, seq) => {
        posted.push(seq);
        return { accepted: true };
      },
      sleep: async () => {},
    });

    expect(posted).toHaveLength(envelopes.length);
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
