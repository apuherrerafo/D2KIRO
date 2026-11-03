const STEAM32_MAX = 4_294_967_295;
const STEAM32_PATTERN = /^[1-9][0-9]*$/;

export interface BetaAllowlist {
  configured: boolean;
  validIds: ReadonlySet<number>;
  malformed: boolean;
}

export function parseBetaAllowedSteamIds(value: string | undefined): BetaAllowlist {
  const entries = value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
  if (entries.length === 0) return { configured: false, validIds: new Set(), malformed: false };
  const validIds = new Set<number>();
  let malformed = false;
  for (const entry of entries) {
    if (!STEAM32_PATTERN.test(entry)) { malformed = true; continue; }
    const id = Number(entry);
    if (!Number.isSafeInteger(id) || id > STEAM32_MAX) { malformed = true; continue; }
    validIds.add(id);
  }
  return { configured: true, validIds, malformed };
}

// A malformed configured list fails closed, so an operator error never admits an unlisted user.
export function isSteamIdAllowed(accountId: number, value: string | undefined): boolean {
  const allowlist = parseBetaAllowedSteamIds(value);
  return allowlist.configured && !allowlist.malformed && allowlist.validIds.has(accountId);
}
