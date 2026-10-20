import type { FlightAnalysis, FlightEntry, PositionVariation, Top5Variant, UiVsEngineMismatch } from "./types";

// Cálculo puro sobre las entradas ya grabadas -- contesta "¿el Top 5 cambió alguna vez?" y "¿la UI mostró lo que
// devolvió el motor?" sin volver a tocar nada vivo. Lee con guardas: una entrada rara se ignora, nunca lanza.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function heroIdsOf(candidates: unknown): number[] {
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((candidate) => (isRecord(candidate) && typeof candidate.heroId === "number" ? [candidate.heroId] : []));
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

interface BoardColumn {
  position: number;
  state: string;
  heroIds: number[];
}

function boardColumns(board: unknown, key: "top" | "heroIds"): BoardColumn[] {
  if (!isRecord(board) || !Array.isArray(board.positions)) return [];
  return board.positions.flatMap((column) => {
    if (!isRecord(column) || typeof column.position !== "number") return [];
    const heroIds = key === "top" ? heroIdsOf(column.top) : Array.isArray(column.heroIds) ? column.heroIds.filter((id): id is number => typeof id === "number") : [];
    return [{ position: column.position, state: typeof column.state === "string" ? column.state : "", heroIds }];
  });
}

function stateIdentityOf(board: unknown): string | null {
  return isRecord(board) && typeof board.stateIdentity === "string" ? board.stateIdentity : null;
}

function dispositionOf(entry: FlightEntry): string {
  return typeof entry.data.disposition === "string" ? entry.data.disposition : "";
}

function variationFor(position: number, accepted: readonly FlightEntry[]): PositionVariation {
  const variants: Top5Variant[] = [];
  let boardsSeen = 0;
  for (const entry of accepted) {
    const column = boardColumns(entry.data.board, "top").find((candidate) => candidate.position === position);
    if (!column || column.heroIds.length === 0) continue;
    boardsSeen += 1;
    const known = variants.find((variant) => sameIds(variant.heroIds, column.heroIds));
    if (known) {
      known.occurrences += 1;
      continue;
    }
    variants.push({ heroIds: column.heroIds, firstSeenSeq: entry.seq, firstSeenStateIdentity: stateIdentityOf(entry.data.board) ?? "", occurrences: 1 });
  }
  return { position, boardsSeen, distinctTop5: variants };
}

function lastAcceptedBefore(boards: readonly FlightEntry[], seq: number): FlightEntry | undefined {
  return [...boards].reverse().find((entry) => entry.seq < seq);
}

function mismatchesFor(ui: FlightEntry, engine: FlightEntry): UiVsEngineMismatch[] {
  const uiBoard = ui.data.board;
  if (!isRecord(uiBoard)) return []; // the screen showed no board (placeholder): nothing to compare.
  const uiState = stateIdentityOf(uiBoard);
  const engineState = stateIdentityOf(engine.data.board);
  const engineColumns = boardColumns(engine.data.board, "top");
  const found: UiVsEngineMismatch[] = [];
  if (uiState !== engineState) found.push({ uiSeq: ui.seq, engineSeq: engine.seq, position: 0, uiHeroIds: [], engineHeroIds: [], uiStateIdentity: uiState, engineStateIdentity: engineState });
  for (const column of boardColumns(uiBoard, "heroIds")) {
    const engineColumn = engineColumns.find((candidate) => candidate.position === column.position);
    if (!engineColumn || column.state === "FILLED") continue;
    if (sameIds(column.heroIds, engineColumn.heroIds)) continue;
    found.push({ uiSeq: ui.seq, engineSeq: engine.seq, position: column.position, uiHeroIds: column.heroIds, engineHeroIds: engineColumn.heroIds, uiStateIdentity: uiState, engineStateIdentity: engineState });
  }
  return found;
}

function distinctStateIdentities(entries: readonly FlightEntry[], field: "board" | "decision"): number {
  const identities = new Set<string>();
  for (const entry of entries) {
    const value = field === "board" ? stateIdentityOf(entry.data.board) : isRecord(entry.data.decision) && typeof entry.data.decision.stateIdentity === "string" ? entry.data.decision.stateIdentity : null;
    if (value !== null) identities.add(value);
  }
  return identities.size;
}

export function buildAnalysis(entries: readonly FlightEntry[]): FlightAnalysis {
  const boards = entries.filter((entry) => entry.kind === "engine_team_board");
  const decisions = entries.filter((entry) => entry.kind === "engine_current_decision");
  const acceptedBoards = boards.filter((entry) => dispositionOf(entry) === "accepted");
  const acceptedDecisions = decisions.filter((entry) => dispositionOf(entry) === "accepted");
  const uiRenders = entries.filter((entry) => entry.kind === "ui_render");
  const mismatches = uiRenders.flatMap((ui) => {
    const engine = lastAcceptedBefore(acceptedBoards, ui.seq);
    return engine ? mismatchesFor(ui, engine) : [];
  });
  return {
    acceptedBoards: acceptedBoards.length,
    discardedBoards: boards.length - acceptedBoards.length,
    distinctBoardStateIdentities: distinctStateIdentities(acceptedBoards, "board"),
    acceptedDecisions: acceptedDecisions.length,
    discardedDecisions: decisions.length - acceptedDecisions.length,
    distinctDecisionStateIdentities: distinctStateIdentities(acceptedDecisions, "decision"),
    perPosition: [1, 2, 3, 4, 5].map((position) => variationFor(position, acceptedBoards)),
    uiVsEngineMismatches: mismatches,
  };
}
