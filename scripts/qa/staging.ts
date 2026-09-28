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
  status: number | null;
  errorClass: string | null;
}

class SmokeFailure extends Error {
  constructor(readonly context: Pick<FailureContext, "route" | "status" | "errorClass">, message: string) {
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
  for (const hero of heroes.body) {
    if (!isRecord(hero) || !Number.isInteger(hero.id) || banned.has(hero.id)) continue;
    const submitted = await browserRequest(page, `/engine/api/session/protocol/${encodeURIComponent(sessionIdValue)}/command`, {
      method: "POST",
      body: { command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex, heroId: hero.id }, assignedPosition },
    });
    if (submitted.status === 202 && isRecord(submitted.body) && submitted.body.accepted === true) return responseSnapshot(submitted);
    if (submitted.status >= 500) throw new Error(`hero_submit_${submitted.status}`);
  }
  throw new Error("no_accepted_human_pick");
}

async function autoDrive(page: Page, id: string): Promise<Json> {
  const result = await browserRequest(page, `/engine/api/session/protocol/${encodeURIComponent(id)}/auto-drive`, { method: "POST", body: {} });
  if (result.status !== 200) throw new SmokeFailure({ route: `/engine/api/session/protocol/${encodeURIComponent(id)}/auto-drive`, status: result.status, errorClass: result.errorClass }, "auto_drive_failed");
  return responseSnapshot(result);
}

async function resolveBans(page: Page, id: string): Promise<Json> {
  const result = await browserRequest(page, `/engine/api/session/protocol/${encodeURIComponent(id)}/resolve-bans`, { method: "POST", body: { playerBanPreferences: [] } });
  if (result.status !== 200) throw new SmokeFailure({ route: `/engine/api/session/protocol/${encodeURIComponent(id)}/resolve-bans`, status: result.status, errorClass: result.errorClass }, "resolve_bans_failed");
  return responseSnapshot(result);
}

async function createSession(page: Page, positions: readonly (1 | 2 | 3 | 4 | 5)[], seed: string): Promise<string> {
  const created = await browserRequest(page, "/engine/api/session/protocol", { method: "POST", body: makeSessionBody(positions, seed) });
  if (created.status !== 201) throw new SmokeFailure({ route: "/engine/api/session/protocol", status: created.status, errorClass: created.errorClass }, "session_create_failed");
  return sessionId(created);
}

async function assertHealth(page: Page): Promise<void> {
  const health = await browserRequest(page, "/healthz");
  required(health.status === 200 && isRecord(health.body), "healthz_failed");
  required(health.body.ok === true && health.body.next === "ok" && health.body.engine === "ok", "health_or_engine_not_ok");
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

async function authBootstrap(): Promise<number> {
  mkdirSync(resolve(".qa-auth"), { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${STAGING_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(async () => {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      if (!response.ok) return false;
      const body: unknown = await response.json();
      return typeof body === "object" && body !== null && Number.isInteger((body as { accountId?: unknown }).accountId);
    }, undefined, { timeout: 10 * 60_000 });
    await context.storageState({ path: AUTH_STATE_PATH });
    try { chmodSync(AUTH_STATE_PATH, 0o600); } catch { /* Windows ACLs are managed outside POSIX mode bits. */ }
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
  let failure: FailureContext = { scenario: "bootstrap", route: "/", status: null, errorClass: null };
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("requestfailed", (request) => networkFailures.push(`${request.method()} ${new URL(request.url()).pathname}`));
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const artifactDir = resolve(ARTIFACT_ROOT, timestamp());
  try {
    await page.goto(`${STAGING_URL}/simulator`, { waitUntil: "domcontentloaded" });
    required(await authenticated(page), "authenticated_session_missing");
    failure = { scenario: "SMOKE-01 HEALTH", route: "/healthz", status: null, errorClass: null };
    await assertHealth(page);
    failure = { scenario: "SMOKE-02/03/04/05 SOLO POS2", route: "/engine/api/session/protocol", status: null, errorClass: null };
    const solo = await soloPos2(page);
    failure = { scenario: "SMOKE-07 BASIC PROGRESSION", route: "/engine/api/session/protocol/:id/auto-drive", status: null, errorClass: null };
    await progress(page, solo);
    failure = { scenario: "SMOKE-06 PARTY2", route: "/engine/api/session/protocol", status: null, errorClass: null };
    await party2(page);
    await context.tracing.stop();
    return "STAGING_SMOKE_PASS";
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "unknown_failure";
    if (caught instanceof SmokeFailure) failure = { ...failure, ...caught.context };
    else failure.errorClass = message;
    mkdirSync(artifactDir, { recursive: true });
    await page.screenshot({ path: resolve(artifactDir, "failure.png"), fullPage: true }).catch(() => undefined);
    await context.tracing.stop({ path: resolve(artifactDir, "trace.zip") }).catch(() => undefined);
    saveFailure(artifactDir, failure, consoleErrors, networkFailures, {
      stagingUrl: STAGING_URL,
      sha: STAGING_SHA,
      deployment: STAGING_DEPLOYMENT,
      unexpected5xx: failure.status !== null && failure.status >= 500 ? 1 : 0,
    });
    return "STAGING_SMOKE_FAIL";
  } finally {
    await browser.close();
  }
}

const command = process.argv[2];
if (command === "auth") {
  process.exitCode = await authBootstrap();
} else if (command === "smoke") {
  console.log(await stagingSmoke());
} else {
  throw new Error("usage: bun scripts/qa/staging.ts <auth|smoke>");
}
