// How much life the Player's Dota link has left. Frontend defense only: the engine decides what is valid.

export type LinkLifetime = "healthy" | "expiring" | "expired";

export const LINK_EXPIRING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** `expired` once expiresAt <= now (or unreadable: never presented as healthy); `expiring` within 7 days. */
export function linkLifetime(expiresAt: string, nowMs: number): LinkLifetime {
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return "expired";
  const remaining = expiry - nowMs;
  if (remaining <= 0) return "expired";
  if (remaining <= LINK_EXPIRING_WINDOW_MS) return "expiring";
  return "healthy";
}
