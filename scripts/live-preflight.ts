#!/usr/bin/env bun
// `bun scripts/live-preflight.ts` -- ¿está esta PC lista para abrir Dota y probar Live? Imprime LISTO o BLOQUEADO.
//
//   (sin flags)   sólo LEE: Dota, cfg de GSI, Companion, puertos, servicios. No cambia nada.
//   --start       arranca motor + web de ESTE worktree (dev:mvp) en 3000/4000 y los deja corriendo (Ctrl+C los detiene).
//   --rehearse    ensayo: arranca motor + web en 3200/4200 con base temporal, comprueba, y los DETIENE. No toca 3000/4000.
//
// Nunca abre Dota, nunca escribe en la carpeta del juego ni en la configuración del Companion, nunca imprime
// un token ni un Steam id. La lógica de decisión está en live-preflight-core.ts (pura, con pruebas).

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sealData } from "iron-session";
import { randomBytes } from "node:crypto";
import { classifyEngineCommand } from "./dev-mvp-config";
import { evaluate, formatReport, type CompanionFact, type GsiCfgFact, type PortFact, type PreflightFacts } from "./live-preflight-core";

const ROOT = resolve(import.meta.dir, "..");
const LOCAL = join(ROOT, ".local");
const PIDFILE = join(LOCAL, "live-preflight.pids.json");
const WEB_PORT = 3000;
const ENGINE_PORT = 4000;
const HTTPS_ORIGIN = "https://localhost:3443";
const READY_TIMEOUT_MS = 240_000;
/** Primera visita a una ruta de Next en frío: compila. Margen holgado para no confundir lentitud con fallo. */
const COLD_ROUTE_TIMEOUT_MS = 180_000;
/** Espera máxima por la primera sincronización del meta en una base nueva (no bloquea: sólo avisa si no llegó). */
const META_WAIT_MS = 300_000;

const args = new Set(process.argv.slice(2));

function sh(command: string, argv: string[]): string {
  const out = spawnSync(command, argv, { encoding: "utf8", windowsHide: true });
  return out.status === 0 ? out.stdout : "";
}

function powershell(script: string): string {
  return sh("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
}

function regValue(key: string, name: string): string | null {
  const match = sh("reg", ["query", key, "/v", name]).match(new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`));
  return match ? match[1].trim().replace(/\//g, "\\") : null;
}

function steamRoot(): string | null {
  return regValue("HKCU\\Software\\Valve\\Steam", "SteamPath");
}

function dotaRoot(): string | null {
  const explicit = process.env.DOTA2_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  const steam = steamRoot();
  if (steam === null) return null;
  const libraries = [steam];
  const vdf = join(steam, "steamapps", "libraryfolders.vdf");
  if (existsSync(vdf)) {
    for (const match of readFileSync(vdf, "utf8").matchAll(/"path"\s+"([^"]+)"/g)) libraries.push(match[1].replace(/\\\\/g, "\\"));
  }
  for (const library of libraries) {
    const candidate = join(library, "steamapps", "common", "dota 2 beta");
    if (existsSync(join(candidate, "game", "dota", "cfg"))) return candidate;
  }
  return null;
}

/** Opciones de lanzamiento de Dota (appid 570) en Steam. null = no se pudo leer. */
function launchOptionHasGsi(): boolean | null {
  const steam = steamRoot();
  if (steam === null) return null;
  const userdata = join(steam, "userdata");
  if (!existsSync(userdata)) return null;
  let readAny = false;
  for (const user of readdirSync(userdata)) {
    const file = join(userdata, user, "config", "localconfig.vdf");
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const block = text.match(/"570"\s*\{[\s\S]{0,4000}?"LaunchOptions"\s+"([^"]*)"/);
    if (block === null) continue;
    readAny = true;
    if (/-gamestateintegration/i.test(block[1])) return true;
  }
  return readAny ? false : null;
}

function gsiCfgFact(root: string | null): GsiCfgFact {
  const empty: GsiCfgFact = { found: false, uri: null, hasTokenShape: false, sections: [] };
  if (root === null) return empty;
  const file = join(root, "game", "dota", "cfg", "gamestate_integration", "gamestate_integration_d2kiro.cfg");
  if (!existsSync(file)) return empty;
  const text = readFileSync(file, "utf8");
  const uri = text.match(/"uri"\s+"([^"]+)"/)?.[1] ?? null;
  const dataBlock = text.match(/"data"\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  const sections = [...dataBlock.matchAll(/"(\w+)"\s+"1"/g)].map((m) => m[1]);
  return { found: true, uri, hasTokenShape: /"token"\s+"[0-9a-f]{64}"/.test(text), sections };
}

async function companionFact(): Promise<CompanionFact> {
  const none: CompanionFact = { configFound: false, schemaOk: false, port: null, siteOrigin: null, healthOk: null };
  const base = process.env.LOCALAPPDATA;
  if (!base) return none;
  const file = join(base, "D2KIRO", "Companion", "config.json");
  if (!existsSync(file)) return none;
  try {
    const json = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const port = typeof json.port === "number" ? json.port : null;
    const siteOrigin = typeof json.siteOrigin === "string" ? json.siteOrigin : null;
    let healthOk = false;
    if (port !== null) healthOk = await ok(`http://127.0.0.1:${port}/health`);
    return { configFound: true, schemaOk: json.schema === "d2kiro-companion-config/v1", port, siteOrigin, healthOk };
  } catch {
    return { ...none, configFound: true };
  }
}

async function ok(url: string, timeoutMs = 4_000): Promise<boolean> {
  try {
    // El proxy local usa un certificado propio (autofirmado): aquí sólo se comprueba alcance, nunca se envían datos.
    const loopbackTls = url.startsWith("https://localhost") ? { tls: { rejectUnauthorized: false } } : {};
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), ...loopbackTls });
    return response.status < 500;
  } catch {
    return false;
  }
}

/** Estado HTTP de una petición (sin seguir redirecciones). null = sin respuesta dentro del plazo. */
async function statusOf(url: string, timeoutMs: number, cookie?: string, method = "GET"): Promise<number | null> {
  try {
    const response = await fetch(url, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: cookie === undefined ? {} : { cookie },
      // Proxy local con certificado propio (autofirmado): sólo se comprueba alcance.
      ...(url.startsWith("https://localhost") ? { tls: { rejectUnauthorized: false } } : {}),
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    return response.status;
  } catch {
    return null;
  }
}

function startedPids(): number[] {
  try {
    return (JSON.parse(readFileSync(PIDFILE, "utf8")) as { pids: number[] }).pids;
  } catch {
    return [];
  }
}

function portFact(port: number): PortFact {
  const raw = powershell(
    `$c = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"; "$($c.OwningProcess)|$($p.CommandLine)" }`,
  ).trim();
  if (raw === "") return { port, owner: null };
  const [pidText, ...rest] = raw.split("|");
  const pid = Number(pidText);
  const commandLine = rest.join("|").replace(/\\/g, "/").toLowerCase();
  const ours = commandLine.includes(ROOT.replace(/\\/g, "/").toLowerCase()) || startedPids().includes(pid) || descendsFrom(pid, startedPids());
  return { port, owner: { pid, ours } };
}

function descendsFrom(pid: number, roots: number[]): boolean {
  if (roots.length === 0) return false;
  const out = powershell(`$id=${pid}; for ($i=0; $i -lt 6 -and $id; $i++) { $id = (Get-CimInstance Win32_Process -Filter "ProcessId=$id").ParentProcessId; if ($id) { $id } }`);
  return out.split(/\s+/).map(Number).some((value) => roots.includes(value));
}

function portCommandLine(port: number): string | null {
  const raw = powershell(
    `$c = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { (Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)").CommandLine }`,
  ).trim();
  return raw === "" ? null : raw;
}

/** true = meta sincronizada y fresca; false = vacía/vieja/sincronizando; null = el motor no responde. */
async function metaReady(enginePort: number): Promise<boolean | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${enginePort}/api/meta/status`, { signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { syncedAt?: unknown; isStale?: unknown; lastSync?: { status?: unknown } };
    return body.syncedAt !== null && body.isStale === false && body.lastSync?.status !== "running";
  } catch {
    return null;
  }
}

async function collect(): Promise<PreflightFacts> {
  const root = dotaRoot();
  const companion = await companionFact();
  const engineCommand = portCommandLine(ENGINE_PORT);
  return {
    worktreeRoot: ROOT,
    bunVersion: process.versions.bun ?? null,
    depsInstalled: {
      root: existsSync(join(ROOT, "node_modules")),
      web: existsSync(join(ROOT, "apps", "web", "node_modules")),
      engine: existsSync(join(ROOT, "apps", "engine", "node_modules")),
    },
    dotaInstallFound: root !== null,
    dotaRunning: /dota2\.exe/i.test(sh("tasklist", ["/FI", "IMAGENAME eq dota2.exe", "/NH"])),
    launchOptionGsi: launchOptionHasGsi(),
    gsiCfg: gsiCfgFact(root),
    companion,
    expectedOrigin: HTTPS_ORIGIN,
    webPort: portFact(WEB_PORT),
    enginePort: portFact(ENGINE_PORT),
    httpsProxyUp: await ok(`${HTTPS_ORIGIN}/healthz`),
    engineHealthy: await ok(`http://127.0.0.1:${ENGINE_PORT}/api/health`),
    webHealthy: await ok(`http://127.0.0.1:${WEB_PORT}/login`),
    engineEntrypoint: engineCommand === null ? null : classifyEngineCommand(engineCommand),
    metaReady: await metaReady(ENGINE_PORT),
  };
}

// ---------- arranque / ensayo ----------

function killTree(pid: number): void {
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
}

const LOCAL_STACK_DIR = join(process.env.USERPROFILE ?? "", "d2kiro-local");

/** Allowlist de beta y secretos de sesión del stack local del dueño (fuera del repo). Se pasan al hijo; nunca se imprimen. */
function localStackEnv(): Record<string, string> {
  const file = join(LOCAL_STACK_DIR, "local-env.ps1");
  if (!existsSync(file)) return {};
  const wanted = new Set(["BETA_ALLOWED_STEAM_IDS", "SESSION_SECRET", "INTERNAL_AUTH_SECRET"]);
  const out: Record<string, string> = {};
  for (const match of readFileSync(file, "utf8").matchAll(/\$env:(\w+)\s*=\s*'([^']*)'/g)) if (wanted.has(match[1])) out[match[1]] = match[2];
  return out;
}

/** Caddy (HTTPS local :3443 -> :3000) con el Caddyfile del dueño. Devuelve su PID, o null si no se pudo/no hacía falta. */
function launchCaddy(): number | null {
  const caddyfile = join(LOCAL_STACK_DIR, "Caddyfile");
  const exe = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Packages", "CaddyServer.Caddy_Microsoft.Winget.Source_8wekyb3d8bbwe", "caddy.exe");
  if (!existsSync(caddyfile) || !existsSync(exe)) return null;
  const child = spawn(exe, ["run", "--config", caddyfile, "--adapter", "caddyfile"], { stdio: "ignore", windowsHide: true });
  return child.pid ?? null;
}

/** Caddy AISLADO para el ensayo: otro puerto (3543 -> 3200), mismo certificado local (sólo lectura). No toca el Caddy del dueño en 3443. */
function launchRehearsalCaddy(httpsPort: number, upstreamPort: number): number | null {
  const exe = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Packages", "CaddyServer.Caddy_Microsoft.Winget.Source_8wekyb3d8bbwe", "caddy.exe");
  const crt = join(LOCAL_STACK_DIR, "tls", "localhost.crt");
  const key = join(LOCAL_STACK_DIR, "tls", "localhost.key");
  if (!existsSync(exe) || !existsSync(crt) || !existsSync(key)) return null;
  const caddyfile = join(LOCAL, "preflight-rehearsal.Caddyfile");
  const lines = [
    "{",
    "\tadmin off",
    "\tauto_https off",
    "}",
    "",
    `https://localhost:${httpsPort} {`,
    "\tbind 127.0.0.1 ::1",
    `\ttls ${crt.split("\\").join("/")} ${key.split("\\").join("/")}`,
    `\treverse_proxy 127.0.0.1:${upstreamPort}`,
    "}",
    "",
  ];
  writeFileSync(caddyfile, lines.join("\n"));
  const child = spawn(exe, ["run", "--config", caddyfile, "--adapter", "caddyfile"], { stdio: "ignore", windowsHide: true });
  return child.pid ?? null;
}

function launchStack(webPort: number, enginePort: number, publicBase: string, dbPath?: string, extraEnv: Record<string, string> = {}): number {
  mkdirSync(LOCAL, { recursive: true });
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...extraEnv,
    WEB_PORT: String(webPort),
    ENGINE_PORT: String(enginePort),
    PUBLIC_BASE_URL: publicBase,
    ...(dbPath ? { ENGINE_DB_PATH: dbPath } : {}),
  };
  const child = spawn("bun", ["scripts/dev-mvp.ts", "--live"], { cwd: ROOT, env, stdio: "ignore", windowsHide: true });
  const pid = child.pid ?? 0;
  writeFileSync(PIDFILE, JSON.stringify({ pids: [pid], startedAt: new Date().toISOString() }));
  return pid;
}

async function waitUp(webPort: number, enginePort: number): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await ok(`http://127.0.0.1:${enginePort}/api/health`)) && (await ok(`http://127.0.0.1:${webPort}/login`))) return true;
    await new Promise((r) => setTimeout(r, 1_500));
  }
  return false;
}

async function rehearse(): Promise<boolean> {
  const webPort = 3200;
  const enginePort = 4200;
  const httpsPort = 3543;
  for (const port of [webPort, enginePort, httpsPort]) {
    if (portFact(port).owner !== null) {
      console.log(`[ensayo] El puerto ${port} ya está ocupado; no se puede ensayar.`);
      return false;
    }
  }
  const db = join(LOCAL, "preflight-rehearsal.sqlite");
  rmSync(db, { force: true });
  console.log(`[ensayo] Arrancando motor :${enginePort} y web :${webPort} (base temporal)...`);
  // Secretos de ensayo: aleatorios, sólo viven en estos procesos. Nunca los del stack del dueño.
  const sessionSecret = randomBytes(32).toString("hex");
  const secrets = { SESSION_SECRET: sessionSecret, INTERNAL_AUTH_SECRET: randomBytes(32).toString("hex") };
  const pid = launchStack(webPort, enginePort, `https://localhost:${httpsPort}`, db, secrets);
  const caddyPid = launchRehearsalCaddy(httpsPort, webPort);
  let pass = false;
  try {
    const up = await waitUp(webPort, enginePort);
    console.log(`[ensayo] Motor y web responden: ${up ? "SÍ" : "NO"}`);
    if (up) {
      const kind = classifyEngineCommand(portCommandLine(enginePort) ?? "");
      console.log(`[ensayo] Motor arrancado es el REAL (index.ts, sin capacidades de prueba): ${kind === "production" ? "SÍ" : `NO (${kind})`}`);
      // Arranque en frío: Next compila cada ruta en su PRIMERA visita (puede pasar de 60 s). Se espera, no se declara error.
      // Con una sesión de ensayo (cookie sellada con el secreto de ensayo, cuenta ficticia) se compila la ruta autenticada de verdad.
      const cookie = await sealData({ accountId: 1, issuedAt: Date.now() - 1_000, firstLoginAt: Date.now() - 1_000 }, { password: sessionSecret, ttl: 3_600 });
      const started = Date.now();
      const liveStatus = await statusOf(`http://127.0.0.1:${webPort}/live-draft`, COLD_ROUTE_TIMEOUT_MS, `d2k_session=${cookie}`);
      const warmSeconds = Math.round((Date.now() - started) / 1_000);
      // Control negativo: SIN sesión la misma ruta debe redirigir a login (si diera 200, el "200 con sesión" no probaría nada).
      const anonymousStatus = await statusOf(`http://127.0.0.1:${webPort}/live-draft`, COLD_ROUTE_TIMEOUT_MS);
      const gated = anonymousStatus !== null && anonymousStatus >= 300 && anonymousStatus < 400;
      const live = liveStatus === 200 && gated;
      // Un enlace GSI inventado debe rechazarse (401/400/404), nunca crear sesión ni devolver 200.
      const probeStatus = await statusOf(`http://127.0.0.1:${webPort}/api/live/gsi/${"A".repeat(43)}`, COLD_ROUTE_TIMEOUT_MS, undefined, "POST");
      const rejected = probeStatus !== null && [400, 401, 404, 409].includes(probeStatus);
      console.log(`[ensayo] /live-draft con sesión de ensayo responde 200 (primera carga en frío ${warmSeconds}s): ${live ? "SÍ" : `NO (con sesión HTTP ${liveStatus ?? "sin respuesta"}; sin sesión HTTP ${anonymousStatus ?? "sin respuesta"})`}; sin sesión redirige a login: ${gated ? "SÍ" : "NO"}`);
      console.log(`[ensayo] Receptor GSI rechaza un enlace inventado (SIMULADO): ${rejected ? `SÍ (HTTP ${probeStatus})` : "NO"}`);
      // Caddy aislado (HTTPS :3543 -> web :3200): el mismo camino que usa el Companion (HTTPS), sin tocar el Caddy del dueño.
      const httpsHealth = caddyPid !== null && (await ok(`https://localhost:${httpsPort}/healthz`, 30_000));
      const httpsLive = caddyPid !== null && (await statusOf(`https://localhost:${httpsPort}/live-draft`, COLD_ROUTE_TIMEOUT_MS, `d2k_session=${cookie}`)) === 200;
      console.log(`[ensayo] Proxy HTTPS aislado (Caddy :${httpsPort}) responde /healthz: ${httpsHealth ? "SÍ" : "NO"}; /live-draft con sesión por HTTPS: ${httpsLive ? "SÍ" : "NO"}`);
      pass = kind === "production" && live && rejected && httpsHealth && httpsLive;
    }
  } finally {
    killTree(pid);
    if (caddyPid !== null) killTree(caddyPid);
    rmSync(PIDFILE, { force: true });
    rmSync(db, { force: true });
    rmSync(join(LOCAL, "preflight-rehearsal.Caddyfile"), { force: true });
    const left = [webPort, enginePort, httpsPort].filter((port) => portFact(port).owner !== null);
    console.log(left.length === 0 ? "[ensayo] Servicios detenidos; puertos liberados." : `[ensayo] ATENCIÓN: siguen ocupados los puertos ${left.join(", ")}.`);
  }
  return pass;
}

async function main(): Promise<void> {
  if (args.has("--rehearse")) {
    const pass = await rehearse();
    console.log(pass ? "\n== ENSAYO DE ARRANQUE: OK ==" : "\n== ENSAYO DE ARRANQUE: FALLÓ ==");
    process.exit(pass ? 0 : 1);
  }
  if (args.has("--start")) {
    if (portFact(WEB_PORT).owner !== null || portFact(ENGINE_PORT).owner !== null) {
      console.log("[start] 3000 o 4000 ya están ocupados por otro proceso; no arranco encima. Corre el preflight sin flags para ver quién.");
      process.exit(1);
    }
    const pid = launchStack(WEB_PORT, ENGINE_PORT, HTTPS_ORIGIN, undefined, localStackEnv());
    const caddyPid = (await ok(`${HTTPS_ORIGIN}/healthz`)) ? null : launchCaddy();
    writeFileSync(PIDFILE, JSON.stringify({ pids: [pid, ...(caddyPid === null ? [] : [caddyPid])], startedAt: new Date().toISOString() }));
    console.log(`[start] Arrancando motor :${ENGINE_PORT} y web :${WEB_PORT} de ESTE worktree (PID ${pid})${caddyPid === null ? "" : ` + Caddy HTTPS :3443 (PID ${caddyPid})`}...`);
    const up = await waitUp(WEB_PORT, ENGINE_PORT);
    console.log(up ? "[start] Servicios arriba. Ctrl+C aquí los detiene." : "[start] No respondieron a tiempo.");
    if (up) {
      // Arranque en frío: se calientan las rutas sin sesión y se espera la primera sincronización del meta (base nueva).
      // La ruta autenticada /live-draft sólo compila con tu sesión: la PRIMERA carga puede tardar hasta ~1-2 min. No recargues.
      await statusOf(`http://127.0.0.1:${WEB_PORT}/login`, COLD_ROUTE_TIMEOUT_MS);
      const metaDeadline = Date.now() + META_WAIT_MS;
      while (Date.now() < metaDeadline && (await metaReady(ENGINE_PORT)) === false) await new Promise((r) => setTimeout(r, 5_000));
      const meta = await metaReady(ENGINE_PORT);
      console.log(meta === true ? "[start] Meta de héroes lista." : "[start] AVISO: el meta sigue sincronizando (o OpenDota no respondió): las recomendaciones saldrán con confianza baja hasta que termine.");
      console.log("[start] Primera carga de /live-draft tras iniciar sesión: puede tardar 1-2 min (compilación en frío). Espera, no recargues.");
    }
    const killAll = () => {
      killTree(pid);
      if (caddyPid !== null) killTree(caddyPid);
      rmSync(PIDFILE, { force: true });
    };
    if (!up) {
      killAll();
      process.exit(1);
    }
    const stop = () => {
      killAll();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  }
  const report = evaluate(await collect());
  for (const line of formatReport(report)) console.log(line);
  if (!args.has("--start")) process.exit(report.verdict === "LISTO" ? 0 : 1);
  setInterval(() => undefined, 1 << 30);
}

await main();
