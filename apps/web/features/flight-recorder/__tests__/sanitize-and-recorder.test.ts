import { describe, expect, test } from "bun:test";
import type { PerspectiveHeroSlot, ProtocolSnapshot } from "@/features/random-draft-simulator/protocol-client";
import { isFlightRecorderEnabled, isFlightRecorderBuilt, isFlightRecorderRequested } from "../config";
import { createFlightRecorder } from "../recorder";
import { REDACTED, scrubPerspectiveSlots, shortSessionRef, toJsonSafe } from "../sanitize";
import { summarizeSnapshot } from "../summaries";

function fixedClock(): () => Date {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 9, 19, 12, 0, 0, tick++ * 10));
}

describe("sanitize -- nunca un secreto", () => {
  test("claves con pinta de token/cookie/credencial/cuenta se reemplazan a cualquier profundidad", () => {
    const safe = toJsonSafe({
      ok: 1,
      "x-account-token": "abc",
      nested: { Cookie: "d2k_session=zzz", authorization: "Bearer abc.def", deeper: [{ accountId: 123456, steamId: "7656", password: "p", apiKey: "k", fine: "hola" }] },
      secretThing: "s",
    }) as Record<string, unknown>;
    expect(safe).toEqual({
      ok: 1,
      "x-account-token": REDACTED,
      nested: { Cookie: REDACTED, authorization: REDACTED, deeper: [{ accountId: REDACTED, steamId: REDACTED, password: REDACTED, apiKey: REDACTED, fine: "hola" }] },
      secretThing: REDACTED,
    });
  });

  test("un valor con forma de bearer o de hash largo se reemplaza aunque la clave sea inocente", () => {
    const safe = toJsonSafe({ note: "Authorization: Bearer eyJhbGciOi.abc-def_ghi", other: `sig=${"ab12".repeat(12)}`, ok: "Rubick" }) as Record<string, unknown>;
    expect(safe).toEqual({ note: REDACTED, other: REDACTED, ok: "Rubick" });
  });

  test("el sessionId se acorta a un prefijo y nunca se copia entero", () => {
    const full = "8c1d2e3f-aaaa-bbbb-cccc-1234567890ab";
    const safe = toJsonSafe({ sessionId: full, board: { sessionId: full } }) as { sessionId: string; board: { sessionId: string } };
    expect(safe.sessionId).toBe(shortSessionRef(full));
    expect(safe.board.sessionId).toBe("8c1d2e3f…");
    expect(JSON.stringify(safe)).not.toContain(full);
  });

  test("el resultado es JSON puro: NaN/Infinity -> null, undefined/funciones se descartan, Set -> arreglo", () => {
    const safe = toJsonSafe({ a: Number.NaN, b: Number.POSITIVE_INFINITY, c: undefined, d: () => 1, e: new Set([1, 2]) });
    expect(JSON.parse(JSON.stringify(safe))).toEqual({ a: null, b: null, e: [1, 2] });
  });
});

describe("sanitize -- picks enemigos ocultos", () => {
  test("una casilla HIDDEN se graba sólo como HIDDEN, aunque un payload malformado traiga un heroId", () => {
    const leaky = { visibility: "HIDDEN", heroId: 999 } as unknown as PerspectiveHeroSlot;
    const scrubbed = scrubPerspectiveSlots([leaky, { visibility: "REVEALED", heroId: 7 }, { visibility: "KNOWN", heroId: 8 }]);
    expect(scrubbed).toEqual([{ visibility: "HIDDEN" }, { visibility: "REVEALED", heroId: 7 }, { visibility: "KNOWN", heroId: 8 }]);
  });

  test("el resumen de un snapshot cuenta los ocultos pero jamás nombra su héroe", () => {
    const snapshot = {
      view: {
        schema: "draft-protocol-perspective/v1",
        sessionId: "session-abcdef-123456",
        status: "ACTIVE",
        viewerSide: "radiant",
        bannedHeroes: [30, 31],
        ownPicks: [{ visibility: "KNOWN", heroId: 1 }],
        enemyPicks: [{ visibility: "HIDDEN", heroId: 424242 }, { visibility: "HIDDEN" }],
        rankedAp: { phase: "PICK_ROUND_1", banResolutionComplete: true },
        captainsMode: null,
      },
      legalActions: [{ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1 }],
      simulator: null,
      ownAssignedPositions: [],
      canYield: false,
    } as unknown as ProtocolSnapshot;
    const summary = summarizeSnapshot(snapshot);
    expect(summary.enemyHiddenCount).toBe(2);
    expect(summary.enemyPicks).toEqual([{ visibility: "HIDDEN" }, { visibility: "HIDDEN" }]);
    expect(JSON.stringify(summary)).not.toContain("424242");
    expect(JSON.stringify(summary)).not.toContain("session-abcdef-123456");
  });
});

describe("recorder", () => {
  test("desarmada: record() es un no-op y no guarda nada", () => {
    const recorder = createFlightRecorder({ now: fixedClock() });
    expect(recorder.record("transition", { source: "x" })).toBeNull();
    expect(recorder.count()).toBe(0);
  });

  test("armada: seq creciente, reloj inyectado, y lastTransitionSeq sigue sólo a las transiciones", () => {
    const recorder = createFlightRecorder({ now: fixedClock() });
    recorder.arm();
    recorder.record("session_start", { config: { draftSeed: "ABCDEFGH" } });
    const transition = recorder.record("transition", { source: "bans_resolved" });
    recorder.record("engine_team_board", { disposition: "accepted" });
    expect(recorder.entries().map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(transition?.seq).toBe(2);
    expect(recorder.lastTransitionSeq()).toBe(2);
    expect(recorder.entries()[2]!.elapsedMs).toBeGreaterThan(recorder.entries()[0]!.elapsedMs);
  });

  test("lo que se graba pasa por el sanitizador", () => {
    const recorder = createFlightRecorder({ now: fixedClock() });
    recorder.arm();
    recorder.record("user_action", { action: "x", token: "t", cookie: "c" });
    expect(recorder.entries()[0]!.data).toEqual({ action: "x", token: REDACTED, cookie: REDACTED });
  });

  test("el buffer tiene tope: descarta lo más viejo y lo cuenta", () => {
    const recorder = createFlightRecorder({ now: fixedClock(), maxEntries: 3 });
    recorder.arm();
    for (let index = 0; index < 5; index += 1) recorder.record("transition", { index });
    expect(recorder.entries().map((entry) => entry.data.index)).toEqual([2, 3, 4]);
    expect(recorder.buildExport({ flagEnabled: true, userAgentFamily: null }).droppedEntries).toBe(2);
  });

  test("la exportación es JSON serializable con el esquema, el conteo y el análisis", () => {
    const recorder = createFlightRecorder({ now: fixedClock() });
    recorder.arm();
    recorder.record("transition", { source: "a" });
    const exported = recorder.buildExport({ flagEnabled: true, userAgentFamily: "Chrome" });
    const roundTrip = JSON.parse(JSON.stringify(exported)) as typeof exported;
    expect(roundTrip.schema).toBe("d2kiro-flight-recorder/v1");
    expect(roundTrip.entryCount).toBe(1);
    expect(roundTrip.analysis.acceptedBoards).toBe(0);
    expect(roundTrip.entries[0]!.kind).toBe("transition");
  });

  test("reset vacía el buffer y reinicia la numeración", () => {
    const recorder = createFlightRecorder({ now: fixedClock() });
    recorder.arm();
    recorder.record("transition", {});
    recorder.reset();
    expect(recorder.count()).toBe(0);
    expect(recorder.record("transition", {})?.seq).toBe(1);
  });
});

describe("config -- doble interruptor", () => {
  test("sin el flag de build NUNCA se habilita, aunque la URL lo pida", () => {
    expect(isFlightRecorderEnabled("?flightRecorder=1", false)).toBe(false);
  });

  test("con el flag de build pero sin la URL tampoco", () => {
    expect(isFlightRecorderEnabled("", true)).toBe(false);
    expect(isFlightRecorderEnabled("?flightRecorder=0", true)).toBe(false);
    expect(isFlightRecorderEnabled("?flightRecorder=true", true)).toBe(false);
  });

  test("sólo flag de build + ?flightRecorder=1 la habilitan", () => {
    expect(isFlightRecorderEnabled("?a=b&flightRecorder=1", true)).toBe(true);
    expect(isFlightRecorderRequested("?flightRecorder=1")).toBe(true);
  });

  test("el flag de build exige exactamente '1' (ausente en producción)", () => {
    expect(isFlightRecorderBuilt(undefined)).toBe(false);
    expect(isFlightRecorderBuilt("true")).toBe(false);
    expect(isFlightRecorderBuilt("1")).toBe(true);
  });
});
