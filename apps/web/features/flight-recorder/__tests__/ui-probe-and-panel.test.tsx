import "@/test-support/happy-dom";

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CurrentDecisionOutput } from "@/features/random-draft-simulator/coach-client";
import { CurrentDecisionPanel } from "@/features/random-draft-simulator/components/CurrentDecisionPanel";
import { TeamCoachBoard } from "@/features/team-coach/components/TeamCoachBoard";
import type { TeamCoachBoardData, TeamCoachColumn, TeamPosition } from "@/features/team-coach/types";
import { FlightRecorderPanel } from "../components/FlightRecorderPanel";
import { flightRecorder } from "../recorder";
import { readRenderedBoard, readRenderedDecision, readRenderedUi } from "../ui-probe";

afterEach(() => {
  cleanup();
  flightRecorder.disarm();
});

function column(position: TeamPosition, heroIds: number[], stateIdentity: string, overrides: Partial<TeamCoachColumn> = {}): TeamCoachColumn {
  return {
    position,
    eligibleNow: true,
    alreadyFilled: false,
    filledHeroId: null,
    state: "RANKED",
    primaryHeroId: heroIds[0] ?? null,
    top: heroIds.map((heroId, index) => ({ heroId, rank: index + 1, score: 40 - index, reasons: ["r"], isPrimary: index === 0 })),
    stateIdentity,
    note: null,
    ...overrides,
  };
}

function board(stateIdentity: string, tops: Partial<Record<TeamPosition, number[]>>): TeamCoachBoardData {
  return {
    schema: "team-coach-board/v1",
    sessionId: "s",
    stateIdentity,
    currentDecision: { recommendedPosition: 2, recommendedHeroId: 21, targetBasis: "DETERMINISTIC_DEFAULT", reason: "r", actionablePositions: [1, 2, 3, 4, 5], roundCapacity: 2 },
    positions: ([1, 2, 3, 4, 5] as TeamPosition[]).map((position) => column(position, tops[position] ?? [position * 10 + 1, position * 10 + 2, position * 10 + 3], stateIdentity)),
    unboundOwnHeroIds: [],
  };
}

function renderBoard(data: TeamCoachBoardData | null) {
  return render(<TeamCoachBoard board={data} status="ready" heroCatalog={new Map()} selectedPosition={null} onSelectPosition={() => {}} />);
}

describe("ui-probe -- lee lo que la pantalla muestra de verdad", () => {
  test("el tablero real: stateIdentity, posición recomendada y los héroes con su rank por columna", () => {
    const view = renderBoard(board("state-7", { 1: [101, 102, 103, 104, 105] }));
    const ui = readRenderedBoard(view.container)!;
    expect(ui.stateIdentity).toBe("state-7");
    expect(ui.status).toBe("ready");
    expect(ui.recommendedPosition).toBe(2);
    const one = ui.positions.find((entry) => entry.position === 1)!;
    expect(one.heroIds).toEqual([101, 102, 103, 104, 105]);
    expect(one.ranks).toEqual([1, 2, 3, 4, 5]);
    expect(ui.positions.map((entry) => entry.position)).toEqual([1, 2, 3, 4, 5]);
  });

  test("una columna FILLED no muestra candidatos; sin tablero (placeholder) el sondeo devuelve null", () => {
    const filled = board("s", {});
    filled.positions[2] = column(3, [], "s", { state: "FILLED", filledHeroId: 33, alreadyFilled: true, eligibleNow: false, top: [] });
    const view = renderBoard(filled);
    expect(readRenderedBoard(view.container)!.positions.find((entry) => entry.position === 3)).toMatchObject({ state: "FILLED", heroIds: [] });
    cleanup();
    const empty = renderBoard(null);
    expect(readRenderedBoard(empty.container)!.positions).toEqual([]); // placeholder: the board shell exists, no columns
    expect(readRenderedBoard(document.createElement("div"))).toBeNull();
  });

  test("la decisión V4 real: revisión, stateIdentity, posición vista y las cartas con su rank", () => {
    const output: CurrentDecisionOutput = {
      schema: "recommendation-output/v4",
      sessionId: "s",
      decision: {
        kind: "ACTIONABLE",
        actionablePositions: [1, 2, 3],
        roundCapacity: 2,
        targetPosition: 2,
        targetBasis: "STRATEGIC",
        targetRationale: "porque sí",
        viewedPosition: 3,
        candidates: {
          state: "RANKED",
          targetPosition: 3,
          cards: [
            { heroId: 11, position: 3, rank: 1, score: 30, confidence: "alta", roleStatus: "LIKELY", badges: [], rationale: "a", isFromPool: false, poolMembership: "NO_POOL", basis: { kind: "curated", sources: [{ kind: "curated", sampleSize: null }] }, risks: [] },
            { heroId: 12, position: 3, rank: 2, score: 20, confidence: "media", roleStatus: "LIKELY", badges: [], rationale: "b", isFromPool: false, poolMembership: "NO_POOL", basis: { kind: "curated", sources: [{ kind: "curated", sampleSize: null }] }, risks: [] },
          ],
          degradations: [],
        },
        personalPoolApplied: false,
        poolState: "NONE",
        poolOwner: null,
      },
      roleBeliefs: { own: [], enemy: [] },
      meta: { round: 1, phase: "PICK_ROUND_1", decisionContext: "team_opening", trigger: "OWN_PICK_CONFIRMED", revision: 4, basedOn: { stateIdentity: "state-9", evidenceVersion: "v" } },
    };
    const view = render(<CurrentDecisionPanel output={output} heroCatalog={new Map()} />);
    expect(readRenderedDecision(view.container)).toEqual({
      kind: "ACTIONABLE",
      revision: 4,
      stateIdentity: "state-9",
      targetPosition: 2,
      viewedPosition: 3,
      candidateState: "RANKED",
      heroIds: [11, 12],
      ranks: [1, 2],
    });
  });

  test("readRenderedUi junta tablero y decisión; sin nada en pantalla ambos son null", () => {
    expect(readRenderedUi(document.createElement("div"))).toEqual({ board: null, decision: null });
  });
});

describe("FlightRecorderPanel -- doble interruptor, grabación de lo mostrado y exportación", () => {
  beforeEach(() => {
    flightRecorder.disarm();
  });

  test("producción (sin flag de build): no renderiza nada y la grabadora NO se arma, aunque la URL lo pida", () => {
    const view = render(<FlightRecorderPanel built={false} search="?flightRecorder=1" />);
    expect(view.queryByTestId("flight-recorder-panel")).toBeNull();
    expect(flightRecorder.isArmed()).toBe(false);
  });

  test("con flag de build pero sin ?flightRecorder=1 tampoco se arma ni se muestra", () => {
    const view = render(<FlightRecorderPanel built={true} search="" />);
    expect(view.queryByTestId("flight-recorder-panel")).toBeNull();
    expect(flightRecorder.isArmed()).toBe(false);
  });

  test("flag de build + URL: se arma y se muestra; al desmontar se desarma", () => {
    const view = render(<FlightRecorderPanel built={true} search="?flightRecorder=1" />);
    expect(view.getByTestId("flight-recorder-panel")).toBeTruthy();
    expect(flightRecorder.isArmed()).toBe(true);
    view.unmount();
    expect(flightRecorder.isArmed()).toBe(false);
  });

  test("graba un ui_render cuando lo mostrado CAMBIA (y sólo entonces) y lo exporta como JSON descargable", async () => {
    const downloads: { filename: string; contents: string }[] = [];
    const download = (filename: string, contents: string) => downloads.push({ filename, contents });
    const view = render(
      <div>
        <FlightRecorderPanel built={true} search="?flightRecorder=1" download={download} />
        <div data-testid="slot" />
      </div>,
    );
    const slot = view.getByTestId("slot");
    const shown = render(<TeamCoachBoard board={board("state-1", { 1: [11, 12, 13] })} status="ready" heroCatalog={new Map()} selectedPosition={null} onSelectPosition={() => {}} />, { container: slot });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    shown.rerender(<TeamCoachBoard board={board("state-2", { 1: [12, 11, 14] })} status="ready" heroCatalog={new Map()} selectedPosition={null} onSelectPosition={() => {}} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    const renders = flightRecorder.entries().filter((entry) => entry.kind === "ui_render");
    expect(renders.length).toBe(2);
    expect((renders[0]!.data.board as { stateIdentity: string }).stateIdentity).toBe("state-1");
    expect((renders[1]!.data.board as { stateIdentity: string }).stateIdentity).toBe("state-2");

    fireEvent.click(view.getByTestId("flight-recorder-export"));
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.filename).toMatch(/^d2kiro-flight-.*\.json$/);
    const exported = JSON.parse(downloads[0]!.contents) as { schema: string; entries: { kind: string }[]; build: { flagEnabled: boolean } };
    expect(exported.schema).toBe("d2kiro-flight-recorder/v1");
    expect(exported.build.flagEnabled).toBe(true);
    expect(exported.entries.filter((entry) => entry.kind === "ui_render")).toHaveLength(2);
    expect(downloads[0]!.contents).not.toMatch(/token|cookie/i);
  });

  test("Vaciar deja el buffer en cero", async () => {
    const view = render(<FlightRecorderPanel built={true} search="?flightRecorder=1" />);
    act(() => {
      flightRecorder.record("transition", { source: "x" });
    });
    expect(view.getByTestId("flight-recorder-count").textContent).toContain("1 eventos");
    fireEvent.click(view.getByTestId("flight-recorder-clear"));
    expect(flightRecorder.count()).toBe(0);
  });
});
