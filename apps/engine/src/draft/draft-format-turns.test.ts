import { describe, expect, test } from "bun:test";
import {
  loadDraftFormatTurnData,
  parseAllPickTurnData,
  parseCaptainsModeTurnTable,
  parseDraftFormatTurnData,
} from "./draft-format-turns";

describe("parseCaptainsModeTurnTable", () => {
  test("un objeto bien formado se acepta tal cual", () => {
    const table = parseCaptainsModeTurnTable({
      reserveTimeMs: 130000,
      turns: [{ action: "ban", team: "first", standardTimeMs: 15000 }],
    });
    expect(table).toEqual({ reserveTimeMs: 130000, turns: [{ action: "ban", team: "first", standardTimeMs: 15000 }] });
  });

  test("reserveTimeMs negativo o cero degrada a null", () => {
    expect(parseCaptainsModeTurnTable({ reserveTimeMs: 0, turns: [{ action: "ban", team: "first", standardTimeMs: 15000 }] })).toBeNull();
    expect(parseCaptainsModeTurnTable({ reserveTimeMs: -1, turns: [{ action: "ban", team: "first", standardTimeMs: 15000 }] })).toBeNull();
  });

  test("turns vacío degrada a null", () => {
    expect(parseCaptainsModeTurnTable({ reserveTimeMs: 130000, turns: [] })).toBeNull();
  });

  test("un turno con action inválida degrada la tabla completa a null", () => {
    expect(
      parseCaptainsModeTurnTable({ reserveTimeMs: 130000, turns: [{ action: "steal", team: "first", standardTimeMs: 15000 }] }),
    ).toBeNull();
  });

  test("un turno con team inválido degrada la tabla completa a null", () => {
    expect(
      parseCaptainsModeTurnTable({ reserveTimeMs: 130000, turns: [{ action: "ban", team: "third", standardTimeMs: 15000 }] }),
    ).toBeNull();
  });

  test("un turno con standardTimeMs no entero o negativo degrada la tabla completa a null", () => {
    expect(
      parseCaptainsModeTurnTable({ reserveTimeMs: 130000, turns: [{ action: "ban", team: "first", standardTimeMs: -5 }] }),
    ).toBeNull();
  });

  test("raw que no es un objeto degrada a null", () => {
    expect(parseCaptainsModeTurnTable(null)).toBeNull();
    expect(parseCaptainsModeTurnTable("no soy un objeto")).toBeNull();
  });
});

describe("parseAllPickTurnData", () => {
  test("un objeto bien formado se acepta tal cual", () => {
    const data = parseAllPickTurnData({
      banCount: 16,
      banSource: "player_ban_preferences",
      pickRounds: [{ picksPerTeam: 2, durationMs: 25000 }],
    });
    expect(data).toEqual({ banCount: 16, banSource: "player_ban_preferences", pickRounds: [{ picksPerTeam: 2, durationMs: 25000 }] });
  });

  test("pickRounds vacío degrada a null", () => {
    expect(parseAllPickTurnData({ banCount: 16, banSource: "x", pickRounds: [] })).toBeNull();
  });

  test("banCount no entero o negativo degrada a null", () => {
    expect(parseAllPickTurnData({ banCount: 0, banSource: "x", pickRounds: [{ picksPerTeam: 2, durationMs: 25000 }] })).toBeNull();
  });
});

describe("parseDraftFormatTurnData", () => {
  test("captainsMode y allPick se validan por separado -- uno corrupto no tira al otro", () => {
    const data = parseDraftFormatTurnData({
      captainsMode: { reserveTimeMs: 130000, turns: [{ action: "ban", team: "first", standardTimeMs: 15000 }] },
      allPick: "esto no es un objeto válido",
    });
    expect(data.captainsMode).not.toBeNull();
    expect(data.allPick).toBeNull();
  });

  test("raw completamente corrupto degrada a las dos tablas en null, nunca lanza", () => {
    expect(parseDraftFormatTurnData(null)).toEqual({ captainsMode: null, allPick: null });
    expect(parseDraftFormatTurnData(42)).toEqual({ captainsMode: null, allPick: null });
  });
});

describe("loadDraftFormatTurnData (archivo real)", () => {
  test("captainsMode tiene exactamente 24 turnos -- 14 bans + 10 picks", () => {
    const data = loadDraftFormatTurnData();
    expect(data.captainsMode).not.toBeNull();
    const turns = data.captainsMode!.turns;
    expect(turns).toHaveLength(24);
    expect(turns.filter((t) => t.action === "ban")).toHaveLength(14);
    expect(turns.filter((t) => t.action === "pick")).toHaveLength(10);
  });

  test("captainsMode.reserveTimeMs es 130000 (130s por equipo, fuente cruzada)", () => {
    const data = loadDraftFormatTurnData();
    expect(data.captainsMode!.reserveTimeMs).toBe(130000);
  });

  test("allPick.banCount es 16, pickRounds suma 5 picks por equipo (2/2/1)", () => {
    const data = loadDraftFormatTurnData();
    expect(data.allPick).not.toBeNull();
    expect(data.allPick!.banCount).toBe(16);
    const totalPerTeam = data.allPick!.pickRounds.reduce((sum, round) => sum + round.picksPerTeam, 0);
    expect(totalPerTeam).toBe(5);
  });
});
