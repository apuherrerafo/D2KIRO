// Pulido visual requerido por /design-forge (hover/pressed/focus/disabled) — nunca solo hover.
const INTERACTIVE_BASE =
  "transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

export const BUTTON_PRIMARY = `rounded-md bg-accent-primary px-4 py-2 text-caption text-surface-base hover:bg-accent-primary-hover active:bg-accent-primary-hover ${INTERACTIVE_BASE}`;

export const BUTTON_SECONDARY = `rounded-md border border-surface-border px-4 py-2 text-caption text-content-secondary hover:border-accent-primary hover:text-content-primary ${INTERACTIVE_BASE}`;

export const BUTTON_GHOST = `self-start text-caption text-accent-primary hover:text-accent-primary-hover ${INTERACTIVE_BASE}`;

export const LOCAL_SIDE_LABEL = "text-accent-primary";
