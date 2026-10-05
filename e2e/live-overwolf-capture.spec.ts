import { ENGINE_DIRECT, engineDirectHeaders } from "./support/wave1";
import { expect, test } from "./support/failure-evidence";
import {
  HERO_SELECTION,
  batchUrl,
  buildBatch,
  capturePresence,
  createCaptureState,
  createCloudEventFactory,
  handleInfoUpdate,
  handleNewEvents,
  heroesUrl,
  pairUrl,
  parseCredentialResponse,
  setDotaRunning,
  setGsiStatus,
} from "../scripts/live/overwolf-capture/capture-core.js";

// Automatic live draft capture, in a real Chromium against the real engine + web (relay included).
// Overwolf itself is replaced by the REAL adapter core (scripts/live/overwolf-capture/capture-core.js) fed with
// synthetic GEP updates, posting exactly what background.js posts: pair (one-time code) -> credential -> batches.
// The Player never types a pick or a ban: the only clicks are "Conectar captura automática" and reading the code.
//
//   pair -> "Captura automática lista" BEFORE queueing -> bans -> 4 initial picks -> the rest -> 10 heroes -> match
//   starts -> the board followed on its own, Party 5 pools stayed active, no identity anywhere in the page.

const RADIANT = [1, 8, 10, 11, 13];
const DIRE = [2, 3, 5, 7, 9];
const BANS = [20, 22, 26];
const SENTINEL = "SENTINEL-IDENTITY-DO-NOT-SHOW";

function gep(info: Record<string, unknown>) {
  return { info };
}

function seat(heroId: number, side: "radiant" | "dire", slot: number) {
  const roles = [1, 4, 2, 8, 16];
  return { steamId: SENTINEL, name: SENTINEL, rank: 80, heroId, team: side === "radiant" ? 2 : 3, team_slot: slot, role: roles[slot], pickConfirmed: true };
}

function roster(radiant: number, dire: number) {
  return JSON.stringify([...RADIANT.slice(0, radiant).map((hero, slot) => seat(hero, "radiant", slot)), ...DIRE.slice(0, dire).map((hero, slot) => seat(hero, "dire", slot))]);
}

test.describe("Automatic live capture (fake Overwolf)", () => {
  test("pair, capture a whole draft with zero manual input, Party 5 pools stay active", async ({ page, request, baseURL }) => {
    // The GSI link is issued the way apps/web does it server side (the cfg download is https-only).
    const issued = await request.post(`${ENGINE_DIRECT}/api/live/gsi-link/issue`, { headers: engineDirectHeaders() });
    expect(issued.status()).toBe(201);
    const link = (await issued.json()) as { liveId: string; token: string; sessionId: string };

    await page.goto("/live-draft");
    const group = await page.evaluate(async () => {
      const response = await fetch("/engine/api/team-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "E2E Overwolf Team",
          partySize: 5,
          members: [[1, [1, 8, 10]], [2, [11, 13, 22]], [3, [2, 7, 28]], [4, [3, 20, 26]], [5, [5, 30, 83]]].map(([slot, heroPool]) => ({ slot, name: `Pos ${slot}`, heroPool })),
        }),
      });
      return response.status;
    });
    expect(group).toBe(201);
    await page.reload();
    await page.getByTestId("live-preset-select").selectOption({ label: "E2E Overwolf Team" });
    await expect(page.getByTestId("live-preset-active")).toBeVisible({ timeout: 30_000 });

    // 1. "Conectar captura automática" -> a one-time code on screen. Nothing else is clicked from here on.
    await expect(page.getByTestId("capture-auto")).toHaveAttribute("data-readiness", "not_paired", { timeout: 60_000 });
    await page.getByTestId("capture-pairing-start").click();
    const code = ((await page.getByTestId("capture-pairing-code").textContent()) ?? "").trim();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);

    // 2. The adapter exchanges the code through the PUBLIC relay (no session cookie): it gets a scoped credential.
    const site = baseURL ?? "http://127.0.0.1:3100";
    const pairResponse = await request.post(pairUrl(site), { data: { code }, headers: { "content-type": "application/json", cookie: "" } });
    expect(pairResponse.status()).toBe(200);
    const credential = parseCredentialResponse(await pairResponse.json(), site);
    expect(credential).not.toBeNull();
    // The code is spent: the same code never pairs twice.
    expect((await request.post(pairUrl(site), { data: { code }, headers: { cookie: "" } })).status()).toBe(401);

    // The fake adapter: the real core, a delivery function that does what background.js does.
    const state = createCaptureState();
    const make = createCloudEventFactory({ runId: "e2e", now: Date.now });
    const catalog = await request.get(heroesUrl(credential!), { headers: { "x-capture-credential": credential!.token, cookie: "" } });
    expect(catalog.status()).toBe(200);
    async function deliver(payloads: unknown[]) {
      const response = await request.post(batchUrl(credential!), {
        data: buildBatch((payloads as { type: string }[]).map((payload) => make(payload)), capturePresence(state)),
        headers: { "content-type": "application/json", "x-capture-credential": credential!.token, cookie: "" },
      });
      expect(response.status()).toBe(200);
    }
    setDotaRunning(state, true);
    await deliver(setGsiStatus(state, true, {}));

    // 3. BEFORE queueing: the page says the automatic capture is ready (Overwolf connected, Dota open, GSI option on).
    await expect(page.getByTestId("capture-auto")).toHaveAttribute("data-readiness", "ready", { timeout: 30_000 });
    await expect(page.getByTestId("capture-auto-readiness")).toHaveText("● Captura automática lista");
    await expect(page.getByTestId("capture-pairing-code-box")).toHaveCount(0);

    // 4. Hero selection begins; Dota's own GSI keeps telling side + own hero (a pick Overwolf will state too).
    await deliver([...handleInfoUpdate(state, gep({ me: { team: "radiant" } }), {}), ...handleNewEvents(state, { events: [{ name: "match_state_changed", data: JSON.stringify({ match_state: HERO_SELECTION }) }] }, {})]);
    const gsi = (heroId: number, gameState: string) =>
      request.post(`${ENGINE_DIRECT}/api/live/gsi/${link.liveId}`, {
        headers: { "content-type": "application/json" },
        data: { provider: { name: "Dota 2" }, map: { game_state: gameState, matchid: "987654321" }, player: { team_name: "radiant", steamid: SENTINEL, name: SENTINEL }, hero: { id: heroId }, draft: {}, auth: { token: link.token } },
      });
    expect((await gsi(RADIANT[0]!, HERO_SELECTION)).status()).toBe(200);

    // 5. Bans, then the 4 initial picks, then the rest -- all by Overwolf, one batch per GEP update.
    await deliver(handleInfoUpdate(state, gep({ roster: { bans: JSON.stringify(BANS.map((heroId, index) => ({ heroId: String(heroId), team: index % 2 === 0 ? 2 : 3 })) ) } }), {}));
    await expect(page.getByTestId("live-capture-source")).toHaveText("Automática · Overwolf · 3 bans capturados · esperando los picks", { timeout: 30_000 });

    const progression: [number, number][] = [[2, 2], [3, 3], [4, 4], [5, 5]];
    const seen: string[] = [];
    for (const [radiant, dire] of progression) {
      await deliver(handleInfoUpdate(state, gep({ roster: { players: roster(radiant, dire) } }), {}));
      await expect(page.getByTestId("live-capture-source")).toContainText(`${radiant + dire}/10 héroes visibles`, { timeout: 30_000 });
      seen.push((await page.getByTestId("live-capture-source").textContent()) ?? "");
      // A repeated full snapshot (Overwolf does this constantly) changes nothing.
      await deliver(handleInfoUpdate(state, gep({ roster: { players: roster(radiant, dire) } }), {}));
      await expect(page.getByTestId("live-capture-source")).toContainText(`${radiant + dire}/10 héroes visibles`);
    }
    expect(seen).toEqual(["Automática · Overwolf · 4/10 héroes visibles", "Automática · Overwolf · 6/10 héroes visibles", "Automática · Overwolf · 8/10 héroes visibles", "Automática · Overwolf · 10/10 héroes visibles"]);

    // GSI repeating its own hero never duplicates it, and cannot override Overwolf.
    expect((await gsi(RADIANT[0]!, HERO_SELECTION)).status()).toBe(200);
    await expect(page.getByTestId("live-capture-source")).toContainText("10/10 héroes visibles");

    // 6. The board followed on its own: no manual interaction ever happened, the fallback stayed closed.
    await expect(page.getByTestId("team-coach-board")).toBeVisible();
    expect(await page.getByTestId("live-manual-entry").evaluate((element) => (element as HTMLDetailsElement).open)).toBe(false);
    await expect(page.getByTestId("live-capture-partial")).toHaveCount(0);
    await expect(page.getByTestId("live-capture-degraded")).toHaveCount(0);
    await expect(page.getByTestId("live-preset-active")).toBeVisible();
    for (const position of [1, 2, 3, 4, 5]) await expect(page.getByTestId(`live-preset-pos-${position}`)).toHaveAttribute("data-active", "true");

    // 7. The match starts (Dota's GSI says so; Overwolf's state moves on too): the draft is over, nothing is lost.
    await deliver(handleNewEvents(state, { events: [{ name: "match_state_changed", data: JSON.stringify({ match_state: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS" }) }] }, {}));
    expect((await gsi(RADIANT[0]!, "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS")).status()).toBe(200);
    await expect(page.getByTestId("team-coach-draft-ended")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("live-team-coach")).not.toContainText(/PICK NOW/i);
    await expect(page.getByTestId("live-capture-status")).toContainText("Draft terminado");
    await expect(page.getByTestId("live-preset-active")).toBeVisible();

    // 8. Diagnostics: presence only, and no identity or credential anywhere in the page.
    await page.getByTestId("live-diagnostics").locator("summary").click();
    await expect(page.getByTestId("diag-overwolf-connected")).toHaveAttribute("data-presence", "YES");
    await expect(page.getByTestId("diag-overwolf-roster")).toHaveAttribute("data-presence", "YES");
    await expect(page.getByTestId("diag-overwolf-bans")).toHaveAttribute("data-presence", "YES");
    await expect(page.getByTestId("diag-overwolf-players")).toHaveAttribute("data-presence", "YES");
    const text = (await page.getByTestId("live-team-coach").textContent()) ?? "";
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain(credential!.token);
    expect(text).not.toContain(credential!.captureId);
    expect(await page.content()).not.toContain(credential!.token);

    // 9. Unpairing kills the credential at once.
    await page.getByTestId("capture-pairing-unpair").click();
    await expect(page.getByTestId("capture-auto")).toHaveAttribute("data-readiness", "not_paired", { timeout: 30_000 });
    const afterRevoke = await request.post(batchUrl(credential!), { data: buildBatch([], capturePresence(state)), headers: { "content-type": "application/json", "x-capture-credential": credential!.token, cookie: "" } });
    expect(afterRevoke.status()).toBe(401);
  });
});
