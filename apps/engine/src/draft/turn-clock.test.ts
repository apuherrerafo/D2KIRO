import { describe, expect, test } from "bun:test";
import type { CaptainsModeTurnTable } from "./draft-format-turns";
import type { DraftState } from "./reducer";
import { captainsModeTurnIndex, checkCaptainsModeTurn, consumeReserveTime, currentCaptainsModeTurn } from "./turn-clock";

// Tabla sintética minúscula, nunca la real (S10, testing-seams.md) -- 3 turnos: ban(first),
// ban(second), pick(first).
const FIXTURE_TABLE: CaptainsModeTurnTable = {
  reserveTimeMs: 60000,
  turns: [
    { action: "ban", team: "first", standardTimeMs: 10000 },
    { action: "ban", team: "second", standardTimeMs: 10000 },
    { action: "pick", team: "first", standardTimeMs: 20000 },
  ],
};

function state(overrides: Partial<DraftState> = {}): DraftState {
  return {
    sessionId: "s1",
    schema: "draft-state/v1",
    format: "captains_mode",
    patch: "7.41e",
    localSide: "radiant",
    phase: "active",
    banned: [],
    picks: { radiant: [], dire: [] },
    lastSeq: 0,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "",
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    ...overrides,
  };
}

describe("captainsModeTurnIndex", () => {
  test("suma bans + picks de ambos lados", () => {
    expect(captainsModeTurnIndex(state({ banned: [1, 2], picks: { radiant: [3], dire: [] } }))).toBe(3);
  });
});

describe("checkCaptainsModeTurn", () => {
  test("sin tabla, nunca rechaza", () => {
    expect(checkCaptainsModeTurn(state(), null, "ban", "radiant")).toEqual({});
  });

  test("formato distinto de captains_mode, nunca rechaza", () => {
    expect(checkCaptainsModeTurn(state({ format: "all_pick" }), FIXTURE_TABLE, "ban", "radiant")).toEqual({});
  });

  test("turno 0, side:unknown, no bootstrapea ni rechaza", () => {
    expect(checkCaptainsModeTurn(state(), FIXTURE_TABLE, "ban", "unknown")).toEqual({});
  });

  test("turno 0, action distinta de la esperada, rechaza con wrong_turn -- el tipo de acción siempre se sabe con certeza, nunca es 'evidencia insuficiente'", () => {
    expect(checkCaptainsModeTurn(state(), FIXTURE_TABLE, "pick", "radiant")).toEqual({ rejected: "wrong_turn" });
  });

  test("turno 0 con lado real bootstrapea firstPickSide -- el team del turno 0 es 'first'", () => {
    expect(checkCaptainsModeTurn(state(), FIXTURE_TABLE, "ban", "dire")).toEqual({ bootstrapSide: "dire" });
  });

  test("con firstPickSide ya conocido, el lado correcto en el turno correcto no rechaza", () => {
    const withFirst = state({ firstPickSide: "radiant" });
    expect(checkCaptainsModeTurn(withFirst, FIXTURE_TABLE, "ban", "radiant")).toEqual({});
  });

  test("con firstPickSide conocido, el lado incorrecto se rechaza con wrong_turn", () => {
    const withFirst = state({ firstPickSide: "radiant" });
    expect(checkCaptainsModeTurn(withFirst, FIXTURE_TABLE, "ban", "dire")).toEqual({ rejected: "wrong_turn" });
  });

  test("con firstPickSide conocido, la acción incorrecta (pick en vez de ban) se rechaza con wrong_turn", () => {
    const withFirst = state({ firstPickSide: "radiant" });
    expect(checkCaptainsModeTurn(withFirst, FIXTURE_TABLE, "pick", "radiant")).toEqual({ rejected: "wrong_turn" });
  });

  test("con firstPickSide conocido, side:unknown nunca rechaza (no se puede confirmar)", () => {
    const withFirst = state({ firstPickSide: "radiant" });
    expect(checkCaptainsModeTurn(withFirst, FIXTURE_TABLE, "ban", "unknown")).toEqual({});
  });

  test("segundo turno de la tabla usa 'second' -- con first=radiant, se espera dire", () => {
    const secondTurn = state({ firstPickSide: "radiant", banned: [1] });
    expect(checkCaptainsModeTurn(secondTurn, FIXTURE_TABLE, "ban", "dire")).toEqual({});
    expect(checkCaptainsModeTurn(secondTurn, FIXTURE_TABLE, "ban", "radiant")).toEqual({ rejected: "wrong_turn" });
  });

  test("secuencia agotada (más acciones que turnos en la tabla) nunca rechaza", () => {
    const exhausted = state({ firstPickSide: "radiant", banned: [1, 2], picks: { radiant: [3], dire: [] } });
    expect(checkCaptainsModeTurn(exhausted, FIXTURE_TABLE, "ban", "radiant")).toEqual({});
  });
});

describe("currentCaptainsModeTurn", () => {
  test("sin firstPickSide, devuelve null", () => {
    expect(currentCaptainsModeTurn(state(), FIXTURE_TABLE)).toBeNull();
  });

  test("con firstPickSide, resuelve el lado real del turno actual, incluido standardTimeMs", () => {
    expect(currentCaptainsModeTurn(state({ firstPickSide: "dire" }), FIXTURE_TABLE)).toEqual({
      side: "dire",
      action: "ban",
      standardTimeMs: 10000,
    });
  });

  test("formato distinto de captains_mode, devuelve null", () => {
    expect(currentCaptainsModeTurn(state({ format: "all_pick", firstPickSide: "radiant" }), FIXTURE_TABLE)).toBeNull();
  });
});

describe("consumeReserveTime", () => {
  const initial = { radiant: 60000, dire: 60000 };

  test("dentro del tiempo estándar, no descuenta nada", () => {
    expect(consumeReserveTime(initial, "radiant", 8000, 10000)).toEqual(initial);
  });

  test("excede el tiempo estándar, descuenta solo el excedente del lado que actuó", () => {
    const result = consumeReserveTime(initial, "radiant", 13000, 10000);
    expect(result).toEqual({ radiant: 57000, dire: 60000 });
  });

  test("nunca baja de 0 aunque el excedente supere la reserva restante", () => {
    const result = consumeReserveTime({ radiant: 2000, dire: 60000 }, "radiant", 15000, 10000);
    expect(result.radiant).toBe(0);
  });
});
