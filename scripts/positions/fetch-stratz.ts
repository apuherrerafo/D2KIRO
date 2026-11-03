#!/usr/bin/env bun
// Certification remediation (Phase A, A2) -- STRATZ snapshot fetcher.
//
//   bun scripts/positions/fetch-stratz.ts [--out=<path>] [--token=<key>] [--take=<n>] [--bracket=<bracket>] [--game-mode=<mode>]
//
// Fetches daily hero position observations from STRATZ GraphQL API:
//   POST https://api.stratz.com/graphql
//   Authorization: Bearer <STRATZ_API_KEY>
//
// Constraints:
//   - Uses Bun native fetch. Zero external dependencies.
//   - Explicit POSITION_1 through POSITION_5 aliases.
//   - Filters by selected bracket (default: IMMORTAL) and game mode (default: ALL_PICK_RANKED).
//   - Excludes the current partial UTC day to retain only CLOSED daily buckets.
//   - NEVER writes token, Authorization header, cookies or personal credentials into snapshot.
//   - Raw live API responses default to ignored local storage (data/raw/stratz/); commercial
//     and redistribution permissions remain externally UNRESOLVED.
//   - Evaluates and logs spotlight hero coverage (Chen 66, Ringmaster 131, Kez 145, Largo 155).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { evaluateCoverage, formatCoverageReport, type Position } from "./coverage";

export const STRATZ_SNAPSHOT_SCHEMA = "stratz-position-snapshot/v1";
export const DEFAULT_STRATZ_ENDPOINT = "https://api.stratz.com/graphql";
export const DEFAULT_RAW_SNAPSHOT_PATH = "data/raw/stratz/snapshot-latest.json";
export const DEFAULT_RULESET_TARGET = "7.41f";
export const DEFAULT_BRACKET = "IMMORTAL";
export const DEFAULT_GAME_MODE = "ALL_PICK_RANKED";
export const DEFAULT_TAKE_DAYS = 14;
export const DEFAULT_REQUIRED_CLOSED_DAYS = 7;

export const STRATZ_POSITION_STATS_QUERY = `query HeroPositionStats(
  $bracketIds: [RankBracket!]
  $gameModeIds: [GameModeEnumType!]
  $take: Int
) {
  constants {
    heroes {
      id
      displayName
    }
  }
  heroStats {
    total: winDay(
      bracketIds: $bracketIds
      gameModeIds: $gameModeIds
      take: $take
    ) {
      day
      heroId
      matchCount
      winCount
    }
    p1: winDay(
      bracketIds: $bracketIds
      gameModeIds: $gameModeIds
      positionIds: [POSITION_1]
      take: $take
    ) {
      day
      heroId
      matchCount
      winCount
    }
    p2: winDay(
      bracketIds: $bracketIds
      gameModeIds: $gameModeIds
      positionIds: [POSITION_2]
      take: $take
    ) {
      day
      heroId
      matchCount
      winCount
    }
    p3: winDay(
      bracketIds: $bracketIds
      gameModeIds: $gameModeIds
      positionIds: [POSITION_3]
      take: $take
    ) {
      day
      heroId
      matchCount
      winCount
    }
    p4: winDay(
      bracketIds: $bracketIds
      gameModeIds: $gameModeIds
      positionIds: [POSITION_4]
      take: $take
    ) {
      day
      heroId
      matchCount
      winCount
    }
    p5: winDay(
      bracketIds: $bracketIds
      gameModeIds: $gameModeIds
      positionIds: [POSITION_5]
      take: $take
    ) {
      day
      heroId
      matchCount
      winCount
    }
  }
}`;

export interface StratzHeroStatsEntry {
  day: number;
  heroId: number;
  matchCount: number;
  winCount: number;
}

export interface StratzConstantsHero {
  id: number;
  displayName: string;
}

export interface StratzResponseData {
  constants?: {
    heroes?: StratzConstantsHero[];
  };
  heroStats: {
    total?: StratzHeroStatsEntry[];
    p1?: StratzHeroStatsEntry[];
    p2?: StratzHeroStatsEntry[];
    p3?: StratzHeroStatsEntry[];
    p4?: StratzHeroStatsEntry[];
    p5?: StratzHeroStatsEntry[];
    [key: string]: unknown;
  };
}

export interface BucketExclusion {
  bucketId: number;
  date: string;
  reason: string;
}

export interface BucketSelectionResult {
  currentUtcDayBucket: number;
  currentUtcDayDate: string;
  selectedBucketIds: number[];
  excludedBuckets: BucketExclusion[];
}

export interface StratzPositionSnapshot {
  schema: typeof STRATZ_SNAPSHOT_SCHEMA;
  endpoint: string;
  query: string;
  querySha256: string;
  variables: Record<string, unknown>;
  retrievedAt: string;
  closedBucketIds: number[];
  bucketSelection?: BucketSelectionResult;
  bracket: string[];
  gameMode: string[];
  rulesetTarget: string;
  empiricalPatchClaim: {
    verified: false;
    note: string;
  };
  rateLimit: Record<string, string | null>;
  commercialPermissions: {
    status: "UNRESOLVED";
    note: string;
  };
  data: StratzResponseData;
  sha256?: string;
}

export interface FetchStratzOptions {
  endpoint?: string;
  outPath?: string;
  bracket?: string;
  gameMode?: string;
  takeDays?: number;
  requiredClosedDays?: number;
  explicitClosedBuckets?: number[];
  customFetch?: typeof fetch;
}

/**
 * Determines confirmed closed daily UTC buckets.
 *
 * Explicitly determines the current UTC daily bucket from retrievedAt (or clock):
 *   - excludes any bucket that is actually the current/incomplete bucket (day >= currentUtcDayBucket);
 *   - retains the required number (default 7) of most recent confirmed closed buckets;
 *   - records selected bucket IDs and all excluded bucket IDs with explicit reasons.
 */
export function evaluateClosedBucketSelection(
  heroStats: StratzResponseData["heroStats"],
  options?: {
    requiredDays?: number;
    explicitBucketIds?: readonly number[];
    retrievedAt?: string | Date;
  },
): BucketSelectionResult {
  const requiredDays = options?.requiredDays ?? DEFAULT_REQUIRED_CLOSED_DAYS;
  const retrievedDate = options?.retrievedAt ? new Date(options.retrievedAt) : new Date();
  const currentUtcDayBucket = Math.floor(
    Date.UTC(retrievedDate.getUTCFullYear(), retrievedDate.getUTCMonth(), retrievedDate.getUTCDate()) / 1000,
  );
  const currentUtcDayDate = new Date(currentUtcDayBucket * 1000).toISOString().slice(0, 10);

  const allDays = new Set<number>();
  for (const posKey of ["total", "p1", "p2", "p3", "p4", "p5"] as const) {
    const list = heroStats[posKey];
    if (Array.isArray(list)) {
      for (const row of list) {
        if (typeof row?.day === "number") {
          allDays.add(row.day);
        }
      }
    }
  }

  if (options?.explicitBucketIds && options.explicitBucketIds.length > 0) {
    for (const id of options.explicitBucketIds) {
      if (!allDays.has(id)) {
        throw new Error(`Requested bucket ID ${id} is not present in STRATZ snapshot`);
      }
    }
    if (options.explicitBucketIds.length < requiredDays) {
      throw new Error(
        `Requested ${options.explicitBucketIds.length} bucket(s), but at least ${requiredDays} are required.`,
      );
    }
    const selected = [...options.explicitBucketIds].sort((a, b) => a - b);
    const excluded: BucketExclusion[] = [...allDays]
      .filter((d) => !selected.includes(d))
      .sort((a, b) => b - a)
      .map((bucketId) => ({
        bucketId,
        date: new Date(bucketId * 1000).toISOString().slice(0, 10),
        reason: "excluded by explicit bucket selection",
      }));
    return {
      currentUtcDayBucket,
      currentUtcDayDate,
      selectedBucketIds: selected,
      excludedBuckets: excluded,
    };
  }

  const sortedDescending = [...allDays].sort((a, b) => b - a);
  const excludedBuckets: BucketExclusion[] = [];
  const confirmedClosed: number[] = [];

  for (const day of sortedDescending) {
    const dateStr = new Date(day * 1000).toISOString().slice(0, 10);
    if (day >= currentUtcDayBucket) {
      excludedBuckets.push({
        bucketId: day,
        date: dateStr,
        reason: "current incomplete UTC bucket (in-progress day)",
      });
    } else {
      confirmedClosed.push(day);
    }
  }

  if (confirmedClosed.length < requiredDays) {
    throw new Error(
      `STRATZ returned ${confirmedClosed.length} confirmed closed day bucket(s), but ${requiredDays} closed day(s) were requested. Try increasing --take.`,
    );
  }

  // 7 most recent confirmed closed buckets
  const selected = confirmedClosed.slice(0, requiredDays).sort((a, b) => a - b);
  const selectedSet = new Set(selected);

  // Any remaining confirmed closed buckets beyond requiredDays are recorded as excluded
  for (const day of confirmedClosed) {
    if (!selectedSet.has(day)) {
      excludedBuckets.push({
        bucketId: day,
        date: new Date(day * 1000).toISOString().slice(0, 10),
        reason: `prior closed UTC bucket (outside ${requiredDays}-day observation window)`,
      });
    }
  }

  return {
    currentUtcDayBucket,
    currentUtcDayDate,
    selectedBucketIds: selected,
    excludedBuckets,
  };
}

/**
 * Extracts and sorts closed day buckets from STRATZ winDay results.
 */
export function extractClosedBucketIds(
  heroStats: StratzResponseData["heroStats"],
  requiredDays = DEFAULT_REQUIRED_CLOSED_DAYS,
  explicitBucketIds?: readonly number[],
  retrievedAt?: string | Date,
): number[] {
  return evaluateClosedBucketSelection(heroStats, {
    requiredDays,
    explicitBucketIds,
    retrievedAt,
  }).selectedBucketIds;
}

/**
 * Builds a snapshot object from raw response data, ensuring secrets are excluded and
 * closed buckets are canonically recorded.
 */
export function buildSnapshotObject(
  data: StratzResponseData,
  options: {
    endpoint: string;
    variables: Record<string, unknown>;
    bracket: string;
    gameMode: string;
    retrievedAt?: string;
    closedBucketIds: number[];
    bucketSelection?: BucketSelectionResult;
    rateLimitHeaders?: Record<string, string | null>;
  },
): StratzPositionSnapshot {
  const snapshot: StratzPositionSnapshot = {
    schema: STRATZ_SNAPSHOT_SCHEMA,
    endpoint: options.endpoint,
    query: STRATZ_POSITION_STATS_QUERY,
    querySha256: createHash("sha256").update(STRATZ_POSITION_STATS_QUERY).digest("hex"),
    variables: options.variables,
    retrievedAt: options.retrievedAt ?? new Date().toISOString(),
    closedBucketIds: options.closedBucketIds,
    bucketSelection: options.bucketSelection,
    bracket: [options.bracket],
    gameMode: [options.gameMode],
    rulesetTarget: DEFAULT_RULESET_TARGET,
    empiricalPatchClaim: {
      verified: false,
      note: "STRATZ GraphQL API does not assert patch in winDay; product ruleset target is 7.41f",
    },
    rateLimit: options.rateLimitHeaders ?? {},
    commercialPermissions: {
      status: "UNRESOLVED",
      note: "Raw live API responses must default to ignored/local storage; commercial/redistribution terms externally unresolved.",
    },
    data,
  };

  const textWithoutSha = JSON.stringify(snapshot);
  snapshot.sha256 = createHash("sha256").update(textWithoutSha).digest("hex");
  return snapshot;
}

/**
 * Validates the raw response data shape from STRATZ.
 */
export function validateStratzResponseData(data: unknown): asserts data is StratzResponseData {
  if (typeof data !== "object" || data === null) {
    throw new Error("malformed STRATZ response: data is not an object");
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.heroStats !== "object" || obj.heroStats === null) {
    throw new Error("malformed STRATZ response: missing 'heroStats' object");
  }
  const heroStats = obj.heroStats as Record<string, unknown>;
  if (heroStats.total !== undefined && !Array.isArray(heroStats.total)) {
    throw new Error("malformed STRATZ response: 'heroStats.total' is not an array");
  }
  for (const posKey of ["p1", "p2", "p3", "p4", "p5"]) {
    if (!Array.isArray(heroStats[posKey])) {
      throw new Error(`malformed STRATZ response: 'heroStats.${posKey}' is not an array`);
    }
  }
}

/**
 * Fetches STRATZ snapshot using authenticated GraphQL request.
 */
export async function fetchStratzSnapshot(options: FetchStratzOptions = {}): Promise<{
  snapshot: StratzPositionSnapshot;
  coverageReport: ReturnType<typeof evaluateCoverage>;
  outPath: string;
}> {
  if (process.argv.some((a) => a.startsWith("--token="))) {
    throw new Error(
      "SECURITY ERROR: Passing --token via command-line arguments is forbidden. STRATZ_API_KEY must be provided via environment variable only.",
    );
  }

  const token = process.env.STRATZ_API_KEY;
  if (!token || token.trim() === "") {
    throw new Error(
      "STRATZ_API_KEY is missing. Set STRATZ_API_KEY in environment to execute live fetch.",
    );
  }

  const endpoint = options.endpoint ?? DEFAULT_STRATZ_ENDPOINT;
  const bracket = options.bracket ?? DEFAULT_BRACKET;
  const gameMode = options.gameMode ?? DEFAULT_GAME_MODE;
  const takeDays = options.takeDays ?? DEFAULT_TAKE_DAYS;
  const requiredClosedDays = options.requiredClosedDays ?? DEFAULT_REQUIRED_CLOSED_DAYS;
  const outPath = options.outPath ?? DEFAULT_RAW_SNAPSHOT_PATH;
  const fetchImpl = options.customFetch ?? fetch;

  const variables = {
    bracketIds: [bracket],
    gameModeIds: [gameMode],
    take: takeDays,
  };

  const retrievedAt = new Date().toISOString();
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "D2Kiro-Offline/1.0",
        Authorization: `Bearer ${token.trim()}`,
      },
      body: JSON.stringify({
        query: STRATZ_POSITION_STATS_QUERY,
        variables,
      }),
    });
  } catch (err) {
    throw new Error(`STRATZ network fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (response.status === 429) {
    throw new Error("STRATZ API rate limit reached (HTTP 429). Retry after backoff.");
  }
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`STRATZ HTTP ${response.status} error from ${endpoint}: ${errorText.slice(0, 300)}`);
  }

  const rateLimitHeaders: Record<string, string | null> = {
    "x-rate-limit-remaining-second": response.headers.get("x-rate-limit-remaining-second"),
    "x-rate-limit-remaining-minute": response.headers.get("x-rate-limit-remaining-minute"),
    "x-rate-limit-remaining-hour": response.headers.get("x-rate-limit-remaining-hour"),
    "x-rate-limit-remaining-day": response.headers.get("x-rate-limit-remaining-day"),
    "retry-after": response.headers.get("retry-after"),
  };

  const rawJson = (await response.json()) as { data?: unknown; errors?: Array<{ message: string }> };
  if (rawJson.errors && rawJson.errors.length > 0) {
    const messages = rawJson.errors.map((e) => e.message).join("; ");
    throw new Error(`STRATZ GraphQL error: ${messages}`);
  }

  validateStratzResponseData(rawJson.data);

  const bucketSelection = evaluateClosedBucketSelection(rawJson.data.heroStats, {
    requiredDays: requiredClosedDays,
    explicitBucketIds: options.explicitClosedBuckets,
    retrievedAt,
  });
  const closedBucketIds = bucketSelection.selectedBucketIds;

  const snapshot = buildSnapshotObject(rawJson.data, {
    endpoint,
    variables,
    bracket,
    gameMode,
    retrievedAt,
    closedBucketIds,
    bucketSelection,
    rateLimitHeaders,
  });

  // Security check: NEVER serialize the token
  const serialized = JSON.stringify(snapshot, null, 2);
  if (serialized.includes(token.trim())) {
    throw new Error("FATAL SECURITY VIOLATION: API token leaked into serialized snapshot object!");
  }

  const resolvedOut = resolve(outPath);
  mkdirSync(dirname(resolvedOut), { recursive: true });
  writeFileSync(resolvedOut, `${serialized}\n`, "utf8");

  // Run coverage assertion
  const heroesCatalog = rawJson.data.constants?.heroes ?? [];
  const selectedBucketSet = new Set(closedBucketIds);
  const obsMap = new Map<number, Map<Position, number>>();

  for (const [posKey, posNum] of [
    ["p1", 1],
    ["p2", 2],
    ["p3", 3],
    ["p4", 4],
    ["p5", 5],
  ] as const) {
    const list = rawJson.data.heroStats[posKey] ?? [];
    for (const row of list) {
      if (selectedBucketSet.has(row.day) && row.matchCount > 0) {
        let perHero = obsMap.get(row.heroId);
        if (!perHero) {
          perHero = new Map();
          obsMap.set(row.heroId, perHero);
        }
        perHero.set(posNum, (perHero.get(posNum) ?? 0) + row.matchCount);
      }
    }
  }

  const coverageReport = evaluateCoverage(heroesCatalog, obsMap);

  return {
    snapshot,
    coverageReport,
    outPath: resolvedOut,
  };
}

function parseArg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

export async function main(): Promise<void> {
  if (process.argv.some((a) => a.startsWith("--token="))) {
    console.error("SECURITY ERROR: Passing --token via command-line arguments is forbidden.");
    console.error("STRATZ_API_KEY must be provided via environment variable only.");
    console.error("Usage: STRATZ_API_KEY=<key> bun scripts/positions/fetch-stratz.ts [--out=<path>]");
    process.exit(1);
  }

  const token = process.env.STRATZ_API_KEY;
  const outPath = parseArg("out") ?? DEFAULT_RAW_SNAPSHOT_PATH;
  const takeArg = parseArg("take");
  const daysArg = parseArg("days");
  const bracket = parseArg("bracket") ?? DEFAULT_BRACKET;
  const gameMode = parseArg("game-mode") ?? DEFAULT_GAME_MODE;
  const bucketsArg = parseArg("closed-buckets");

  if (!token) {
    console.error("Error: STRATZ_API_KEY environment variable is missing.");
    console.error("Usage: STRATZ_API_KEY=<key> bun scripts/positions/fetch-stratz.ts [--out=<path>]");
    process.exit(1);
  }

  console.log(`Connecting to STRATZ GraphQL (${DEFAULT_STRATZ_ENDPOINT})...`);
  console.log(`Filters: Bracket=[${bracket}], GameMode=[${gameMode}]`);

  try {
    const { snapshot, coverageReport, outPath: writtenPath } = await fetchStratzSnapshot({
      outPath,
      bracket,
      gameMode,
      takeDays: takeArg ? Number(takeArg) : DEFAULT_TAKE_DAYS,
      requiredClosedDays: daysArg ? Number(daysArg) : DEFAULT_REQUIRED_CLOSED_DAYS,
      explicitClosedBuckets: bucketsArg ? bucketsArg.split(",").map(Number) : undefined,
    });

    console.log(`\n[SUCCESS] Snapshot written to: ${writtenPath}`);
    console.log(`SHA-256: ${snapshot.sha256}`);
    console.log(`Closed buckets selected (${snapshot.closedBucketIds.length}): [${snapshot.closedBucketIds.join(", ")}]`);
    if (snapshot.bucketSelection?.excludedBuckets && snapshot.bucketSelection.excludedBuckets.length > 0) {
      console.log(`Excluded buckets (${snapshot.bucketSelection.excludedBuckets.length}):`);
      for (const exc of snapshot.bucketSelection.excludedBuckets) {
        console.log(`  - ${exc.bucketId} (${exc.date}): ${exc.reason}`);
      }
    }
    console.log(`\n${formatCoverageReport(coverageReport)}\n`);
  } catch (err) {
    console.error(`\n[FAILED] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  void main();
}
