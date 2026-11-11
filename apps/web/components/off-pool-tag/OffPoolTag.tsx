// P0-03D -- the ONE "OFF-POOL" tag shared by the Simulator panel (V4 cards) and the Team Coach board (Simulator + Live).
//
// A hero is OFF-POOL exactly when the engine says `OUTSIDE_POOL`: a pool is configured for that position and the hero is not in it.
// `NO_POOL` (nobody configured a pool) and `IN_POOL` show nothing here -- an unconfigured pool is never reported as "outside".
// It is INFORMATION, not a reason: the hero is recommended (or not) by its strategic ground; this only says it is not one of the pool's heroes.
// Color by semantic role and 4 px scale only.

export type OffPoolMembership = "IN_POOL" | "OUTSIDE_POOL" | "NO_POOL";

const OFF_POOL_TAG = "rounded-md border border-surface-border px-2 py-1 text-caption text-content-secondary";
const DEFAULT_TITLE = "Fuera del pool configurado para esta posición. Es solo información: el motivo de la recomendación es su fundamento, no el pool.";

export interface OffPoolTagProps {
  membership: OffPoolMembership | undefined;
  /** Whose pool it is ("Fuera de tu pool" / "Fuera del pool del compañero"); omitted = the generic explanation. */
  title?: string;
  testId?: string;
}

export function OffPoolTag({ membership, title, testId = "off-pool-tag" }: OffPoolTagProps) {
  if (membership !== "OUTSIDE_POOL") return null;
  return (
    <span className={OFF_POOL_TAG} data-testid={testId} title={title ?? DEFAULT_TITLE}>
      OFF-POOL
    </span>
  );
}
