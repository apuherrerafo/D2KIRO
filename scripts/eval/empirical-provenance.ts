// Certification remediation (Phase A, A1) -- HONEST provenance of a frozen empirical snapshot.
//
// The live ingestion (`apps/engine/src/meta/sync.ts`) stamps a CALLER-SUPPLIED patch string (`CURRENT_PATCH`) onto
// `hero_patch_stats` rows; OpenDota's `/heroStats` and `/heroes/{id}/matchups` carry no patch parameter or column, and
// `hero_matchups` has no patch column at all. So "7.41e" on those rows is a LABEL WE APPLIED, not something the source
// reported. This module keeps four things that the row label used to blur into one, and never merges them:
//
//   rulesetTarget      the patch the PRODUCT targets (a product decision; says nothing about what the data measured)
//   patchClaim         the label carried by the data + whether anything verifies it (here: it does not)
//   synchronization    when we RETRIEVED the rows (exact, recorded by our own `meta_sync`)
//   observationWindow  the period the SOURCE aggregated over -- null unless the source reported it (OpenDota does not)
//
// Pure: builds and validates a plain object. Reading the SQLite and writing files is `freeze-empirical-snapshot.ts`.
// Never imported from apps/ (Fase 9 rule).

export const EMPIRICAL_PROVENANCE_SCHEMA = "empirical-snapshot-provenance/v1";

export interface SyncRunFact {
  id: number;
  source: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  rowsWritten: number;
}

export interface TableRetrieval {
  rows: number;
  /** Earliest / latest `updated_at` among the frozen rows (the moment OUR sync wrote them). */
  retrievedFrom: string | null;
  retrievedTo: string | null;
}

export interface MatchupRetrievalGroup {
  /** The sync run whose start most recently preceded these rows' `updated_at` (`null` if none did). */
  syncId: number | null;
  heroes: number;
  retrievedFrom: string;
  retrievedTo: string;
}

export interface BracketFact {
  bracket: string;
  /** Sum of `picks` over every hero in the frozen snapshot. 0 means the bracket carries no observations at all. */
  totalPicks: number;
  totalWins: number;
}

export interface EmpiricalProvenanceInput {
  snapshotId: string;
  frozenAt: string;
  /** Product target patch (from code, e.g. `RANKED_ALL_PICK_IDENTITY.verifiedThroughPatch`). */
  rulesetTarget: string;
  patchLabelOnRows: string | null;
  patchLabelDistinct: string[];
  syncRuns: SyncRunFact[];
  tables: { heroes: TableRetrieval; hero_patch_stats: TableRetrieval; hero_matchups: TableRetrieval };
  matchupRetrievalGroups: MatchupRetrievalGroup[];
  matchupHeroesDistinct: number;
  brackets: BracketFact[];
  hashes: { logicalFingerprint: string; fileSha256: string; sourceFileSha256: string };
}

export interface EmpiricalSnapshotProvenance {
  schema: typeof EMPIRICAL_PROVENANCE_SCHEMA;
  snapshotId: string;
  frozenAt: string;
  source: {
    name: "OpenDota";
    endpoints: string[];
    queryParameters: "none -- no patch, rank or time-window parameter is sent";
    apiKey: false;
  };
  rulesetTarget: { patch: string; meaning: "product target; NOT a claim about what the data measured" };
  patchClaim: {
    label: string | null;
    verified: false;
    basis: "caller-supplied constant stamped at ingestion (CURRENT_PATCH); the source reports no patch";
    appliesTo: "hero_patch_stats.patch only; hero_matchups has no patch column";
    labelsFound: string[];
  };
  synchronization: {
    syncRuns: SyncRunFact[];
    /** True when any recorded run is not `ok`/finished -- the snapshot then holds rows from more than one retrieval. */
    interruptedRunPresent: boolean;
    tables: EmpiricalProvenanceInput["tables"];
    matchupRetrievalGroups: MatchupRetrievalGroup[];
    retrievalWindow: { from: string | null; to: string | null };
  };
  observationWindow: null;
  observationWindowNote: "not reported by OpenDota and not recorded by the sync; unknown, NOT assumed equal to any patch";
  sample: {
    heroStatsBracketDefinition: "OpenDota /heroStats `<tier>_pick`/`<tier>_win`, tier 1..8 labelled herald..immortal by the project; the MMR span of each tier is not recorded here";
    brackets: BracketFact[];
    matchupSampleDefinition: "per (hero, opposing hero) aggregate games/wins from /heroes/{id}/matchups; no bracket split, window unknown";
  };
  rowCounts: { heroes: number; hero_patch_stats: number; hero_matchups: number; matchupHeroesDistinct: number };
  hashes: EmpiricalProvenanceInput["hashes"] & { logicalFingerprintScope: "heroes(id,localized_name,roles) + hero_patch_stats(hero_id,patch,bracket,picks,wins) + hero_matchups(hero_id,vs_hero_id,games,wins); independent of file layout and meta_sync" };
  limitations: string[];
}

export function buildEmpiricalProvenance(input: EmpiricalProvenanceInput): EmpiricalSnapshotProvenance {
  const interruptedRunPresent = input.syncRuns.some((run) => run.status !== "ok" || run.finishedAt === null);
  const retrieved = [input.tables.heroes, input.tables.hero_patch_stats, input.tables.hero_matchups]
    .flatMap((table) => [table.retrievedFrom, table.retrievedTo])
    .filter((value): value is string => value !== null)
    .sort();
  const emptyBrackets = input.brackets.filter((bracket) => bracket.totalPicks === 0).map((bracket) => bracket.bracket);

  const limitations = [
    "The patch label is applied by our ingestion, not reported by OpenDota: it is UNVERIFIED and must not be read as \"data is from that patch\".",
    `The ruleset target (${input.rulesetTarget}) and the data label (${input.patchLabelOnRows ?? "none"}) are different things; equality or inequality between them proves nothing about the data.`,
    "The observation window OpenDota aggregated over is unknown: nothing here dates the games themselves.",
    "hero_matchups carries no patch and no bracket: it can never be attributed to a patch, even in principle.",
  ];
  if (interruptedRunPresent) limitations.push("A sync run is recorded as not finished: the frozen rows are the union of what was committed before it stopped and earlier complete runs (each hero's matchups are written in one transaction, so a hero's block is internally consistent, but blocks were retrieved at different times).");
  if (input.matchupRetrievalGroups.length > 1) limitations.push(`hero_matchups was retrieved in ${input.matchupRetrievalGroups.length} separate groups (see synchronization.matchupRetrievalGroups).`);
  if (emptyBrackets.length > 0) limitations.push(`Bracket(s) with zero recorded picks for every hero: ${emptyBrackets.join(", ")}.`);

  return {
    schema: EMPIRICAL_PROVENANCE_SCHEMA,
    snapshotId: input.snapshotId,
    frozenAt: input.frozenAt,
    source: {
      name: "OpenDota",
      endpoints: ["GET /heroes", "GET /heroStats", "GET /heroes/{id}/matchups"],
      queryParameters: "none -- no patch, rank or time-window parameter is sent",
      apiKey: false,
    },
    rulesetTarget: { patch: input.rulesetTarget, meaning: "product target; NOT a claim about what the data measured" },
    patchClaim: {
      label: input.patchLabelOnRows,
      verified: false,
      basis: "caller-supplied constant stamped at ingestion (CURRENT_PATCH); the source reports no patch",
      appliesTo: "hero_patch_stats.patch only; hero_matchups has no patch column",
      labelsFound: input.patchLabelDistinct,
    },
    synchronization: {
      syncRuns: input.syncRuns,
      interruptedRunPresent,
      tables: input.tables,
      matchupRetrievalGroups: input.matchupRetrievalGroups,
      retrievalWindow: { from: retrieved[0] ?? null, to: retrieved[retrieved.length - 1] ?? null },
    },
    observationWindow: null,
    observationWindowNote: "not reported by OpenDota and not recorded by the sync; unknown, NOT assumed equal to any patch",
    sample: {
      heroStatsBracketDefinition: "OpenDota /heroStats `<tier>_pick`/`<tier>_win`, tier 1..8 labelled herald..immortal by the project; the MMR span of each tier is not recorded here",
      brackets: input.brackets,
      matchupSampleDefinition: "per (hero, opposing hero) aggregate games/wins from /heroes/{id}/matchups; no bracket split, window unknown",
    },
    rowCounts: {
      heroes: input.tables.heroes.rows,
      hero_patch_stats: input.tables.hero_patch_stats.rows,
      hero_matchups: input.tables.hero_matchups.rows,
      matchupHeroesDistinct: input.matchupHeroesDistinct,
    },
    hashes: {
      ...input.hashes,
      logicalFingerprintScope: "heroes(id,localized_name,roles) + hero_patch_stats(hero_id,patch,bracket,picks,wins) + hero_matchups(hero_id,vs_hero_id,games,wins); independent of file layout and meta_sync",
    },
    limitations,
  };
}

const SHA256 = /^[0-9a-f]{64}$/;
const FINGERPRINT = /^meta1:[0-9a-f]{64}$/;

/** Structural validation of a provenance document (e.g. one read back from disk). Returns every problem found; [] means valid. */
export function validateEmpiricalProvenance(value: unknown): string[] {
  const problems: string[] = [];
  if (typeof value !== "object" || value === null) return ["not an object"];
  const doc = value as Partial<EmpiricalSnapshotProvenance>;
  if (doc.schema !== EMPIRICAL_PROVENANCE_SCHEMA) problems.push("schema mismatch");
  if (!doc.snapshotId) problems.push("snapshotId missing");
  if (doc.patchClaim?.verified !== false) problems.push("patchClaim.verified must be explicitly false (nothing verifies the label)");
  if (doc.observationWindow !== null) problems.push("observationWindow must be null unless the source reports it");
  if (!doc.rulesetTarget?.patch) problems.push("rulesetTarget.patch missing");
  if (!FINGERPRINT.test(doc.hashes?.logicalFingerprint ?? "")) problems.push("hashes.logicalFingerprint is not meta1:<sha256>");
  if (!SHA256.test(doc.hashes?.fileSha256 ?? "")) problems.push("hashes.fileSha256 is not a sha256");
  if (!SHA256.test(doc.hashes?.sourceFileSha256 ?? "")) problems.push("hashes.sourceFileSha256 is not a sha256");
  if (!doc.synchronization?.syncRuns?.length) problems.push("synchronization.syncRuns empty");
  if (!doc.rowCounts || doc.rowCounts.heroes <= 0 || doc.rowCounts.hero_patch_stats <= 0 || doc.rowCounts.hero_matchups <= 0) problems.push("rowCounts must be positive for every table");
  if (!doc.limitations?.length) problems.push("limitations empty");
  return problems;
}
