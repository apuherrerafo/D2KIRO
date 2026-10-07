import { afterAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VISUAL_RUNTIME } from "./companion-visual";
import { buildGsiConfig, GSI_CFG_FILENAME } from "@/lib/gsi-config";
import { CFG_SHAPE_PATTERN } from "@/lib/gsi-windows-installer";
import { COMPANION_INSTALLER_FILENAME, buildWindowsCompanionInstaller } from "./companion-installer";
import { COMPANION_FORWARD_SECTIONS, COMPANION_INSTALL_PS, COMPANION_RUNTIME_PS } from "./companion-scripts";

// D2KIRO Companion V0. Pure checks lock the file's shape and where the credential may appear; on Windows the
// installer is RUN (cmd.exe + Windows PowerShell 5.1) against a fake Steam layout under the temp folder, and the
// installed runtime is RUN against a fake D2KIRO server on 127.0.0.1 -- never the machine's real Steam/Dota
// folders, never the registry (D2KIRO_TEST_NO_AUTOSTART), never the network.

const ORIGIN = "https://d2kiro-test.up.railway.app";
const LIVE_ID = "L".repeat(43);
const TOKEN = "ab".repeat(32);
const CFG = buildGsiConfig(`${ORIGIN}/api/live/gsi/${LIVE_ID}`, TOKEN);
const SENTINEL_STEAMID = "76561198999999999";
const SENTINEL_NAME = "SentinelPlayerName";

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("Companion installer (generated file)", () => {
  const personal = buildWindowsCompanionInstaller(CFG);
  const generic = buildWindowsCompanionInstaller(null);

  test("CRLF everywhere and a plain batch preamble", () => {
    for (const file of [personal, generic]) {
      expect(file.startsWith("@echo off\r\n")).toBe(true);
      expect(file.replace(/\r\n/g, "")).not.toContain("\n");
    }
  });

  test("the link token appears exactly once, in the trailing CFG block -- never in the batch, the installer or the runtime", () => {
    expect(occurrences(personal, TOKEN)).toBe(1);
    const cfgStart = personal.indexOf("#D2KIRO-CFG-BEGIN");
    expect(cfgStart).toBeGreaterThan(personal.indexOf("#D2KIRO-RUNTIME-END"));
    expect(personal.indexOf(TOKEN)).toBeGreaterThan(cfgStart);
    expect(personal.slice(0, cfgStart)).not.toContain(LIVE_ID);
    expect(personal.slice(0, cfgStart)).not.toContain("d2kiro-test.up.railway.app");
  });

  test("the generic installer carries no credential and does not delete itself; the personal one does", () => {
    expect(generic).not.toContain("#D2KIRO-CFG-BEGIN");
    expect(generic).not.toContain(TOKEN);
    const genericBatch = generic.slice(0, generic.indexOf("#D2KIRO-SCRIPT-BEGIN"));
    expect(genericBatch.endsWith("\r\nexit /b %D2KIRO_EXIT%\r\n")).toBe(true);
    expect(genericBatch).not.toContain("del ");
    expect(personal).toContain('(goto) 2>nul & del "%~f0" & exit /b %D2KIRO_EXIT%');
  });

  test("the batch part is ASCII and calls PowerShell by absolute path", () => {
    const batch = personal.slice(0, personal.indexOf("#D2KIRO-SCRIPT-BEGIN"));
    expect(batch).not.toMatch(/[^\x09\x0A\x0D\x20-\x7E]/);
    expect(batch).toContain('"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile');
    expect(batch).not.toMatch(/(^|[\s&])powershell(\.exe)?\s/im);
    expect(occurrences(personal, "#D2KIRO-SCRIPT-BEGIN")).toBe(1);
    expect(occurrences(personal, "#D2KIRO-RUNTIME-BEGIN")).toBe(1);
  });

  test("never reads Steam account files; only binds and talks to 127.0.0.1 locally", () => {
    for (const script of [COMPANION_INSTALL_PS, COMPANION_RUNTIME_PS]) {
      expect(script).not.toMatch(/userdata|loginusers|config\.vdf|ActiveUser|AutoLoginUser|LastOwner/i);
      expect(script).not.toMatch(/IPAddress\]::Any|0\.0\.0\.0/);
      expect(script).not.toContain("`");
      expect(script).not.toContain("${");
    }
    expect(COMPANION_RUNTIME_PS).toContain("[System.Net.IPAddress]::Loopback");
  });

  test("forwards exactly the sections D2KIRO's own cfg always sent", () => {
    const sent = [...CFG.matchAll(/^\s+"(\w+)"\s+"1"$/gm)].map((match) => match[1]);
    expect([...COMPANION_FORWARD_SECTIONS].sort() as string[]).toEqual(sent.sort());
  });

  test("refuses to embed anything that is not a D2KIRO cfg", () => {
    expect(() => buildWindowsCompanionInstaller("not a cfg")).toThrow();
    expect(() => buildWindowsCompanionInstaller(`${CFG}#D2KIRO-SCRIPT-END`)).toThrow();
    expect(COMPANION_INSTALLER_FILENAME).toBe("instalar-d2kiro-companion.cmd");
  });
});

// ---- Real run on Windows -------------------------------------------------------------------------------

const onWindows = process.platform === "win32";
const roots: string[] = [];
const children: ChildProcess[] = [];
afterAll(() => {
  for (const child of children) child.kill();
  // Stub helpers a test left running hold their exe open: stop ONLY the ones living under this run's temp roots.
  if (process.platform === "win32" && roots.length > 0) {
    const under = roots.map((root) => `'${root.replace(/'/g, "''")}*'`).join(",");
    spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", `Get-Process -Name d2kiro-visual -ErrorAction SilentlyContinue | Where-Object { $p = $_.Path; $p -and (@(${under}) | Where-Object { $p -like $_ }) } | Stop-Process -Force`], { encoding: "utf8" });
  }
  for (const root of roots) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

interface Machine {
  root: string;
  downloads: string;
  steam: string;
  home: string;
  dotaCfg: string;
  installedCfg: string;
  port: number;
}

let nextPort = 53_300 + Math.floor(Math.random() * 400);

function machine(): Machine {
  const root = mkdtempSync(join(tmpdir(), "d2kiro-companion-"));
  roots.push(root);
  const downloads = join(root, "Descargas de José");
  const steam = join(root, "Steam");
  const dotaCfg = join(steam, "steamapps", "common", "dota 2 beta", "game", "dota", "cfg");
  mkdirSync(downloads, { recursive: true });
  mkdirSync(dotaCfg, { recursive: true });
  writeFileSync(join(steam, "steamapps", "appmanifest_570.acf"), "\"AppState\"\r\n{\r\n}\r\n");
  writeFileSync(join(steam, "steamapps", "libraryfolders.vdf"), "\"libraryfolders\"\r\n{\r\n}\r\n");
  nextPort += 11;
  return { root, downloads, steam, home: join(root, "AppData", "D2KIRO", "Companion"), dotaCfg, installedCfg: join(dotaCfg, "gamestate_integration", GSI_CFG_FILENAME), port: nextPort };
}

function testEnv(m: Machine, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    D2KIRO_TEST_STEAM_ROOT: m.steam,
    D2KIRO_TEST_NO_DIALOG: "1",
    D2KIRO_TEST_NO_AUTOSTART: "1",
    D2KIRO_TEST_NO_START: "1",
    D2KIRO_TEST_NO_VISUAL: "1", // the visual supervisor has its own suite below; the others must never reach the network
    D2KIRO_COMPANION_HOME: m.home,
    D2KIRO_COMPANION_PORT: String(m.port),
    ...extra,
  };
}

function install(m: Machine, contents: string): { exitCode: number; output: string; path: string } {
  const path = join(m.downloads, COMPANION_INSTALLER_FILENAME);
  writeFileSync(path, contents);
  const result = spawnSync("cmd.exe", ["/d", "/s", "/c", `""${path}""`], { cwd: m.downloads, env: testEnv(m), windowsVerbatimArguments: true, encoding: "utf8" });
  return { exitCode: result.status ?? -1, output: `${result.stdout ?? ""}${result.stderr ?? ""}`, path };
}

interface Received {
  path: string;
  body: Record<string, unknown>;
}

/** A fake D2KIRO server (node:http, see `local`): records every POST; `status(path)` decides the answer. */
async function fakeServer(status: (path: string) => number = () => 200) {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0] ?? "";
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      } catch {
        body = {};
      }
      received.push({ path, body });
      const code = status(path);
      if (code === 200 && path.startsWith("/api/live/visual/")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ schema: "live-visual-ack/v1", draftPhase: "hero_selection", draftEpoch: 1 }));
        return;
      }
      res.writeHead(code, code >= 300 && code < 400 ? { location: "/login" } : {});
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { received, base: `http://127.0.0.1:${port}`, stop: () => server.close() };
}

function startRuntime(m: Machine, upstream: string, extra: Record<string, string> = {}): ChildProcess {
  const child = spawn(
    join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(m.home, "companion.ps1")],
    { env: testEnv(m, { D2KIRO_TEST_UPSTREAM: upstream, ...extra }), stdio: "ignore" },
  );
  children.push(child);
  return child;
}

async function waitFor<T>(probe: () => Promise<T | null> | T | null, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error("timed out");
    await Bun.sleep(150);
  }
}

interface LocalResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}

/**
 * Talks to the Companion through node:http, never the global fetch: in the full apps/web run, happy-dom's global
 * registrator replaces `fetch` process-wide (see CLAUDE.md), which would make these real-socket checks lie.
 */
function local(m: Machine, method: string, path: string, init: { headers?: Record<string, string>; body?: string } = {}): Promise<LocalResponse> {
  return new Promise((resolve, reject) => {
    const body = init.body === undefined ? undefined : Buffer.from(init.body);
    const req = httpRequest({ host: "127.0.0.1", port: m.port, method, path, headers: { ...(body ? { "content-type": "application/json", "content-length": String(body.length) } : {}), ...init.headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.setTimeout(10_000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function health(m: Machine, headers: Record<string, string> = {}): Promise<Record<string, unknown> | null> {
  try {
    const response = await local(m, "GET", "/health", { headers });
    return response.status === 200 ? (JSON.parse(response.text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function localToken(m: Machine): string {
  return (JSON.parse(readFileSync(join(m.home, "config.json"), "utf8")) as { localToken: string }).localToken;
}

function gsiPayload(token: string, gameState: string | null): Record<string, unknown> {
  return {
    provider: { name: "Dota 2", appid: 570, version: 47, timestamp: 1 },
    ...(gameState === null ? {} : { map: { name: "start", matchid: "8123456789", game_time: 10, clock_time: -50, game_state: gameState } }),
    player: { steamid: SENTINEL_STEAMID, accountid: "1038734271", name: SENTINEL_NAME, activity: "playing", team_name: "radiant" },
    hero: { id: 0 },
    draft: {},
    wearables: { wearable0: 123 },
    minimap: { o0: { unitname: "npc_dota_hero_axe", team: 2 } },
    auth: { token },
  };
}

async function postGsi(m: Machine, body: unknown, host = `127.0.0.1:${m.port}`): Promise<number> {
  return (await local(m, "POST", "/gsi", { headers: { host }, body: JSON.stringify(body) })).status;
}

describe.skipIf(!onWindows)("Companion installer (real cmd.exe + PowerShell run)", () => {
  test("personal download: installs the runtime, an encrypted pairing and the local Dota cfg, then deletes itself", () => {
    const m = machine();
    const result = install(m, buildWindowsCompanionInstaller(CFG));
    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain(TOKEN);
    expect(existsSync(result.path)).toBe(false);
    expect(readdirSync(m.home).sort()).toEqual(["companion.ps1", "config.json", "desinstalar-d2kiro-companion.cmd"]);
    const config = readFileSync(join(m.home, "config.json"), "utf8");
    expect(config).not.toContain(TOKEN);
    expect(JSON.parse(config)).toMatchObject({ schema: "d2kiro-companion-config/v1", siteOrigin: ORIGIN, liveId: LIVE_ID, port: m.port });
    const cfg = readFileSync(m.installedCfg, "utf8");
    expect(cfg).toContain(`"uri"           "http://127.0.0.1:${m.port}/gsi"`);
    expect(cfg).toContain(localToken(m));
    expect(cfg).not.toContain(TOKEN);
    // The Companion's own cfg never looks like a site cfg (it is never "adopted" as a link).
    expect(new RegExp(CFG_SHAPE_PATTERN).test(cfg.replace(/\s+/g, " ").trim())).toBe(false);
  });

  test("generic installer adopts the D2KIRO cfg already installed in Dota and keeps itself", () => {
    const m = machine();
    mkdirSync(join(m.dotaCfg, "gamestate_integration"), { recursive: true });
    writeFileSync(m.installedCfg, CFG);
    const result = install(m, buildWindowsCompanionInstaller(null));
    expect(result.exitCode).toBe(0);
    expect(existsSync(result.path)).toBe(true);
    expect(JSON.parse(readFileSync(join(m.home, "config.json"), "utf8"))).toMatchObject({ siteOrigin: ORIGIN, liveId: LIVE_ID });
    expect(readFileSync(m.installedCfg, "utf8")).toContain(`http://127.0.0.1:${m.port}/gsi`);
  });

  test("generic installer with nothing to pair with: clear message, exit 5, nothing installed", () => {
    const m = machine();
    const result = install(m, buildWindowsCompanionInstaller(null));
    expect(result.exitCode).toBe(5);
    expect(existsSync(m.home)).toBe(false);
    expect(existsSync(m.installedCfg)).toBe(false);
  });

  test("a tampered embedded link is refused: exit 4, nothing installed", () => {
    const m = machine();
    const file = buildWindowsCompanionInstaller(CFG);
    const cfgStart = file.indexOf("#D2KIRO-CFG-BEGIN");
    const result = install(m, file.slice(0, cfgStart) + file.slice(cfgStart).replace('"timeout"       "5.0"', '"timeout"       "9.0"'));
    expect(result.exitCode).toBe(4);
    expect(existsSync(m.home)).toBe(false);
  });
});

describe.skipIf(!onWindows)("Companion runtime (real PowerShell, fake D2KIRO server)", () => {
  test("relays Dota GSI with the link token, keeps research local, reports health, survives an outage, uninstalls", async () => {
    const m = machine();
    expect(install(m, buildWindowsCompanionInstaller(CFG)).exitCode).toBe(0);
    let outage = false;
    const server = await fakeServer((path) => (outage && path.startsWith("/api/live/gsi/") ? 503 : 200));
    try {
      startRuntime(m, server.base, { D2KIRO_TEST_CFG_SYNC_SECONDS: "1" });
      const first = await waitFor(() => health(m));
      expect(first).toMatchObject({ schema: "d2kiro-companion-health/v1", version: "0.1.0", paired: true, cfgInstalled: true });
      expect(["not_running", "waiting"]).toContain(first.dota as string);
      expect(JSON.stringify(first)).not.toContain(TOKEN);

      // Local door: wrong token, wrong Host (DNS rebinding) and non-JSON are refused.
      const token = localToken(m);
      expect(await postGsi(m, gsiPayload("0".repeat(64), "DOTA_GAMERULES_STATE_HERO_SELECTION"))).toBe(401);
      expect(await postGsi(m, gsiPayload(token, "DOTA_GAMERULES_STATE_HERO_SELECTION"), "evil.example")).toBe(421);
      expect(await postGsi(m, gsiPayload(TOKEN, "DOTA_GAMERULES_STATE_HERO_SELECTION"))).toBe(401);
      expect(await postGsi(m, gsiPayload(token, "DOTA_GAMERULES_STATE_HERO_SELECTION"), `127.0.0.1:${m.port + 1}`)).toBe(421);
      // A client that omits the port in Host (legal HTTP) is still Dota on this PC.
      expect(await postGsi(m, gsiPayload(token, null), "127.0.0.1")).toBe(200);

      // Hero Selection reaches the live session with the LINK token and only the allowlisted sections.
      expect(await postGsi(m, gsiPayload(token, "DOTA_GAMERULES_STATE_HERO_SELECTION"))).toBe(200);
      const forwarded = await waitFor(() => server.received.find((r) => r.path === `/api/live/gsi/${LIVE_ID}` && (r.body.map as { game_state?: string } | undefined)?.game_state === "DOTA_GAMERULES_STATE_HERO_SELECTION") ?? null);
      expect(forwarded.body.auth).toEqual({ token: TOKEN });
      expect(Object.keys(forwarded.body).sort()).toEqual(["auth", "draft", "hero", "map", "player", "provider"]);
      expect(JSON.stringify(forwarded.body)).not.toContain(token);

      const drafting = await waitFor(async () => {
        const h = await health(m);
        return h && h.phase === "HERO_SELECTION" && h.liveSession === "connected" ? h : null;
      });
      expect(drafting.dota).toBe("connected");
      const heartbeat = await waitFor(() => server.received.find((r) => r.path === `/api/live/companion/${LIVE_ID}` && (r.body.companion as { phase?: string })?.phase === "HERO_SELECTION") ?? null);
      expect(heartbeat.body).toMatchObject({ auth: { token: TOKEN }, companion: { schema: "companion-heartbeat/v1", version: "0.1.0", dota: "connected", restartNeeded: false } });

      // CORS only for the paired site; Private Network Access preflight answered.
      const preflight = await local(m, "OPTIONS", "/health", { headers: { origin: ORIGIN } });
      expect(preflight.status).toBe(204);
      expect(preflight.headers["access-control-allow-origin"]).toBe(ORIGIN);
      expect(preflight.headers["access-control-allow-private-network"]).toBe("true");
      expect((await local(m, "OPTIONS", "/health", { headers: { origin: "https://evil.example" } })).status).toBe(403);
      expect((await local(m, "GET", "/health", { headers: { origin: "https://evil.example" } })).headers["access-control-allow-origin"]).toBeUndefined();

      // The local visual helper goes through the Companion, which alone holds the link token.
      const visual = await local(m, "POST", "/relay/api/live/visual/companion", { body: JSON.stringify({ auth: { token }, envelope: { schema: "draft-event/v1" } }) });
      expect(visual.status).toBe(200);
      expect(JSON.parse(visual.text)).toMatchObject({ schema: "live-visual-ack/v1", draftEpoch: 1 });
      const relayed = server.received.find((r) => r.path === `/api/live/visual/${LIVE_ID}`);
      expect(relayed?.body.auth).toEqual({ token: TOKEN });

      // Outage: the server refuses for a while; the latest state is delivered once it is back.
      outage = true;
      expect(await postGsi(m, gsiPayload(token, "DOTA_GAMERULES_STATE_STRATEGY_TIME"))).toBe(200);
      await waitFor(async () => ((await health(m))?.liveSession === "offline" ? true : null));
      outage = false;
      await waitFor(() => server.received.some((r) => r.path === `/api/live/gsi/${LIVE_ID}` && (r.body.map as { game_state?: string })?.game_state === "DOTA_GAMERULES_STATE_STRATEGY_TIME") || null, 40_000);
      await waitFor(async () => ((await health(m))?.liveSession === "connected" ? true : null));

      // Diagnostics: raw stays local and never holds the local token; the inventory holds no identity.
      const diag = join(m.home, "diagnostics");
      const raw = readdirSync(diag).filter((name) => name.startsWith("gsi-raw-")).map((name) => readFileSync(join(diag, name), "utf8")).join("");
      expect(raw).toContain("DOTA_GAMERULES_STATE_HERO_SELECTION");
      expect(raw).toContain("wearables");
      expect(raw).not.toContain(token);
      const inventory = await waitFor(() => (existsSync(join(diag, "inventory-latest.json")) ? readFileSync(join(diag, "inventory-latest.json"), "utf8") : null));
      for (const secret of [SENTINEL_STEAMID, SENTINEL_NAME, "1038734271", "8123456789", token, TOKEN]) expect(inventory).not.toContain(secret);
      const parsed = JSON.parse(inventory) as { schema: string; phases: Record<string, { paths: Record<string, unknown> }> };
      expect(parsed.schema).toBe("d2kiro-gsi-inventory/v1");
      expect(Object.keys(parsed.phases.HERO_SELECTION?.paths ?? {})).toEqual(expect.arrayContaining(["$.map.game_state", "$.player.steamid", "$.wearables.wearable#", "$.minimap.o#.unitname"]));

      // Re-pairing: downloading a fresh site cfg into Dota is adopted, then replaced by the local cfg.
      const otherLive = "M".repeat(43);
      const otherToken = "cd".repeat(32);
      writeFileSync(m.installedCfg, buildGsiConfig(`${ORIGIN}/api/live/gsi/${otherLive}`, otherToken));
      await waitFor(() => (readFileSync(m.installedCfg, "utf8").includes("127.0.0.1") ? true : null));
      expect(JSON.parse(readFileSync(join(m.home, "config.json"), "utf8")).liveId).toBe(otherLive);
      expect(await postGsi(m, gsiPayload(token, "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"))).toBe(200);
      const repaired = await waitFor(() => server.received.find((r) => r.path === `/api/live/gsi/${otherLive}`) ?? null);
      expect(repaired.body.auth).toEqual({ token: otherToken });

      // Uninstall: stops the runtime, removes Dota's cfg and the Companion, keeps the local diagnostics.
      const uninstall = spawnSync("cmd.exe", ["/d", "/s", "/c", `""${join(m.home, "desinstalar-d2kiro-companion.cmd")}""`], { env: testEnv(m), windowsVerbatimArguments: true, encoding: "utf8" });
      expect(uninstall.status).toBe(0);
      expect(existsSync(m.installedCfg)).toBe(false);
      expect(readdirSync(m.home)).toEqual(["diagnostics"]);
      await waitFor(async () => ((await health(m)) === null ? true : null));
    } finally {
      server.stop();
    }
  }, 120_000);

  test("a site without the heartbeat route (redirect to /login) is never mistaken for an accepted heartbeat", async () => {
    const m = machine();
    expect(install(m, buildWindowsCompanionInstaller(CFG)).exitCode).toBe(0);
    const server = await fakeServer((path) => (path.startsWith("/api/live/companion/") ? 307 : 200));
    try {
      const child = startRuntime(m, server.base);
      await waitFor(() => server.received.find((r) => r.path.startsWith("/api/live/companion/")) ?? null);
      const h = await waitFor(async () => {
        const value = await health(m);
        return value && value.heartbeat === false ? value : null;
      });
      expect(h.liveSession).toBe("connecting");
      // GSI itself still flows to the existing ingest, which is what makes the live session connected.
      expect(await postGsi(m, gsiPayload(localToken(m), null))).toBe(200);
      await waitFor(async () => ((await health(m))?.liveSession === "connected" ? true : null));
      expect(server.received.some((r) => r.path === "/login")).toBe(false);
      child.kill();
    } finally {
      server.stop();
    }
  }, 60_000);
});

// ---- D2KIRO Visual runtime supervision -----------------------------------------------------------------
// A tiny compiled stub plays d2kiro-visual.exe; a local HTTP server plays the GitHub release. Nothing real is fetched.

const STUB_SOURCE = [
  "using System; using System.Diagnostics; using System.IO; using System.Threading;",
  "class P { static void Main() {",
  '  string log = Environment.GetEnvironmentVariable("D2KIRO_STUB_LOG");',
  '  File.AppendAllText(log, "start " + Process.GetCurrentProcess().Id + " " + Environment.GetEnvironmentVariable("D2KIRO_GSI_CFG") + "\\n");',
  '  string ms = Environment.GetEnvironmentVariable("D2KIRO_STUB_EXIT_MS");',
  "  if (ms != null) Thread.Sleep(int.Parse(ms)); else Thread.Sleep(Timeout.Infinite);",
  "} }",
].join("\n");

interface FakeRelease {
  zip: Buffer;
  sha256: string;
  url: string;
  stop(): void;
}

async function fakeRelease(root: string, corrupt = false): Promise<FakeRelease> {
  const work = mkdtempSync(join(root, "stub-"));
  const source = join(work, "stub.cs");
  const exe = join(work, VISUAL_RUNTIME.exeName);
  writeFileSync(source, STUB_SOURCE);
  const csc = join(process.env.SystemRoot ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  const compiled = spawnSync(csc, ["/nologo", "/target:exe", `/out:${exe}`, source], { encoding: "utf8" });
  if (compiled.status !== 0) throw new Error(`could not compile the stub: ${compiled.stdout}${compiled.stderr}`);
  const zipPath = join(work, "visual.zip");
  const packed = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", `Compress-Archive -Path '${exe}' -DestinationPath '${zipPath}'`], { encoding: "utf8" });
  if (packed.status !== 0) throw new Error(`could not zip the stub: ${packed.stderr}`);
  const zip = readFileSync(zipPath);
  const sha256 = createHash("sha256").update(zip).digest("hex");
  const served = corrupt ? Buffer.concat([zip, Buffer.from("tampered")]) : zip;
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/zip", "content-length": String(served.length) });
    res.end(served);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { zip, sha256, url: `http://127.0.0.1:${port}/d2kiro-visual-9.9.9.zip`, stop: () => server.close() };
}

function visualEnv(release: FakeRelease, log: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    D2KIRO_TEST_NO_VISUAL: "0",
    D2KIRO_TEST_VISUAL_VERSION: "9.9.9",
    D2KIRO_TEST_VISUAL_URL: release.url,
    D2KIRO_TEST_VISUAL_SHA256: release.sha256,
    D2KIRO_TEST_VISUAL_RESTART_SECONDS: "1",
    D2KIRO_TEST_VISUAL_FETCH_RETRY_SECONDS: "600",
    D2KIRO_STUB_LOG: log,
    ...extra,
  };
}

function stubStarts(log: string): { pid: number; cfg: string }[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("start "))
    .map((line) => {
      const [, pid, ...cfg] = line.trim().split(" ");
      return { pid: Number(pid), cfg: cfg.join(" ") };
    });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("D2KIRO Visual runtime: pinned release", () => {
  test("the production pin is a well-formed release of this repository (an https GitHub asset + a SHA-256)", () => {
    expect(VISUAL_RUNTIME.url.startsWith("https://github.com/apuherrerafo/D2KIRO/releases/download/visual-runtime-v")).toBe(true);
    expect(VISUAL_RUNTIME.url.endsWith(`d2kiro-visual-${VISUAL_RUNTIME.version}.zip`)).toBe(true);
    expect(VISUAL_RUNTIME.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("the production pin is the calibrated 0.1.1 release (exact published asset and SHA-256)", () => {
    expect(VISUAL_RUNTIME.version).toBe("0.1.1");
    expect(VISUAL_RUNTIME.url).toBe("https://github.com/apuherrerafo/D2KIRO/releases/download/visual-runtime-v0.1.1/d2kiro-visual-0.1.1.zip");
    expect(VISUAL_RUNTIME.sha256).toBe("300759174824a7a284de43ed00a03e3e34d75c4322198c02426cf3f7978e72fd");
  });

  test("the generated PowerShell pins the production release and verifies the hash before extracting", () => {
    expect(COMPANION_RUNTIME_PS).toContain(VISUAL_RUNTIME.url);
    expect(COMPANION_RUNTIME_PS).toContain(VISUAL_RUNTIME.sha256);
    expect(COMPANION_RUNTIME_PS.indexOf("hash_mismatch")).toBeLessThan(COMPANION_RUNTIME_PS.indexOf("ExtractToFile"));
    expect(COMPANION_RUNTIME_PS).toContain("bad_entry");
  });
});

describe.skipIf(!onWindows)("D2KIRO Visual runtime supervision (real PowerShell, stub helper, fake release)", () => {
  test("downloads once, verifies the SHA-256, starts the helper hidden against OUR Dota cfg, and reports it", async () => {
    const m = machine();
    expect(install(m, buildWindowsCompanionInstaller(CFG)).exitCode).toBe(0);
    const release = await fakeRelease(m.root);
    const server = await fakeServer();
    const log = join(m.root, "stub.log");
    try {
      startRuntime(m, server.base, visualEnv(release, log));
      await waitFor(() => (stubStarts(log).length > 0 ? true : null), 60_000);
      const [start] = stubStarts(log);
      expect(start!.cfg).toBe(m.installedCfg);
      const seen = await waitFor(async () => {
        const status = await health(m);
        return status?.visual === "running" ? status : null;
      });
      expect(JSON.stringify(seen)).not.toContain(TOKEN);
      // The same state travels in the heartbeat the site reads ("preparando..." vs "no disponible" is decided there).
      const beat = await waitFor(() => server.received.find((r) => r.path === `/api/live/companion/${LIVE_ID}` && (r.body.companion as { visual?: string } | undefined)?.visual === "running") ?? null);
      expect((beat.body.companion as { schema: string }).schema).toBe("companion-heartbeat/v1");
      expect(existsSync(join(m.home, "visual", "9.9.9", VISUAL_RUNTIME.exeName))).toBe(true);
      // No download or staging leftovers next to the installed version.
      expect(readdirSync(join(m.home, "visual"))).toEqual(["9.9.9"]);
    } finally {
      server.stop();
      release.stop();
    }
  }, 120_000);

  test("a download whose SHA-256 does not match the pin is refused: never extracted, never started", async () => {
    const m = machine();
    expect(install(m, buildWindowsCompanionInstaller(CFG)).exitCode).toBe(0);
    const release = await fakeRelease(m.root, true);
    const server = await fakeServer();
    const log = join(m.root, "stub.log");
    try {
      startRuntime(m, server.base, visualEnv(release, log));
      await waitFor(async () => ((await health(m))?.visual === "failed" ? true : null), 60_000);
      await Bun.sleep(1500);
      expect(stubStarts(log)).toEqual([]);
      expect(existsSync(join(m.home, "visual", "9.9.9"))).toBe(false);
      expect(readdirSync(join(m.home, "visual"))).toEqual([]);
    } finally {
      server.stop();
      release.stop();
    }
  }, 120_000);

  test("a helper that dies is restarted by the Companion", async () => {
    const m = machine();
    expect(install(m, buildWindowsCompanionInstaller(CFG)).exitCode).toBe(0);
    const release = await fakeRelease(m.root);
    const server = await fakeServer();
    const log = join(m.root, "stub.log");
    try {
      startRuntime(m, server.base, visualEnv(release, log, { D2KIRO_STUB_EXIT_MS: "600" }));
      await waitFor(() => (stubStarts(log).length >= 3 ? true : null), 90_000);
      expect(new Set(stubStarts(log).map((start) => start.pid)).size).toBeGreaterThanOrEqual(3);
    } finally {
      server.stop();
      release.stop();
    }
  }, 120_000);

  test("a new Companion start removes the helper an old one left behind, and uninstall removes helper and folder", async () => {
    const m = machine();
    expect(install(m, buildWindowsCompanionInstaller(CFG)).exitCode).toBe(0);
    const release = await fakeRelease(m.root);
    const server = await fakeServer();
    const log = join(m.root, "stub.log");
    try {
      const first = startRuntime(m, server.base, visualEnv(release, log));
      await waitFor(() => (stubStarts(log).length >= 1 ? true : null), 60_000);
      const orphan = stubStarts(log)[0]!.pid;
      first.kill(); // the Companion dies; the helper it started is left running
      await waitFor(async () => ((await health(m)) === null ? true : null));
      expect(alive(orphan)).toBe(true);
      startRuntime(m, server.base, visualEnv(release, log));
      await waitFor(() => (stubStarts(log).length >= 2 ? true : null), 60_000);
      expect(alive(orphan)).toBe(false);
      const current = stubStarts(log)[1]!.pid;
      expect(alive(current)).toBe(true);

      const uninstall = spawnSync("cmd.exe", ["/d", "/s", "/c", `""${join(m.home, "desinstalar-d2kiro-companion.cmd")}""`], { env: testEnv(m, visualEnv(release, log)), windowsVerbatimArguments: true, encoding: "utf8" });
      expect(uninstall.status).toBe(0);
      await waitFor(() => (alive(current) ? null : true));
      expect(existsSync(join(m.home, "visual"))).toBe(false);
    } finally {
      server.stop();
      release.stop();
    }
  }, 150_000);
});

// Opt-in: the REAL production path (public GitHub release, real SHA-256 pin, the real packaged exe). Off by default
// (network + 65 MB); run with D2KIRO_REAL_RELEASE=1 after changing VISUAL_RUNTIME.
describe.skipIf(!onWindows || process.env.D2KIRO_REAL_RELEASE !== "1")("D2KIRO Visual runtime: REAL pinned release (opt-in)", () => {
  test("downloads the production release, verifies the pin, starts the real helper and it waits for Dota", async () => {
    const m = machine();
    expect(install(m, buildWindowsCompanionInstaller(CFG)).exitCode).toBe(0);
    const server = await fakeServer();
    const visualHome = join(m.root, "visual-home");
    try {
      startRuntime(m, server.base, {
        D2KIRO_TEST_NO_VISUAL: "0",
        D2KIRO_TEST_VISUAL_VERSION: VISUAL_RUNTIME.version,
        D2KIRO_TEST_VISUAL_URL: VISUAL_RUNTIME.url,
        D2KIRO_TEST_VISUAL_SHA256: VISUAL_RUNTIME.sha256,
        D2KIRO_VISUAL_HOME: visualHome,
        D2KIRO_VISUAL_DIAGNOSTICS: "1",
      });
      await waitFor(async () => ((await health(m))?.visual === "running" ? true : null), 180_000);
      expect(existsSync(join(m.home, "visual", VISUAL_RUNTIME.version, VISUAL_RUNTIME.exeName))).toBe(true);
      // The real helper started: it logs locally and is waiting for Dota / credentials (no Dota window here).
      const diagnostics = join(visualHome, "diagnostics");
      await waitFor(() => (existsSync(diagnostics) && readdirSync(diagnostics).length > 0 ? true : null), 60_000);
      const text = readdirSync(diagnostics).map((file) => readFileSync(join(diagnostics, file), "utf8")).join("");
      expect(text).toContain('"kind":"start","frozen":true');
      expect(text).not.toContain(TOKEN);
    } finally {
      server.stop();
    }
  }, 300_000);
});
