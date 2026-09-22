#!/usr/bin/env bun
// Certification remediation (Phase A, A2) -- STRATZ live low-count acceptance probe.
//
//   bun scripts/positions/verify-stratz-low-counts.ts --snapshot=<path/to/snapshot.json> [--out=<evidence-path>]
//   or:
//   STRATZ_API_KEY=<key> bun scripts/positions/verify-stratz-low-counts.ts --live [--out=<evidence-path>]
//
// Acceptance gate:
//   Searches closed daily buckets in the snapshot for at least one REAL returned row satisfying:
//     1 <= matchCount <= 19
//
// If found:
//   Writes acceptance evidence artifact (default: docs/diagnostics/WAVE5_STRATZ_LOW_COUNT_EVIDENCE.json)
//   containing: heroId, position, day, matchCount, snapshotHash.
//
// If NOT found:
//   Reports: LOW_COUNT_NOT_OBSERVED
//   Exits non-zero. Does NOT synthesize success.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  extractClosedBucketIds,
  fetchStratzSnapshot,
  STRATZ_SNAPSHOT_SCHEMA,
  type StratzPositionSnapshot,
} from "./fetch-stratz";
import type { Position } from "./coverage";

export const LOW_COUNT_EVIDENCE_SCHEMA = "stratz-low-count-acceptance/v1";
export const DEFAULT_LOW_COUNT_OUT = "docs/diagnostics/WAVE5_STRATZ_LOW_COUNT_EVIDENCE.json";

export interface LowCountObservationMatch {
  heroId: number;
  position: Position;
  day: number;
  matchCount: number;
  winCount: number;
}

export interface LowCountEvidenceArtifact {
  schema: typeof LOW_COUNT_EVIDENCE_SCHEMA;
  status: "PASS";
  verifiedAt: string;
  snapshotHash: string;
  selectedClosedBuckets: number[];
  firstEvidence: {
    heroId: number;
    position: Position;
    day: number;
    matchCount: number;
    snapshotHash: string;
  };
  totalLowCountObservations: number;
  examples: LowCountObservationMatch[];
}

export interface LowCountVerificationResult {
  pass: boolean;
  snapshotHash: string;
  selectedClosedBuckets: number[];
  firstEvidence?: {
    heroId: number;
    position: Position;
    day: number;
    matchCount: number;
    snapshotHash: string;
  };
  totalMatches: number;
  matches: LowCountObservationMatch[];
}

/**
 * Searches the closed buckets in a snapshot for rows with 1 <= matchCount <= 19.
 */
export function verifyLowCountEvidence(
  snapshot: StratzPositionSnapshot,
  explicitBuckets?: readonly number[],
): LowCountVerificationResult {
  if (snapshot.schema !== STRATZ_SNAPSHOT_SCHEMA) {
    throw new Error(`Unexpected snapshot schema: ${String(snapshot.schema)}`);
  }

  const snapshotText = JSON.stringify(snapshot);
  const snapshotHash = snapshot.sha256 ?? createHash("sha256").update(snapshotText).digest("hex");

  const closedBuckets = explicitBuckets
    ? extractClosedBucketIds(snapshot.data.heroStats, explicitBuckets.length, explicitBuckets)
    : snapshot.closedBucketIds && snapshot.closedBucketIds.length > 0
    ? [...snapshot.closedBucketIds].sort((a, b) => a - b)
    : extractClosedBucketIds(snapshot.data.heroStats, 7);
  const closedBucketSet = new Set(closedBuckets);

  const matches: LowCountObservationMatch[] = [];

  const posAliases: readonly [keyof StratzPositionSnapshot["data"]["heroStats"] & `p${Position}`, Position][] = [
    ["p1", 1],
    ["p2", 2],
    ["p3", 3],
    ["p4", 4],
    ["p5", 5],
  ];

  for (const [posKey, position] of posAliases) {
    const rows = snapshot.data.heroStats[posKey] ?? [];
    for (const row of rows) {
      if (closedBucketSet.has(row.day) && row.matchCount >= 1 && row.matchCount <= 19) {
        matches.push({
          heroId: row.heroId,
          position,
          day: row.day,
          matchCount: row.matchCount,
          winCount: row.winCount,
        });
      }
    }
  }

  // Sort canonically: matchCount asc, heroId asc, position asc, day asc
  matches.sort((a, b) => a.matchCount - b.matchCount || a.heroId - b.heroId || a.position - b.position || a.day - b.day);

  if (matches.length === 0) {
    return {
      pass: false,
      snapshotHash,
      selectedClosedBuckets: closedBuckets,
      totalMatches: 0,
      matches: [],
    };
  }

  const first = matches[0]!;
  return {
    pass: true,
    snapshotHash,
    selectedClosedBuckets: closedBuckets,
    firstEvidence: {
      heroId: first.heroId,
      position: first.position,
      day: first.day,
      matchCount: first.matchCount,
      snapshotHash,
    },
    totalMatches: matches.length,
    matches,
  };
}

function parseArg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

export async function main(): Promise<void> {
  if (process.argv.some((a) => a.startsWith("--token="))) {
    console.error("SECURITY ERROR: Passing --token via command-line arguments is forbidden.");
    console.error("STRATZ_API_KEY must be provided via environment variable only.");
    process.exit(1);
  }

  const snapshotPath = parseArg("snapshot");
  const isLive = process.argv.includes("--live");
  const outPath = parseArg("out") ?? DEFAULT_LOW_COUNT_OUT;
  const bucketsArg = parseArg("closed-buckets");
  const explicitBuckets = bucketsArg ? bucketsArg.split(",").map(Number) : undefined;

  let snapshot: StratzPositionSnapshot;

  if (snapshotPath) {
    const raw = readFileSync(resolve(snapshotPath), "utf8");
    snapshot = JSON.parse(raw) as StratzPositionSnapshot;
  } else if (isLive) {
    const token = process.env.STRATZ_API_KEY;
    if (!token) {
      console.error("Error: STRATZ_API_KEY environment variable is missing.");
      console.error("Usage: STRATZ_API_KEY=<key> bun scripts/positions/verify-stratz-low-counts.ts --live [--out=<evidence-path>]");
      process.exit(1);
    }
    console.log("Fetching live STRATZ snapshot for low-count acceptance verification...");
    const res = await fetchStratzSnapshot();
    snapshot = res.snapshot;
  } else {
    console.error("Usage:");
    console.error("  bun scripts/positions/verify-stratz-low-counts.ts --snapshot=<path> [--out=<evidence-path>]");
    console.error("  STRATZ_API_KEY=<key> bun scripts/positions/verify-stratz-low-counts.ts --live [--out=<evidence-path>]");
    process.exit(1);
  }

  const result = verifyLowCountEvidence(snapshot, explicitBuckets);

  if (!result.pass || !result.firstEvidence) {
    console.error("\nRESULT: LOW_COUNT_NOT_OBSERVED");
    console.error("No row with 1 <= matchCount <= 19 found in the selected closed daily buckets.");
    console.error("The acceptance gate cannot be satisfied by this snapshot.");
    process.exit(1);
  }

  const artifact: LowCountEvidenceArtifact = {
    schema: LOW_COUNT_EVIDENCE_SCHEMA,
    status: "PASS",
    verifiedAt: new Date().toISOString(),
    snapshotHash: result.snapshotHash,
    selectedClosedBuckets: result.selectedClosedBuckets,
    firstEvidence: result.firstEvidence,
    totalLowCountObservations: result.totalMatches,
    examples: result.matches.slice(0, 10),
  };

  const resolvedOut = resolve(outPath);
  mkdirSync(dirname(resolvedOut), { recursive: true });
  writeFileSync(resolvedOut, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  console.log("\n[ACCEPTANCE GATE PASS]");
  console.log(`Verified real low-count observation:`);
  console.log(`  Hero ID:     ${result.firstEvidence.heroId}`);
  console.log(`  Position:    Pos ${result.firstEvidence.position}`);
  console.log(`  Day Bucket:  ${result.firstEvidence.day}`);
  console.log(`  Match Count: ${result.firstEvidence.matchCount} (satisfies 1 <= matchCount <= 19)`);
  console.log(`  Snapshot:    ${result.firstEvidence.snapshotHash}`);
  console.log(`  Total found: ${result.totalMatches} low-count observation(s) across selected buckets`);
  console.log(`Evidence artifact written to: ${resolvedOut}\n`);
}

if (import.meta.main) {
  void main();
}
