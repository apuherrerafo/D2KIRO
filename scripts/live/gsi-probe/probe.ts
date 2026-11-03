#!/usr/bin/env bun
// `bun run probe:gsi` -- direct Valve Game State Integration probe. No Overwolf, no memory reading, no OCR.
// Independent from dev:live: it starts no engine/web, only a 127.0.0.1 listener for Dota's GSI POSTs.
//
//   bun run probe:gsi                              detect Dota, install cfg, listen
//   bun run probe:gsi --dota-path "<...\dota 2 beta>"
//   bun run probe:gsi --uninstall                  remove the cfg from the Dota install
//
// Console and .local/gsi-probe/ receive ONLY the allowlisted safe summary (see probe-core.ts) -- never
// a raw payload, Steam id, player name or the auth token.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  GSI_CFG_NAME,
  GSI_HOST,
  GSI_PORT,
  GSI_URI,
  HERO_SELECTION,
  buildGsiConfig,
  createEvidence,
  dotaCfgParent,
  dotaRootForLibrary,
  extractOwnToken,
  formatSummary,
  formatVerdict,
  gsiCfgDir,
  parseLibraryFolders,
  recordEvidence,
  summarizeGsi,
  summaryKey,
} from "./probe-core";
import { IN_MATCH_STATES, createTelemetry, formatTelemetryReport, recordTelemetry, telemetryStatusLine } from "./telemetry-core";

const ROOT = resolve(import.meta.dir, "..", "..", "..");
const OUT_DIR = join(ROOT, ".local", "gsi-probe");
const MAX_BODY_BYTES = 1_000_000;
const NO_TRAFFIC_HINT_MS = 60_000;
const TELEMETRY_FLUSH_MS = 15_000;
const TELEMETRY_STATUS_MS = 60_000;

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function regValue(key: string, name: string): string | null {
  const out = spawnSync("reg", ["query", key, "/v", name], { encoding: "utf8" });
  if (out.status !== 0) return null;
  const match = out.stdout.match(new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`));
  return match ? match[1].trim().replace(/\//g, "\\") : null;
}

function detectDotaRoot(): string {
  const explicit = argValue("--dota-path") ?? process.env.DOTA2_PATH ?? null;
  if (explicit) {
    if (existsSync(dotaCfgParent(explicit))) return explicit;
    fail(`The Dota path you gave has no game\\dota\\cfg folder:\n  ${explicit}\nIt must be the "dota 2 beta" folder.`);
  }
  const steamRoots = new Set<string>(
    [
      process.platform === "win32" ? regValue("HKCU\\Software\\Valve\\Steam", "SteamPath") : null,
      process.platform === "win32" ? regValue("HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath") : null,
      "C:\\Program Files (x86)\\Steam",
      "C:\\Program Files\\Steam",
    ].filter((p): p is string => p !== null),
  );
  const libraries = new Set<string>(steamRoots);
  for (const steam of steamRoots) {
    const vdf = join(steam, "steamapps", "libraryfolders.vdf");
    if (existsSync(vdf)) for (const lib of parseLibraryFolders(readFileSync(vdf, "utf8"))) libraries.add(lib);
  }
  for (const drive of ["C", "D", "E", "F", "G"]) {
    libraries.add(`${drive}:\\SteamLibrary`);
    libraries.add(`${drive}:\\Steam`);
  }
  for (const lib of libraries) {
    const root = dotaRootForLibrary(lib);
    if (existsSync(dotaCfgParent(root))) return root;
  }
  fail(
    'Could not find a Dota 2 install (a "dota 2 beta" folder with game\\dota\\cfg).\n' +
      'Pass it explicitly:  bun run probe:gsi --dota-path "D:\\SteamLibrary\\steamapps\\common\\dota 2 beta"\n' +
      "or set DOTA2_PATH to that folder.",
  );
}

function fail(message: string): never {
  console.error(`D2KIRO GSI PROBE ERROR\n${message}`);
  process.exit(1);
}

const dotaRoot = detectDotaRoot();
const cfgDir = gsiCfgDir(dotaRoot);
const cfgPath = join(cfgDir, GSI_CFG_NAME);

if (process.argv.includes("--uninstall")) {
  rmSync(cfgPath, { force: true });
  console.log(`Removed ${cfgPath}`);
  process.exit(0);
}

// Reuse our previous token so a Dota client already launched with the cfg keeps authenticating.
const previousCfg = existsSync(cfgPath) ? readFileSync(cfgPath, "utf8") : null;
const token = (previousCfg && extractOwnToken(previousCfg)) ?? randomBytes(32).toString("hex");
const cfgBody = buildGsiConfig(token);
const cfgChanged = previousCfg !== cfgBody;
if (cfgChanged) {
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(cfgPath, cfgBody);
}

mkdirSync(OUT_DIR, { recursive: true });
const observationsPath = join(OUT_DIR, "observations.jsonl");
const verdictPath = join(OUT_DIR, "verdict.txt");
const telemetryPath = join(OUT_DIR, "match-telemetry.txt");
const tokenBytes = Buffer.from(token);

function tokenMatches(payload: unknown): boolean {
  const auth = typeof payload === "object" && payload !== null ? (payload as { auth?: { token?: unknown } }).auth : undefined;
  const given = typeof auth?.token === "string" ? Buffer.from(auth.token) : null;
  return given !== null && given.length === tokenBytes.length && timingSafeEqual(given, tokenBytes);
}

const evidence = createEvidence();
const telemetry = createTelemetry();
let telemetryDirty = false;
let lastTelemetryStatusAt = 0;
let lastKey = "";
let lastState: string | null = null;
let updates = 0;
let rejected = 0;

function writeVerdict(): string {
  const text = formatVerdict(evidence);
  writeFileSync(verdictPath, `${new Date().toISOString()}\n${text}\n`);
  return text;
}

function writeTelemetry(): string {
  const text = formatTelemetryReport(telemetry, new Date().toISOString());
  writeFileSync(telemetryPath, text);
  telemetryDirty = false;
  return text;
}

function handlePayload(payload: unknown): void {
  updates += 1;
  const summary = summarizeGsi(payload);
  recordEvidence(evidence, summary);
  recordTelemetry(telemetry, payload, summary.gameState);
  if (lastState === HERO_SELECTION && summary.gameState !== null && summary.gameState !== HERO_SELECTION) {
    console.log(writeVerdict());
  }
  if (summary.gameState !== null) lastState = summary.gameState;
  // In-match: keep running and collecting. The console gets a periodic one-liner and the report file
  // is flushed on a timer -- the per-change draft summary below would only spam during a match.
  if (summary.gameState !== null && IN_MATCH_STATES.has(summary.gameState)) {
    telemetryDirty = true;
    if (Date.now() - lastTelemetryStatusAt >= TELEMETRY_STATUS_MS) {
      lastTelemetryStatusAt = Date.now();
      console.log(`[${new Date().toISOString().slice(11, 19)}] ${summary.gameState} -- ${telemetryStatusLine(telemetry)}`);
    }
    return;
  }
  const key = summaryKey(summary);
  if (key === lastKey) return;
  lastKey = key;
  console.log(`\n[${new Date().toISOString().slice(11, 19)}] update #${updates}\n${formatSummary(summary)}`);
  appendFileSync(observationsPath, `${JSON.stringify({ at: new Date().toISOString(), summary })}\n`);
}

try {
  Bun.serve({
    hostname: GSI_HOST,
    port: GSI_PORT,
    async fetch(req) {
      if (req.method !== "POST") return new Response("D2KIRO GSI probe", { status: 200 });
      const length = Number(req.headers.get("content-length") ?? "0");
      if (length > MAX_BODY_BYTES) return new Response(null, { status: 413 });
      let payload: unknown;
      try {
        payload = await req.json();
      } catch {
        rejected += 1;
        return new Response(null, { status: 400 });
      }
      if (!tokenMatches(payload)) {
        rejected += 1;
        console.log(`(rejected a POST without the probe token -- total rejected: ${rejected})`);
        return new Response(null, { status: 401 });
      }
      handlePayload(payload);
      return new Response(null, { status: 200 });
    },
  });
} catch (error) {
  fail(`Could not listen on ${GSI_URI} (${error instanceof Error ? error.message : "unknown error"}). Is port ${GSI_PORT} in use?`);
}

console.log(`D2KIRO GSI PROBE READY
Listening: http://${GSI_HOST}:${GSI_PORT}
Config: ${cfgPath}
Waiting for Dota 2 GSI...`);
if (cfgChanged) {
  console.log("\nThe cfg was just installed/updated: Dota 2 reads it at launch, so (re)start Dota 2 now.");
}
console.log(
  'Dota 2 also needs the Steam launch option  -gamestateintegration  (Steam > Dota 2 > Properties > Launch Options).\n' +
    `Safe summaries -> ${observationsPath}\nDraft verdict -> ${verdictPath}\nMatch telemetry -> ${telemetryPath}\n` +
    "Keeps running after hero selection. Ctrl+C prints the draft verdict + the match telemetry summary.",
);

setTimeout(() => {
  if (updates === 0 && rejected === 0) {
    console.log(
      `\n(no GSI POST in ${NO_TRAFFIC_HINT_MS / 1000}s -- is Dota 2 running, restarted after the cfg install, and launched with -gamestateintegration?)`,
    );
  }
}, NO_TRAFFIC_HINT_MS);

setInterval(() => {
  if (telemetryDirty) writeTelemetry();
}, TELEMETRY_FLUSH_MS);

process.on("SIGINT", () => {
  console.log(writeVerdict());
  console.log(`\n${writeTelemetry()}`);
  process.exit(0);
});
