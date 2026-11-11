import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import type { APIRequestContext, Page } from "@playwright/test";
import { ENGINE_DIRECT, engineDirectHeaders } from "./support/wave1";
import { expect, test } from "./support/failure-evidence";

// Fase 4B · Live Draft Canonical Light, en un Chromium real contra el MOTOR REAL (V6 intacto) y la web real.
// NIVEL DE EVIDENCIA, dicho sin adornos: esto NO es una sesión de Dota real. Dota está REEMPLAZADO por observaciones directas al motor (las mismas
// que enviaría un capturador) y por POSTs GSI con la credencial del enlace. El tablero, el ranking, los estados y la decisión del equipo salen del motor.
// Ningún `page.route` sobre respuestas del motor.
const webRequire = createRequire(resolve(process.cwd(), "apps/web/package.json"));
const AxeBuilder = (webRequire("@axe-core/playwright") as { AxeBuilder?: unknown }).AxeBuilder as typeof import("@axe-core/playwright").AxeBuilder;
const OUT = resolve(process.cwd(), "docs/research/phase-4b");
const CAPTURES = resolve(OUT, "captures");
mkdirSync(CAPTURES, { recursive: true });
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const EVIDENCE_LEVEL = "MOTOR REAL (V6 intacto) + WEB REAL · Dota SIMULADO por observaciones directas y POSTs GSI (no es una sesión de Dota real)";

interface IssuedLink { liveId: string; token: string; sessionId: string }

// Los 16 bans curados del escenario «solo-strong» de 4A.3 (ids de Dota): con ellos el motor real recomienda Leshrac (Pos 2, evidencia STRONG).
const CURATED_BANS = [111, 129, 88, 138, 135, 136, 110, 145, 123, 1, 89, 90, 120, 113, 114, 69];
const LESHRAC = 52;

function save(name: string, data: unknown) {
  writeFileSync(resolve(OUT, name), JSON.stringify(data, null, 2));
}

async function waitImages(page: Page) {
  await page.waitForFunction(() => [...document.querySelectorAll("img")].every((img) => img.complete), undefined, { timeout: 20_000 }).catch(() => undefined);
}

async function issueLink(request: APIRequestContext): Promise<IssuedLink> {
  const issued = await request.post(`${ENGINE_DIRECT}/api/live/gsi-link/issue`, { headers: engineDirectHeaders() });
  expect(issued.status()).toBe(201);
  return (await issued.json()) as IssuedLink;
}

async function observe(page: Page, sessionId: string, body: unknown): Promise<number> {
  return page.evaluate(async ([sid, payload]) => {
    const response = await fetch(`/engine/api/session/protocol/${sid}/live-observation`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    return response.status;
  }, [sessionId, body] as const);
}

async function seedCuratedDraft(page: Page, sessionId: string) {
  expect(await observe(page, sessionId, { type: "draft_started", patch: "" })).toBe(202);
  expect(await observe(page, sessionId, { type: "side", side: "radiant" })).toBe(202);
  for (const heroId of CURATED_BANS) expect(await observe(page, sessionId, { type: "ban", heroId })).toBe(202);
  expect(await observe(page, sessionId, { type: "bans_closed" })).toBe(202);
}

function gsiBody(token: string, gameState: string): string {
  return JSON.stringify({
    provider: { name: "Dota 2", appid: 570 },
    map: { name: "start", matchid: "1234567890", game_state: gameState, clock_time: -30 },
    player: { steamid: "SENTINEL-STEAMID", accountid: "SENTINEL-ACCOUNTID", name: "SENTINEL-NAME", team_name: "radiant" },
    hero: { id: 104 },
    draft: {},
    auth: { token },
  });
}

test.describe.configure({ mode: "serial" });

test.describe("Fase 4B · Live Canonical Light", () => {
  test("Solo · sin declarar → elegir Pos 2 → ELIGE AHORA real → análisis; el clic nunca elige; teclado, axe, reflow y movimiento reducido", async ({ page, request }) => {
    test.setTimeout(240_000);
    const record: Record<string, unknown> = { evidenceLevel: EVIDENCE_LEVEL, scenario: "live-solo-strong" };
    const link = await issueLink(request);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/live-draft");
    await expect(page.getByTestId("live-dota")).toBeVisible({ timeout: 60_000 });
    await seedCuratedDraft(page, link.sessionId);

    // 1. Solo sin posición declarada: no hay columna; hay Pos 1–5 (flujo Live existente: PUT /api/live/human-position).
    const picker = page.getByTestId("live-light-pick-seat");
    await expect(picker).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-testid^="team-coach-column-"]')).toHaveCount(0);
    for (const position of [1, 2, 3, 4, 5]) await expect(page.getByTestId(`live-light-seat-${position}`)).toBeVisible();
    await waitImages(page);
    await page.screenshot({ path: resolve(CAPTURES, "solo-1-sin-declarar.png"), fullPage: true });

    // 2. Declarar Pos 2 → una sola columna, «declarada, sin confirmar» (no hay héroe propio ligado todavía).
    const putStatuses: number[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/api/live/human-position") && response.request().method() === "PUT") putStatuses.push(response.status());
    });
    await page.getByTestId("live-light-seat-2").click();
    await expect(page.getByTestId("team-coach-column-2")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-testid^="team-coach-column-"]')).toHaveCount(1);
    expect(putStatuses).toEqual([200]);
    await expect(page.getByTestId("team-coach-column-2")).toHaveAttribute("data-relation", "mine-unconfirmed");
    await expect(page.getByTestId("sl-party")).toContainText("Solo · Tú: Pos2 Mid (declarada, sin confirmar)");
    await expect(page.getByTestId("live-light-pick-seat")).toHaveCount(0);

    // 3. ELIGE AHORA real del motor V6 (Leshrac, STRONG) sobre la tarjeta recomendada.
    const board = page.getByTestId("team-coach-board");
    const recommended = board.locator('[data-recommended="true"]');
    await expect(recommended).toHaveCount(1, { timeout: 60_000 });
    await expect(recommended).toHaveAttribute("data-hero-id", String(LESHRAC));
    await expect(recommended).toContainText("ELIGE AHORA");
    const engineBoard = await page.evaluate(async (sid) => (await fetch(`/engine/api/session/protocol/${sid}/team-recommendations`)).json(), link.sessionId);
    const humanColumn = (engineBoard.positions as Array<{ position: number; top: Array<{ heroId: number; evidenceStrength?: string }> }>).find((column) => column.position === 2);
    expect(engineBoard.currentDecision.recommendedHeroId).toBe(LESHRAC);
    expect(humanColumn?.top.find((card) => card.heroId === LESHRAC)?.evidenceStrength).toBe("STRONG");
    record.engineDecision = engineBoard.currentDecision;
    record.engineColumnsReturned = (engineBoard.positions as Array<{ position: number }>).map((column) => column.position);
    record.uiColumnsShown = await page.locator('[data-testid^="team-coach-column-"]').count();
    await waitImages(page);
    await page.screenshot({ path: resolve(CAPTURES, "solo-2-elige-ahora.png"), fullPage: true });

    // 4. Clic = analizar: ni un POST al motor ni botón de elegir; Live no tiene timer.
    const writes: string[] = [];
    page.on("request", (req) => {
      if (req.method() !== "GET" && req.url().includes("/engine/")) writes.push(`${req.method()} ${new URL(req.url()).pathname}`);
    });
    await recommended.locator("button").first().click();
    await expect(page.getByTestId("sl-decision")).toBeVisible();
    await expect(page.getByTestId("sl-hero-reasons")).toBeVisible();
    await expect(board).toContainText("El pick lo haces tú dentro de Dota");
    await expect(page.getByRole("button", { name: /^Elegir / })).toHaveCount(0);
    await expect(page.getByTestId("draft-timer")).toHaveCount(0);
    expect(writes, "abrir el análisis no escribe nada en el motor").toEqual([]);
    record.analysisPanel = {
      decisionAttr: await page.getByTestId("sl-decision").getAttribute("data-decision"),
      decisionText: (await page.getByTestId("sl-decision").innerText()).replace(/\s+/g, " ").trim(),
      heroReasonsText: (await page.getByTestId("sl-hero-reasons").innerText()).replace(/\s+/g, " ").trim(),
    };
    await waitImages(page);
    await page.screenshot({ path: resolve(CAPTURES, "solo-3-elige-ahora-y-analisis.png"), fullPage: true });

    // 5. Accesibilidad (axe, WCAG 2.2 AA) sobre la página con el análisis abierto.
    const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).include('[data-testid="team-coach-board"]').analyze();
    record.axeBoard = { violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })), incomplete: axe.incomplete.map((e) => ({ id: e.id, nodes: e.nodes.length })) };
    expect(axe.violations).toEqual([]);

    // 6. Teclado: Enter y Espacio abren/cierran el análisis; Tab pasa a otra tarjeta; el foco es visible.
    const card = board.locator(`[data-card-key="2:${LESHRAC}"] button`);
    await card.focus();
    await page.keyboard.press("Enter");
    await expect(card).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Space");
    await expect(card).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Tab");
    const focusInCard = await page.evaluate(() => document.activeElement?.closest("[data-card-key]")?.getAttribute("data-card-key") ?? null);
    expect(focusInCard, "Tab avanza a la siguiente tarjeta").not.toBeNull();
    expect(focusInCard).not.toBe(`2:${LESHRAC}`);
    record.keyboard = { focusAfterTab: focusInCard };
    expect(writes, "el teclado tampoco escribe en el motor").toEqual([]);

    // 7. Reflow a 200 % y 400 % (viewport 1600 → 800 y 400 px CSS): ningún bloque Light desborda ni genera scroll horizontal propio.
    const reflow: Record<string, unknown> = {};
    for (const [label, width] of [["200", 800], ["400", 400]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(400);
      const metrics = await page.evaluate(() => {
        const limit = document.documentElement.clientWidth;
        const blocks = [...document.querySelectorAll('[data-testid="team-coach-board"], [data-testid="live-light-draft-strip"]')] as HTMLElement[];
        return { limit, blocks: blocks.map((el) => ({ testid: el.getAttribute("data-testid"), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, right: Math.round(el.getBoundingClientRect().right) })) };
      });
      reflow[label] = metrics;
      for (const block of metrics.blocks) {
        expect(block.scrollWidth, `${block.testid} a ${label} %`).toBeLessThanOrEqual(block.clientWidth + 1);
        expect(block.right, `${block.testid} a ${label} %`).toBeLessThanOrEqual(metrics.limit + 1);
      }
      await waitImages(page);
      await board.scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(CAPTURES, `solo-4-reflow-${label}.png`), fullPage: true });
    }
    record.reflow = reflow;
    await page.setViewportSize({ width: 1600, height: 1000 });

    // 8. Movimiento reducido: sin animaciones en curso dentro del tablero tras asentarse.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(page.getByTestId("team-coach-column-2")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("team-coach-board").locator(`[data-card-key="2:${LESHRAC}"] button`).click();
    await page.waitForTimeout(800);
    const running = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="team-coach-board"]');
      return document.getAnimations().filter((animation) => animation.playState === "running" && root !== null && animation.effect instanceof KeyframeEffect && animation.effect.target instanceof Node && root.contains(animation.effect.target)).length;
    });
    record.reducedMotionRunningAnimationsInBoard = running;
    expect(running).toBe(0);
    await waitImages(page);
    await page.screenshot({ path: resolve(CAPTURES, "solo-5-movimiento-reducido.png"), fullPage: true });
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // 9. Reconexión: recargar la página conserva lo que el MOTOR sabe (posición declarada y recomendación), sin volver a pedir posición.
    await page.reload();
    await expect(page.getByTestId("team-coach-column-2")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("live-light-pick-seat")).toHaveCount(0);
    await expect(page.getByTestId("team-coach-board").locator('[data-recommended="true"]')).toHaveAttribute("data-hero-id", String(LESHRAC));
    await waitImages(page);
    await page.screenshot({ path: resolve(CAPTURES, "solo-6-reconexion.png"), fullPage: true });
    save("scenario-live-solo-strong.json", record);
  });

  test("Party 5 · preset aplicado → cinco posiciones, propia / compañeros / prioridad del equipo", async ({ page, request }) => {
    test.setTimeout(240_000);
    const record: Record<string, unknown> = { evidenceLevel: EVIDENCE_LEVEL, scenario: "live-party5" };
    const link = await issueLink(request);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/live-draft");
    await expect(page.getByTestId("live-dota")).toBeVisible({ timeout: 60_000 });
    const group = await page.evaluate(async () => {
      const response = await fetch("/engine/api/team-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "E2E Live Light Party",
          partySize: 5,
          members: [
            { slot: 1, position: 1, name: "Pos 1", heroPool: [1, 8, 10] },
            { slot: 2, position: 2, name: "Pos 2", heroPool: [11, 13, 52] },
            { slot: 3, position: 3, name: "Pos 3", heroPool: [2, 7, 28] },
            { slot: 4, position: 4, name: "Pos 4", heroPool: [3, 20, 26] },
            { slot: 5, position: 5, name: "Pos 5", heroPool: [5, 30, 83] },
          ],
        }),
      });
      return response.status;
    });
    expect(group).toBe(201);
    await page.reload();
    await seedCuratedDraft(page, link.sessionId);

    // Antes del preset: Solo sin declarar (no se supone un equipo).
    await expect(page.getByTestId("live-light-pick-seat")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("live-preset-select").selectOption({ label: "E2E Live Light Party" });
    await expect(page.getByTestId("live-preset-active")).toBeVisible({ timeout: 60_000 });

    // Con el preset aplicado por el motor: cinco posiciones, aun sin declarar la propia.
    await expect(page.locator('[data-testid^="team-coach-column-"]')).toHaveCount(5, { timeout: 60_000 });
    await expect(page.getByTestId("sl-party")).toContainText("Party 5");
    await expect(page.locator('[data-relation="mine"], [data-relation="mine-unconfirmed"]')).toHaveCount(0);
    await page.getByTestId("live-seat-2").click();
    await expect(page.getByTestId("team-coach-column-2")).toHaveAttribute("data-relation", "mine-unconfirmed", { timeout: 60_000 });
    for (const position of [1, 3, 4, 5]) await expect(page.getByTestId(`team-coach-column-${position}`)).toHaveAttribute("data-relation", "party");

    const engineBoard = await page.evaluate(async (sid) => (await fetch(`/engine/api/session/protocol/${sid}/team-recommendations`)).json(), link.sessionId);
    record.engineDecision = engineBoard.currentDecision;
    record.engineColumns = (engineBoard.positions as Array<{ position: number; state: string; top: unknown[] }>).map((column) => ({ position: column.position, state: column.state, cards: column.top.length }));
    const decided = engineBoard.currentDecision as { recommendedPosition: number | null; recommendedHeroId: number | null };
    const board = page.getByTestId("team-coach-board");
    if (decided.recommendedPosition !== null && decided.recommendedHeroId !== null) {
      const highlighted = board.locator('[data-recommended="true"]');
      await expect(highlighted).toHaveCount(1);
      await expect(highlighted).toHaveAttribute("data-hero-id", String(decided.recommendedHeroId));
      // La decisión del equipo es de SU posición: solo si es la mía lleva «ELIGE AHORA»; si no, «Para tu party · Pos N».
      if (decided.recommendedPosition === 2) await expect(highlighted).toContainText("ELIGE AHORA");
      else await expect(highlighted).toContainText(`Para tu party · Pos ${decided.recommendedPosition}`);
      record.highlightedFor = decided.recommendedPosition === 2 ? "propia (ELIGE AHORA)" : `compañero Pos ${decided.recommendedPosition} (Para tu party)`;
    } else {
      await expect(board.locator('[data-recommended="true"]')).toHaveCount(0);
      record.highlightedFor = "ninguna (el motor no recomienda a nadie)";
    }
    const firstCard = board.locator("[data-card-key] button").first();
    await firstCard.click();
    await expect(page.getByTestId("sl-decision").or(page.getByTestId("sl-hero-reasons")).first()).toBeVisible();
    await waitImages(page);
    await page.screenshot({ path: resolve(CAPTURES, "party5-1-cinco-posiciones-y-analisis.png"), fullPage: true });
    const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).include('[data-testid="team-coach-board"]').analyze();
    record.axeBoard = { violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })) };
    expect(axe.violations).toEqual([]);
    await page.setViewportSize({ width: 400, height: 900 });
    await page.waitForTimeout(400);
    const narrow = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="team-coach-board"]') as HTMLElement;
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, right: Math.round(el.getBoundingClientRect().right), limit: document.documentElement.clientWidth };
    });
    record.reflow400 = narrow;
    expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.clientWidth + 1);
    expect(narrow.right).toBeLessThanOrEqual(narrow.limit + 1);
    await waitImages(page);
    await page.screenshot({ path: resolve(CAPTURES, "party5-2-reflow-400.png"), fullPage: true });
    save("scenario-live-party5.json", record);
  });

  test("Captura incompleta: sin tablero, el motor responde 409, nada se recomienda; reconexión y fin de draft", async ({ page, request }) => {
    test.setTimeout(240_000);
    const record: Record<string, unknown> = { evidenceLevel: EVIDENCE_LEVEL, scenario: "live-captura-incompleta" };
    const link = await issueLink(request);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/live-draft");
    await expect(page.getByTestId("live-dota")).toBeVisible({ timeout: 60_000 });
    // Dota solo informa lado y héroe propio (forma real de una partida contra bots): captura parcial honesta.
    const first = await request.post(`${ENGINE_DIRECT}/api/live/gsi/${link.liveId}`, { data: gsiBody(link.token, "DOTA_GAMERULES_STATE_HERO_SELECTION"), headers: { "content-type": "application/json" } });
    expect(first.status()).toBe(200);
    await page.reload();
    await expect(page.getByTestId("live-capture-partial")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("team-coach-board")).toHaveCount(0);
    await expect(page.locator('[data-card-key]')).toHaveCount(0);
    await expect(page.getByTestId("live-team-coach")).not.toContainText(/PICK NOW|ELIGE AHORA|Recomendado ahora/i);
    const incomplete = await page.evaluate(async (sid) => {
      const response = await fetch(`/engine/api/session/protocol/${sid}/team-recommendations`);
      return { status: response.status, body: await response.json().catch(() => null) };
    }, link.sessionId);
    expect(incomplete.status).toBe(409);
    record.engineTeamRecommendations = { status: incomplete.status, body: incomplete.body };
    await waitImages(page);
    await page.screenshot({ path: resolve(CAPTURES, "incompleto-1-captura-parcial-409.png"), fullPage: true });

    // Reconexión: recargar no inventa un tablero; el estado incompleto sigue dicho.
    await page.reload();
    await expect(page.getByTestId("live-capture-partial")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("team-coach-board")).toHaveCount(0);
    await page.screenshot({ path: resolve(CAPTURES, "incompleto-2-reconexion.png"), fullPage: true });

    // Fin del draft: Dota pasa a la partida.
    const ended = await request.post(`${ENGINE_DIRECT}/api/live/gsi/${link.liveId}`, { data: gsiBody(link.token, "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"), headers: { "content-type": "application/json" } });
    expect(ended.status()).toBe(200);
    await expect(page.getByTestId("team-coach-draft-ended")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("live-team-coach")).not.toContainText(/PICK NOW|ELIGE AHORA|Recomendado ahora/i);
    await expect(page.getByRole("button", { name: /^Elegir / })).toHaveCount(0);
    await expect(page.getByTestId("live-capture-status")).toContainText("Draft terminado");
    await page.screenshot({ path: resolve(CAPTURES, "incompleto-3-draft-terminado.png"), fullPage: true });
    save("scenario-live-captura-incompleta.json", record);
  });
});
