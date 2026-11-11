import "@/test-support/happy-dom";

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import type { TeamCoachBoardData, TeamCoachColumn, TeamPosition } from "@/features/team-coach/types";
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
    expect(getByText("Abrir el análisis no elige el héroe ni envía nada a Dota.")).toBeDefined();
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
  test("FILLED, WAITING y UNAVAILABLE se dicen; RANKED sin candidatos no dibuja nada", () => {
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
    expect(container.querySelector('[data-testid="team-coach-column-4"] li')).toBeNull();
    expect(container.querySelector('[data-testid="team-coach-column-4"] .sl-note, [data-testid="team-coach-column-4"] .sl-filled, [data-testid="team-coach-column-4"] .sl-subhead')).toBeNull();
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
