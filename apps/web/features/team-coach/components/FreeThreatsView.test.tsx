import "@/test-support/happy-dom";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { TeamCoachBoardData, TeamCoachColumn, TeamCoachFreeThreat, TeamPosition } from "../types";
import { parseTeamCoachBoard } from "../validation";
import { TeamCoachBoard } from "./TeamCoachBoard";

afterEach(cleanup);

// ADVERTIR (PO 2026-11-05): "Amenazas libres a tus picks". Se pinta lo que el motor decidió; nada se puntúa ni se reordena. Fixtures inline.

const HEROES = new Map<number, HeroMeta>(
  Array.from({ length: 60 }, (_, index) => [index + 1, { id: index + 1, name: `npc_${index + 1}`, localizedName: `Hero ${index + 1}`, imgUrl: "https://cdn.cloudflare.steamstatic.com/x.png", primaryAttr: "agi", attackType: "Melee", roles: [] }]),
);

const STEALABLE: TeamCoachFreeThreat = { ownHeroId: 1, threatHeroId: 10, why: "Silencia al carry y lo mata antes de que escale", stealPositions: [3] };
const STEALABLE_MANY: TeamCoachFreeThreat = { ownHeroId: 1, threatHeroId: 11, why: "Su stun atraviesa el escudo", stealPositions: [3, 4, 5] };
const NOT_STEALABLE: TeamCoachFreeThreat = { ownHeroId: 2, threatHeroId: 12, why: "Su ulti rompe la invisibilidad", stealPositions: [] };

function column(position: TeamPosition): TeamCoachColumn {
  return {
    position,
    eligibleNow: true,
    alreadyFilled: false,
    filledHeroId: null,
    state: "RANKED",
    primaryHeroId: position * 10 + 1,
    top: [{ heroId: position * 10 + 1, rank: 1, score: 30, reasons: ["razón"], isPrimary: true }],
    stateIdentity: "state-a",
    note: null,
  };
}

function board(freeThreats: TeamCoachFreeThreat[] | undefined): TeamCoachBoardData {
  const data: TeamCoachBoardData = {
    schema: "team-coach-board/v1",
    sessionId: "s",
    stateIdentity: "state-a",
    currentDecision: { recommendedPosition: 2, recommendedHeroId: 21, targetBasis: "DETERMINISTIC_DEFAULT", reason: "razón", actionablePositions: [1, 2, 3, 4, 5], roundCapacity: 2 },
    positions: [column(1), column(2), column(3), column(4), column(5)],
    unboundOwnHeroIds: [],
  };
  if (freeThreats !== undefined) data.freeThreats = freeThreats;
  return data;
}

function renderBoard(data: TeamCoachBoardData, draftEnded = false) {
  return render(<TeamCoachBoard board={data} status="ready" heroCatalog={HEROES} selectedPosition={null} onSelectPosition={() => {}} onPickHero={() => {}} draftEnded={draftEnded} />);
}

describe("FreeThreatsView -- qué se ve", () => {
  test("titula la sección y por cada amenaza nombra al counter, a tu héroe amenazado y el mecanismo", () => {
    const view = renderBoard(board([STEALABLE]));
    const section = view.getByTestId("free-threats");
    expect(section.textContent).toContain("Amenazas libres a tus picks");
    expect(section.textContent).toContain("Es un aviso, no una recomendación: no cambia el orden de las tarjetas");
    const row = view.getByTestId("free-threat");
    expect(row.textContent).toContain("Hero 10");
    expect(row.textContent).toContain("counterea fuerte a tu");
    expect(row.textContent).toContain("Hero 1");
    expect(view.getByTestId("free-threat-why").textContent).toBe("Silencia al carry y lo mata antes de que escale.");
  });

  test("todo héroe lleva su ícono oficial (el counter y tu héroe amenazado)", () => {
    const view = renderBoard(board([STEALABLE]));
    const icons = view.getByTestId("free-threat").querySelectorAll("img");
    expect(icons.length).toBe(2);
  });

  test("robable: dice en qué posición(es) que te quedan lo puedes robar, con nombre de posición (nunca el número solo)", () => {
    const view = renderBoard(board([STEALABLE, STEALABLE_MANY]));
    const lines = view.getAllByTestId("free-threat-steal").map((node) => node.textContent);
    expect(lines[0]).toBe("Puedes quitárselo al rival jugándolo como Pos3 Offlane.");
    expect(lines[1]).toBe("Puedes quitárselo al rival jugándolo como Pos3 Offlane, Pos4 Support o Pos5 Hard Support.");
  });

  test("no robable: se distingue claramente y no ofrece una posición", () => {
    const view = renderBoard(board([NOT_STEALABLE]));
    expect(view.getByTestId("free-threat-no-steal").textContent).toBe("No encaja con tus posiciones libres: no puedes quitárselo al rival.");
    expect(view.queryByTestId("free-threat-steal")).toBeNull();
  });

  test("muestra como máximo 4 y avisa cuántas más hay, sin esconderlas en silencio", () => {
    const many = Array.from({ length: 6 }, (_, index): TeamCoachFreeThreat => ({ ownHeroId: 1, threatHeroId: 20 + index, why: `razón ${index}`, stealPositions: [] }));
    const view = renderBoard(board(many));
    expect(view.getAllByTestId("free-threat").length).toBe(4);
    expect(view.getByTestId("free-threats-more").textContent).toBe("y 2 más.");
  });

  test("sin amenazas (vacío, ausente en un motor anterior) no se pinta la sección, ni un título vacío", () => {
    expect(renderBoard(board([])).queryByTestId("free-threats")).toBeNull();
    cleanup();
    expect(renderBoard(board(undefined)).queryByTestId("free-threats")).toBeNull();
  });

  test("con el draft terminado ya no hay nada que robar ni evitar: no se muestra", () => {
    expect(renderBoard(board([STEALABLE]), true).queryByTestId("free-threats")).toBeNull();
  });

  test("se actualiza: al cambiar el tablero (un ban o una posición llena) la amenaza sale o cambia de robable a no robable", () => {
    const view = renderBoard(board([STEALABLE, STEALABLE_MANY]));
    expect(view.getAllByTestId("free-threat").length).toBe(2);
    const afterBan = board([STEALABLE_MANY]);
    view.rerender(<TeamCoachBoard board={afterBan} status="ready" heroCatalog={HEROES} selectedPosition={null} onSelectPosition={() => {}} onPickHero={() => {}} />);
    expect(view.getAllByTestId("free-threat").length).toBe(1);
    const afterFill = board([{ ...STEALABLE_MANY, stealPositions: [] }]);
    view.rerender(<TeamCoachBoard board={afterFill} status="ready" heroCatalog={HEROES} selectedPosition={null} onSelectPosition={() => {}} onPickHero={() => {}} />);
    expect(view.queryByTestId("free-threat-steal")).toBeNull();
    expect(view.getByTestId("free-threat-no-steal")).toBeTruthy();
  });
});

describe("FreeThreatsView -- cero cambios en lo que ya se veía", () => {
  test("las columnas (héroes, orden, ELIGE AHORA) se ven idénticas con y sin la sección", () => {
    const without = renderBoard(board(undefined));
    const columnsWithout = [1, 2, 3, 4, 5].map((position) => without.getByTestId(`team-coach-column-${position}`).outerHTML);
    const decisionWithout = without.getByTestId("team-coach-decision").outerHTML;
    cleanup();
    const withThreats = renderBoard(board([STEALABLE, STEALABLE_MANY, NOT_STEALABLE]));
    const columnsWith = [1, 2, 3, 4, 5].map((position) => withThreats.getByTestId(`team-coach-column-${position}`).outerHTML);
    expect(columnsWith).toEqual(columnsWithout);
    expect(withThreats.getByTestId("team-coach-decision").outerHTML).toBe(decisionWithout);
  });
});

describe("parseTeamCoachBoard -- ADVERTIR se valida en el borde", () => {
  test("acepta amenazas bien formadas y también su ausencia (motor anterior)", () => {
    expect(parseTeamCoachBoard(board([STEALABLE, NOT_STEALABLE]))?.freeThreats?.length).toBe(2);
    expect(parseTeamCoachBoard(board(undefined))).not.toBeNull();
    expect(parseTeamCoachBoard(board([]))).not.toBeNull();
  });

  test("una forma rota rechaza el tablero ENTERO (nunca se pinta a medias)", () => {
    const broken = (patch: Record<string, unknown>) => parseTeamCoachBoard({ ...board([STEALABLE]), freeThreats: [{ ...STEALABLE, ...patch }] });
    expect(broken({ stealPositions: [6] })).toBeNull();
    expect(broken({ stealPositions: "3" })).toBeNull();
    expect(broken({ why: 42 })).toBeNull();
    expect(broken({ why: "  " })).toBeNull(); // un aviso sin mecanismo no se pinta: el motor ya lo filtra, aquí se exige igual
    expect(broken({ threatHeroId: "10" })).toBeNull();
    expect(parseTeamCoachBoard({ ...board([]), freeThreats: "nada" })).toBeNull();
  });
});
