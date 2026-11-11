import { describe, expect, test } from "bun:test";
import type { LiveLocalPlayer, LiveTeamContext, TeamCoachBoardData, TeamCoachColumn, TeamPosition } from "@/features/team-coach/types";
import { asReference, liveHeadlineOf, liveLightViewOf, liveModeOf, liveSeatOf, mineRelationOf } from "./view-model";

// FIXTURES INLINE: ninguna prueba de este archivo toca una sesión Live real, el motor ni datos curados. Ids de héroe arbitrarios.

function column(position: TeamPosition): TeamCoachColumn {
  return {
    position,
    eligibleNow: true,
    alreadyFilled: false,
    filledHeroId: null,
    state: "RANKED",
    primaryHeroId: position * 10 + 1,
    top: [1, 2].map((k) => ({ heroId: position * 10 + k, rank: k, score: 10 - k, reasons: [], isPrimary: k === 1, evidenceStrength: "STRONG" as const })),
    stateIdentity: "s",
    note: null,
  };
}

function board(recommended: TeamPosition | null = 1): TeamCoachBoardData {
  return {
    schema: "team-coach-board/v1",
    sessionId: "s",
    stateIdentity: "s",
    currentDecision: { recommendedPosition: recommended, recommendedHeroId: recommended === null ? null : recommended * 10 + 1, targetBasis: "STRATEGIC", reason: "razón de equipo", actionablePositions: [1, 2, 3, 4, 5], roundCapacity: 2 },
    positions: ([1, 2, 3, 4, 5] as const).map(column),
    unboundOwnHeroIds: [],
  };
}

const NO_POOLS = { "1": false, "2": false, "3": false, "4": false, "5": false };
const ALL_POOLS = { "1": true, "2": true, "3": true, "4": true, "5": true };
const PARTY5: LiveTeamContext = { teamGroupId: 7, positions: ALL_POOLS };
const declared = (position: TeamPosition | null, bound = false): LiveLocalPlayer => ({ position, heroId: null, bound });

describe("liveModeOf · Party 5 solo si el MOTOR confirma un preset aplicado", () => {
  test("sin contexto o sin preset → solo", () => {
    expect(liveModeOf(undefined)).toBe("solo");
    expect(liveModeOf({ teamGroupId: null, positions: NO_POOLS })).toBe("solo");
  });
  test("preset elegido pero sin ningún pool activo → solo (no se supone un equipo)", () => {
    expect(liveModeOf({ teamGroupId: 7, positions: NO_POOLS })).toBe("solo");
  });
  test("preset aplicado con pools → party5", () => {
    expect(liveModeOf(PARTY5)).toBe("party5");
    expect(liveModeOf({ teamGroupId: 7, positions: { ...NO_POOLS, "2": true } })).toBe("party5");
  });
});

describe("liveSeatOf · declarada ≠ confirmada", () => {
  test("sin dato del motor o sin posición → undeclared", () => {
    expect(liveSeatOf(undefined)).toBe("undeclared");
    expect(liveSeatOf(declared(null))).toBe("undeclared");
  });
  test("posición declarada y héroe NO ligado → declared; ligado → confirmed", () => {
    expect(liveSeatOf(declared(3))).toBe("declared");
    expect(liveSeatOf(declared(3, true))).toBe("confirmed");
  });
  test("la relación de la columna propia sigue al estado: confirmada = mine, declarada = mine-unconfirmed", () => {
    expect(mineRelationOf("confirmed")).toBe("mine");
    expect(mineRelationOf("declared")).toBe("mine-unconfirmed");
  });
});

describe("liveLightViewOf · Solo", () => {
  test("sin posición declarada no hay columna: se pide Pos 1–5", () => {
    expect(liveLightViewOf({ board: board(), localPlayer: declared(null), teamContext: undefined, draftEnded: false }).kind).toBe("pick-seat");
    expect(liveLightViewOf({ board: board(), localPlayer: undefined, teamContext: undefined, draftEnded: false }).kind).toBe("pick-seat");
  });

  test("Solo sin declarar y con el draft terminado: no se pide posición, solo se avisa que terminó", () => {
    expect(liveLightViewOf({ board: board(), localPlayer: declared(null), teamContext: undefined, draftEnded: true }).kind).toBe("ended-without-seat");
  });

  test("con posición declarada, SOLO esa columna (las otras cuatro no se muestran)", () => {
    const view = liveLightViewOf({ board: board(), localPlayer: declared(3), teamContext: undefined, draftEnded: false });
    expect(view.kind).toBe("board");
    if (view.kind !== "board") return;
    expect(view.board.positions.map((entry) => entry.position)).toEqual([3]);
    expect(view.mode).toBe("solo");
    expect(view.seat).toBe("declared");
  });

  test("el motor no entregó esa columna → missing-column, jamás otra en su lugar", () => {
    const partial = board();
    partial.positions = partial.positions.filter((entry) => entry.position !== 4);
    expect(liveLightViewOf({ board: partial, localPlayer: declared(4), teamContext: undefined, draftEnded: false })).toEqual({ kind: "missing-column", position: 4 });
  });

  test("currentDecision apunta a OTRA posición → se dice como prioridad del equipo; la columna propia no hereda la decisión", () => {
    const view = liveLightViewOf({ board: board(5), localPlayer: declared(1), teamContext: undefined, draftEnded: false });
    expect(view.kind === "board" && view.priorityElsewhere).toBe(5);
  });

  test("currentDecision apunta a MI posición → no hay «prioridad en otra parte»", () => {
    const view = liveLightViewOf({ board: board(1), localPlayer: declared(1), teamContext: undefined, draftEnded: false });
    expect(view.kind === "board" && view.priorityElsewhere).toBeNull();
  });
});

describe("liveLightViewOf · Party 5", () => {
  test("cinco columnas, aun con posición propia sin declarar (no se inventa quién eres)", () => {
    const view = liveLightViewOf({ board: board(), localPlayer: declared(null), teamContext: PARTY5, draftEnded: false });
    expect(view.kind).toBe("board");
    if (view.kind !== "board") return;
    expect(view.mode).toBe("party5");
    expect(view.board.positions.map((entry) => entry.position)).toEqual([1, 2, 3, 4, 5]);
    expect(view.humanPosition).toBeNull();
    expect(view.seat).toBe("undeclared");
  });

  test("con posición declarada, esa es la propia y las otras cuatro son del party", () => {
    const view = liveLightViewOf({ board: board(), localPlayer: declared(2, true), teamContext: PARTY5, draftEnded: false });
    expect(view.kind === "board" && view.humanPosition).toBe(2);
    expect(view.kind === "board" && view.seat).toBe("confirmed");
  });
});

describe("draft terminado = referencia", () => {
  test("asReference borra la decisión del equipo y deja columnas y candidatos intactos", () => {
    const reference = asReference(board(1));
    expect(reference.currentDecision.recommendedPosition).toBeNull();
    expect(reference.currentDecision.recommendedHeroId).toBeNull();
    expect(reference.currentDecision.reason).toBe("");
    expect(reference.positions).toEqual(board(1).positions);
  });

  test("con el draft terminado la vista ya no trae decisión", () => {
    const view = liveLightViewOf({ board: board(1), localPlayer: declared(1), teamContext: undefined, draftEnded: true });
    expect(view.kind === "board" && view.board.currentDecision.recommendedHeroId).toBeNull();
    expect(view.kind === "board" && view.priorityElsewhere).toBeNull();
  });
});

describe("liveHeadlineOf", () => {
  test("dice modo y estado de la posición propia", () => {
    expect(liveHeadlineOf("solo", 3, "declared")).toBe("Solo · Tú: Pos3 Offlane (declarada, sin confirmar)");
    expect(liveHeadlineOf("solo", 3, "confirmed")).toBe("Solo · Tú: Pos3 Offlane (confirmada)");
    expect(liveHeadlineOf("party5", null, "undeclared")).toBe("Party 5 · Pos 1 a Pos 5 · Tu posición: sin declarar");
  });
});
