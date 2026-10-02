// Pulido visual (hover/pressed/focus/disabled) con tokens semánticos y escala de 4 px -- ni un hex ni un px suelto.
const INTERACTIVE =
  "transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

export const BOARD_SHELL = "flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4";
export const BOARD_GRID = "grid grid-cols-1 gap-3 md:grid-cols-5";
export const COLUMN_BASE = "flex min-w-0 flex-col gap-2 rounded-lg border bg-surface-base p-3";
export const COLUMN_RECOMMENDED = `${COLUMN_BASE} border-accent-primary`;
export const COLUMN_SELECTED = `${COLUMN_BASE} border-content-secondary`;
export const COLUMN_DEFAULT = `${COLUMN_BASE} border-surface-border`;
export const COLUMN_HEADER = `flex flex-col items-start gap-1 rounded-md px-2 py-1 text-left hover:bg-surface-overlay ${INTERACTIVE}`;
export const PICK_NOW_BADGE = "inline-flex items-center rounded-full bg-accent-primary px-2 py-0.5 text-caption font-semibold text-surface-base";
export const CANDIDATE_BUTTON = `flex w-full items-center gap-2 rounded-md border border-surface-border px-2 py-1 text-left text-caption text-content-secondary hover:border-accent-primary hover:text-content-primary ${INTERACTIVE}`;
export const CANDIDATE_ROW = "flex w-full items-center gap-2 rounded-md border border-surface-border px-2 py-1 text-left text-caption text-content-secondary";
export const PLAN_BADGE = "ml-auto rounded-full border border-accent-primary px-2 text-caption text-accent-primary";
export const DECISION_BANNER = "flex flex-col gap-1 rounded-lg border border-accent-primary bg-surface-overlay p-3";
export const STATUS_PILL_OK = "inline-flex items-center gap-1 text-caption text-signal-positive";
export const STATUS_PILL_WARN = "inline-flex items-center gap-1 text-caption text-signal-warning";
export const STATUS_PILL_BAD = "inline-flex items-center gap-1 text-caption text-signal-negative";
export const STATUS_PILL_MUTED = "inline-flex items-center gap-1 text-caption text-content-muted";
export const CHIP = `rounded-md border border-surface-border px-2 py-1 text-caption text-content-secondary hover:border-accent-primary ${INTERACTIVE}`;
export const CHIP_ACTIVE = `rounded-md border border-accent-primary bg-accent-primary px-2 py-1 text-caption text-surface-base ${INTERACTIVE}`;
// TSK-219 -- conectar Dota.
export const PANEL = "flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4";
export const PRIMARY_BUTTON = `inline-flex items-center justify-center self-start rounded-md bg-accent-primary px-4 py-2 text-body font-semibold text-surface-base hover:opacity-90 ${INTERACTIVE}`;
export const SECONDARY_BUTTON = `inline-flex items-center justify-center self-start rounded-md border border-surface-border px-3 py-1 text-caption text-content-secondary hover:border-accent-primary hover:text-content-primary ${INTERACTIVE}`;
export const CODE_BOX = "min-w-0 flex-1 select-all break-all rounded-md border border-surface-border bg-surface-base px-2 py-1 font-mono text-caption text-content-primary";
export const STEP_NUMBER = "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent-primary text-caption text-accent-primary";
