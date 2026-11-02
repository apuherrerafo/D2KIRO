import "@/test-support/happy-dom";

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { TeamCoachBoardData, TeamCoachGoldenCard, TeamCoachColumn, TeamPosition } from "../types";
import { parseTeamCoachBoard } from "../validation";
import { TeamCoachBoard } from "./TeamCoachBoard";

afterEach(cleanup);

// Card dorada: se pinta lo que el motor decidió (nada se puntúa aquí). Fixtures inline.

const HEROES = new Map<number, HeroMeta>(
  Array.from({ length: 60 }, (_, index) => [index + 1, { id: index + 1, name: `npc_${index + 1}`, localizedName: `Hero ${index + 1}`, imgUrl: "https://cdn.cloudflare.steamstatic.com/x.png", primaryAttr: "agi", attackType: "Melee", roles: [] }]),
);

const GOLDEN: TeamCoachGoldenCard = {
  heroId: 7,
  position: 3,
  wins: [
    { vsHeroId: 11, level: "hard", why: "Orchid lo silencia", core: true },
    { vsHeroId: 12, level: "medium", why: "razón media", core: false },
  ],
  stillFreeHardCounters: [20],
  counteredOutBy: [21, 22],
  synergies: [{ withHeroId: 30, why: "Combo de fixture" }],
};

function column(position: TeamPosition, eligibleNow = true): TeamCoachColumn {
  return {
    position,
    eligibleNow,
    alreadyFilled: false,
    filledHeroId: null,
    state: "RANKED",
    primaryHeroId: position * 10 + 1,
    top: [{ heroId: position * 10 + 1, rank: 1, score: 30, reasons: ["razón"], isPrimary: true }],
    stateIdentity: "state-a",
    note: null,
  };
}

function board(goldenCard: TeamCoachGoldenCard | null | undefined, eligible3 = true): TeamCoachBoardData {
  const data: TeamCoachBoardData = {
    schema: "team-coach-board/v1",
    sessionId: "s",
    stateIdentity: "state-a",
    currentDecision: { recommendedPosition: 2, recommendedHeroId: 21, targetBasis: "DETERMINISTIC_DEFAULT", reason: "razón", actionablePositions: [1, 2, 3, 4, 5], roundCapacity: 2 },
    positions: [column(1), column(2), column(3, eligible3), column(4), column(5)],
    unboundOwnHeroIds: [],
  };
  if (goldenCard !== undefined) data.goldenCard = goldenCard;
  return data;
}

function renderBoard(data: TeamCoachBoardData, onPickHero?: (position: TeamPosition, heroId: number) => void, draftEnded = false) {
  return render(<TeamCoachBoard board={data} status="ready" heroCatalog={HEROES} selectedPosition={null} onSelectPosition={() => {}} onPickHero={onPickHero} draftEnded={draftEnded} />);
}

describe("GoldenCardView -- se pinta lo que decidió el motor", () => {
  test("muestra héroe, posición, a quién le gana (con el porqué), la pareja, los counters ya fuera y el aviso del que sigue libre", () => {
    const view = renderBoard(board(GOLDEN));
    const card = view.getByTestId("golden-card");
    expect(card.textContent).toContain("Card dorada · Pos3 Offlane");
    expect(card.textContent).toContain("Hero 7");
    expect(card.textContent).toContain("Fuera de tu pool");
    const wins = view.getAllByTestId("golden-card-win").map((node) => node.textContent);
    expect(wins[0]).toContain("Fuerte contra Hero 11 (ya está en el rival): Orchid lo silencia");
    expect(wins[1]).toContain("Ventaja posible contra Hero 12");
    expect(view.getByTestId("golden-card-synergy").textContent).toContain("Combina con tu Hero 30: Combo de fixture");
    expect(view.getByTestId("golden-card-out-of-play").textContent).toContain("Hero 21 y Hero 22");
    expect(view.getByTestId("golden-card-still-free").textContent).toContain("Ojo: Hero 20 lo counterea fuerte y sigue libre");
  });

  test("sin card (null o campo ausente de un motor anterior) no se pinta nada", () => {
    expect(renderBoard(board(null)).queryByTestId("golden-card")).toBeNull();
    cleanup();
    expect(renderBoard(board(undefined)).queryByTestId("golden-card")).toBeNull();
  });

  test("sin aviso de counter libre ni pareja, esas líneas no aparecen (nada de texto vacío)", () => {
    const view = renderBoard(board({ ...GOLDEN, stillFreeHardCounters: [], counteredOutBy: [], synergies: [] }));
    expect(view.queryByTestId("golden-card-still-free")).toBeNull();
    expect(view.queryByTestId("golden-card-out-of-play")).toBeNull();
    expect(view.queryByTestId("golden-card-synergy")).toBeNull();
  });
});

describe("GoldenCardView -- elegir", () => {
  test("el botón elige al héroe en SU posición", () => {
    const picks: [number, number][] = [];
    const view = renderBoard(board(GOLDEN), (position, heroId) => picks.push([position, heroId]));
    fireEvent.click(view.getByTestId("golden-card-pick"));
    expect(picks).toEqual([[3, 7]]);
  });

  test("si esa posición ya no se puede elegir ahora, la card se ve pero SIN botón", () => {
    const view = renderBoard(board(GOLDEN, false), () => {});
    expect(view.getByTestId("golden-card")).toBeTruthy();
    expect(view.queryByTestId("golden-card-pick")).toBeNull();
  });

  test("con el draft terminado queda como referencia, sin botón", () => {
    const view = renderBoard(board(GOLDEN), () => {}, true);
    expect(view.queryByTestId("golden-card-pick")).toBeNull();
  });
});

describe("parseTeamCoachBoard -- la card dorada se valida en el borde", () => {
  test("una card bien formada, null o ausente se acepta", () => {
    expect(parseTeamCoachBoard(board(GOLDEN))).not.toBeNull();
    expect(parseTeamCoachBoard(board(null))).not.toBeNull();
    expect(parseTeamCoachBoard(board(undefined))).not.toBeNull();
  });

  test("una forma rota rechaza el tablero entero (nunca se pinta a medias)", () => {
    const broken = (patch: Record<string, unknown>) => parseTeamCoachBoard({ ...board(GOLDEN), goldenCard: { ...GOLDEN, ...patch } });
    expect(broken({ position: 9 })).toBeNull();
    expect(broken({ heroId: "7" })).toBeNull();
    expect(broken({ wins: [{ vsHeroId: 11, level: "enorme", why: "x", core: true }] })).toBeNull();
    expect(broken({ wins: [{ vsHeroId: 11, level: "hard", why: "x" }] })).toBeNull();
    expect(broken({ stillFreeHardCounters: "20" })).toBeNull();
    expect(broken({ synergies: [{ withHeroId: "x", why: 3 }] })).toBeNull();
  });
});
