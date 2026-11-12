import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import type { APIRequestContext, Page } from "@playwright/test";
import { ENGINE_DIRECT, engineDirectHeaders } from "./support/wave1";
import { expect, test } from "./support/failure-evidence";

// Fase 4B.2 · experiencia COMPLETA de /live-draft en Canonical Light a 1600x900. MOTOR REAL (V6 intacto) + WEB REAL.
// EVIDENCIA DE PRUEBA: Dota está SIMULADO por observaciones directas al motor y POSTs GSI con la credencial del enlace.
// Nada de esto es una sesión auténtica de un cliente Dota. Mide posiciones (px) de los bloques y saca capturas del VIEWPORT.
const webRequire = createRequire(resolve(process.cwd(), "apps/web/package.json"));
const AxeBuilder = (webRequire("@axe-core/playwright") as { AxeBuilder?: unknown }).AxeBuilder as typeof import("@axe-core/playwright").AxeBuilder;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const LABEL = process.env.CL_LABEL ?? "after";
const OUT = resolve(process.cwd(), "docs/research/phase-4b2", LABEL);
mkdirSync(OUT, { recursive: true });
const VIEW = { width: 1600, height: 900 };
const CURATED_BANS = [111, 129, 88, 138, 135, 136, 110, 145, 123, 1, 89, 90, 120, 113, 114, 69];
const LESHRAC = 52;
const BLOCKS = ["app-nav", "live-light-draft-strip", "live-capture-status", "live-seat", "live-light-pick-seat", "live-party-preset", "live-controls", "dota-link-controls", "companion-install", "live-diagnostics", "live-light-draft-strip", "team-coach-board", "sl-decision"];

interface IssuedLink { liveId: string; token: string; sessionId: string }
const results: Record<string, unknown> = { label: LABEL, viewport: VIEW, evidence: "PRUEBA: motor real + web real, Dota SIMULADO (GSI/observaciones de prueba), no es sesión auténtica de Dota" };

async function waitImages(page: Page) {
  await page.waitForFunction(() => [...document.querySelectorAll("img")].every((img) => img.complete), undefined, { timeout: 20_000 }).catch(() => undefined);
}
async function issueLink(request: APIRequestContext): Promise<IssuedLink> {
  const issued = await request.post(`${ENGINE_DIRECT}/api/live/gsi-link/issue`, { headers: engineDirectHeaders() });
  expect(issued.status()).toBe(201);
  return (await issued.json()) as IssuedLink;
}
// Latido SIMULADO del Companion (el mismo POST que haría el Companion real): con él la conexión queda en estado "conectado", como en una sesión normal.
async function beat(request: APIRequestContext, link: IssuedLink) {
  const response = await request.post(`${ENGINE_DIRECT}/api/live/companion/${link.liveId}`, { headers: { "content-type": "application/json" }, data: { auth: { token: link.token }, companion: { schema: "companion-heartbeat/v1", version: "1.0.0", dota: "connected", phase: "HERO_SELECTION", restartNeeded: false } } });
  expect(response.status()).toBe(200);
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
  return JSON.stringify({ provider: { name: "Dota 2", appid: 570 }, map: { name: "start", matchid: "1234567890", game_state: gameState, clock_time: -30 }, player: { steamid: "SENTINEL-STEAMID", accountid: "SENTINEL-ACCOUNTID", name: "SENTINEL-NAME", team_name: "radiant" }, hero: { id: 104 }, draft: {}, auth: { token } });
}

async function shoot(page: Page, name: string, request: APIRequestContext, link: IssuedLink) {
  await beat(request, link);
  await page.waitForTimeout(3000);
  await waitImages(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const metrics = await page.evaluate(({ blocks, h }) => {
    const out: Record<string, { top: number; bottom: number; inFirstScreen: boolean } | null> = {};
    for (const id of blocks) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) { out[id] = null; continue; }
      const b = el.getBoundingClientRect();
      out[id] = { top: Math.round(b.top), bottom: Math.round(b.bottom), inFirstScreen: b.bottom <= h };
    }
    const rec = document.querySelector('[data-recommended="true"]');
    if (rec) { const b = rec.getBoundingClientRect(); out["recommended-card"] = { top: Math.round(b.top), bottom: Math.round(b.bottom), inFirstScreen: b.bottom <= h }; }
    const firstCard = document.querySelector("[data-card-key]");
    if (firstCard) { const b = firstCard.getBoundingClientRect(); out["first-card"] = { top: Math.round(b.top), bottom: Math.round(b.bottom), inFirstScreen: b.top < h }; }
    return { blocks: out, pageHeight: document.documentElement.scrollHeight, scrollsPage: document.documentElement.scrollHeight > h };
  }, { blocks: BLOCKS, h: VIEW.height });
  results[name] = metrics;
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: false });
  await page.screenshot({ path: resolve(OUT, `${name}-pagina-completa.png`), fullPage: true });
}

test.describe.configure({ mode: "serial" });
test.afterAll(() => { writeFileSync(resolve(OUT, "medidas.json"), JSON.stringify(results, null, 2)); });

test.describe(`4B.2 Canonical Light completo (${LABEL})`, () => {
  test("Sin enlace: Dota desconectado, instalación abierta, y la navegación es la misma en todas las rutas", async ({ page, request }) => {
    test.setTimeout(240_000);
    // Precondición EXPLÍCITA: "sin enlace" es un estado de la cuenta, y la cuenta del E2E es una sola. Otra spec (live-canonical-4b2-cert) deja un enlace con
    // latido vivo y, corriendo antes, esta prueba veía "conectado" y fallaba solo en la corrida completa (pasaba aislada). Se revoca por la ruta real.
    const revoked = await request.delete(`${ENGINE_DIRECT}/api/live/gsi-link`, { headers: engineDirectHeaders() });
    expect(revoked.status()).toBe(200);
    await page.setViewportSize(VIEW);
    await page.goto("/live-draft");
    await expect(page.getByTestId("dota-connect")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("app-nav")).toHaveCount(1);
    await page.screenshot({ path: resolve(OUT, "sin-enlace-1-desconectado.png"), fullPage: false });
    await page.getByTestId("dota-connect-button").click();
    await expect(page.getByTestId("companion-installer-download")).toBeVisible();
    await page.getByTestId("advanced-connection").locator("summary").first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(OUT, "sin-enlace-2-instalacion-avanzada.png"), fullPage: true });
    // MVP final: una sola barra Canonical Light para todo el sitio (ya no hay un marco exclusivo de /live-draft).
    for (const route of ["/simulator", "/hero-pool", "/meta"]) {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
      await expect(page.getByTestId("app-nav")).toHaveCount(1);
      const navBg = await page.getByTestId("app-nav").evaluate((el) => getComputedStyle(el).backgroundColor);
      results[`nav-${route}`] = { backgroundColor: navBg };
    }
    await page.goto("/simulator");
    await page.screenshot({ path: resolve(OUT, "otras-rutas-simulator-nav.png"), clip: { x: 0, y: 0, width: 1600, height: 120 } });
  });

  test("Solo: sin declarar, ELIGE AHORA, análisis abierto", async ({ page, request }) => {
    test.setTimeout(240_000);
    const link = await issueLink(request);
    await beat(request, link);
    await page.setViewportSize(VIEW);
    await page.goto("/live-draft");
    await expect(page.getByTestId("live-dota")).toBeVisible({ timeout: 60_000 });
    await seedCuratedDraft(page, link.sessionId);
    await expect(page.getByTestId("live-light-pick-seat")).toBeVisible({ timeout: 60_000 });
    await shoot(page, "solo-1-sin-declarar", request, link);
    // cuántos selectores de posición (Pos 1..5) hay visibles a la vez
    results.soloUndeclaredVisibleSeatSelectors = await page.locator('[data-testid^="live-seat-"], [data-testid^="live-light-seat-"]').evaluateAll((els) => {
      const chips = els.filter((e) => /-seat-[1-5]$/.test(e.getAttribute("data-testid") ?? "") && (e as HTMLElement).offsetParent !== null);
      return chips.length;
    });

    await page.getByTestId("live-light-seat-2").click();
    const recommended = page.getByTestId("team-coach-board").locator('[data-recommended="true"]');
    await expect(recommended).toHaveCount(1, { timeout: 60_000 });
    await expect(recommended).toHaveAttribute("data-hero-id", String(LESHRAC));
    await expect(recommended).toContainText("ELIGE AHORA");
    await shoot(page, "solo-2-elige-ahora", request, link);

    const writes: string[] = [];
    page.on("request", (req) => { if (req.method() !== "GET" && req.url().includes("/engine/")) writes.push(`${req.method()} ${new URL(req.url()).pathname}`); });
    await recommended.locator("button").first().click();
    await expect(page.getByTestId("sl-decision")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Elegir / })).toHaveCount(0);
    expect(writes, "abrir un candidato no escribe nada en el motor").toEqual([]);
    results.openingCandidateWrites = writes;
    await shoot(page, "solo-3-analisis-abierto", request, link);
  });

  test("Party 5: cinco columnas y análisis", async ({ page, request }) => {
    test.setTimeout(240_000);
    const link = await issueLink(request);
    await beat(request, link);
    await page.setViewportSize(VIEW);
    await page.goto("/live-draft");
    await expect(page.getByTestId("live-dota")).toBeVisible({ timeout: 60_000 });
    const status = await page.evaluate(async () => (await fetch("/engine/api/team-groups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "E2E 4B1 Party", partySize: 5, members: [
      { slot: 1, position: 1, name: "Pos 1", heroPool: [1, 8, 10] }, { slot: 2, position: 2, name: "Pos 2", heroPool: [11, 13, 52] }, { slot: 3, position: 3, name: "Pos 3", heroPool: [2, 7, 28] },
      { slot: 4, position: 4, name: "Pos 4", heroPool: [3, 20, 26] }, { slot: 5, position: 5, name: "Pos 5", heroPool: [5, 30, 83] }] }) })).status);
    expect(status).toBe(201);
    await page.reload();
    await seedCuratedDraft(page, link.sessionId);
    await expect(page.getByTestId("live-light-pick-seat")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("live-preset-select").selectOption({ label: "E2E 4B1 Party" });
    await expect(page.locator('[data-testid^="team-coach-column-"]')).toHaveCount(5, { timeout: 60_000 });
    await page.getByTestId("live-seat-2").click();
    await expect(page.getByTestId("team-coach-column-2")).toHaveAttribute("data-relation", "mine-unconfirmed", { timeout: 60_000 });
    await shoot(page, "party5-1-cinco-columnas", request, link);
    await page.getByTestId("team-coach-board").locator("[data-card-key] button").first().click();
    await expect(page.getByTestId("sl-decision").or(page.getByTestId("sl-hero-reasons")).first()).toBeVisible();
    await shoot(page, "party5-2-analisis-abierto", request, link);
  });

  test("Captura incompleta / 409", async ({ page, request }) => {
    test.setTimeout(240_000);
    const link = await issueLink(request);
    await beat(request, link);
    await page.setViewportSize(VIEW);
    await page.goto("/live-draft");
    await expect(page.getByTestId("live-dota")).toBeVisible({ timeout: 60_000 });
    const first = await request.post(`${ENGINE_DIRECT}/api/live/gsi/${link.liveId}`, { data: gsiBody(link.token, "DOTA_GAMERULES_STATE_HERO_SELECTION"), headers: { "content-type": "application/json" } });
    expect(first.status()).toBe(200);
    await page.reload();
    await expect(page.getByTestId("live-capture-partial")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("team-coach-board")).toHaveCount(0);
    const incomplete = await page.evaluate(async (sid) => (await fetch(`/engine/api/session/protocol/${sid}/team-recommendations`)).status, link.sessionId);
    expect(incomplete).toBe(409);
    await shoot(page, "incompleto-409", request, link);
  });
  test("Página completa: axe, teclado, reflow 200/400 %, movimiento reducido", async ({ page, request }) => {
    test.setTimeout(240_000);
    const link = await issueLink(request);
    await beat(request, link);
    await page.setViewportSize(VIEW);
    await page.goto("/live-draft");
    await expect(page.getByTestId("live-dota")).toBeVisible({ timeout: 60_000 });
    await seedCuratedDraft(page, link.sessionId);
    await expect(page.getByTestId("live-light-pick-seat")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("live-light-seat-2").click();
    const recommended = page.getByTestId("team-coach-board").locator('[data-recommended="true"]');
    await expect(recommended).toHaveCount(1, { timeout: 60_000 });
    await recommended.locator("button").first().click();
    await expect(page.getByTestId("sl-decision")).toBeVisible();
    await beat(request, link);
    // axe sobre la PÁGINA COMPLETA (no solo el tablero)
    const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    results.axeFullPage = { violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) })) };
    // teclado: Tab recorre la página y cada parada tiene foco visible; nunca se activa un pick
    const stops: string[] = [];
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const visible = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 || cs.boxShadow !== "none";
        return `${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 24) ?? ""}]${visible ? "" : " SIN-FOCO-VISIBLE"}`;
      });
      if (stop !== null) stops.push(stop);
    }
    results.keyboardStops = stops;
    results.keyboardStopsWithoutVisibleFocus = stops.filter((s) => s.endsWith("SIN-FOCO-VISIBLE"));
    // reflow de PÁGINA COMPLETA a 200 % (800 px) y 400 % (400 px)
    const reflow: Record<string, unknown> = {};
    for (const [label, width] of [["200", 800], ["400", 400]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(500);
      const m = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth }));
      reflow[label] = { ...m, horizontalScroll: m.scrollWidth > m.clientWidth + 1 };
      await waitImages(page);
      await page.screenshot({ path: resolve(OUT, `reflow-${label}-pagina-completa.png`), fullPage: true });
    }
    results.reflowFullPage = reflow;
    // movimiento reducido
    await page.setViewportSize(VIEW);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(page.getByTestId("team-coach-column-2")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(800);
    results.reducedMotionRunningAnimations = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    await page.screenshot({ path: resolve(OUT, "movimiento-reducido.png"), fullPage: false });
  });


  test("Reconexión: recargar conserva posición y recomendación; el motor manda", async ({ page, request }) => {
    test.setTimeout(240_000);
    const link = await issueLink(request);
    await beat(request, link);
    await page.setViewportSize(VIEW);
    await page.goto("/live-draft");
    await expect(page.getByTestId("live-dota").or(page.getByTestId("live-team-coach"))).toBeVisible({ timeout: 60_000 });
    await seedCuratedDraft(page, link.sessionId);
    await expect(page.getByTestId("live-light-pick-seat")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("live-light-seat-2").click();
    await expect(page.getByTestId("team-coach-board").locator('[data-recommended="true"]')).toHaveCount(1, { timeout: 60_000 });
    await page.reload();
    await expect(page.getByTestId("team-coach-column-2")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("live-light-pick-seat")).toHaveCount(0);
    await expect(page.getByTestId("team-coach-board").locator('[data-recommended="true"]')).toHaveAttribute("data-hero-id", String(LESHRAC));
    await shoot(page, "reconexion-1-tras-recargar", request, link);
  });
  test("Datos desactualizados: un latido viejo del Companion no se presenta como captura vigente", async ({ page, request }) => {
    test.setTimeout(240_000);
    const link = await issueLink(request);
    await beat(request, link);
    await page.setViewportSize(VIEW);
    await page.goto("/live-draft");
    await expect(page.getByTestId("live-dota")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("live-capture-status")).toContainText("Companion conectado", { timeout: 60_000 });
    results.companionTextFresh = (await page.getByTestId("live-capture-status").innerText()).replace(/\s+/g, " ");
    await page.screenshot({ path: resolve(OUT, "estado-vigente.png"), fullPage: false });
    // sin nuevos latidos, pasado LIVE_COMPANION_STALE_AFTER_MS (45 s) la propia página (sin recargar) deja de decir "conectado"
    await expect(page.getByTestId("live-capture-status")).not.toContainText("Companion conectado", { timeout: 90_000 });
    results.companionTextStale = (await page.getByTestId("live-capture-status").innerText()).replace(/\s+/g, " ");
    await expect(page.getByTestId("live-capture-status")).toContainText("Companion sin señal");
    await waitImages(page);
    await page.screenshot({ path: resolve(OUT, "estado-desactualizado.png"), fullPage: false });
  });
});
