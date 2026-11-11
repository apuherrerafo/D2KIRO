import "@/test-support/happy-dom";

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import type { TeamCoachBoardData, TeamCoachColumn, TeamPosition } from "@/features/team-coach/types";
import { NO_RECOMMENDATIONS_COPY } from "./Columns";
import { SimulatorLightBoard } from "./SimulatorLightBoard";

afterEach(cleanup);

// Fixtures inline (ninguna prueba lee datos reales). Ids de héroe arbitrarios.
function column(position: TeamPosition, overrides: Partial<TeamCoachColumn> = {}): TeamCoachColumn {
  const heroes = [position * 10 + 1, position * 10 + 2, position * 10 + 3];
  return {
    position,
    eligibleNow: true,
    alreadyFilled: false,
    filledHeroId: null,
    state: "RANKED",
    primaryHeroId: heroes[0]!,
    top: heroes.map((heroId, index) => ({ heroId, rank: index + 1, score: 30 - index, reasons: [`razón ${heroId}`], isPrimary: index === 0, evidenceStrength: "STRONG" as const })),
    stateIdentity: "state-a",
    note: null,
    ...overrides,
  };
}

function boardOf(positions: TeamPosition[], recommended: TeamPosition | null = positions[0] ?? null, overrides: Partial<Record<TeamPosition, Partial<TeamCoachColumn>>> = {}): TeamCoachBoardData {
  const columns = positions.map((position) => column(position, overrides[position]));
  return {
    schema: "team-coach-board/v1",
    sessionId: "s",
    stateIdentity: "state-a",
    currentDecision: {
      recommendedPosition: recommended,
      recommendedHeroId: recommended === null ? null : recommended * 10 + 1,
      targetBasis: "STRATEGIC",
      reason: "razón de equipo",
      actionablePositions: positions,
      roundCapacity: positions.length,
    },
    positions: columns,
    unboundOwnHeroIds: [],
  };
}

function view(board: TeamCoachBoardData | null, humanPosition: TeamPosition | null = 1, status: "idle" | "loading" | "ready" | "failed" = "ready") {
  return render(<SimulatorLightBoard board={board} humanPosition={humanPosition} status={status} />);
}

const PARTIES: TeamPosition[][] = [[1], [1, 3], [1, 2, 3], [1, 2, 3, 4, 5]];

describe("SimulatorLightBoard · columnas por party", () => {
  for (const positions of PARTIES) {
    test(`muestra exactamente las posiciones controladas: ${positions.join(",")}`, () => {
      const { container } = view(boardOf(positions));
      const shown = [...container.querySelectorAll('[data-testid^="team-coach-column-"]')].map((node) => node.getAttribute("data-testid"));
      expect(shown).toEqual(positions.map((position) => `team-coach-column-${position}`));
      expect(container.querySelector(".sl-stage")?.getAttribute("data-columns")).toBe(String(positions.length));
    });
  }

  test("no inventa posiciones que el motor no entregó", () => {
    const { container } = view(boardOf([1, 2, 3, 4]));
    expect(container.querySelectorAll('[data-testid^="team-coach-column-"]').length).toBe(4);
  });

  test("la posición propia se marca como «Tu posición»; el resto, como party", () => {
    const { container } = view(boardOf([1, 3]), 3);
    expect(container.querySelector('[data-testid="team-coach-column-3"] section, [data-testid="team-coach-column-3"]')?.getAttribute("data-relation")).toBe("mine");
    expect(container.querySelector('[data-testid="team-coach-column-1"]')?.getAttribute("data-relation")).toBe("party");
  });
});

describe("SimulatorLightBoard · el clic analiza, no elige", () => {
  test("sin selección el panel dice qué hacer y aclara que no se envía nada", () => {
    const { getByText } = view(boardOf([1, 3]));
    expect(getByText("Selecciona un héroe para ver su análisis")).toBeDefined();
    expect(getByText(/Abrir el análisis no elige el héroe ni envía nada a Dota/)).toBeDefined();
  });

  test("clic en una tarjeta abre el análisis de ESE héroe y la marca pressed; segundo clic lo cierra", () => {
    const { container, getByText } = view(boardOf([1, 3], 1));
    const card = container.querySelector('[data-card-key="3:32"] button') as HTMLButtonElement;
    expect(card.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(card);
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("[data-detail-key]")?.getAttribute("data-detail-key")).toBe("3:32");
    expect(getByText("razón 32")).toBeDefined();
    fireEvent.click(card);
    expect(card.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector("[data-detail-key]")).toBeNull();
  });

  test("no hay botones anidados ni botón de elegir dentro del tablero", () => {
    const { container } = view(boardOf([1, 3]));
    expect(container.querySelectorAll("button button").length).toBe(0);
    expect(container.querySelector('[data-testid="team-coach-pick-recommended"]')).toBeNull();
  });

  test("recomendado + abierto en análisis a la vez: conserva recommended Y queda pressed", () => {
    const { container } = view(boardOf([1], 1), 1);
    const card = container.querySelector('[data-card-key="1:11"] button') as HTMLButtonElement;
    expect(card.getAttribute("data-state")).toBe("recommended");
    fireEvent.click(card);
    expect(card.getAttribute("data-state")).toBe("recommended");
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-card-key="1:11"]')?.textContent).toContain("ELIGE AHORA");
  });
});

describe("SimulatorLightBoard · contrato V6", () => {
  test("ELIGE AHORA solo con evidencia STRONG: un recomendado WEAK no se destaca", () => {
    const weak = boardOf([1], 1, { 1: { top: [{ heroId: 11, rank: 1, score: 5, reasons: [], isPrimary: true, evidenceStrength: "WEAK" }] } });
    const { container } = view(weak, 1);
    expect(container.querySelector('[data-card-key="1:11"] button')?.getAttribute("data-state")).toBe("uncertain");
    expect(container.querySelector('[data-recommended="true"]')).toBeNull();
    expect(container.textContent).toContain("Evidencia limitada");
  });

  test("primaryHeroId distinto del top 1: el plan es del primario y ELIGE AHORA queda en la columna recomendada", () => {
    const top = [31, 32, 33].map((heroId, index) => ({ heroId, rank: index + 1, score: 9, reasons: [], isPrimary: heroId === 32, evidenceStrength: "STRONG" as const }));
    const { container } = view(boardOf([1, 3], 1, { 3: { primaryHeroId: 32, top } }), 1);
    expect(container.querySelector('[data-card-key="3:32"]')?.getAttribute("data-primary")).toBe("true");
    expect(container.querySelector('[data-card-key="3:31"]')?.getAttribute("data-primary")).toBe("false");
    expect(container.querySelector('[data-card-key="3:32"]')?.textContent).toContain("Plan de equipo");
    expect(container.querySelector('[data-card-key="1:11"]')?.getAttribute("data-recommended")).toBe("true");
    // Ranking general ≠ prioridad estratégica: el título dice el puesto en el ranking (#2) y la marca dice la prioridad (Plan de equipo); el #1 no la tiene.
    expect(container.querySelector('[data-card-key="3:32"]')?.textContent).toContain("#2 en el ranking");
    expect(container.querySelector('[data-card-key="3:31"]')?.textContent).toContain("#1 en el ranking");
    expect(container.querySelector('[data-card-key="3:31"]')?.textContent).not.toContain("Plan de equipo");
    expect(container.querySelector('[data-card-key="3:32"]')?.textContent).not.toContain("ELIGE AHORA");
  });

  test("si la decisión apunta a una posición que no está en el tablero, no se reasigna a otro héroe", () => {
    const b = boardOf([1, 3], 1);
    b.currentDecision.recommendedPosition = 5;
    b.currentDecision.recommendedHeroId = 51;
    const { container } = view(b);
    expect(container.querySelector('[data-recommended="true"]')).toBeNull();
  });

  test("ranking general y ranking del pool van separados; ningún héroe se repite", () => {
    const poolTop = [
      { heroId: 32, rank: 1, score: 8, reasons: [], isPrimary: false, evidenceStrength: "STRONG" as const, poolMembership: "IN_POOL" as const },
      { heroId: 99, rank: 2, score: 7, reasons: [], isPrimary: false, evidenceStrength: "STRONG" as const, poolMembership: "IN_POOL" as const },
    ];
    const { container, getByText } = view(boardOf([3], null, { 3: { poolTop } }), 3);
    const ids = [...container.querySelectorAll("[data-card-key]")].map((node) => node.getAttribute("data-card-key"));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("3:99");
    expect(getByText("Ranking general")).toBeDefined();
    expect(getByText("Más de tu pool")).toBeDefined();
    const dual = container.querySelector('[data-card-key="3:32"]')?.textContent ?? "";
    expect(dual).toContain("#2 en el ranking");
    expect(dual).toContain("#1 de tu pool");
    expect(container.querySelector('[data-card-key="3:99"]')?.textContent).toContain("#2 de tu pool");
  });
});

describe("SimulatorLightBoard · estados del tablero", () => {
  test("FILLED, WAITING y UNAVAILABLE se dicen; RANKED sin candidatos lo dice sin inventar candidatos", () => {
    const b = boardOf([1, 2, 3, 4], null, {
      1: { state: "FILLED", filledHeroId: 7, top: [] },
      2: { state: "WAITING", top: [], note: "Esperando tu turno" },
      3: { state: "UNAVAILABLE", top: [], note: "No se pudo calcular esta posición" },
      4: { state: "RANKED", top: [] },
    });
    const { container } = view(b);
    expect(container.querySelector('[data-testid="team-coach-column-1"]')?.textContent).toContain("Posición cubierta");
    expect(container.querySelector('[data-testid="team-coach-column-2"]')?.textContent).toContain("Esperando tu turno");
    expect(container.querySelector('[data-testid="team-coach-column-3"] [role="alert"]')?.textContent).toContain("No se pudo calcular");
    // RANKED sin candidatos: ningún candidato inventado, pero el vacío se dice en llano y deja la salida manual a la vista.
    expect(container.querySelector('[data-testid="team-coach-column-4"] li')).toBeNull();
    expect(container.querySelector('[data-testid="team-coach-column-4"] [data-card-key]')).toBeNull();
    const empty = container.querySelector('[data-testid="team-coach-column-4"] [data-testid="sl-column-empty"]');
    expect(empty?.textContent).toBe(NO_RECOMMENDATIONS_COPY);
    expect(empty?.textContent).toContain("Sin recomendaciones disponibles con la información actual");
    expect(empty?.textContent).toContain("Buscar otro héroe");
    expect(empty?.getAttribute("role")).toBeNull();
    expect(container.textContent).not.toContain("ELIGE AHORA");
    // Las demás columnas no muestran el aviso de vacío.
    expect(container.querySelectorAll('[data-testid="sl-column-empty"]').length).toBe(1);
  });

  test("sin tablero: cargando, y fallo con «Reintentar»", () => {
    const loading = view(null, 1, "loading");
    expect(loading.container.querySelector('[data-testid="team-coach-loading"]')).not.toBeNull();
    cleanup();
    let retries = 0;
    function handleRetry() {
      retries += 1;
    }
    const failed = render(<SimulatorLightBoard board={null} humanPosition={1} onRetry={handleRetry} status="failed" />);
    expect(failed.container.querySelector('[role="alert"]')).not.toBeNull();
    fireEvent.click(failed.getByText("Reintentar"));
    expect(retries).toBe(1);
  });

  test("panel: razones solo con datos reales (un campo vacío no se dibuja)", () => {
    const top = [{ heroId: 11, rank: 1, score: 9, reasons: ["motivo base"], isPrimary: true, evidenceStrength: "STRONG" as const,
      strengths: [{ vsHeroId: 5, level: "hard" as const, why: "lo corta" }], risks: [{ vsHeroId: 6, why: "lo castiga" }], synergies: [{ withHeroId: 7, why: "combo" }] }];
    const { container, getByText, queryByText } = view(boardOf([1], 1, { 1: { top } }), 1);
    fireEvent.click(container.querySelector('[data-card-key="1:11"] button') as HTMLButtonElement);
    expect(getByText(/lo corta/)).toBeDefined();
    expect(getByText(/lo castiga/)).toBeDefined();
    expect(getByText(/combo/)).toBeDefined();
    expect(queryByText("Robo")).toBeNull();
    expect(queryByText("Sigue libre")).toBeNull();
  });
});

describe("SimulatorLightBoard · razón estratégica (Fase 4A.2)", () => {
  function open(board: TeamCoachBoardData, key: string, human: TeamPosition | null = 1) {
    const rendered = view(board, human);
    fireEvent.click(rendered.container.querySelector(`[data-card-key="${key}"] button`) as HTMLButtonElement);
    return rendered;
  }

  test("las tarjetas siguen compactas: la razón del equipo NO aparece hasta abrir un candidato", () => {
    const { container, queryByText } = view(boardOf([1, 3], 1));
    expect(queryByText("razón de equipo")).toBeNull();
    expect(container.querySelector('[data-testid="sl-decision"]')).toBeNull();
  });

  test("abrir el recomendado muestra la razón del motor en «Decisión del equipo», aparte de «Razones de …»", () => {
    const { container, getByTestId } = open(boardOf([1, 3], 1), "1:11");
    const decision = getByTestId("sl-decision");
    expect(decision.getAttribute("data-decision")).toBe("same");
    expect(getByTestId("sl-decision-reason").textContent).toBe("razón de equipo");
    expect(decision.textContent).toContain("ELIGE AHORA");
    const heroReasons = getByTestId("sl-hero-reasons");
    expect(heroReasons.textContent).toContain("razón 11");
    expect(heroReasons.contains(decision)).toBe(false);
    expect(container.querySelectorAll('[data-testid="sl-decision-reason"]').length).toBe(1);
  });

  test("abrir OTRO héroe: la razón se atribuye al recomendado por su nombre y no al abierto", () => {
    const { getByTestId } = open(boardOf([1, 3], 1), "1:12");
    const decision = getByTestId("sl-decision");
    expect(decision.getAttribute("data-decision")).toBe("other");
    expect(decision.textContent).toContain("Esta decisión es sobre");
    expect(getByTestId("sl-hero-reasons").textContent).not.toContain("razón de equipo");
  });

  test("si la decisión apunta a otra POSICIÓN visible, abrir un héroe de esta columna no hereda la explicación", () => {
    const { getByTestId } = open(boardOf([1, 3], 3), "1:11");
    expect(getByTestId("sl-decision").getAttribute("data-decision")).toBe("other");
    expect(getByTestId("sl-hero-reasons").textContent).not.toContain("razón de equipo");
  });

  test("criterio no estratégico: la razón del motor también se muestra, con su criterio dicho tal cual", () => {
    const board = boardOf([1], 1);
    board.currentDecision = { ...board.currentDecision, targetBasis: "PHASE_FALLBACK", reason: "razón de orden" };
    const { getByTestId } = open(board, "1:11");
    expect(getByTestId("sl-decision-reason").textContent).toBe("razón de orden");
    expect(getByTestId("sl-decision").textContent).toContain("orden de la fase");
  });

  test("recomendado con evidencia limitada: no hay decisión que mostrar ni se la atribuye a nadie", () => {
    const top = [{ heroId: 11, rank: 1, score: 9, reasons: ["motivo"], isPrimary: true, evidenceStrength: "WEAK" as const }];
    const { container } = open(boardOf([1], 1, { 1: { top } }), "1:11");
    expect(container.querySelector('[data-testid="sl-decision"]')).toBeNull();
  });

  test("sin pick humano ahora (posición null): el aviso del motor se dice dentro del análisis abierto, sin inventar recomendación", () => {
    const board = boardOf([1], null);
    board.currentDecision = { ...board.currentDecision, reason: "No hay un pick humano abierto en este momento." };
    const { getByTestId } = open(board, "1:11");
    expect(getByTestId("sl-decision").getAttribute("data-decision")).toBe("none");
    expect(getByTestId("sl-decision").textContent).toContain("No hay un pick humano abierto en este momento.");
  });
});

describe("SimulatorLightBoard · onAnalyze (abrir no elige; solo informa)", () => {
  type Seen = { position: number; heroId: number } | null;

  test("avisa qué candidato quedó abierto y limpia al cerrarlo", () => {
    const seen: Seen[] = [];
    function onAnalyze(candidate: Seen) {
      seen.push(candidate);
    }
    const { container } = render(<SimulatorLightBoard board={boardOf([1, 3], 1)} humanPosition={1} onAnalyze={onAnalyze as never} status="ready" />);
    const card = container.querySelector('[data-card-key="3:32"] button') as HTMLButtonElement;
    fireEvent.click(card);
    expect(seen.at(-1)).toEqual({ position: 3, heroId: 32 });
    fireEvent.click(card);
    expect(seen.at(-1)).toBeNull();
  });

  test("si el candidato abierto desaparece del tablero (se eligió o se recalculó), el análisis se cierra y se avisa", () => {
    const seen: Seen[] = [];
    function onAnalyze(candidate: Seen) {
      seen.push(candidate);
    }
    const first = boardOf([1], 1);
    const rendered = render(<SimulatorLightBoard board={first} humanPosition={1} onAnalyze={onAnalyze as never} status="ready" />);
    fireEvent.click(rendered.container.querySelector('[data-card-key="1:11"] button') as HTMLButtonElement);
    expect(seen.at(-1)).toEqual({ position: 1, heroId: 11 });
    const without = boardOf([1], 1, { 1: { top: first.positions[0]!.top.slice(1), primaryHeroId: 12 } });
    rendered.rerender(<SimulatorLightBoard board={without} humanPosition={1} onAnalyze={onAnalyze as never} status="ready" />);
    expect(seen.at(-1)).toBeNull();
    expect(rendered.container.querySelector("[data-detail-key]")).toBeNull();
  });
});
