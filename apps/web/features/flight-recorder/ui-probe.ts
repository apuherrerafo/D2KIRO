// Lee del DOM lo que la pantalla MUESTRA de verdad (no lo que el store cree que muestra): el tablero del Team Coach
// y la decisión V4. Sólo lee atributos `data-*` que los componentes ya publican -- ningún componente cambia.

export interface UiColumn {
  position: number;
  state: string;
  eligible: boolean;
  heroIds: number[];
  ranks: number[];
}

export interface UiBoard {
  stateIdentity: string | null;
  status: string | null;
  recommendedPosition: number | null;
  positions: UiColumn[];
}

export interface UiDecision {
  kind: string | null;
  revision: number | null;
  stateIdentity: string | null;
  targetPosition: number | null;
  viewedPosition: number | null;
  candidateState: string | null;
  heroIds: number[];
  ranks: number[];
}

export interface UiSnapshot {
  board: UiBoard | null;
  decision: UiDecision | null;
}

const COLUMN_PREFIX = "team-coach-column-";

function toInt(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function ints(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null);
}

function readColumn(section: Element): UiColumn | null {
  const position = toInt((section.getAttribute("data-testid") ?? "").slice(COLUMN_PREFIX.length));
  if (position === null) return null;
  const candidates = [...section.querySelectorAll('[data-testid="team-coach-candidate"]')];
  return {
    position,
    state: section.getAttribute("data-state") ?? "",
    eligible: section.getAttribute("data-eligible") === "true",
    heroIds: ints(candidates.map((candidate) => toInt(candidate.getAttribute("data-hero-id")))),
    // The rank is the first "N." label of the row, the same number the Player reads.
    ranks: ints(candidates.map((candidate) => toInt(candidate.querySelector("span")?.textContent ?? null))),
  };
}

export function readRenderedBoard(root: ParentNode): UiBoard | null {
  const board = root.querySelector('[data-testid="team-coach-board"]');
  if (!board) return null;
  const columns = [...board.querySelectorAll(`[data-testid^="${COLUMN_PREFIX}"]`)].flatMap((section) => {
    const column = readColumn(section);
    return column ? [column] : [];
  });
  return {
    stateIdentity: board.getAttribute("data-state-identity") || null,
    status: board.getAttribute("data-status"),
    recommendedPosition: toInt(board.querySelector('[data-testid="team-coach-decision"]')?.getAttribute("data-recommended-position") ?? null),
    positions: columns,
  };
}

export function readRenderedDecision(root: ParentNode): UiDecision | null {
  const panel = root.querySelector('[data-testid="current-decision-panel"]');
  if (!panel) return null;
  const section = panel.querySelector('[data-testid="current-decision-candidates"]');
  const rows = section ? [...section.querySelectorAll('[data-testid="current-decision-card"], [data-testid="current-decision-alternative"]')] : [];
  return {
    kind: panel.getAttribute("data-decision-kind"),
    revision: toInt(panel.getAttribute("data-revision")),
    stateIdentity: panel.getAttribute("data-state-identity"),
    targetPosition: toInt(panel.querySelector('[data-testid="current-decision-target"]')?.getAttribute("data-target-position") ?? null),
    viewedPosition: toInt(panel.querySelector('[data-testid="current-decision-viewed"]')?.getAttribute("data-viewed-position") ?? null),
    candidateState: section?.getAttribute("data-candidate-state") ?? null,
    heroIds: ints(rows.map((row) => toInt(row.getAttribute("data-hero-id")))),
    ranks: ints(rows.map((row) => toInt(row.getAttribute("data-rank")))),
  };
}

export function readRenderedUi(root: ParentNode): UiSnapshot {
  return { board: readRenderedBoard(root), decision: readRenderedDecision(root) };
}

/** Firma estable: sólo se graba un `ui_render` cuando lo que se ve CAMBIÓ. */
export function uiSignature(snapshot: UiSnapshot): string {
  return JSON.stringify(snapshot);
}
