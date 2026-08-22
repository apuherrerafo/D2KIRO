import type { RawHeroStatsRow } from "./validation";
import { isValidRawHeroStatsRow } from "./validation";

// Static JSON import — bundled at build time. resolveJsonModule must be enabled in tsconfig.
// If the file is missing or malformed at build time, the import fails here and getValidatedSeed
// returns [] via the try/catch in the module initialiser block below.
import seedRaw from "./seed-hero-stats.json";

// Module-level cache — populated lazily on the first call to getValidatedSeed().
let validatedSeed: RawHeroStatsRow[] | null = null;

export function getValidatedSeed(): RawHeroStatsRow[] {
  if (validatedSeed !== null) return validatedSeed;

  let rows: RawHeroStatsRow[];
  try {
    rows = Array.isArray(seedRaw) ? (seedRaw as unknown[]).filter(isValidRawHeroStatsRow) : [];
  } catch (err) {
    console.error(
      "[meta/seed] Unexpected error processing seed-hero-stats.json — patchStats fallback disabled",
      err,
    );
    validatedSeed = [];
    return validatedSeed;
  }

  if (rows.length === 0) {
    console.warn(
      "[meta/seed] Seed file failed validation or is empty — patchStats fallback disabled",
    );
  }

  validatedSeed = rows;
  return validatedSeed;
}

/**
 * Test seam — resets (or pre-populates) the module-level cache.
 * Pass `null` to force re-initialisation from the JSON file on the next call to getValidatedSeed.
 */
export function setValidatedSeed(rows: RawHeroStatsRow[] | null): void {
  validatedSeed = rows;
}
