// Certification remediation (Phase A, A2) -- STRATZ hero catalog and observation coverage evaluator.
//
// Explicitly audits:
//   - Chen 66
//   - Ringmaster 131
//   - Kez 145
//   - Largo 155
//
// For each:
//   - exists in catalog?
//   - appears in selected positional observations?
//   - observed counts by position if present
//
// Absence from a 7-day empirical window is allowed. Inventing counts is not.
// Zero network, pure logic.

export type Position = 1 | 2 | 3 | 4 | 5;

export interface SpotlightHero {
  id: number;
  canonicalName: string;
}

export const SPOTLIGHT_HEROES: readonly SpotlightHero[] = [
  { id: 66, canonicalName: "Chen" },
  { id: 131, canonicalName: "Ringmaster" },
  { id: 145, canonicalName: "Kez" },
  { id: 155, canonicalName: "Largo" },
];

export interface HeroCoverageReport {
  heroId: number;
  canonicalName: string;
  existsInCatalog: boolean;
  observedInWindow: boolean;
  totalMatches: number;
  countsByPosition: Partial<Record<Position, number>>;
}

export interface CatalogItem {
  id: number;
  displayName?: string;
  localizedName?: string;
}

/**
 * Evaluates coverage of the spotlight heroes against the catalog and the aggregated observations.
 * @param catalog Catalog heroes (from STRATZ constants.heroes or SQLite DB).
 * @param observationsByHero Map from heroId to (position -> matchCount).
 */
export function evaluateCoverage(
  catalog: readonly CatalogItem[],
  observationsByHero: ReadonlyMap<number, ReadonlyMap<Position, number>>,
): HeroCoverageReport[] {
  const catalogIds = new Set(catalog.map((h) => h.id));

  return SPOTLIGHT_HEROES.map((spotlight) => {
    const existsInCatalog = catalogIds.has(spotlight.id);
    const heroObs = observationsByHero.get(spotlight.id);

    const countsByPosition: Partial<Record<Position, number>> = {};
    let totalMatches = 0;

    if (heroObs) {
      for (const [pos, matches] of heroObs.entries()) {
        if (matches > 0) {
          countsByPosition[pos] = matches;
          totalMatches += matches;
        }
      }
    }

    return {
      heroId: spotlight.id,
      canonicalName: spotlight.canonicalName,
      existsInCatalog,
      observedInWindow: totalMatches > 0,
      totalMatches,
      countsByPosition,
    };
  });
}

/**
 * Formats the coverage report for console printing or diagnostics reporting.
 */
export function formatCoverageReport(reports: readonly HeroCoverageReport[]): string {
  const lines: string[] = ["--- STRATZ Spotlight Hero Coverage ---"];
  for (const r of reports) {
    const catalogMark = r.existsInCatalog ? "YES" : "NO";
    const windowMark = r.observedInWindow ? `YES (${r.totalMatches} matches)` : "NO (0 matches in window)";
    const posBreakdown = Object.entries(r.countsByPosition)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([pos, matches]) => `Pos${pos}: ${matches}`)
      .join(", ") || "none";

    lines.push(
      `Hero ${r.heroId} (${r.canonicalName}): in_catalog=${catalogMark} | in_window=${windowMark} | positions=[${posBreakdown}]`,
    );
  }
  return lines.join("\n");
}
