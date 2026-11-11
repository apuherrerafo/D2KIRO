import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/failure-evidence";
import { PARTY_CASES, startDraft } from "./support/simulator-start";

// MVP final · integración visual completa bajo Canonical Light V1.1. Motor real + web real (build de producción), sesión de prueba
// sellada con el SESSION_SECRET efímero de la corrida (el mismo gate que Railway; ver global-setup.ts).
// Recorre TODAS las rutas del MVP en tres anchos, comprueba que no queda nada del diseño anterior y deja las capturas en
// docs/research/mvp-final/<ancho>/. Dota 2 NO se simula aquí: esto mide pantallas, no la captura auténtica.

const OUT = resolve(process.cwd(), process.env.MVP_FINAL_OUT ?? "docs/research/mvp-final");
const VIEWPORTS = [
  { name: "desktop-1600", width: 1600, height: 900 },
  { name: "tablet-800", width: 800, height: 1000 },
  { name: "mobile-390", width: 390, height: 844 },
] as const;
const ROUTES = [
  { path: "/", slug: "inicio", marker: "account-home" },
  { path: "/simulator", slug: "simulador-configuracion", marker: "simulator-config" },
  { path: "/live-draft", slug: "draft-en-vivo", marker: "live-" },
  { path: "/hero-pool", slug: "mi-pool", marker: "hero-pool-page" },
  { path: "/team-groups", slug: "equipos", marker: "" },
  { path: "/meta", slug: "meta", marker: "meta-page" },
  { path: "/settings", slug: "cuenta", marker: "account-page" },
  { path: "/heroes", slug: "heroes", marker: "heroes-page" },
  { path: "/esta-ruta-no-existe", slug: "404", marker: "not-found" },
] as const;
const NAV_LABELS = ["Simulador", "Draft en vivo", "Mi pool", "Equipos", "Meta"];

for (const viewport of VIEWPORTS) mkdirSync(resolve(OUT, viewport.name), { recursive: true });

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForFunction(() => [...document.querySelectorAll("img")].every((img) => img.complete), undefined, { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(600);
}

interface LegacyReport {
  shellLight: boolean;
  shellBackground: string;
  legacyText: string[];
  legacyColors: number;
  overflowX: number;
  offenders: string[];
}

// "Legacy" = el nombre anterior del producto, el dorado del tema oscuro anterior o un fondo del azul-negro anterior pintado en pantalla.
async function legacyReport(page: Page): Promise<LegacyReport> {
  return page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".ap-light[data-theme='light']");
    const toRgb = (value: string) => (/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value) ?? []).slice(1, 4).map(Number);
    const isLegacyGold = ([r, g, b]: number[]) => r === 212 && g === 175 && b === 55;
    const isLegacyDark = ([r, g, b]: number[]) => (r === 15 && g === 17 && b === 21) || (r === 23 && g === 26 && b === 33) || (r === 31 && g === 35 && b === 44);
    let legacyColors = 0;
    for (const element of document.body.querySelectorAll<HTMLElement>("*")) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(element);
      const background = toRgb(style.backgroundColor);
      const color = toRgb(style.color);
      const border = toRgb(style.borderTopColor);
      if (isLegacyGold(background) || isLegacyGold(color) || isLegacyGold(border) || isLegacyDark(background)) legacyColors += 1;
    }
    const text = document.body.innerText;
    const legacyText = ["dota2coach"].filter((needle) => text.toLowerCase().includes(needle));
    const root = document.documentElement;
    const offenders = [...document.body.querySelectorAll<HTMLElement>("*")]
      .filter((element) => element.getBoundingClientRect().right > root.clientWidth + 1 && getComputedStyle(element).position !== "fixed")
      .slice(0, 5)
      .map((element) => `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 60)}`);
    return {
      shellLight: shell !== null,
      shellBackground: shell === null ? "" : getComputedStyle(shell).backgroundColor,
      legacyText,
      legacyColors,
      overflowX: Math.max(0, root.scrollWidth - root.clientWidth),
      offenders,
    };
  });
}

function luminance(rgb: string): number {
  const parts = (/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb) ?? []).slice(1, 4).map(Number);
  if (parts.length !== 3) return 0;
  return (0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]) / 255;
}

for (const viewport of VIEWPORTS) {
  test.describe(`rutas autenticadas · ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const route of ROUTES) {
      test(`${route.slug}: Canonical Light, sin Legacy, sin desborde`, async ({ page }) => {
        const consoleErrors: string[] = [];
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
        await page.goto(route.path);
        await settle(page);

        const report = await legacyReport(page);
        expect(report.shellLight, "el shell Canonical Light envuelve la ruta").toBe(true);
        expect(luminance(report.shellBackground), `fondo claro (${report.shellBackground})`).toBeGreaterThan(0.8);
        expect(report.legacyText, "ningún nombre del producto anterior").toEqual([]);
        expect(report.legacyColors, "ningún color del tema oscuro/dorado anterior").toBe(0);
        expect(report.overflowX, `sin scroll horizontal de página (${report.offenders.join(" | ")})`).toBeLessThanOrEqual(1);

        const nav = page.getByTestId("app-nav");
        await expect(nav).toBeVisible();
        for (const label of NAV_LABELS) await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
        // El identificador interno de Steam jamás se pinta.
        await expect(nav).not.toContainText(/\b\d{7,10}\b/);

        await page.screenshot({ path: resolve(OUT, viewport.name, `${route.slug}.png`), fullPage: true });
        const fatal = consoleErrors.filter((text) => !/favicon|404 \(Not Found\)|Failed to load resource/i.test(text));
        expect(fatal, "sin errores de consola").toEqual([]);
      });
    }
  });
}

test.describe("recorrido y datos", () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test("todo enlace interno del menú y del inicio responde sin error", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const hrefs = await page.$$eval("a[href^='/']", (anchors) => [...new Set(anchors.map((anchor) => anchor.getAttribute("href") ?? ""))]);
    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) {
      const response = await page.request.get(href, { maxRedirects: 5 });
      expect(response.status(), `GET ${href}`).toBeLessThan(400);
    }
  });

  test("el inicio muestra el estado real de preparación, sin ids de Steam", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    await expect(page.getByTestId("home-prep-pool")).toBeVisible();
    await expect(page.getByTestId("home-prep-teams")).toBeVisible();
    await expect(page.getByTestId("home-prep-meta")).toBeVisible();
    await expect(page.getByTestId("account-home")).not.toContainText(/\b\d{7,10}\b/);
    await expect(page.getByTestId("home-open-simulator")).toBeVisible();
  });

  test("Mi pool: agregar, guardar y recargar conserva el héroe (persistencia)", async ({ page }) => {
    await page.goto("/hero-pool");
    await settle(page);
    const count = page.getByTestId("pool-count");
    await expect(count).toBeVisible();
    const before = (await page.getByTestId("pool-row").count());
    const cell = page.locator(".ap-cell:not(:disabled):not([aria-pressed='true'])").first();
    const heroName = (await cell.innerText()).trim();
    await cell.click();
    await expect(page.getByTestId("pool-row")).toHaveCount(before + 1);
    await page.getByTestId("pool-save").click();
    await expect(page.getByTestId("pool-saved")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await settle(page);
    await expect(page.getByTestId("pool-row")).toHaveCount(before + 1);
    await expect(page.getByTestId("hero-pool-page")).toContainText(heroName);
    // Deja la cuenta de prueba como estaba.
    const row = page.getByTestId("pool-row").filter({ hasText: heroName }).first();
    await row.getByRole("button", { name: "Quitar" }).click();
    await page.getByTestId("pool-save").click();
    await expect(page.getByTestId("pool-saved")).toBeVisible({ timeout: 15_000 });
  });

  test("Cuenta: muestra el nombre, deja salir de la sesión y no muestra el Steam32", async ({ page }) => {
    await page.goto("/settings");
    await settle(page);
    await expect(page.getByTestId("account-page")).toBeVisible();
    await expect(page.getByTestId("account-page")).not.toContainText(/Steam32|\b\d{7,10}\b/);
    await expect(page.getByTestId("account-logout")).toBeVisible();
  });

  test("Salir cierra la sesión y manda al acceso", async ({ page }) => {
    await page.goto("/settings");
    await settle(page);
    await page.getByTestId("account-logout").click();
    await page.waitForURL("**/login**");
    await expect(page.getByTestId("login-page")).toBeVisible();
  });
});

for (const viewport of VIEWPORTS) {
  test.describe(`simulador en partida · ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("Party 5 en curso se ve entero en Canonical Light", async ({ page }) => {
      const party5 = PARTY_CASES.find((item) => item.size === 5);
      if (party5 === undefined) throw new Error("falta el caso Party 5");
      await startDraft(page, party5);
      await settle(page);
      const report = await legacyReport(page);
      expect(report.legacyText).toEqual([]);
      expect(report.legacyColors).toBe(0);
      expect(report.overflowX).toBeLessThanOrEqual(1);
      await page.screenshot({ path: resolve(OUT, viewport.name, "simulador-en-curso.png"), fullPage: true });
    });
  });
}

test.describe("visitante sin sesión", () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1600, height: 900 } });

  for (const viewport of VIEWPORTS) {
    test(`portada, acceso y sin acceso · ${viewport.name}`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      for (const [path, slug, marker] of [["/", "portada", "landing-01b"], ["/login", "login", "login-page"], ["/access-denied", "sin-acceso", "access-denied"]] as const) {
        await page.goto(path);
        await settle(page);
        await expect(page.getByTestId(marker)).toBeVisible();
        const report = await legacyReport(page);
        expect(report.legacyText, `${path}: sin nombre anterior`).toEqual([]);
        expect(report.overflowX, `${path}: sin desborde`).toBeLessThanOrEqual(1);
        if (path !== "/") expect(luminance(report.shellBackground), `${path}: Light`).toBeGreaterThan(0.8);
        await page.screenshot({ path: resolve(OUT, viewport.name, `visitante-${slug}.png`), fullPage: true });
      }
      await context.close();
    });
  }

  test("una ruta privada sin sesión manda al acceso", async ({ page }) => {
    await page.goto("/hero-pool");
    await page.waitForURL("**/login**");
    await expect(page.getByTestId("login-page")).toBeVisible();
  });
});
