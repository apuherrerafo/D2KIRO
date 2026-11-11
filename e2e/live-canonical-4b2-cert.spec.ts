import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import type { APIRequestContext, Page } from "@playwright/test";
import { ENGINE_DIRECT, engineDirectHeaders } from "./support/wave1";
import { expect, test } from "./support/failure-evidence";

// Fase 4B.2 · CIERRE DE CERTIFICACIÓN. Motor real (V6 intacto) + web real. Dota SIMULADO: nada de esto es un cliente Dota auténtico.
//  A) GoldenCardView / FreeThreatsView alcanzables: la respuesta de team-recommendations se enriquece EN EL NAVEGADOR (page.route); el motor no se toca.
//  B) Party 5 con nombres largos, razones extensas y análisis abierto.
//  C) Diagnóstico de indicadores Companion / Connection / Phase / Capture por origen del dato.
//  D) Draft terminado.
const webRequire = createRequire(resolve(process.cwd(), "apps/web/package.json"));
const AxeBuilder = (webRequire("@axe-core/playwright") as { AxeBuilder?: unknown }).AxeBuilder as typeof import("@axe-core/playwright").AxeBuilder;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const OUT = resolve(process.cwd(), "docs/research/phase-4b2/cert");
mkdirSync(OUT, { recursive: true });
const VIEW = { width: 1600, height: 900 };
const CURATED_BANS = [111, 129, 88, 138, 135, 136, 110, 145, 123, 1, 89, 90, 120, 113, 114, 69];
const results: Record<string, unknown> = { evidence: "PRUEBA: motor real + web real, Dota SIMULADO; respuesta de board enriquecida en el navegador solo para A/B" };

interface IssuedLink { liveId: string; token: string; sessionId: string }
const LONG_WHY = "Este héroe cubre la ventana de iniciación que a tu equipo le falta, y además su control en área encadena con la bola de nieve del aliado ya elegido, de modo que el rival no puede jugar su línea cómoda durante los primeros diez minutos de la partida ni rotar sin perder torres. ".repeat(2).trim();
const LONG_NAME = "Jugador con un nombre demasiado largo para caber en una columna";

async function issueLink(request: APIRequestContext): Promise<IssuedLink> {
  const issued = await request.post(`${ENGINE_DIRECT}/api/live/gsi-link/issue`, { headers: engineDirectHeaders() });
  expect(issued.status()).toBe(201);
  return (await issued.json()) as IssuedLink;
}
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
function gsiBody(token: string, gameState: string, withDraft = false): string {
  return JSON.stringify({ provider: { name: "Dota 2", appid: 570 }, map: { name: "start", matchid: "1234567890", game_state: gameState, clock_time: -30 }, player: { steamid: "SENTINEL-STEAMID", accountid: "SENTINEL-ACCOUNTID", name: "SENTINEL-NAME", team_name: "radiant" }, hero: { id: 104 }, draft: withDraft ? { activeteam: 2, pick: true, activeteam_time_remaining: 20, radiant_bonus_time: 130, dire_bonus_time: 130 } : {}, auth: { token } });
}
async function waitImages(page: Page) {
  await page.waitForFunction(() => [...document.querySelectorAll("img")].every((img) => img.complete), undefined, { timeout: 20_000 }).catch(() => undefined);
}
async function pills(page: Page) {
  const text = await page.getByTestId("live-capture-status").innerText();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const pick = (label: string) => { const i = lines.indexOf(label); return i >= 0 ? lines[i + 1] ?? null : null; };
  return { COMPANION: pick("COMPANION"), CONNECTION: pick("CONNECTION"), PHASE: pick("PHASE"), CAPTURE: pick("CAPTURE"), DRAFT_AUTOMATICO: pick("DRAFT AUTOMÁTICO"), SIDE: pick("SIDE") };
}
async function axeFull(page: Page, label: string) {
  const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  results[`axe-${label}`] = axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
}
async function reflow(page: Page, label: string) {
  const out: Record<string, unknown> = {};
  for (const [name, width] of [["200", 800], ["400", 400]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    out[name] = { ...m, horizontalScroll: m.scrollWidth > m.clientWidth + 1 };
    await waitImages(page);
    await page.screenshot({ path: resolve(OUT, `${label}-reflow-${name}.png`), fullPage: true });
  }
  results[`reflow-${label}`] = out;
  await page.setViewportSize(VIEW);
}

test.describe.configure({ mode: "serial" });
test.afterAll(() => { writeFileSync(resolve(OUT, "medidas.json"), JSON.stringify(results, null, 2)); });

test.describe("4B.2 cierre de certificación", () => {
  test("A · card dorada y amenazas libres: sin superficies Legacy", async ({ page, request }) => {
    test.setTimeout(240_000);
    const link = await issueLink(request);
    await beat(request, link);
    await page.setViewportSize(VIEW);
    await page.route("**/team-recommendations", async (route) => {
      const response = await route.fetch();
      const board = (await response.json()) as Record<string, unknown>;
      board.goldenCard = { heroId: 11, position: 2, wins: [{ vsHeroId: 129, level: "hard", why: LONG_WHY, core: true }, { vsHeroId: 138, level: "medium", why: "Le gana la línea por alcance.", core: false }], stillFreeHardCounters: [8], counteredOutBy: [111], synergies: [{ withHeroId: 1, why: "Su control abre la ventana para tu carry." }] };
      board.freeThreats = [{ ownHeroId: 1, threatHeroId: 8, why: LONG_WHY, stealPositions: [2] }, { ownHeroId: 1, threatHeroId: 11, why: "Te anula la ventana de farmeo.", stealPositions: [] }];
      await route.fulfill({ response, json: board });
    });
    await page.goto("/live-draft");
    await expect(page.getByTestId("live-dota")).toBeVisible({ timeout: 60_000 });
    await seedCuratedDraft(page, link.sessionId);
    await expect(page.getByTestId("live-light-pick-seat")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("live-light-seat-2").click();
    await expect(page.getByTestId("golden-card")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("free-threats")).toBeVisible();
    await waitImages(page);
    await page.getByTestId("golden-card").scrollIntoViewIfNeeded();
    // Superficie: ningún fondo oscuro Legacy (luminancia relativa del fondo efectivo) y sin desborde horizontal.
    const surface = await page.evaluate(() => {
      const lum = (rgb: string) => { const m = rgb.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0]; const [r, g, b] = m.slice(0, 3).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const probe = (id: string) => {
        const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
        if (!el) return null;
        let bg = ""; let node: HTMLElement | null = el;
        while (node) { const c = getComputedStyle(node).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { bg = c; break; } node = node.parentElement; }
        const b = el.getBoundingClientRect();
        return { background: bg, backgroundLuminance: Number(lum(bg).toFixed(3)), color: getComputedStyle(el).color, border: getComputedStyle(el).borderTopColor, width: Math.round(b.width), overflowsX: el.scrollWidth > el.clientWidth + 1 };
      };
      return { goldenCard: probe("golden-card"), freeThreats: probe("free-threats"), freeThreatRows: document.querySelectorAll('[data-testid="free-threat"]').length };
    });
    results.legacySurfaces = surface;
    expect((surface.goldenCard?.backgroundLuminance ?? 0)).toBeGreaterThan(0.5);
    expect((surface.freeThreats?.backgroundLuminance ?? 0)).toBeGreaterThan(0.5);
    await page.screenshot({ path: resolve(OUT, "golden-y-amenazas.png"), fullPage: true });
    // Color-contrast de axe SOLO sobre las dos vistas
    const axe = await new AxeBuilder({ page }).include('[data-testid="golden-card"]').include('[data-testid="free-threats"]').withTags(WCAG_TAGS).analyze();
    results.axeGoldenAndThreats = axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
    await axeFull(page, "golden-pagina");
    // El pick de la card dorada NO se ofrece en Live (canPick no se pasa): ningún "Elegir a" aparece.
    results.goldenPickButtons = await page.getByTestId("golden-card-pick").count();
    await reflow(page, "golden");
  });

  test("B · Party 5: nombres largos, razones extensas, análisis abierto", async ({ page, request }) => {
    test.setTimeout(240_000);
    const link = await issueLink(request);
    await beat(request, link);
    await page.setViewportSize(VIEW);
    await page.route("**/team-recommendations", async (route) => {
      const response = await route.fetch();
      const board = (await response.json()) as { positions?: { top?: { reasons: string[]; synergies?: { withHeroId: number; why: string }[] }[] }[] };
      for (const column of board.positions ?? []) for (const candidate of column.top ?? []) { candidate.reasons = [LONG_WHY, ...candidate.reasons]; }
      await route.fulfill({ response, json: board });
    });
    await page.goto("/live-draft");
    await expect(page.getByTestId("live-dota")).toBeVisible({ timeout: 60_000 });
    const status = await page.evaluate(async (name) => (await fetch("/engine/api/team-groups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `${name} · equipo`, partySize: 5, members: [
      { slot: 1, position: 1, name, heroPool: [1, 8, 10] }, { slot: 2, position: 2, name, heroPool: [11, 13, 52] }, { slot: 3, position: 3, name, heroPool: [2, 7, 28] },
      { slot: 4, position: 4, name, heroPool: [3, 20, 26] }, { slot: 5, position: 5, name, heroPool: [5, 30, 83] }] }) })).status, LONG_NAME);
    expect(status).toBe(201);
    await page.reload();
    await seedCuratedDraft(page, link.sessionId);
    await expect(page.getByTestId("live-light-pick-seat")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("live-preset-select").selectOption({ label: `${LONG_NAME} · equipo` });
    await expect(page.locator('[data-testid^="team-coach-column-"]')).toHaveCount(5, { timeout: 60_000 });
    await page.getByTestId("live-seat-2").click();
    await expect(page.getByTestId("team-coach-column-2")).toHaveAttribute("data-relation", "mine-unconfirmed", { timeout: 60_000 });
    await waitImages(page);
    await page.screenshot({ path: resolve(OUT, "party5-largos-columnas.png"), fullPage: true });
    await page.getByTestId("team-coach-board").locator("[data-card-key] button").first().click();
    await expect(page.getByTestId("sl-decision").or(page.getByTestId("sl-hero-reasons")).first()).toBeVisible();
    // La razón larga debe estar COMPLETA y visible en el análisis abierto (sin recorte funcional)
    const analysisText = (await page.getByTestId("sl-hero-reasons").or(page.getByTestId("sl-decision")).first().innerText()).replace(/\s+/g, " ");
    const clipped = await page.evaluate(() => {
      const out: { testid: string; clamped: boolean; scrollH: number; clientH: number }[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('[data-testid^="sl-"], [data-testid^="team-coach-column-"]')) {
        const cs = getComputedStyle(el);
        const clamped = (cs.overflow !== "visible" || cs.webkitLineClamp !== "none") && el.scrollHeight > el.clientHeight + 1;
        if (clamped) out.push({ testid: el.getAttribute("data-testid") ?? "", clamped, scrollH: el.scrollHeight, clientH: el.clientHeight });
      }
      return out;
    });
    results.party5Long = { analysisContainsFullReason: analysisText.includes(LONG_WHY.slice(0, 80)) && analysisText.includes(LONG_WHY.slice(-40)), clippedElements: clipped };
    const headerTexts = await page.locator('[data-testid^="team-coach-column-"]').evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-testid"), clipped: (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1, text: (e as HTMLElement).innerText.split("\n")[0] })));
    results.party5Columns = headerTexts;
    await page.screenshot({ path: resolve(OUT, "party5-largos-analisis.png"), fullPage: true });
    await axeFull(page, "party5-largos");
    await reflow(page, "party5-largos");
  });

  test("C · indicadores: procedencia y vigencia", async ({ page, request }) => {
    test.setTimeout(240_000);
    // 1) enlace nuevo sin ningún evento ni latido
    const link = await issueLink(request);
    await page.setViewportSize(VIEW);
    await page.goto("/live-draft");
    await expect(page.getByTestId("live-capture-status")).toBeVisible({ timeout: 60_000 });
    results.c1_sinEventos = await pills(page);
    // 2) latido del Companion (Dota conectado según el Companion) pero ningún GSI aún
    await beat(request, link);
    await page.waitForTimeout(3500);
    results.c2_soloCompanion = await pills(page);
    // 3) hechos de draft inyectados como observaciones (sin GSI): equivale a un helper visual / manual, NO a Dota enviando datos
    await seedCuratedDraft(page, link.sessionId);
    await page.waitForTimeout(3500);
    results.c3_soloObservaciones_sinGSI = await pills(page);
    await page.screenshot({ path: resolve(OUT, "indicadores-observaciones-sin-gsi.png"), fullPage: false });
    // 4) ahora llega GSI real de Dota
    const gsi = await request.post(`${ENGINE_DIRECT}/api/live/gsi/${link.liveId}`, { data: gsiBody(link.token, "DOTA_GAMERULES_STATE_HERO_SELECTION", true), headers: { "content-type": "application/json" } });
    results.c4_gsiStatus = gsi.status();
    await beat(request, link);
    await page.waitForTimeout(3500);
    results.c4_conGSI = await pills(page);
    await page.screenshot({ path: resolve(OUT, "indicadores-con-gsi.png"), fullPage: false });
    const statusJson = await page.evaluate(async (sid) => { const r = await fetch(`/engine/api/session/protocol/${sid}/live-status`); const j = await r.json() as Record<string, unknown>; return { connection: j.connection, lastEventAt: j.lastEventAt !== null, draftPhase: j.draftPhase, bans: j.bans, captureHealth: j.captureHealth, captureDetail: j.captureDetail }; }, link.sessionId);
    results.c4_liveStatusJson = statusJson;
  });

  test("D · draft terminado conserva la funcionalidad (sin recomendación nueva, aviso claro)", async ({ page, request }) => {
    test.setTimeout(240_000);
    const link = await issueLink(request);
    await beat(request, link);
    await page.setViewportSize(VIEW);
    await page.goto("/live-draft");
    await expect(page.getByTestId("live-dota")).toBeVisible({ timeout: 60_000 });
    await seedCuratedDraft(page, link.sessionId);
    await expect(page.getByTestId("live-light-pick-seat")).toBeVisible({ timeout: 60_000 });
    const ended = await request.post(`${ENGINE_DIRECT}/api/live/gsi/${link.liveId}`, { data: gsiBody(link.token, "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"), headers: { "content-type": "application/json" } });
    results.d_gsiStatus = ended.status();
    await beat(request, link);
    await page.waitForTimeout(4000);
    results.d_pills = await pills(page);
    await expect(page.getByTestId("live-capture-status")).toContainText("Draft terminado", { timeout: 30_000 });
    await waitImages(page);
    await page.screenshot({ path: resolve(OUT, "draft-terminado.png"), fullPage: true });
    results.d_goldenOrThreatsAfterEnd = (await page.getByTestId("golden-card").count()) + (await page.getByTestId("free-threats").count());
    await axeFull(page, "draft-terminado");
  });
});
