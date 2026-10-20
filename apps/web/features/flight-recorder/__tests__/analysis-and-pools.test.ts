import { describe, expect, test } from "bun:test";
import type { DraftConfig } from "@/features/random-draft-simulator/types";
import type { TeamCoachBoardData, TeamCoachColumn, TeamPosition } from "@/features/team-coach/types";
import { buildAnalysis } from "../analysis";
import { deriveEffectivePools, parsePersonalPool, parsePoolGroups } from "../pools";
import { createFlightRecorder } from "../recorder";
import { summarizeBoard } from "../summaries";
import type { FlightEntry } from "../types";

function column(position: TeamPosition, heroIds: number[], stateIdentity: string): TeamCoachColumn {
  return {
    position,
    eligibleNow: true,
    alreadyFilled: false,
    filledHeroId: null,
    state: "RANKED",
    primaryHeroId: heroIds[0] ?? null,
    top: heroIds.map((heroId, index) => ({ heroId, rank: index + 1, score: 50 - index, reasons: [`razón ${heroId}`], isPrimary: index === 0 })),
    stateIdentity,
    note: null,
  };
}

function board(stateIdentity: string, tops: Partial<Record<TeamPosition, number[]>>): TeamCoachBoardData {
  const positions = ([1, 2, 3, 4, 5] as TeamPosition[]).map((position) => column(position, tops[position] ?? [], stateIdentity));
  return {
    schema: "team-coach-board/v1",
    sessionId: "session-0123456789",
    stateIdentity,
    currentDecision: { recommendedPosition: 1, recommendedHeroId: 1, targetBasis: "DETERMINISTIC_DEFAULT", reason: "r", actionablePositions: [1, 2, 3, 4, 5], roundCapacity: 2 },
    positions,
    unboundOwnHeroIds: [],
  };
}

let clock = 0;
function recordBoard(recorder: ReturnType<typeof createFlightRecorder>, data: TeamCoachBoardData, disposition: string): void {
  recorder.record("engine_team_board", { disposition, board: summarizeBoard(data) });
  clock += 1;
}

function newRecorder() {
  return createFlightRecorder({ now: () => new Date(Date.UTC(2026, 9, 19, 12, 0, clock)) });
}

describe("summarizeBoard", () => {
  test("conserva el top completo de cada posición con id, rank, score y razones", () => {
    const summary = summarizeBoard(board("s1", { 1: [11, 12, 13, 14, 15] })) as { positions: { position: number; topCount: number; top: { heroId: number; rank: number; score: number; reasons: string[] }[] }[] };
    const one = summary.positions.find((entry) => entry.position === 1)!;
    expect(one.topCount).toBe(5);
    expect(one.top[0]).toMatchObject({ heroId: 11, rank: 1, score: 50, reasons: ["razón 11"] });
    expect(one.top[4]).toMatchObject({ heroId: 15, rank: 5 });
  });

  test("copia los campos extra del candidato sin conocerlos (p. ej. señales que el motor agregue)", () => {
    const withExtra = board("s1", { 1: [11] });
    (withExtra.positions[0]!.top[0] as unknown as Record<string, unknown>).signals = [{ id: "counter", raw: 62 }];
    const summary = summarizeBoard(withExtra) as { positions: { top: Record<string, unknown>[] }[] };
    expect(summary.positions[0]!.top[0]!.signals).toEqual([{ id: "counter", raw: 62 }]);
  });
});

describe("buildAnalysis -- ¿el Top 5 cambió alguna vez?", () => {
  test("detecta un Top 5 que NO cambia entre estados distintos", () => {
    const recorder = newRecorder();
    recorder.arm();
    recordBoard(recorder, board("s1", { 1: [11, 12, 13, 14, 15] }), "accepted");
    recordBoard(recorder, board("s2", { 1: [11, 12, 13, 14, 15] }), "accepted");
    recordBoard(recorder, board("s3", { 1: [11, 12, 13, 14, 15] }), "accepted");
    const analysis = buildAnalysis(recorder.entries());
    const one = analysis.perPosition.find((entry) => entry.position === 1)!;
    expect(analysis.distinctBoardStateIdentities).toBe(3);
    expect(one.boardsSeen).toBe(3);
    expect(one.distinctTop5).toHaveLength(1);
    expect(one.distinctTop5[0]).toMatchObject({ heroIds: [11, 12, 13, 14, 15], firstSeenStateIdentity: "s1", occurrences: 3 });
  });

  test("cuenta una variante nueva cuando el Top 5 cambia, y marca dónde apareció", () => {
    const recorder = newRecorder();
    recorder.arm();
    recordBoard(recorder, board("s1", { 2: [21, 22, 23] }), "accepted");
    recordBoard(recorder, board("s2", { 2: [21, 22, 23] }), "accepted");
    recordBoard(recorder, board("s3", { 2: [22, 21, 24] }), "accepted");
    const two = buildAnalysis(recorder.entries()).perPosition.find((entry) => entry.position === 2)!;
    expect(two.distinctTop5.map((variant) => variant.heroIds)).toEqual([[21, 22, 23], [22, 21, 24]]);
    expect(two.distinctTop5[1]!.firstSeenStateIdentity).toBe("s3");
  });

  test("las respuestas descartadas no cuentan como Top 5 visto y se contabilizan aparte", () => {
    const recorder = newRecorder();
    recorder.arm();
    recordBoard(recorder, board("s1", { 1: [11] }), "accepted");
    recordBoard(recorder, board("s2", { 1: [99] }), "discarded_superseded");
    const analysis = buildAnalysis(recorder.entries());
    expect(analysis.acceptedBoards).toBe(1);
    expect(analysis.discardedBoards).toBe(1);
    expect(analysis.perPosition.find((entry) => entry.position === 1)!.distinctTop5).toHaveLength(1);
  });
});

describe("buildAnalysis -- lo que devolvió el motor vs lo que mostró la UI", () => {
  function uiEntry(seq: number, stateIdentity: string, tops: Record<number, number[]>): FlightEntry {
    return {
      seq,
      at: "2026-10-19T12:00:00.000Z",
      elapsedMs: seq,
      kind: "ui_render",
      data: { board: { stateIdentity, status: "ready", recommendedPosition: 1, positions: Object.entries(tops).map(([position, heroIds]) => ({ position: Number(position), state: "RANKED", eligible: true, heroIds, ranks: heroIds.map((_, index) => index + 1) })) }, decision: null },
    };
  }

  test("sin diferencias: la UI coincide con el último tablero aceptado", () => {
    const recorder = newRecorder();
    recorder.arm();
    recordBoard(recorder, board("s1", { 1: [11, 12], 2: [21, 22] }), "accepted");
    const entries = [...recorder.entries(), uiEntry(10, "s1", { 1: [11, 12], 2: [21, 22] })];
    expect(buildAnalysis(entries).uiVsEngineMismatches).toEqual([]);
  });

  test("detecta una posición que la UI muestra distinta de lo que devolvió el motor", () => {
    const recorder = newRecorder();
    recorder.arm();
    recordBoard(recorder, board("s2", { 1: [31, 32], 2: [21, 22] }), "accepted");
    const entries = [...recorder.entries(), uiEntry(10, "s2", { 1: [11, 12], 2: [21, 22] })];
    const mismatches = buildAnalysis(entries).uiVsEngineMismatches;
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({ position: 1, uiHeroIds: [11, 12], engineHeroIds: [31, 32] });
  });

  test("detecta que la UI quedó en otro stateIdentity que el último tablero aceptado", () => {
    const recorder = newRecorder();
    recorder.arm();
    recordBoard(recorder, board("s2", { 1: [11] }), "accepted");
    const entries = [...recorder.entries(), uiEntry(10, "s1", { 1: [11] })];
    const mismatches = buildAnalysis(entries).uiVsEngineMismatches;
    expect(mismatches).toEqual([expect.objectContaining({ position: 0, uiStateIdentity: "s1", engineStateIdentity: "s2" })]);
  });
});

describe("pools efectivos (derivación de diagnóstico)", () => {
  const config = { draftSeed: "ABCDEFGH", userSide: "radiant", playerPosition: 2, personalBanList: [], patch: "7.41", partySize: 5, teamGroupId: 7, teamAssignment: { "101": 1, "102": 3, "103": 4 } } as unknown as DraftConfig;
  const groups = parsePoolGroups([
    {
      id: 7,
      name: "no se graba",
      members: [
        { id: 101, name: "Alguien", positionPools: [{ position: 1, heroPool: [1, 2, 3] }] },
        { id: 102, name: "Otro", positionPools: [{ position: 3, heroPool: [] }, { position: 1, heroPool: [9] }] },
        { id: 103, name: "Otro más", positionPools: [{ position: 4, heroPool: [40, 41, "x"] }] },
      ],
    },
  ])!;

  test("el dueño usa su pool personal; los demás, el pool guardado PARA ESA posición; sin pool o sin asignar -> no_pool", () => {
    const pools = deriveEffectivePools({ config, groups, personalPool: [5, 6] });
    expect(pools.find((pool) => pool.position === 2)).toEqual({ position: 2, source: "personal_pool", heroIds: [5, 6] });
    expect(pools.find((pool) => pool.position === 1)).toEqual({ position: 1, source: "team_member_position_pool", heroIds: [1, 2, 3] });
    expect(pools.find((pool) => pool.position === 3)).toEqual({ position: 3, source: "no_pool", heroIds: [] }); // el pool guardado de 102 es de otra posición
    expect(pools.find((pool) => pool.position === 4)).toEqual({ position: 4, source: "team_member_position_pool", heroIds: [40, 41] });
    expect(pools.find((pool) => pool.position === 5)).toEqual({ position: 5, source: "no_pool", heroIds: [] });
  });

  test("nunca arrastra nombres de integrantes ni winrates", () => {
    const serialized = JSON.stringify({ groups, pools: deriveEffectivePools({ config, groups, personalPool: parsePersonalPool([{ hero: 5, personalWinrate: 0.61, personalGames: 99 }])! }) });
    expect(serialized).not.toContain("Alguien");
    expect(serialized).not.toContain("no se graba");
    expect(serialized).not.toContain("0.61");
  });

  test("payloads con forma inesperada se rechazan sin lanzar", () => {
    expect(parsePoolGroups({ nope: true })).toBeNull();
    expect(parsePersonalPool("x")).toBeNull();
    expect(parsePoolGroups([{ id: "x" }, 4, null])).toEqual([]);
  });
});
