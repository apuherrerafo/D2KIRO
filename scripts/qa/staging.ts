import { chmodSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

const STAGING_URL = "https://d2kiro-5r4j-staging.up.railway.app";
const STAGING_SHA = process.env.STAGING_SHA ?? "9475cbd9c210ebcaf01e639e44bb03918cb11bc7";
const STAGING_DEPLOYMENT = process.env.STAGING_DEPLOYMENT ?? "fdfac57d-1de4-4502-a1cf-9ee3dbf90146";
const AUTH_STATE_PATH = resolve(".qa-auth/staging-storage-state.json");
const ARTIFACT_ROOT = resolve("artifacts/qa/staging");

type Result = "STAGING_SMOKE_PASS" | "STAGING_SMOKE_FAIL" | "AUTH_STATE_REQUIRED";
type Json = Record<string, unknown>;

interface HttpResult {
  status: number;
  body: unknown;
  errorClass: string | null;
}

interface FailureContext {
  scenario: string;
  route: string;
  method: string | null;
  status: number | null;
  expectedStatus: number | null;
  errorClass: string | null;
}

class SmokeFailure extends Error {
  constructor(
    readonly context: Pick<FailureContext, "route" | "method" | "status" | "expectedStatus" | "errorClass">,
    message: string,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function required(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function errorClass(body: unknown): string | null {
  if (!isRecord(body)) return null;
  return typeof body.error === "string" ? body.error : null;
}

async function browserRequest(page: Page, route: string, init?: { method?: string; body?: unknown }): Promise<HttpResult> {
  return page.evaluate(async ({ route, init }) => {
    const response = await fetch(route, {
      method: init?.method,
      headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      credentials: "same-origin",
    });
    const text = await response.text();
    let body: unknown = null;
    try { body = text.length === 0 ? null : JSON.parse(text); } catch { body = null; }
    return {
      status: response.status,
      body,
      errorClass: typeof body === "object" && body !== null && !Array.isArray(body) && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : null,
    };
  }, { route, init });
}

async function authenticated(page: Page): Promise<boolean> {
  const session = await browserRequest(page, "/api/auth/session");
  return session.status === 200 && isRecord(session.body) && Number.isInteger(session.body.accountId);
}

function makeSessionBody(controlledPositions: readonly (1 | 2 | 3 | 4 | 5)[], seed: string): Json {
  return {
    rulesetId: "dota2/ranked-all-pick",
    patch: "7.41e",
    localSide: "radiant",
    adapterKind: "simulator",
    partyContext: { partySize: controlledPositions.length, side: "radiant", controlledSlots: [] },
    controlledPositions,
    humanPosition: controlledPositions[0],
    simulatorSeed: seed,
  };
}

function sessionId(result: HttpResult): string {
  required(isRecord(result.body) && typeof result.body.sessionId === "string" && result.body.sessionId.length > 0, "session_create_missing_id");
  return result.body.sessionId;
}

function responseSnapshot(result: HttpResult): Json {
  required(isRecord(result.body) && isRecord(result.body.view) && Array.isArray(result.body.legalActions), "protocol_snapshot_invalid");
  return result.body;
}

function firstOpenOwnSlot(snapshot: Json): number {
  const action = (snapshot.legalActions as unknown[]).find((entry) => isRecord(entry)
    && entry.type === "SUBMIT_SEALED_SELECTION" && entry.side === "radiant" && Number.isInteger(entry.slotIndex));
  required(isRecord(action) && Number.isInteger(action.slotIndex), "human_action_not_available");
  return action.slotIndex;
}

function assignedPositions(snapshot: Json): number[] {
  if (!Array.isArray(snapshot.ownAssignedPositions)) return [];
  return snapshot.ownAssignedPositions.flatMap((entry) => isRecord(entry) && Number.isInteger(entry.assignedPosition) ? [entry.assignedPosition] : []);
}

async function chooseHero(page: Page, sessionIdValue: string, assignedPosition: 1 | 2 | 3 | 4 | 5): Promise<Json> {
  const heroes = await browserRequest(page, "/engine/api/heroes");
  required(heroes.status === 200 && Array.isArray(heroes.body), "hero_catalog_unavailable");
  const before = await browserRequest(page, `/engine/api/session/protocol/${encodeURIComponent(sessionIdValue)}`);
  required(before.status === 200, "protocol_snapshot_unavailable");
  const slotIndex = firstOpenOwnSlot(responseSnapshot(before));
  const banned = new Set(isRecord(before.body) && isRecord(before.body.view) && Array.isArray(before.body.view.bannedHeroes) ? before.body.view.bannedHeroes : []);
  const route = `/engine/api/session/protocol/${encodeURIComponent(sessionIdValue)}/command`;
  // Se recuerda el último intento para que, si ningún héroe es aceptado, el reporte de fallo
  // apunte al endpoint y status reales (p.ej. 409 repetido) en vez del escenario exterior stale.
  let lastAttempt: HttpResult | null = null;
  for (const hero of heroes.body) {
    if (!isRecord(hero) || !Number.isInteger(hero.id) || banned.has(hero.id)) continue;
    const submitted = await browserRequest(page, route, {
      method: "POST",
      body: { command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex, heroId: hero.id }, assignedPosition },
    });
    lastAttempt = submitted;
    if (submitted.status === 202 && isRecord(submitted.body) && submitted.body.accepted === true) return responseSnapshot(submitted);
    if (submitted.status >= 500) {
      throw new SmokeFailure(
        { route, method: "POST", status: submitted.status, expectedStatus: 202, errorClass: submitted.errorClass },
        `hero_submit_${submitted.status}`,
      );
    }
  }
  throw new SmokeFailure(
    { route, method: "POST", status: lastAttempt?.status ?? null, expectedStatus: 202, errorClass: lastAttempt?.errorClass ?? null },
    "no_accepted_human_pick",
  );
}

async function autoDrive(page: Page, id: string): Promise<Json> {
  const route = `/engine/api/session/protocol/${encodeURIComponent(id)}/auto-drive`;
  const result = await browserRequest(page, route, { method: "POST", body: {} });
  if (result.status !== 200) throw new SmokeFailure({ route, method: "POST", status: result.status, expectedStatus: 200, errorClass: result.errorClass }, "auto_drive_failed");
  return responseSnapshot(result);
}

async function resolveBans(page: Page, id: string): Promise<Json> {
  const route = `/engine/api/session/protocol/${encodeURIComponent(id)}/resolve-bans`;
  const result = await browserRequest(page, route, { method: "POST", body: { playerBanPreferences: [] } });
  if (result.status !== 200) throw new SmokeFailure({ route, method: "POST", status: result.status, expectedStatus: 200, errorClass: result.errorClass }, "resolve_bans_failed");
  return responseSnapshot(result);
}

async function createSession(page: Page, positions: readonly (1 | 2 | 3 | 4 | 5)[], seed: string): Promise<string> {
  const route = "/engine/api/session/protocol";
  const created = await browserRequest(page, route, { method: "POST", body: makeSessionBody(positions, seed) });
  if (created.status !== 201) throw new SmokeFailure({ route, method: "POST", status: created.status, expectedStatus: 201, errorClass: created.errorClass }, "session_create_failed");
  return sessionId(created);
}

async function assertHealth(page: Page): Promise<void> {
  const route = "/healthz";
  const health = await browserRequest(page, route);
  if (health.status !== 200 || !isRecord(health.body)) {
    throw new SmokeFailure({ route, method: "GET", status: health.status, expectedStatus: 200, errorClass: health.errorClass }, "healthz_failed");
  }
  if (health.body.ok !== true || health.body.next !== "ok" || health.body.engine !== "ok") {
    throw new SmokeFailure({ route, method: "GET", status: health.status, expectedStatus: 200, errorClass: "health_or_engine_not_ok" }, "health_or_engine_not_ok");
  }
}

async function soloPos2(page: Page): Promise<string> {
  const id = await createSession(page, [2], "STAGINGSMOKESOL2");
  await resolveBans(page, id);
  await autoDrive(page, id);
  const picked = await chooseHero(page, id, 2);
  required(assignedPositions(picked).includes(2), "solo_pos2_not_assigned");
  const driven = await autoDrive(page, id);
  required(isRecord(driven.view) && typeof driven.view.status === "string", "auto_drive_stalled");
  const recommendations = await browserRequest(page, `/engine/api/session/protocol/${encodeURIComponent(id)}/recommendations`);
  required(recommendations.status === 200 && isRecord(recommendations.body), `recommendations_${recommendations.status}`);
  return id;
}

async function party2(page: Page): Promise<void> {
  const id = await createSession(page, [2, 5], "STAGINGSMOKEP25");
  await resolveBans(page, id);
  await autoDrive(page, id);
  const first = await chooseHero(page, id, 2);
  required(assignedPositions(first).includes(2) && !assignedPositions(first).includes(5), "party2_bot_stole_controlled_position");
  const afterDrive = await autoDrive(page, id);
  required(assignedPositions(afterDrive).includes(2) && !assignedPositions(afterDrive).includes(5), "party2_pos5_stolen_after_drive");
  const second = await chooseHero(page, id, 5);
  required(assignedPositions(second).includes(2) && assignedPositions(second).includes(5), "party2_controlled_positions_not_bound");
  const progressed = await autoDrive(page, id);
  required(isRecord(progressed.view) && typeof progressed.view.status === "string", "party2_progression_stalled");
}

async function progress(page: Page, id: string): Promise<void> {
  let lastIdentity = "";
  for (let transition = 0; transition < 5; transition += 1) {
    const current = await browserRequest(page, `/engine/api/session/protocol/${encodeURIComponent(id)}`);
    required(current.status === 200, `progression_snapshot_${current.status}`);
    const snapshot = responseSnapshot(current);
    const identity = JSON.stringify({ status: isRecord(snapshot.view) ? snapshot.view.status : null, bans: isRecord(snapshot.view) ? snapshot.view.bannedHeroes : null, own: isRecord(snapshot.view) ? snapshot.view.ownPicks : null });
    if (identity === lastIdentity) throw new Error("progression_freeze");
    lastIdentity = identity;
    if (isRecord(snapshot.view) && snapshot.view.status === "COMPLETE") return;
    const actions = snapshot.legalActions as unknown[];
    const hasOwnPick = actions.some((entry) => isRecord(entry) && entry.type === "SUBMIT_SEALED_SELECTION" && entry.side === "radiant");
    if (hasOwnPick) await chooseHero(page, id, 2);
    await autoDrive(page, id);
  }
  const finalSnapshot = await browserRequest(page, `/engine/api/session/protocol/${encodeURIComponent(id)}`);
  required(finalSnapshot.status === 200, "progression_final_snapshot_failed");
}

function saveFailure(dir: string, failure: FailureContext, consoleErrors: string[], networkFailures: string[], metadata: Json): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "failure.json"), `${JSON.stringify({ ...failure, consoleErrors, networkFailures, ...metadata }, null, 2)}\n`);
}

export function formatScenarioProgress(scenario: string, passed: boolean): string {
  return `${scenario}: ${passed ? "PASS" : "FAIL"}`;
}

// El id de sesión de draft no es un secreto (no es cookie/token de cuenta), pero igual se trunca
// antes de imprimirlo a terminal — mismo criterio de cautela que el resto del harness.
export function redactSessionId(id: string): string {
  if (id.length <= 8) return "***";
  return `${id.slice(0, 8)}...redacted`;
}

export interface SmokeFailureReport {
  scenario: string;
  route: string;
  method: string | null;
  status: number | null;
  expectedStatus: number | null;
  errorClass: string | null;
  errorMessage: string;
  lastGoodState: string;
  unexpected5xx: number;
  artifactDir: string;
  sessionId: string | null;
}

export function formatFailureReport(report: SmokeFailureReport): string {
  const lines = [
    "STAGING_SMOKE_FAIL",
    "",
    "FAILED_SCENARIO:",
    report.scenario,
    "",
    "FAILED_ROUTE:",
    report.route,
    "",
    "HTTP_METHOD:",
    report.method ?? "N/A",
    "",
    "HTTP_STATUS:",
    report.status === null ? "N/A" : String(report.status),
    "",
    "FAILURE_CLASS:",
    report.errorClass ?? "unknown",
    "",
    "LAST_GOOD_STATE:",
    report.lastGoodState,
    "",
    "FIRST_BAD_STATE:",
    report.scenario,
    "",
    "ERROR_MESSAGE:",
    report.errorMessage,
    "",
    "UNEXPECTED_5XX:",
    String(report.unexpected5xx),
    "",
    "ARTIFACT_DIR:",
    report.artifactDir,
  ];
  if (report.sessionId !== null) {
    lines.push("", "SESSION_ID:", redactSessionId(report.sessionId));
  }
  if (report.expectedStatus !== null) {
    lines.push(
      "",
      "EXPECTED_STATUS:",
      String(report.expectedStatus),
      "ACTUAL_STATUS:",
      report.status === null ? "N/A" : String(report.status),
    );
  }
  return lines.join("\n");
}

const AUTH_BOOTSTRAP_TIMEOUT_MS = 5 * 60_000;
const AUTH_BOOTSTRAP_POLL_INTERVAL_MS = 1_500;

export interface AuthPoller {
  check(): Promise<boolean>;
  wait(ms: number): Promise<void>;
}

function contextAuthPoller(context: BrowserContext): AuthPoller {
  return {
    async check() {
      const response = await context.request.get(`${STAGING_URL}/api/auth/session`, { failOnStatusCode: false });
      if (!response.ok()) return false;
      const body: unknown = await response.json().catch(() => null);
      return isRecord(body) && Number.isInteger(body.accountId);
    },
    wait(ms) {
      return new Promise((resolveWait) => setTimeout(resolveWait, ms));
    },
  };
}

export async function pollUntilAuthenticated(poller: AuthPoller, timeoutMs: number, intervalMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await poller.check()) return true;
    } catch {
      // Transient errors (e.g. mid-navigation through the Steam redirect chain) — keep polling.
    }
    await poller.wait(intervalMs);
  }
  return false;
}

async function authBootstrap(): Promise<number> {
  mkdirSync(resolve(".qa-auth"), { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    // Polling runs against context.request (Node-side, shares the context's cookie jar) rather
    // than an in-page fetch: clicking "Entrar con Steam" navigates the page through Steam's
    // OpenID redirect chain, which destroys any in-page JS execution context mid-poll and was
    // closing the browser before the user could finish logging in.
    await page.goto(`${STAGING_URL}/login`, { waitUntil: "domcontentloaded" });
    const authenticatedInTime = await pollUntilAuthenticated(
      contextAuthPoller(context),
      AUTH_BOOTSTRAP_TIMEOUT_MS,
      AUTH_BOOTSTRAP_POLL_INTERVAL_MS,
    );
    if (!authenticatedInTime) {
      console.error("AUTH_BOOTSTRAP_TIMEOUT");
      return 1;
    }
    await context.storageState({ path: AUTH_STATE_PATH });
    try { chmodSync(AUTH_STATE_PATH, 0o600); } catch { /* Windows ACLs are managed outside POSIX mode bits. */ }
    if (!existsSync(AUTH_STATE_PATH) || statSync(AUTH_STATE_PATH).size === 0) {
      console.error("AUTH_BOOTSTRAP_EMPTY_STATE");
      return 1;
    }
    return 0;
  } finally {
    await browser.close();
  }
}

async function stagingSmoke(): Promise<Result> {
  if (!existsSync(AUTH_STATE_PATH) || statSync(AUTH_STATE_PATH).size === 0) return "AUTH_STATE_REQUIRED";
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const networkFailures: string[] = [];
  let failure: FailureContext = { scenario: "bootstrap", route: "/", method: "GET", status: null, expectedStatus: null, errorClass: null };
  let lastGoodState = "NONE";
  let lastSessionId: string | null = null;
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("requestfailed", (request) => networkFailures.push(`${request.method()} ${new URL(request.url()).pathname}`));
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const artifactDir = resolve(ARTIFACT_ROOT, timestamp());
  try {
    await page.goto(`${STAGING_URL}/simulator`, { waitUntil: "domcontentloaded" });
    required(await authenticated(page), "authenticated_session_missing");
    lastGoodState = "AUTHENTICATED";
    failure = { scenario: "SMOKE-01 HEALTH", route: "/healthz", method: "GET", status: null, expectedStatus: 200, errorClass: null };
    await assertHealth(page);
    console.log(formatScenarioProgress(failure.scenario, true));
    lastGoodState = failure.scenario;
    failure = { scenario: "SMOKE-02/03/04/05 SOLO POS2", route: "/engine/api/session/protocol", method: "POST", status: null, expectedStatus: 201, errorClass: null };
    const solo = await soloPos2(page);
    lastSessionId = solo;
    console.log(formatScenarioProgress(failure.scenario, true));
    lastGoodState = failure.scenario;
    failure = { scenario: "SMOKE-07 BASIC PROGRESSION", route: "/engine/api/session/protocol/:id/auto-drive", method: "POST", status: null, expectedStatus: 200, errorClass: null };
    await progress(page, solo);
    console.log(formatScenarioProgress(failure.scenario, true));
    lastGoodState = failure.scenario;
    failure = { scenario: "SMOKE-06 PARTY2", route: "/engine/api/session/protocol", method: "POST", status: null, expectedStatus: 201, errorClass: null };
    await party2(page);
    console.log(formatScenarioProgress(failure.scenario, true));
    await context.tracing.stop();
    return "STAGING_SMOKE_PASS";
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "unknown_failure";
    if (caught instanceof SmokeFailure) failure = { ...failure, ...caught.context };
    else failure.errorClass = message;
    console.log(formatScenarioProgress(failure.scenario, false));
    mkdirSync(artifactDir, { recursive: true });
    await page.screenshot({ path: resolve(artifactDir, "failure.png"), fullPage: true }).catch(() => undefined);
    await context.tracing.stop({ path: resolve(artifactDir, "trace.zip") }).catch(() => undefined);
    const unexpected5xx = failure.status !== null && failure.status >= 500 ? 1 : 0;
    saveFailure(artifactDir, failure, consoleErrors, networkFailures, {
      stagingUrl: STAGING_URL,
      sha: STAGING_SHA,
      deployment: STAGING_DEPLOYMENT,
      unexpected5xx,
    });
    console.log(formatFailureReport({
      scenario: failure.scenario,
      route: failure.route,
      method: failure.method,
      status: failure.status,
      expectedStatus: failure.expectedStatus,
      errorClass: failure.errorClass,
      errorMessage: message,
      lastGoodState,
      unexpected5xx,
      artifactDir,
      sessionId: lastSessionId,
    }));
    return "STAGING_SMOKE_FAIL";
  } finally {
    await browser.close();
  }
}

if (import.meta.main) {
  const command = process.argv[2];
  if (command === "auth") {
    process.exitCode = await authBootstrap();
  } else if (command === "smoke") {
    const result = await stagingSmoke();
    // El bloque de diagnóstico de un fallo ya arranca con "STAGING_SMOKE_FAIL" (impreso dentro de
    // stagingSmoke) — evita duplicar esa línea suelta al final.
    if (result !== "STAGING_SMOKE_FAIL") console.log(result);
  } else {
    throw new Error("usage: bun scripts/qa/staging.ts <auth|smoke>");
  }
}
