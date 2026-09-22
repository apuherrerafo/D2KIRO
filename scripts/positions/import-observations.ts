#!/usr/bin/env bun
// Certification remediation (Phase A, A2) -- DETERMINISTIC import of raw position observations.
//
// Supports two offline sources:
//   1. D2PT manual page dumps:
//      bun scripts/positions/import-observations.ts --pages=<dir with pos-1.json..pos-5.json> --snapshot=<frozen.sqlite> \
//          --out=apps/engine/src/signals/hero-positions.json [--matches-column=<n>] [--replace-legacy]
//
//   2. STRATZ GraphQL offline snapshot:
//      bun scripts/positions/import-observations.ts --stratz=<path/to/snapshot.json> --snapshot=<frozen.sqlite> \
//          --out=apps/engine/src/signals/hero-positions.json [--replace-legacy] [--closed-buckets=<id1,id2,...>]
//
// Output : `hero-position-observations/v1` -- EVERY observed (hero, position, matches) row is retained, INCLUDING those below
//          the admission floor (matchCount 1..19 included). Nothing is filtered here: the floor is applied later, by the engine
//          loader, AFTER the denominator is built (apps/engine/src/signals/hero-positions.ts).
//          Same input bytes -> same output bytes (no clock, no randomness).
// Never imported from apps/ (Fase 9 rule). Zero network.
import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { HERO_POSITION_OBSERVATIONS_SCHEMA, MIN_POSITION_MATCHES } from "../../apps/engine/src/signals/hero-positions";
import { evaluateCoverage, formatCoverageReport, type HeroCoverageReport } from "./coverage";
import {
  extractClosedBucketIds,
  STRATZ_SNAPSHOT_SCHEMA,
  type StratzPositionSnapshot,
  type StratzResponseData,
} from "./fetch-stratz";

export const PAGE_SCHEMA = "d2pt-position-page/v1";
export { STRATZ_SNAPSHOT_SCHEMA };
export type Position = 1 | 2 | 3 | 4 | 5;

export interface PageRow {
  name: string;
  cells: string[];
}

export interface PositionPage {
  schema: typeof PAGE_SCHEMA;
  position: Position;
  url: string;
  /** ISO-8601 instant the page was read (recorded by the scraper, never by this importer). */
  retrievedAt: string;
  /** Header cell labels of the table, when the scraper could read them. */
  tableHeader: string[] | null;
  rows: PageRow[];
}

export interface CatalogHero {
  id: number;
  localizedName: string;
}

export interface ImportReport {
  matchesColumn: number;
  unmatchedNames: { position: Position; name: string }[];
  unparseableRows: { position: Position; name: string; cell: string }[];
  duplicateRows: { position: Position; name: string }[];
  /** Catalog heroes with NO observation on any page: their position evidence is UNAVAILABLE (never invented). */
  unobservedHeroes: { id: number; localizedName: string }[];
  /** Heroes observed, but with no position at/above the admission floor: also unavailable to the engine (raw: null). */
  heroesBelowFloorEverywhere: { id: number; localizedName: string }[];
  observationRows: number;
  belowFloorRows: number;
}

export interface StratzImportReport {
  selectedBuckets: number[];
  unmatchedHeroes: { position: Position; day: number; heroId: number }[];
  unparseableRows: { position: Position; day: number; heroId: unknown; reason: string }[];
  duplicateRows: { position: Position; day: number; heroId: number }[];
  unobservedHeroes: { id: number; localizedName: string }[];
  heroesBelowFloorEverywhere: { id: number; localizedName: string }[];
  observationRows: number;
  belowFloorRows: number;
  lowCountRows: number;
}

export const normalizeName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");

const COUNT = /^\d{1,3}(,\d{3})*$|^\d+$/;

export function locateMatchesColumn(pages: readonly PositionPage[], explicit: number | undefined): number {
  if (explicit !== undefined) return explicit;
  const found = new Set<number>();
  for (const page of pages) {
    const index = page.tableHeader?.findIndex((label) => /^\s*(matches|games)\s*$/i.test(label)) ?? -1;
    if (index >= 0) found.add(index);
  }
  if (found.size !== 1) {
    throw new Error("cannot determine the Matches column from the page headers -- pass --matches-column=<n> after checking a page by eye");
  }
  return [...found][0]!;
}

export function buildObservations(pages: readonly PositionPage[], catalog: readonly CatalogHero[], matchesColumn: number) {
  const byName = new Map(catalog.map((hero) => [normalizeName(hero.localizedName), hero]));
  const counts = new Map<number, Map<Position, number>>();
  const report: ImportReport = {
    matchesColumn,
    unmatchedNames: [],
    unparseableRows: [],
    duplicateRows: [],
    unobservedHeroes: [],
    heroesBelowFloorEverywhere: [],
    observationRows: 0,
    belowFloorRows: 0,
  };

  for (const page of [...pages].sort((a, b) => a.position - b.position)) {
    for (const row of page.rows) {
      const hero = byName.get(normalizeName(row.name));
      if (!hero) {
        report.unmatchedNames.push({ position: page.position, name: row.name });
        continue;
      }
      const cell = (row.cells[matchesColumn] ?? "").trim();
      if (!COUNT.test(cell)) {
        report.unparseableRows.push({ position: page.position, name: row.name, cell });
        continue;
      }
      const perHero = counts.get(hero.id) ?? new Map<Position, number>();
      if (perHero.has(page.position)) {
        report.duplicateRows.push({ position: page.position, name: row.name });
        continue;
      }
      perHero.set(page.position, Number(cell.replaceAll(",", "")));
      counts.set(hero.id, perHero);
    }
  }

  const heroes = [...counts.keys()].sort((a, b) => a - b).map((id) => {
    const observations = [...counts.get(id)!.entries()].sort((a, b) => a[0] - b[0]).map(([position, matches]) => ({ position, matches }));
    report.observationRows += observations.length;
    report.belowFloorRows += observations.filter((o) => o.matches < MIN_POSITION_MATCHES).length;
    return { hero: id, observations };
  });

  for (const hero of [...catalog].sort((a, b) => a.id - b.id)) {
    const perHero = counts.get(hero.id);
    if (!perHero) report.unobservedHeroes.push({ id: hero.id, localizedName: hero.localizedName });
    else if (![...perHero.values()].some((matches) => matches >= MIN_POSITION_MATCHES)) {
      report.heroesBelowFloorEverywhere.push({ id: hero.id, localizedName: hero.localizedName });
    }
  }

  const retrieved = pages.map((page) => page.retrievedAt).sort();
  const file = {
    schema: HERO_POSITION_OBSERVATIONS_SCHEMA,
    provenance: {
      source: "dota2protracker.com/meta?position=pos+N (third-party site, manual headless-browser scrape)",
      bracketClaim: "7000+ MMR as selected on the site; NOT independently verified",
      patchClaim: { label: null, verified: false, note: "the site does not state a patch in the scraped table; no patch is asserted" },
      retrievedAt: { from: retrieved[0] ?? null, to: retrieved[retrieved.length - 1] ?? null },
      completeness: "all rows the source listed per position are retained, sub-floor rows included; a hero the source did not list on a position has no row there",
      admissionFloorMatches: MIN_POSITION_MATCHES,
      admissionFloorNote: "informational -- NOT applied to this file; the engine loader applies it after building the denominator",
      pages: [...pages]
        .sort((a, b) => a.position - b.position)
        .map((page) => ({
          position: page.position,
          url: page.url,
          retrievedAt: page.retrievedAt,
          rowCount: page.rows.length,
          sha256: createHash("sha256").update(JSON.stringify(page)).digest("hex"),
        })),
      generator: "scripts/positions/import-observations.ts@1",
    },
    heroes,
  };
  return { file, report };
}

/**
 * Deterministically imports STRATZ position observations from a snapshot.
 *
 * Requirements:
 *   - aliases p1-p5 map to positions 1-5
 *   - maps using heroId directly
 *   - aggregates repeated hero rows across selected closed daily buckets
 *   - validates integer heroId, matchCount, winCount
 *   - enforces 0 <= winCount <= matchCount
 *   - rejects duplicate (position, day, heroId)
 *   - rejects unknown hero IDs
 *   - retains EVERY positive returned observation (including 1..19)
 *   - never invents counts for unobserved positions
 */
export function buildObservationsFromStratz(
  snapshot: StratzPositionSnapshot,
  catalog: readonly CatalogHero[],
  options?: { selectedBucketIds?: readonly number[] },
): {
  file: {
    schema: typeof HERO_POSITION_OBSERVATIONS_SCHEMA;
    provenance: Record<string, unknown>;
    heroes: Array<{ hero: number; observations: Array<{ position: Position; matches: number }> }>;
  };
  report: StratzImportReport;
  coverage: HeroCoverageReport[];
} {
  if (snapshot.schema !== STRATZ_SNAPSHOT_SCHEMA) {
    throw new Error(`Unexpected STRATZ snapshot schema: ${String(snapshot.schema)}`);
  }

  const catalogMap = new Map(catalog.map((h) => [h.id, h]));
  const selectedBuckets = options?.selectedBucketIds
    ? extractClosedBucketIds(snapshot.data.heroStats, options.selectedBucketIds.length, options.selectedBucketIds)
    : snapshot.closedBucketIds && snapshot.closedBucketIds.length > 0
    ? [...snapshot.closedBucketIds].sort((a, b) => a - b)
    : extractClosedBucketIds(snapshot.data.heroStats, 7);
  const selectedBucketSet = new Set(selectedBuckets);

  const report: StratzImportReport = {
    selectedBuckets,
    unmatchedHeroes: [],
    unparseableRows: [],
    duplicateRows: [],
    unobservedHeroes: [],
    heroesBelowFloorEverywhere: [],
    observationRows: 0,
    belowFloorRows: 0,
    lowCountRows: 0,
  };

  // Map of heroId -> (Position -> matchCount)
  const counts = new Map<number, Map<Position, number>>();

  const posAliases: readonly [keyof StratzResponseData["heroStats"] & `p${Position}`, Position][] = [
    ["p1", 1],
    ["p2", 2],
    ["p3", 3],
    ["p4", 4],
    ["p5", 5],
  ];

  for (const [alias, position] of posAliases) {
    const rows = snapshot.data.heroStats[alias] ?? [];
    const seenOnDay = new Set<string>();

    for (const row of rows) {
      if (!selectedBucketSet.has(row.day)) {
        continue;
      }

      // Validation 1: Integer heroId
      if (!Number.isInteger(row.heroId) || row.heroId <= 0) {
        report.unparseableRows.push({
          position,
          day: row.day,
          heroId: row.heroId,
          reason: "heroId must be a positive integer",
        });
        continue;
      }

      // Validation 2: Unknown hero ID against catalog
      if (!catalogMap.has(row.heroId)) {
        report.unmatchedHeroes.push({
          position,
          day: row.day,
          heroId: row.heroId,
        });
        continue;
      }

      // Validation 3: Integer matchCount
      if (!Number.isInteger(row.matchCount) || row.matchCount < 0) {
        report.unparseableRows.push({
          position,
          day: row.day,
          heroId: row.heroId,
          reason: "matchCount must be a non-negative integer",
        });
        continue;
      }

      // Validation 4: Integer winCount
      if (!Number.isInteger(row.winCount) || row.winCount < 0) {
        report.unparseableRows.push({
          position,
          day: row.day,
          heroId: row.heroId,
          reason: "winCount must be a non-negative integer",
        });
        continue;
      }

      // Validation 5: 0 <= winCount <= matchCount
      if (row.winCount > row.matchCount) {
        report.unparseableRows.push({
          position,
          day: row.day,
          heroId: row.heroId,
          reason: `winCount (${row.winCount}) cannot exceed matchCount (${row.matchCount})`,
        });
        continue;
      }

      // Validation 6: Duplicate (position, day, heroId)
      const dayKey = `${row.day}:${row.heroId}`;
      if (seenOnDay.has(dayKey)) {
        report.duplicateRows.push({
          position,
          day: row.day,
          heroId: row.heroId,
        });
        continue;
      }
      seenOnDay.add(dayKey);

      // Positive matchCount: aggregate into hero counts
      if (row.matchCount > 0) {
        let perHero = counts.get(row.heroId);
        if (!perHero) {
          perHero = new Map();
          counts.set(row.heroId, perHero);
        }
        perHero.set(position, (perHero.get(position) ?? 0) + row.matchCount);
      }
    }
  }

  // Build deterministic output
  const heroes = [...counts.keys()]
    .sort((a, b) => a - b)
    .map((id) => {
      const observations = [...counts.get(id)!.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([position, matches]) => {
          report.observationRows++;
          if (matches < MIN_POSITION_MATCHES) report.belowFloorRows++;
          if (matches >= 1 && matches <= 19) report.lowCountRows++;
          return { position, matches };
        });
      return { hero: id, observations };
    });

  for (const hero of [...catalog].sort((a, b) => a.id - b.id)) {
    const perHero = counts.get(hero.id);
    if (!perHero) {
      report.unobservedHeroes.push({ id: hero.id, localizedName: hero.localizedName });
    } else if (![...perHero.values()].some((matches) => matches >= MIN_POSITION_MATCHES)) {
      report.heroesBelowFloorEverywhere.push({ id: hero.id, localizedName: hero.localizedName });
    }
  }

  // Evaluate spotlight coverage
  const allCatalogItems = [
    ...catalog.map((h) => ({ id: h.id, displayName: h.localizedName })),
    ...(snapshot.data.constants?.heroes ?? []),
  ];
  const coverage = evaluateCoverage(allCatalogItems, counts);

  const snapshotSha256 =
    snapshot.sha256 ?? createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");

  const file = {
    schema: HERO_POSITION_OBSERVATIONS_SCHEMA,
    provenance: {
      source: "api.stratz.com/graphql (STRATZ GraphQL heroStats.winDay, offline snapshot)",
      bracketClaim: snapshot.bracket?.join(", ") ?? "IMMORTAL",
      gameMode: snapshot.gameMode?.join(", ") ?? "ALL_PICK_RANKED",
      patchClaim: snapshot.empiricalPatchClaim ?? {
        label: null,
        verified: false,
        note: "the source API does not state a patch in winDay; no patch is asserted",
      },
      rulesetTarget: snapshot.rulesetTarget ?? "7.41f",
      retrievedAt: { from: snapshot.retrievedAt, to: snapshot.retrievedAt },
      selectedBucketIds: selectedBuckets,
      completeness:
        "all positive observations retained across selected closed buckets, sub-floor included; missing API rows are NOT assumed to be zero",
      commercialPermissions:
        "UNRESOLVED -- raw API responses are not committed; commercial/redistribution terms externally unresolved",
      admissionFloorMatches: MIN_POSITION_MATCHES,
      admissionFloorNote:
        "informational -- NOT applied to this file; the engine loader applies it after building the denominator",
      generator: "scripts/positions/import-observations.ts@stratz-v1",
      rawSnapshotSha256: snapshotSha256,
    },
    heroes,
  };

  return { file, report, coverage };
}

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

export function main(): void {
  const pagesDir = arg("pages");
  const stratzPath = arg("stratz");
  const snapshot = arg("snapshot");
  const out = arg("out");

  if ((!pagesDir && !stratzPath) || !snapshot || !out) {
    console.error("Usage:");
    console.error("  From D2PT dumps:");
    console.error("    bun scripts/positions/import-observations.ts --pages=<dir> --snapshot=<frozen.sqlite> --out=<path> [--matches-column=<n>] [--replace-legacy]");
    console.error("  From STRATZ snapshot:");
    console.error("    bun scripts/positions/import-observations.ts --stratz=<snapshot.json> --snapshot=<frozen.sqlite> --out=<path> [--replace-legacy] [--closed-buckets=<id1,id2,...>]");
    process.exit(1);
  }

  const db = new Database(resolve(snapshot), { readonly: true });
  const catalog = db.query("SELECT id, localized_name AS localizedName FROM heroes ORDER BY id").all() as CatalogHero[];
  db.close();

  let file: { schema: string; provenance: Record<string, unknown>; heroes: unknown[] };
  let report: unknown;
  let coverage: HeroCoverageReport[] | undefined;

  if (stratzPath) {
    const rawSnapshot = JSON.parse(readFileSync(resolve(stratzPath), "utf8")) as StratzPositionSnapshot;
    const explicitBuckets = arg("closed-buckets")?.split(",").map(Number);
    const result = buildObservationsFromStratz(rawSnapshot, catalog, {
      selectedBucketIds: explicitBuckets,
    });

    if (
      result.report.unmatchedHeroes.length +
        result.report.unparseableRows.length +
        result.report.duplicateRows.length >
      0
    ) {
      console.error(JSON.stringify(result.report, null, 2));
      throw new Error("STRATZ import refused: unmatched / unparseable / duplicate rows found. Nothing was written.");
    }

    file = result.file;
    report = result.report;
    coverage = result.coverage;
  } else {
    const pages = ([1, 2, 3, 4, 5] as const).map(
      (position) => JSON.parse(readFileSync(join(pagesDir!, `pos-${position}.json`), "utf8")) as PositionPage,
    );
    for (const page of pages) {
      if (page.schema !== PAGE_SCHEMA) throw new Error(`pos-${page.position}.json: unexpected schema ${String(page.schema)}`);
    }

    const explicit = arg("matches-column");
    const result = buildObservations(
      pages,
      catalog,
      locateMatchesColumn(pages, explicit === undefined ? undefined : Number(explicit)),
    );

    if (result.report.unmatchedNames.length + result.report.unparseableRows.length + result.report.duplicateRows.length > 0) {
      console.error(JSON.stringify(result.report, null, 2));
      throw new Error("import refused: unmatched / unparseable / duplicate rows above. Fix the input; nothing was written.");
    }

    file = result.file;
    report = result.report;
  }

  const target = resolve(out);
  if (
    existsSync(target) &&
    Array.isArray(JSON.parse(readFileSync(target, "utf8"))) &&
    !process.argv.includes("--replace-legacy")
  ) {
    throw new Error("import refused: the target is the legacy floor-truncated v1 file. Archive it, then pass --replace-legacy.");
  }

  const text = `${JSON.stringify(file, null, 2)}\n`;
  writeFileSync(target, text);
  const outSha256 = createHash("sha256").update(text).digest("hex");

  console.log(
    JSON.stringify(
      {
        wrote: out,
        sha256: outSha256,
        heroes: file.heroes.length,
        report,
      },
      null,
      2,
    ),
  );

  if (coverage) {
    console.log(`\n${formatCoverageReport(coverage)}\n`);
  }
}

if (import.meta.main) main();
