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

describe("TeamCoachBoard -- el porqué de cada héroe, a la vista (Parte 2)", () => {
  test("columna RANKED: la razón de cada candidato se ve como texto, no solo en un tooltip", () => {
    const view = renderBoard(board([2], 2));
    const reasons = view.getAllByTestId("team-coach-candidate-reason").map((node) => node.textContent);
    expect(reasons).toEqual(["razón 21", "razón 22", "razón 23"]);
  });

  test("columna UNRANKED_POSITIONAL: no se repite la misma frase en los 5 héroes", () => {
    const view = renderBoard(board([2], 2, { 2: { state: "UNRANKED_POSITIONAL" } }));
    expect(view.queryAllByTestId("team-coach-candidate-reason")).toHaveLength(0);
  });

  test("un rival revelado que counterea al candidato se ve como 'Riesgo (X te counterea): porqué'", () => {
    const withRisk = column(2);
    withRisk.top[0] = { ...withRisk.top[0]!, risks: [{ vsHeroId: 7, why: "Berserker's Call lo obliga a pelear" }] };
    const view = renderBoard({ ...board([2], 2), positions: [withRisk] });
    const risks = view.getAllByTestId("team-coach-candidate-risk");
    expect(risks).toHaveLength(1);
    expect(risks[0]!.textContent).toBe("Riesgo (Hero 7 te counterea): Berserker's Call lo obliga a pelear");
  });

  test("sin riesgos (o un motor que no manda el campo): no aparece ninguna línea de riesgo", () => {
    const view = renderBoard(board([2], 2));
    expect(view.queryAllByTestId("team-coach-candidate-risk")).toHaveLength(0);
  });

  test("a quién le gana de lo que el rival YA tiene se ve con su porqué: 'Fuerte contra X (ya está en el rival): porqué'", () => {
    const withStrength = column(2);
    withStrength.top[0] = { ...withStrength.top[0]!, strengths: [{ vsHeroId: 7, level: "hard", why: "Orchid lo silencia", revealed: true }] };
    const view = renderBoard({ ...board([2], 2), positions: [withStrength] });
    const lines = view.getAllByTestId("team-coach-candidate-strength");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toBe("Fuerte contra Hero 7 (ya está en el rival): Orchid lo silencia");
  });

  test("un counter medium dice 'Ventaja posible contra', nunca 'Fuerte contra'", () => {
    const withMedium = column(2);
    withMedium.top[0] = { ...withMedium.top[0]!, strengths: [{ vsHeroId: 7, level: "medium", why: "razón", revealed: true }] };
    const view = renderBoard({ ...board([2], 2), positions: [withMedium] });
    expect(view.getByTestId("team-coach-candidate-strength").textContent).toBe("Ventaja posible contra Hero 7 (ya está en el rival): razón");
  });

  test("sin fortalezas, sin bans que abran nada y sin sinergias (o un motor que no manda los campos): no aparece ninguna línea", () => {
    const view = renderBoard(board([2], 2));
    expect(view.queryAllByTestId("team-coach-candidate-strength")).toHaveLength(0);
    expect(view.queryAllByTestId("team-coach-candidate-opened")).toHaveLength(0);
    expect(view.queryAllByTestId("team-coach-candidate-synergy")).toHaveLength(0);
  });

  test("lo que abrieron los bans se dice con nombres, y el riesgo que queda también", () => {
    const opened = column(2);
    opened.top[0] = {
      ...opened.top[0]!,
      opening: { openedBy: [{ heroId: 7, level: "hard" }, { heroId: 8, level: "hard" }, { heroId: 9, level: "medium" }], stillFree: [{ heroId: 11, level: "medium" }, { heroId: 12, level: "medium" }] },
    };
    const view = renderBoard({ ...board([2], 2), positions: [opened] });
    expect(view.getByTestId("team-coach-candidate-opened").textContent).toBe("Se abre: Hero 7, Hero 8 y Hero 9, que lo counterean, están baneados.");
    expect(view.getByTestId("team-coach-candidate-still-free").textContent).toBe("Ojo: Hero 11 y Hero 12 también lo counterean y siguen libres.");
  });

  test("un solo counter baneado se dice en singular", () => {
    const opened = column(2);
    opened.top[0] = { ...opened.top[0]!, opening: { openedBy: [{ heroId: 7, level: "hard" }], stillFree: [] } };
    const view = renderBoard({ ...board([2], 2), positions: [opened] });
    expect(view.getByTestId("team-coach-candidate-opened").textContent).toBe("Se abre: Hero 7, que lo counterea, está baneado.");
    expect(view.queryAllByTestId("team-coach-candidate-still-free")).toHaveLength(0);
  });

  test("si le queda un counter FUERTE libre no se dice 'se abre': se avisa de ese counter", () => {
    const closed = column(2);
    closed.top[0] = { ...closed.top[0]!, opening: { openedBy: [], stillFree: [{ heroId: 11, level: "hard" }] } };
    const view = renderBoard({ ...board([2], 2), positions: [closed] });
    expect(view.queryAllByTestId("team-coach-candidate-opened")).toHaveLength(0);
    expect(view.getByTestId("team-coach-candidate-still-free").textContent).toBe("Ojo: Hero 11 lo counterea fuerte y sigue libre.");
  });

  test("un counter libre cuya posición ya ocupó el rival se avisa como menos probable", () => {
    const taken = column(2);
    taken.top[0] = { ...taken.top[0]!, opening: { openedBy: [], stillFree: [{ heroId: 11, level: "hard", takenPosition: 3 }] } };
    const view = renderBoard({ ...board([2], 2), positions: [taken] });
    expect(view.getByTestId("team-coach-candidate-still-free").textContent).toBe("Ojo: Hero 11 (menos probable: ya tienen offlane) lo counterea fuerte y sigue libre.");
  });

  test("sin nada que decir de los bans (ronda 2-3 o casi nada baneado) no aparece ninguna línea de bans", () => {
    const quiet = column(2);
    quiet.top[0] = { ...quiet.top[0]!, opening: { openedBy: [], stillFree: [] } };
    const view = renderBoard({ ...board([2], 2), positions: [quiet] });
    expect(view.queryAllByTestId("team-coach-candidate-opened")).toHaveLength(0);
    expect(view.queryAllByTestId("team-coach-candidate-still-free")).toHaveLength(0);
  });

  test("si el motivo del motor ya es 'Sinergia con X', la misma pareja no se repite abajo", () => {
    const repeated = column(2);
    repeated.top[0] = { ...repeated.top[0]!, reasons: ["Sinergia con Hero 7: combo"], synergies: [{ withHeroId: 7, why: "combo" }] };
    const view = renderBoard({ ...board([2], 2), positions: [repeated] });
    expect(view.queryAllByTestId("team-coach-candidate-synergy")).toHaveLength(0);
  });

  test("la sinergia se dice solo con un aliado que YA elegiste: 'Combina con tu X: porqué'", () => {
    const withPartner = column(2);
    withPartner.top[0] = { ...withPartner.top[0]!, synergies: [{ withHeroId: 7, why: "Shallow Grave le da tiempo para usar Blink" }] };
    const view = renderBoard({ ...board([2], 2), positions: [withPartner] });
    expect(view.getByTestId("team-coach-candidate-synergy").textContent).toBe("Combina con tu Hero 7: Shallow Grave le da tiempo para usar Blink");
  });

  test("dos listas por posición: la de tu pool arriba y 'En general' abajo, y pueden repetir héroes", () => {
    const withPool = column(2);
    withPool.poolTop = [withPool.top[0]!];
    const view = renderBoard({ ...board([2], 2), positions: [withPool] });
    expect(view.getByTestId("team-coach-pool-list").textContent).toContain("Del pool");
    expect(view.getByText("En general")).toBeTruthy();
    const repeated = String(withPool.top[0]!.heroId);
    expect(view.getAllByTestId("team-coach-candidate").filter((node) => node.getAttribute("data-hero-id") === repeated)).toHaveLength(1);
    // La lista del pool usa su propio testid: la auditoría (Flight Recorder) compara solo la lista general con el motor.
    expect(view.getAllByTestId("team-coach-pool-candidate").map((node) => node.getAttribute("data-hero-id"))).toEqual([repeated]);
  });

  test("sin lista de pool la columna queda como siempre: sin encabezados", () => {
    const view = renderBoard(board([2], 2));
    expect(view.queryAllByTestId("team-coach-pool-list")).toHaveLength(0);
    expect(view.queryByText("En general")).toBeNull();
  });

  test("validación: acepta los campos nuevos ausentes y bien formados; rechaza los mal formados", () => {
    const good = board([2], 2);
    good.positions[0]!.top[0] = {
      ...good.positions[0]!.top[0]!,
      strengths: [{ vsHeroId: 7, level: "hard", why: "razón", revealed: true }],
      opening: { openedBy: [{ heroId: 7, level: "hard" }], stillFree: [] },
      synergies: [{ withHeroId: 8, why: "razón" }],
    };
    good.positions[0]!.poolTop = [good.positions[0]!.top[0]!];
    expect(parseTeamCoachBoard(good)).not.toBeNull();
    const brokenStrength = board([2], 2);
    (brokenStrength.positions[0]!.top[0] as unknown as { strengths: unknown }).strengths = [{ vsHeroId: 7, level: "enorme", why: "razón" }];
    expect(parseTeamCoachBoard(brokenStrength)).toBeNull();
    const brokenOpening = board([2], 2);
    (brokenOpening.positions[0]!.top[0] as unknown as { opening: unknown }).opening = { openedBy: "no", stillFree: [] };
    expect(parseTeamCoachBoard(brokenOpening)).toBeNull();
    const brokenPool = board([2], 2);
    (brokenPool.positions[0] as unknown as { poolTop: unknown }).poolTop = "abc";
    expect(parseTeamCoachBoard(brokenPool)).toBeNull();
    const brokenPoolItem = board([2], 2);
    (brokenPoolItem.positions[0] as unknown as { poolTop: unknown }).poolTop = [{ nope: 1 }];
    expect(parseTeamCoachBoard(brokenPoolItem)).toBeNull();
    const brokenSynergy = board([2], 2);
    (brokenSynergy.positions[0]!.top[0] as unknown as { synergies: unknown }).synergies = [{ withHeroId: "x", why: 3 }];
    expect(parseTeamCoachBoard(brokenSynergy)).toBeNull();
  });
});

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

  describe("la recomendación es una acción", () => {
    test("con pick habilitado, un botón elige al héroe recomendado EN su posición recomendada", () => {
      const picks: [TeamPosition, number][] = [];
      const view = renderBoard(board([1, 2, 3, 4, 5], 3), { onPickHero: (position, heroId) => picks.push([position, heroId]) });
      fireEvent.click(view.getByTestId("team-coach-pick-recommended"));
      expect(picks).toEqual([[3, 31]]);
    });

    test("el botón de la recomendación no suma un 'Elegir ...' más: los candidatos siguen siendo 15", () => {
      const view = renderBoard(board(), { onPickHero: () => {} });
      expect(view.getAllByRole("button", { name: /^Elegir / })).toHaveLength(15);
      expect(view.getByRole("button", { name: "Elige a Hero 21 como Pos2 Mid" })).toBeTruthy();
    });

    test("CANDADO modo lectura: sin onPickHero no hay botón ni pista de 'toca un héroe'", () => {
      const view = renderBoard(board());
      expect(view.queryByTestId("team-coach-pick-recommended")).toBeNull();
      expect(view.getByTestId("team-coach-decision").textContent).not.toContain("tocar cualquier héroe");
    });

    test("si la posición recomendada ya no es elegible, no se ofrece el botón", () => {
      const view = renderBoard(board([1, 2, 3, 4, 5], 2, { 2: { eligibleNow: false } }), { onPickHero: () => {} });
      expect(view.queryByTestId("team-coach-pick-recommended")).toBeNull();
    });

    test("la teoría del motor queda detrás de '¿Por qué?', no en la cara del jugador", () => {
      const view = renderBoard(board(), { onPickHero: () => {} });
      const why = view.getByTestId("team-coach-why");
      expect(why.tagName).toBe("DETAILS");
      expect(why.querySelector("summary")?.textContent).toBe("¿Por qué?");
      expect(why.textContent).toContain("razón de la recomendación");
    });
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

describe("TeamCoachBoard -- live Party5 P0 (engine mirror)", () => {
  test("the validator accepts the engine's PHASE_FALLBACK basis and still refuses an unknown one", () => {
    const phase = board();
    phase.currentDecision.targetBasis = "PHASE_FALLBACK";
    expect(parseTeamCoachBoard(JSON.parse(JSON.stringify(phase)))).not.toBeNull();
    const unknown = JSON.parse(JSON.stringify(phase));
    unknown.currentDecision.targetBasis = "MADE_UP";
    expect(parseTeamCoachBoard(unknown)).toBeNull();
  });

  test("PHASE_FALLBACK says it is a phase order, never a strategic advantage", () => {
    const data = board();
    data.currentDecision.targetBasis = "PHASE_FALLBACK";
    const view = renderBoard(data);
    expect(view.getByTestId("team-coach-phase-fallback").textContent).toContain("Orden por fase del draft");
  });

  test("a position our picks fill without a confirmed hero renders as filled, with the engine's note and no candidates", () => {
    const note = "Ocupada por uno de tus héroes cuyo rol exacto todavía no se confirmó.";
    const data = board([1, 2, 3, 4, 5], 2, { 3: { state: "FILLED", alreadyFilled: true, filledHeroId: null, eligibleNow: false, primaryHeroId: null, top: [], note } });
    expect(parseTeamCoachBoard(JSON.parse(JSON.stringify(data)))).not.toBeNull();
    const view = renderBoard(data);
    expect(view.getByTestId("team-coach-column-3").textContent).toContain(note);
    expect(view.getByTestId("team-coach-column-3").querySelectorAll("[data-testid='team-coach-candidate']")).toHaveLength(0);
  });
});
