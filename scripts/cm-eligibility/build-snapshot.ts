#!/usr/bin/env bun
// R1 S3.4 -- CM Hero Eligibility snapshot builder. Orchestrates the full pipeline:
//
//   pak01_dir.vpk (real Steam depot) -> vpk-reader.ts -> scripts/npc/npc_heroes.txt bytes
//     -> kv-parser.ts -> npc-heroes.ts -> cm-hero-eligibility/v1 JSON, hash-verified
//
// Offline by design, same posture as scripts/eval/**: no network, never imported from apps/**.
//
// THIS ENVIRONMENT HAS NO STEAM DEPOT / VPK FILE TO POINT --vpk AT. Real usage (a developer
// running this from a machine with Dota 2 installed):
//
//   bun scripts/cm-eligibility/build-snapshot.ts \
//     --vpk "<steam-library>/steamapps/common/dota 2 beta/game/dota/pak01_dir.vpk" \
//     --patch 7.41e --build-id <verified build> --depot-id <verified depot> \
//     --manifest-id <verified manifest> \
//     --out scripts/cm-eligibility/output/cm-hero-eligibility.7.41e.json
//
// Without --vpk, this script runs in --demo mode: it builds a snapshot from a fixture text (the
// SAME representative fixture npc-heroes.test.ts uses) to prove the pipeline is wired correctly
// end to end, and refuses to write that output anywhere without --allow-demo-output, so a demo
// run can never be mistaken for a real artifact on disk.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { verifyEligibilitySnapshotIntegrity } from "../../apps/engine/src/draft-protocol/eligibility";
import { parseKeyValues } from "./kv-parser";
import { buildCmHeroEligibilitySnapshot, parseNpcHeroEntries } from "./npc-heroes";
import { extractVpkEntry, findVpkEntry, parseVpkDirectory } from "./vpk-reader";

const NPC_HEROES_VPK_PATH = "scripts/npc/npc_heroes.txt";

const DEMO_FIXTURE_NPC_HEROES_TXT = `
"DOTAHeroes"
{
  "npc_dota_hero_base" { "BaseClass" "npc_dota_hero" }
  "npc_dota_hero_antimage" { "HeroID" "1" }
  "npc_dota_hero_axe" { "HeroID" "2" }
}
`;

interface CliArgs {
  vpkPath: string | null;
  patch: string;
  buildId: string;
  depotId: string | null;
  manifestId: string | null;
  out: string | null;
  allowDemoOutput: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    vpkPath: null,
    patch: "unknown",
    buildId: "unknown",
    depotId: null,
    manifestId: null,
    out: null,
    allowDemoOutput: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--vpk") args.vpkPath = argv[++i] ?? null;
    else if (arg === "--patch") args.patch = argv[++i] ?? args.patch;
    else if (arg === "--build-id") args.buildId = argv[++i] ?? args.buildId;
    else if (arg === "--depot-id") args.depotId = argv[++i] ?? null;
    else if (arg === "--manifest-id") args.manifestId = argv[++i] ?? null;
    else if (arg === "--out") args.out = argv[++i] ?? null;
    else if (arg === "--allow-demo-output") args.allowDemoOutput = true;
  }
  return args;
}

export interface BuildResult {
  ok: boolean;
  message: string;
  snapshotPath?: string;
  isDemo: boolean;
}

/** Pure-ish orchestration (file I/O only for the VPK read + JSON write) -- kept separate from CLI parsing/exit-code plumbing so tests can call it directly. */
export function runBuild(args: CliArgs): BuildResult {
  const isDemo = args.vpkPath === null;

  if (!isDemo && (args.patch === "unknown" || args.buildId === "unknown" || !args.depotId || !args.manifestId)) {
    return {
      ok: false,
      isDemo: false,
      message: "ELIGIBILITY_UNVERIFIED: --vpk alone is not official provenance; --patch, --build-id, --depot-id and --manifest-id are required",
    };
  }

  let npcHeroesText: string;
  if (isDemo) {
    npcHeroesText = DEMO_FIXTURE_NPC_HEROES_TXT;
  } else {
    if (!existsSync(args.vpkPath!)) {
      return { ok: false, message: `VPK file not found: ${args.vpkPath}`, isDemo };
    }
    const dirBuffer = new Uint8Array(readFileSync(args.vpkPath!));
    const directory = parseVpkDirectory(dirBuffer);
    const entry = findVpkEntry(directory, NPC_HEROES_VPK_PATH);
    if (!entry) {
      return { ok: false, message: `${NPC_HEROES_VPK_PATH} not found inside ${args.vpkPath}`, isDemo };
    }
    const bytes = extractVpkEntry(dirBuffer, directory, entry);
    npcHeroesText = new TextDecoder("utf-8").decode(bytes);
  }

  const kvRoot = parseKeyValues(npcHeroesText);
  const entries = parseNpcHeroEntries(kvRoot);
  const sourceHash = new Bun.CryptoHasher("sha256").update(npcHeroesText).digest("hex");
  const snapshot = buildCmHeroEligibilitySnapshot(entries, {
    patch: args.patch,
    buildId: args.buildId,
    depotManifests: { "570": isDemo ? "DEMO_FIXTURE_NOT_REAL_DEPOT_DATA" : args.manifestId! },
    sourceHashes: { npc_heroes: `sha256:${sourceHash}` },
    provenance: isDemo
      ? { kind: "DEMO_FIXTURE", label: "embedded build-snapshot demo" }
      : {
          kind: "OFFICIAL_DEPOT",
          appId: 570,
          buildId: args.buildId,
          depotId: args.depotId!,
          manifestId: args.manifestId!,
          sourcePath: NPC_HEROES_VPK_PATH,
          sourceHash: `sha256:${sourceHash}`,
        },
  });

  if (!verifyEligibilitySnapshotIntegrity(snapshot)) {
    // Should be unreachable (we just built it with the kernel's own hash function) -- fail loudly
    // rather than ever writing a snapshot this tool itself can't verify.
    return { ok: false, message: "internal error: freshly-built snapshot failed its own integrity check", isDemo };
  }

  if (isDemo && !args.allowDemoOutput) {
    return {
      ok: true,
      isDemo: true,
      message:
        `DEMO MODE (no --vpk given): pipeline verified end-to-end against a synthetic fixture, ` +
        `NOT real Valve data. heroIds: [${snapshot.heroIds.join(", ")}], contentHash: ${snapshot.contentHash}. ` +
        `Nothing written to disk -- pass --allow-demo-output to write this demo artifact anyway (it will be ` +
        `clearly labeled in depotManifests["570"] as DEMO_FIXTURE_NOT_REAL_DEPOT_DATA).`,
    };
  }

  const outPath = resolvePath(
    args.out ?? `scripts/cm-eligibility/output/cm-hero-eligibility.${isDemo ? "demo" : args.patch}.json`,
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  return {
    ok: true,
    isDemo,
    snapshotPath: outPath,
    message: `${isDemo ? "[DEMO, NOT REAL DATA] " : ""}Wrote ${outPath} (${snapshot.heroIds.length} eligible heroes, contentHash ${snapshot.contentHash}).`,
  };
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const result = runBuild(args);
  console.log(result.message);
  return result.ok ? 0 : 1;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
