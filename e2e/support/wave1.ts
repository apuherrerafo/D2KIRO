import { expect, type Page, type Response } from "@playwright/test";

// Wave 1 acceptance smoke -- shared helpers. Reuses the existing Playwright/E2E harness
// (playwright.config.ts, global-setup.ts, the fixture DB); nothing here is a second framework.

/** Direct engine origin of the E2E harness (playwright.config.ts ENGINE_PORT). Only used for the test-only clock seam. */
export const ENGINE_DIRECT = "http://127.0.0.1:4100";

export interface RecordedResponse {
  url: string;
  method: string;
  status: number;
  path: string;
  body: unknown;
}

export interface Recorder {
  responses: RecordedResponse[];
  /** Every request the browser made to the protocol session API, in order. */
  requests: { method: string; path: string; body: unknown }[];
  sessionId(): string | null;
  /** Session JSON bodies (view/legalActions/simulator snapshots) in arrival order. */
  snapshots(): SnapshotBody[];
}

export interface SnapshotBody {
  view: {
    status: string;
    viewerSide: "radiant" | "dire";
    bannedHeroes: number[];
    ownPicks: { visibility: string; heroId?: number }[];
    enemyPicks: { visibility: string; heroId?: number }[];
    rankedAp: { phase: string } | null;
  };
  legalActions: { type: string; side?: string; slotIndex?: number }[];
  simulator?: { round: number; durationMs: number; penaltyActive: boolean; pendingSeats: number[]; goldPenaltyBySlot: number[] } | null;
  stopReason?: string;
}

const SESSION_API = /\/engine\/api\/session\/protocol(\/|$)/;

/** Records every protocol-session response the page receives (the exact boundary the UI trusts). */
export function record(page: Page): Recorder {
  const responses: RecordedResponse[] = [];
  const requests: Recorder["requests"] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!SESSION_API.test(url.pathname)) return;
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = null;
    }
    requests.push({ method: request.method(), path: url.pathname, body });
  });
  page.on("response", async (response: Response) => {
    const url = new URL(response.url());
    if (!SESSION_API.test(url.pathname)) return;
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    responses.push({ url: response.url(), method: response.request().method(), status: response.status(), path: url.pathname, body });
  });
  return {
    responses,
    requests,
    sessionId() {
      const created = responses.find((entry) => entry.method === "POST" && /\/session\/protocol$/.test(entry.path) && entry.status === 201);
      return (created?.body as { sessionId?: string } | null)?.sessionId ?? null;
    },
    snapshots() {
      return responses.flatMap((entry) => {
        const body = entry.body as { view?: unknown } | null;
        return body && typeof body === "object" && body.view && typeof body.view === "object" ? [body as unknown as SnapshotBody] : [];
      });
    },
  };
}

const FORBIDDEN_KEYS = ["internalPositionAssignments", "positionsByRosterSlot", "pendingSelections", "externalPicks", "eventLog", "authorityResolutions", "sealed"];

/** Player-visible boundary contract: hidden slots carry no hero id, and no Simulator Truth key is ever serialized. */
export function assertNoSimulatorTruthLeak(snapshots: SnapshotBody[], rawBodies: unknown[]): void {
  for (const snapshot of snapshots) {
    for (const slot of snapshot.view.enemyPicks) {
      if (slot.visibility === "HIDDEN") expect(slot).not.toHaveProperty("heroId");
      else expect(slot.visibility).toBe("REVEALED");
    }
    for (const slot of snapshot.view.ownPicks) expect(["KNOWN", "REVEALED"]).toContain(slot.visibility);
  }
  for (const body of rawBodies) {
    const text = JSON.stringify(body ?? null);
    for (const key of FORBIDDEN_KEYS) expect(text).not.toContain(`"${key}"`);
  }
}

/** Player-visible "cannot be selected": the hero is either absent from the pool or its button is disabled. */
export async function expectNotSelectable(page: Page, name: string): Promise<void> {
  await expect
    .poll(async () => {
      const button = heroButton(page, name);
      return (await button.count()) === 0 || (await button.isDisabled());
    }, { message: `${name} must not be selectable` })
    .toBe(true);
}

export function heroButton(page: Page, name: string) {
  return page.locator(`button[title="${name}"]`).first();
}

/** First name of `names` whose grid button exists AND is enabled (i.e. legal for the Player right now). */
export async function firstEnabled(page: Page, names: readonly string[]): Promise<string> {
  for (const name of names) {
    const button = heroButton(page, name);
    if ((await button.count()) > 0 && (await button.isEnabled())) return name;
  }
  throw new Error(`none of [${names.join(", ")}] is selectable`);
}

/**
 * A legal collision is part of a real draft: when the Player's seal matches a hidden enemy pick the hero is banned and the
 * colliding seat(s) reopen ("(N de M sellados)" with N < M, next to the collision notice). This waits for `expected` and,
 * while the UI is instead asking for a re-pick, chooses another hero that is selectable right now (first of `preferred`)
 * through the real grid. Returns how many re-picks it took, so callers can account for the extra commands. It must be
 * called only after every seat of the round has been sealed. Never touches protocol state.
 */
export async function awaitRoundHandlingCollision(page: Page, expected: RegExp, preferred: readonly string[], maxRepicks = 4): Promise<number> {
  const sealedCounter = page.getByText(/\(\d de \d sellados\)/).first();
  const collision = page.getByText(/Baneados por colisión en esta ronda/);
  const settled = page.getByText(expected).first();
  const seatIsReopened = async (): Promise<boolean> => {
    if (!(await collision.first().isVisible()) || !(await sealedCounter.isVisible())) return false;
    const [, sealed, total] = /\((\d) de (\d) sellados\)/.exec(await sealedCounter.innerText()) ?? [];
    return Number(sealed) < Number(total);
  };
  let repicks = 0;
  for (;;) {
    await expect.poll(async () => (await settled.isVisible()) || (await seatIsReopened()), { timeout: 60_000 }).toBe(true);
    if (await settled.isVisible()) return repicks;
    expect(repicks, "a round cannot need an unbounded number of re-picks").toBeLessThan(maxRepicks);
    const before = await sealedCounter.innerText();
    await heroButton(page, await firstEnabled(page, preferred)).click();
    repicks++;
    await expect.poll(async () => (await settled.isVisible()) || (await sealedCounter.innerText().catch(() => "")) !== before, { timeout: 30_000 }).toBe(true);
  }
}

export interface StartOptions {
  side: "Radiant" | "Dire";
  position: string;
  seed: string;
  banNames?: string[];
}

/** The real configuration UI: side, personal position, seed, ban nominations, start. */
export async function configureAndStart(page: Page, options: StartOptions): Promise<void> {
  await page.goto("/simulator");
  const startButton = page.getByRole("button", { name: "Iniciar Draft" });
  await expect(startButton).toBeDisabled({ timeout: 60_000 });
  await page.getByRole("group", { name: "Tu lado" }).getByRole("button", { name: options.side, exact: true }).click();
  await page.getByRole("group", { name: "Tamaño de party" }).getByRole("button", { name: "Party 5" }).click();
  await page.getByRole("group", { name: "Tu posición personal" }).getByRole("button", { name: options.position }).click();
  await page.locator('input[maxlength="8"]').fill(options.seed);
  for (const name of options.banNames ?? []) {
    await page.getByRole("button", { name: "Agregar héroe" }).click();
    await page.getByRole("dialog").locator(`button[title="${name}"]`).click();
  }
  await expect(startButton).toBeEnabled();
  await startButton.click();
}

export const ROUND_HEADING = (round: 1 | 2 | 3, count: number) =>
  new RegExp(`Ronda ${round} -- elegí ${count} ${count === 1 ? "héroe" : "héroes"}`);

export async function heroNamesIn(page: Page, testId: string): Promise<string[]> {
  const rows = page.locator(`[data-testid="${testId}"]`);
  const names: string[] = [];
  for (let i = 0; i < (await rows.count()); i++) names.push(...(await rows.nth(i).locator("span").allInnerTexts()));
  return names.map((name) => name.trim()).filter((name) => name.length > 0);
}

/** Hero names shown in the resolved-bans panel. */
export async function resolvedBanNames(page: Page): Promise<string[]> {
  const panel = page.getByTestId("resolved-bans");
  await expect(panel).toBeVisible();
  const names = await panel.locator("span.text-content-secondary").allInnerTexts();
  return names.map((name) => name.trim()).filter((name) => name.length > 0);
}

/**
 * Locks `names` (first legal option of each list) for the current attempt of a round, in the order
 * given. Waits for the sealed counter between locks; returns the names actually picked.
 */
export async function lockPicks(page: Page, alternatives: readonly (readonly string[])[]): Promise<string[]> {
  const total = alternatives.length;
  const picked: string[] = [];
  for (const [index, options] of alternatives.entries()) {
    const name = await firstEnabled(page, options.filter((candidate) => !picked.includes(candidate)));
    await heroButton(page, name).click();
    picked.push(name);
    if (index < total - 1) await expect(page.getByText(`(${index + 1} de ${total} sellados)`)).toBeVisible();
  }
  return picked;
}
