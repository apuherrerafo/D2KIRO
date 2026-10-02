import "@/test-support/happy-dom";

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { TeamCoachBoardData, TeamCoachColumn, TeamPosition } from "../types";
import { parseTeamCoachBoard } from "../validation";
import { TeamCoachBoard } from "./TeamCoachBoard";

afterEach(cleanup);

const HEROES = new Map<number, HeroMeta>(
  Array.from({ length: 60 }, (_, index) => [index + 1, { id: index + 1, name: `npc_${index + 1}`, localizedName: `Hero ${index + 1}`, imgUrl: "https://cdn.cloudflare.steamstatic.com/x.png", primaryAttr: "agi", attackType: "Melee", roles: [] }]),
);

function column(position: TeamPosition, overrides: Partial<TeamCoachColumn> = {}): TeamCoachColumn {
  const heroes = [position * 10 + 1, position * 10 + 2, position * 10 + 3];
  return {
    position,
    eligibleNow: true,
    alreadyFilled: false,
    filledHeroId: null,
    state: "RANKED",
    primaryHeroId: heroes[0]!,
    top: heroes.map((heroId, index) => ({ heroId, rank: index + 1, score: 30 - index, reasons: [`razón ${heroId}`], isPrimary: index === 0 })),
    stateIdentity: "state-a",
    note: null,
    ...overrides,
  };
}

function board(positions: TeamPosition[] = [1, 2, 3, 4, 5], recommended: TeamPosition | null = 2, overrides: Partial<Record<TeamPosition, Partial<TeamCoachColumn>>> = {}, stateIdentity = "state-a"): TeamCoachBoardData {
  const columns = positions.map((position) => column(position, { stateIdentity, ...overrides[position] }));
  return {
    schema: "team-coach-board/v1",
    sessionId: "s",
    stateIdentity,
    currentDecision: {
      recommendedPosition: recommended,
      recommendedHeroId: recommended === null ? null : recommended * 10 + 1,
      targetBasis: recommended === null ? null : "DETERMINISTIC_DEFAULT",
      reason: "razón de la recomendación",
      actionablePositions: columns.filter((entry) => entry.eligibleNow).map((entry) => entry.position),
      roundCapacity: 2,
    },
    positions: columns,
    unboundOwnHeroIds: [],
  };
}

function renderBoard(data: TeamCoachBoardData | null, options: { onPickHero?: (position: TeamPosition, heroId: number) => void; onSelectPosition?: (position: TeamPosition) => void; selected?: TeamPosition | null } = {}) {
  return render(
    <TeamCoachBoard
      board={data}
      status={data ? "ready" : "loading"}
      heroCatalog={HEROES}
      selectedPosition={options.selected ?? null}
      onSelectPosition={options.onSelectPosition ?? (() => {})}
      onPickHero={options.onPickHero}
    />,
  );
}

describe("TeamCoachBoard", () => {
  test("15. Party5 renderiza 5 columnas, POS1..POS5, con ícono de héroe en cada candidato", () => {
    const view = renderBoard(board());
    for (const position of [1, 2, 3, 4, 5]) expect(view.getByTestId(`team-coach-column-${position}`)).toBeTruthy();
    expect(view.getByTestId("team-coach-column-2").textContent).toContain("POS2 MID");
    expect(view.getAllByTestId("team-coach-candidate")).toHaveLength(15);
    expect(view.getAllByRole("img").length).toBeGreaterThanOrEqual(15);
  });

  test("Party3: sólo 3 columnas", () => {
    const view = renderBoard(board([1, 2, 3], 1));
    expect(view.queryByTestId("team-coach-column-4")).toBeNull();
    expect(view.getAllByTestId(/^team-coach-column-/)).toHaveLength(3);
  });

  test("16. ★ PICK NOW aparece exactamente una vez, sobre la posición recomendada", () => {
    const view = renderBoard(board([1, 2, 3, 4, 5], 3));
    const badges = view.getAllByTestId("team-coach-pick-now");
    expect(badges).toHaveLength(1);
    expect(view.getByTestId("team-coach-column-3").contains(badges[0]!)).toBe(true);
    expect(view.getByTestId("team-coach-decision").getAttribute("data-recommended-position")).toBe("3");
  });

  test("17. todas las posiciones legales siguen seleccionables, no sólo la recomendada", () => {
    const selected: TeamPosition[] = [];
    const view = renderBoard(board([1, 2, 3, 4, 5], 2), { onSelectPosition: (position) => selected.push(position), onPickHero: () => {} });
    for (const position of [1, 2, 3, 4, 5] as TeamPosition[]) {
      const header = view.getByTestId(`team-coach-select-${position}`) as HTMLButtonElement;
      expect(header.disabled).toBe(false);
      fireEvent.click(header);
    }
    expect(selected).toEqual([1, 2, 3, 4, 5]);
    expect(view.getAllByRole("button", { name: /^Elegir / })).toHaveLength(15);
  });

  test("18. elegir un héroe de una posición NO recomendada llama al pick con ESA posición", () => {
    const picks: [TeamPosition, number][] = [];
    const view = renderBoard(board([1, 2, 3, 4, 5], 2), { onPickHero: (position, heroId) => picks.push([position, heroId]) });
    fireEvent.click(view.getByRole("button", { name: "Elegir Hero 52 como Pos5 Hard Support" }));
    expect(picks).toEqual([[5, 52]]);
  });

  test("20. recálculo visible tras el pick: la columna queda Elegida y el héroe desaparece del tablero", () => {
    const view = renderBoard(board([1, 2, 3, 4, 5], 2), { onPickHero: () => {} });
    expect(view.getByTestId("team-coach-board").getAttribute("data-state-identity")).toBe("state-a");
    const after = board([1, 2, 3, 4, 5], 2, { 5: { state: "FILLED", alreadyFilled: true, filledHeroId: 52, eligibleNow: false, top: [], primaryHeroId: null } }, "state-b");
    view.rerender(<TeamCoachBoard board={after} status="ready" heroCatalog={HEROES} selectedPosition={null} onSelectPosition={() => {}} onPickHero={() => {}} />);
    expect(view.getByTestId("team-coach-board").getAttribute("data-state-identity")).toBe("state-b");
    expect(view.getByTestId("team-coach-column-5").getAttribute("data-state")).toBe("FILLED");
    expect(view.getByTestId("team-coach-filled").textContent).toContain("Hero 52");
    expect(view.queryAllByTestId("team-coach-candidate").map((card) => card.getAttribute("data-hero-id"))).not.toContain("52");
    expect((view.getByTestId("team-coach-select-5") as HTMLButtonElement).disabled).toBe(true);
  });

  test("sin onPickHero (live con Dota como fuente) el tablero es de sólo lectura", () => {
    const view = renderBoard(board());
    expect(view.queryAllByRole("button", { name: /^Elegir / })).toHaveLength(0);
    expect(view.getAllByTestId("team-coach-candidate")).toHaveLength(15);
  });

  test("sin acción humana: no hay PICK NOW y se explica por qué", () => {
    const view = renderBoard(board([1, 2, 3, 4, 5], null, Object.fromEntries([1, 2, 3, 4, 5].map((position) => [position, { eligibleNow: false, state: "WAITING", top: [], primaryHeroId: null, note: "esperando" }]))));
    expect(view.queryByTestId("team-coach-pick-now")).toBeNull();
    expect(view.getByTestId("team-coach-no-action")).toBeTruthy();
  });
});

describe("parseTeamCoachBoard", () => {
  test("acepta un board válido y rechaza columnas de otro snapshot", () => {
    expect(parseTeamCoachBoard(board())).not.toBeNull();
    const mixed = board();
    mixed.positions[3] = { ...mixed.positions[3]!, stateIdentity: "otro" };
    expect(parseTeamCoachBoard(mixed)).toBeNull();
    expect(parseTeamCoachBoard({ ...board(), schema: "x" })).toBeNull();
  });
});

describe("19. un único TeamCoachBoard para /simulator y /live-draft", () => {
  const webRoot = resolve(import.meta.dir, "../../..");
  test("ambas superficies importan el mismo componente; no existe una segunda implementación", () => {
    const simulator = readFileSync(resolve(webRoot, "app/simulator/page.tsx"), "utf8");
    const live = readFileSync(resolve(webRoot, "features/team-coach/components/LiveTeamCoachView.tsx"), "utf8");
    const livePage = readFileSync(resolve(webRoot, "app/live-draft/page.tsx"), "utf8");
    expect(simulator).toContain('import { TeamCoachBoard, type TeamPosition } from "@/features/team-coach";');
    expect(simulator).toContain("<TeamCoachBoard");
    expect(live).toContain('import { TeamCoachBoard } from "./TeamCoachBoard";');
    expect(live).toContain("<TeamCoachBoard");
    expect(livePage).toContain("LiveTeamCoachView");
    const definitions = Array.from(new Bun.Glob("{app,features,components}/**/*.tsx").scanSync({ cwd: webRoot }))
      .filter((file) => !file.endsWith(".test.tsx") && /export function TeamCoachBoard\b/.test(readFileSync(resolve(webRoot, file), "utf8")));
    expect(definitions.map((file) => file.replaceAll("\\", "/"))).toEqual(["features/team-coach/components/TeamCoachBoard.tsx"]);
  });
});
