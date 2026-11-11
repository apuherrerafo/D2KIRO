import "@/test-support/happy-dom";

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import { useLiveTeamCoachStore } from "@/features/team-coach/live-store";
import type { LiveCaptureStatus, LiveLocalPlayer, LiveTeamContext, RequestStatus, TeamCoachBoardData, TeamCoachColumn, TeamPosition } from "@/features/team-coach/types";
import { LiveLightBoard } from "./LiveLightBoard";

afterEach(cleanup);

// FIXTURES INLINE (no sesión Live real, no motor, no datos curados). Ids de héroe arbitrarios.

function column(position: TeamPosition, overrides: Partial<TeamCoachColumn> = {}): TeamCoachColumn {
  const heroes = [position * 10 + 1, position * 10 + 2];
  return {
    position,
    eligibleNow: true,
    alreadyFilled: false,
    filledHeroId: null,
    state: "RANKED",
    primaryHeroId: heroes[0]!,
    top: heroes.map((heroId, index) => ({ heroId, rank: index + 1, score: 20 - index, reasons: [`razón ${heroId}`], isPrimary: index === 0, evidenceStrength: "STRONG" as const })),
    stateIdentity: "s",
    note: null,
    ...overrides,
  };
}

function boardOf(recommended: TeamPosition | null = 1, overrides: Partial<Record<TeamPosition, Partial<TeamCoachColumn>>> = {}): TeamCoachBoardData {
  return {
    schema: "team-coach-board/v1",
    sessionId: "s",
    stateIdentity: "s",
    currentDecision: { recommendedPosition: recommended, recommendedHeroId: recommended === null ? null : recommended * 10 + 1, targetBasis: "STRATEGIC", reason: "razón de equipo", actionablePositions: [1, 2, 3, 4, 5], roundCapacity: 2 },
    positions: ([1, 2, 3, 4, 5] as const).map((position) => column(position, overrides[position])),
    unboundOwnHeroIds: [],
  };
}

function capture(localPlayer: LiveLocalPlayer | undefined, teamContext?: LiveTeamContext, overrides: Partial<LiveCaptureStatus> = {}): LiveCaptureStatus {
  return { schema: "live-capture-status/v1", sessionId: "live-1", connection: "connected", lastEventAt: null, captureHealth: "ok", captureDetail: null, draftPhase: "hero_selection", localSide: "radiant", lastDetectedPick: null, bans: 0, picks: 0, deferredPicks: 0, rejectedFacts: 0, localPlayer, teamContext, ...overrides };
}

const ALL_POOLS = { "1": true, "2": true, "3": true, "4": true, "5": true } as const;
const PARTY5: LiveTeamContext = { teamGroupId: 7, positions: { ...ALL_POOLS } };
const seat = (position: TeamPosition | null, bound = false): LiveLocalPlayer => ({ position, heroId: null, bound });

interface Props {
  board: TeamCoachBoardData | null;
  status?: RequestStatus;
  captureStatus: LiveCaptureStatus | null;
  draftEnded?: boolean;
  fetchImpl?: typeof fetch;
  onRetry?: () => void;
}

function view({ board, status = "ready", captureStatus, draftEnded = false, fetchImpl, onRetry }: Props) {
  return render(<LiveLightBoard board={board} captureStatus={captureStatus} draftEnded={draftEnded} fetchImpl={fetchImpl} heroCatalog={new Map()} onRetry={onRetry} sessionId="live-1" status={status} />);
}

const columnIds = (container: HTMLElement) => [...container.querySelectorAll('[data-testid^="team-coach-column-"]')].map((node) => node.getAttribute("data-testid"));

describe("Live Light · Solo (fixtures)", () => {
  test("muestra únicamente la columna de la posición declarada", () => {
    const { container } = view({ board: boardOf(), captureStatus: capture(seat(3)) });
    expect(columnIds(container)).toEqual(["team-coach-column-3"]);
  });

  test("posición declarada pero sin confirmar: lo dice; confirmada: lo dice distinto", () => {
    const declared = view({ board: boardOf(), captureStatus: capture(seat(3)) });
    expect(declared.container.querySelector('[data-testid="team-coach-column-3"]')?.getAttribute("data-relation")).toBe("mine-unconfirmed");
    expect(declared.container.textContent).toContain("Tu posición · declarada, sin confirmar");
    expect(declared.getByTestId("sl-party").textContent).toContain("(declarada, sin confirmar)");
    cleanup();
    const confirmed = view({ board: boardOf(), captureStatus: capture(seat(3, true)) });
    expect(confirmed.container.querySelector('[data-testid="team-coach-column-3"]')?.getAttribute("data-relation")).toBe("mine");
    expect(confirmed.getByTestId("sl-party").textContent).toContain("(confirmada)");
    expect(confirmed.container.textContent).not.toContain("sin confirmar");
  });

  test("la decisión del equipo apunta a mi posición → ELIGE AHORA en mi tarjeta", () => {
    const { container } = view({ board: boardOf(1), captureStatus: capture(seat(1)) });
    expect(container.querySelector('[data-card-key="1:11"]')?.textContent).toContain("ELIGE AHORA");
  });

  test("la decisión apunta a OTRA posición → mi columna no lleva ELIGE AHORA y se avisa como prioridad del equipo", () => {
    const { container, getByTestId } = view({ board: boardOf(5), captureStatus: capture(seat(1)) });
    expect(container.textContent).not.toContain("ELIGE AHORA");
    expect(container.querySelector('[data-recommended="true"]')).toBeNull();
    expect(getByTestId("live-light-priority-elsewhere").textContent).toContain("Pos5 Hard Support");
  });

  test("un recomendado de evidencia LIMITADA no se destaca ni se convierte en fuerte", () => {
    const weak = boardOf(1, { 1: { top: [{ heroId: 11, rank: 1, score: 5, reasons: [], isPrimary: true, evidenceStrength: "WEAK" }] } });
    const { container } = view({ board: weak, captureStatus: capture(seat(1)) });
    expect(container.querySelector('[data-card-key="1:11"] button')?.getAttribute("data-state")).toBe("uncertain");
    expect(container.textContent).not.toContain("ELIGE AHORA");
    expect(container.textContent).toContain("Evidencia limitada");
  });

  test("clic = analizar: abre el análisis, no hay botón de elegir y no se manda NADA al motor ni a Dota", async () => {
    const calls: string[] = [];
    const spy = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const original = globalThis.fetch;
    globalThis.fetch = spy;
    try {
      const { container, queryAllByRole } = view({ board: boardOf(1), captureStatus: capture(seat(1, true)), fetchImpl: spy });
      const card = container.querySelector('[data-card-key="1:12"] button') as HTMLButtonElement;
      fireEvent.click(card);
      expect(container.querySelector("[data-detail-key]")?.getAttribute("data-detail-key")).toBe("1:12");
      expect(container.textContent).toContain("no elige el héroe ni envía nada a Dota");
      expect(container.textContent).toContain("El pick lo haces tú dentro de Dota");
      expect(queryAllByRole("button", { name: /^Elegir / })).toHaveLength(0);
      expect(calls).toEqual([]);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("la decisión del equipo se separa de las razones del héroe abierto", () => {
    const { container } = view({ board: boardOf(1), captureStatus: capture(seat(1, true)) });
    fireEvent.click(container.querySelector('[data-card-key="1:12"] button') as HTMLButtonElement);
    expect(container.querySelector('[data-testid="sl-hero-reasons"]')?.textContent).toContain("razón 12");
    const decision = container.querySelector('[data-testid="sl-decision"]');
    expect(decision?.getAttribute("data-decision")).toBe("other");
    expect(decision?.textContent).toContain("no sobre");
  });

  test("no inventa un timer: Live no tiene cuenta regresiva", () => {
    const { container } = view({ board: boardOf(1), captureStatus: capture(seat(1)) });
    expect(container.querySelector('[data-testid="draft-timer"]')).toBeNull();
  });
});

describe("Live Light · estados de columna (fixtures)", () => {
  const states: { state: TeamCoachColumn["state"]; overrides: Partial<TeamCoachColumn>; expected: string }[] = [
    { state: "FILLED", overrides: { state: "FILLED", filledHeroId: 99, top: [], primaryHeroId: null }, expected: "Posición cubierta" },
    { state: "WAITING", overrides: { state: "WAITING", top: [], primaryHeroId: null, note: "Esperando la próxima ronda." }, expected: "Esperando la próxima ronda." },
    { state: "UNAVAILABLE", overrides: { state: "UNAVAILABLE", top: [], primaryHeroId: null, note: "No se pudo calcular esta posición." }, expected: "No se pudo calcular esta posición." },
  ];
  for (const { state, overrides, expected } of states) {
    test(`${state} se dice tal cual, sin candidatos inventados`, () => {
      const { container } = view({ board: boardOf(null, { 2: overrides }), captureStatus: capture(seat(2, true)) });
      expect(container.querySelector('[data-testid="team-coach-column-2"]')?.getAttribute("data-state")).toBe(state);
      expect(container.textContent).toContain(expected);
      expect(container.querySelectorAll("[data-card-key]").length).toBe(0);
    });
  }

  test("UNAVAILABLE es una alerta, no un texto más", () => {
    const { container } = view({ board: boardOf(null, { 2: { state: "UNAVAILABLE", top: [], primaryHeroId: null, note: "No se pudo calcular esta posición." } }), captureStatus: capture(seat(2)) });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No se pudo calcular");
  });

  test("RANKED sin candidatos: copy en llano, nunca un héroe de relleno", () => {
    const { getByTestId, container } = view({ board: boardOf(null, { 2: { top: [], primaryHeroId: null } }), captureStatus: capture(seat(2)) });
    expect(getByTestId("sl-column-empty").textContent).toContain("Sin recomendaciones disponibles");
    expect(getByTestId("sl-column-empty").textContent).not.toContain("Buscar otro héroe");
    expect(container.querySelectorAll("[data-card-key]").length).toBe(0);
  });
});

describe("Live Light · posición sin declarar (fixtures)", () => {
  test("Solo sin declarar: no hay columnas, hay Pos 1–5", () => {
    const { container, getByTestId } = view({ board: boardOf(), captureStatus: capture(seat(null)) });
    expect(columnIds(container)).toEqual([]);
    expect(getByTestId("live-light-pick-seat")).toBeDefined();
    for (const position of [1, 2, 3, 4, 5]) expect(getByTestId(`live-light-seat-${position}`)).toBeDefined();
  });

  test("elegir Pos N usa el flujo Live existente (PUT /api/live/human-position) con esa posición", async () => {
    useLiveTeamCoachStore.getState().reset("live-1");
    const calls: { url: string; method: string; body: unknown }[] = [];
    const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", body: JSON.parse(String(init?.body ?? "null")) });
      return new Response(JSON.stringify({ schema: "live-human-position/v1", localPlayer: { position: 4, heroId: null, bound: false } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const { getByTestId } = view({ board: boardOf(), captureStatus: capture(seat(null)), fetchImpl: fake });
    await act(async () => {
      fireEvent.click(getByTestId("live-light-seat-4"));
    });
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]!.url).toContain("/api/live/human-position");
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.body).toEqual({ humanPosition: 4 });
  });

  test("si el motor rechaza la declaración (409: Dota no vinculado) se dice en llano y no cambia nada", async () => {
    useLiveTeamCoachStore.getState().reset("live-1");
    const refuse = (async () => new Response("{}", { status: 409 })) as unknown as typeof fetch;
    const { getByTestId } = view({ board: boardOf(), captureStatus: capture(seat(null)), fetchImpl: refuse });
    await act(async () => {
      fireEvent.click(getByTestId("live-light-seat-2"));
    });
    await waitFor(() => expect(getByTestId("live-light-seat-notice").textContent).toContain("Conecta Dota primero"));
    expect(getByTestId("live-light-pick-seat")).toBeDefined();
  });
});

describe("Live Light · Party 5 (fixtures)", () => {
  test("cinco posiciones cuando el motor confirma el preset", () => {
    const { container, getByTestId } = view({ board: boardOf(), captureStatus: capture(seat(2, true), PARTY5) });
    expect(columnIds(container)).toEqual([1, 2, 3, 4, 5].map((position) => `team-coach-column-${position}`));
    expect(getByTestId("sl-party").textContent).toContain("Party 5");
  });

  test("distingue posición propia, compañeros y prioridad del equipo", () => {
    const { container } = view({ board: boardOf(4), captureStatus: capture(seat(2, true), PARTY5) });
    expect(container.querySelector('[data-testid="team-coach-column-2"]')?.getAttribute("data-relation")).toBe("mine");
    expect(container.querySelector('[data-testid="team-coach-column-3"]')?.getAttribute("data-relation")).toBe("party");
    const recommended = container.querySelector('[data-card-key="4:41"]');
    expect(recommended?.getAttribute("data-recommended")).toBe("true");
    // La prioridad es de otro compañero: no se le atribuye al jugador.
    expect(recommended?.textContent).not.toContain("ELIGE AHORA");
    expect(recommended?.textContent).toContain("Para tu party · Pos 4");
  });

  test("Plan de equipo aparece en Party 5 (primarios que no son el ELIGE AHORA)", () => {
    const { container } = view({ board: boardOf(1), captureStatus: capture(seat(1, true), PARTY5) });
    expect(container.querySelector('[data-card-key="3:31"]')?.textContent).toContain("Plan de equipo");
    expect(container.querySelector('[data-card-key="1:11"]')?.textContent).not.toContain("Plan de equipo");
  });

  test("sin declarar mi posición en Party 5: no se marca ninguna columna como mía", () => {
    const { container } = view({ board: boardOf(), captureStatus: capture(seat(null), PARTY5) });
    expect(container.querySelectorAll('[data-relation="mine"], [data-relation="mine-unconfirmed"]').length).toBe(0);
  });

  test("un preset sin pools activos NO es Party 5: vuelve a Solo", () => {
    const none: LiveTeamContext = { teamGroupId: 7, positions: { "1": false, "2": false, "3": false, "4": false, "5": false } };
    const { container } = view({ board: boardOf(), captureStatus: capture(seat(3), none) });
    expect(columnIds(container)).toEqual(["team-coach-column-3"]);
  });
});

describe("Live Light · captura incompleta, 409 y reconexión (fixtures)", () => {
  test("sin tablero y sin cargar nada todavía: «calculando», no un mensaje de bloqueo", () => {
    const { getByTestId } = view({ board: null, status: "loading", captureStatus: null });
    expect(getByTestId("team-coach-loading")).toBeDefined();
  });

  test("409 / captura incompleta (board null + idle con captura leída): lo dice y NO recomienda", () => {
    const { getByTestId, container } = view({ board: null, status: "idle", captureStatus: capture(seat(1), undefined, { recommendation: { available: false, reason: "CAPTURE_PARTIAL" } }) });
    expect(getByTestId("live-light-blocked").textContent).toContain("la captura del draft está incompleta");
    expect(container.querySelectorAll("[data-card-key]").length).toBe(0);
    expect(container.textContent).not.toContain("ELIGE AHORA");
  });

  test("fallo de transporte del tablero: alerta visible con Reintentar", () => {
    let retried = 0;
    const { getByTestId, getByText } = view({ board: null, status: "failed", captureStatus: capture(seat(1)), onRetry: () => { retried += 1; } });
    expect(getByTestId("team-coach-failed").getAttribute("role")).toBe("alert");
    fireEvent.click(getByText("Reintentar"));
    expect(retried).toBe(1);
  });

  test("un tablero que falla DESPUÉS de tener datos conserva la última lectura y el estado «failed»", () => {
    const { getByTestId, container } = view({ board: boardOf(1), status: "failed", captureStatus: capture(seat(1, true)) });
    expect(getByTestId("team-coach-board").getAttribute("data-status")).toBe("failed");
    expect(container.querySelector('[data-card-key="1:11"]')).not.toBeNull();
  });

  test("reconexión: el mismo tablero se redibuja con la identidad de estado nueva sin perder la columna", () => {
    const first = view({ board: boardOf(1), captureStatus: capture(seat(1, true)) });
    expect(first.getByTestId("team-coach-board").getAttribute("data-state-identity")).toBe("s");
    const next = boardOf(1);
    next.stateIdentity = "s2";
    first.rerender(<LiveLightBoard board={next} captureStatus={capture(seat(1, true))} heroCatalog={new Map()} sessionId="live-1" status="ready" />);
    expect(first.getByTestId("team-coach-board").getAttribute("data-state-identity")).toBe("s2");
    expect(columnIds(first.container)).toEqual(["team-coach-column-1"]);
  });

  test("draft terminado sin tablero: solo el aviso", () => {
    const { getByTestId } = view({ board: null, status: "idle", captureStatus: capture(seat(1), undefined, { draftPhase: "ended" }), draftEnded: true });
    expect(getByTestId("team-coach-draft-ended").textContent).toContain("DRAFT TERMINADO");
  });

  test("draft terminado con tablero y Solo sin declarar: solo el aviso, sin pedir posición ni columnas", () => {
    const { getByTestId, queryByTestId, container } = view({ board: boardOf(1), captureStatus: capture(seat(null), undefined, { draftPhase: "ended" }), draftEnded: true });
    expect(getByTestId("team-coach-draft-ended")).toBeDefined();
    expect(queryByTestId("live-light-pick-seat")).toBeNull();
    expect(columnIds(container)).toEqual([]);
  });

  test("draft terminado con tablero: referencia, sin ELIGE AHORA ni decisión del equipo", () => {
    const { container, getByTestId } = view({ board: boardOf(1), captureStatus: capture(seat(1, true), undefined, { draftPhase: "ended" }), draftEnded: true });
    expect(getByTestId("team-coach-draft-ended")).toBeDefined();
    expect(container.textContent).not.toContain("ELIGE AHORA");
    expect(columnIds(container)).toEqual(["team-coach-column-1"]);
  });
});
