/* VRT canónico · StateTarget y HeroDraftSlot (Fase 3D.2), tema Light, componentes REALES.
   - Grupo «Legacy»: SIN las props nuevas. Sus baselines se generaron con el DS ORIGINAL; que sigan pasando con el DS extendido es la prueba de que los
     consumidores anteriores conservan su apariencia.
   - Grupo «Extensiones»: `StateTarget.pressed` y `HeroDraftSlot.showPlate` (valores por defecto incluidos).
   Reglas: ninguna prueba se ejecuta con --update-snapshots salvo `=missing` (solo crea candidatos; nunca sobrescribe un baseline existente).
   Determinismo: movimiento reducido, reloj de fuentes cargadas y el CDN de Valve interceptado con un arte fijo (sin red, mismo componente). */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ART = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="144" viewBox="0 0 256 144"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a6b73"/><stop offset="1" stop-color="#2b2f33"/></linearGradient></defs><rect width="256" height="144" fill="url(#g)"/><circle cx="128" cy="62" r="34" fill="#9aa7ad"/></svg>`;

async function open(page: Page, story: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://cdn.cloudflare.steamstatic.com/**", (route) => route.fulfill({ body: ART, contentType: "image/svg+xml" }));
  await page.goto(`/iframe.html?id=${story}&viewMode=story`);
  const root = page.locator("#storybook-root");
  await expect(root).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
  return root;
}

// Ancho suficiente para las rejillas (4 × 232 px / 6 × 150 px + márgenes): el viewport de 960 px del config recortaba la columna derecha.
test.use({ viewport: { height: 1000, width: 1200 } });

const LEGACY = "ds-v1-canonical-vrt-legacy-sin-props-nuevas";
const EXT = "ds-v1-canonical-vrt-extensiones-3d-2";

test.describe("VRT canónico · Legacy (sin props nuevas)", () => {
  const cases: [string, string][] = [
    ["state-target-all-states", "statetarget-legacy-all-states.png"],
    ["state-target-interactive-all-states", "statetarget-legacy-interactive.png"],
    ["hero-draft-slot-all-states", "herodraftslot-legacy-all-states.png"],
    ["hero-draft-slot-interactive-and-forced", "herodraftslot-legacy-interactive-forced.png"],
  ];
  for (const [story, file] of cases) {
    test(`Legacy ${story}`, async ({ page }) => {
      const root = await open(page, `${LEGACY}--${story}`);
      await expect(root).toHaveScreenshot(file, { animations: "disabled" });
    });
  }
});

test.describe("VRT canónico · Extensiones 3D.2", () => {
  test("StateTarget pressed (todas las combinaciones)", async ({ page }) => {
    const root = await open(page, `${EXT}--state-target-pressed`);
    await expect(root).toHaveScreenshot("statetarget-pressed.png", { animations: "disabled" });
  });

  test("HeroDraftSlot showPlate (default / true / false × 6 estados)", async ({ page }) => {
    const root = await open(page, `${EXT}--hero-draft-slot-show-plate`);
    await expect(root).toHaveScreenshot("herodraftslot-showplate.png", { animations: "disabled" });
  });

  test("showPlate: omitir la prop y showPlate explícito se comparan contra el MISMO baseline", async ({ page }) => {
    await open(page, `${EXT}--show-plate-default-pair`);
    await expect(page.locator('[data-cell="default"]')).toHaveScreenshot("herodraftslot-showplate-default-cell.png", { animations: "disabled" });
    await expect(page.locator('[data-cell="explicit"]')).toHaveScreenshot("herodraftslot-showplate-default-cell.png", { animations: "disabled" });
  });

  test("tarjeta real: recommended / recommended + pressed / rest / rest + pressed", async ({ page }) => {
    const root = await open(page, `${EXT}--composed-card`);
    await expect(root).toHaveScreenshot("card-composed.png", { animations: "disabled" });
  });
});

test.describe("Accesibilidad y teclado · tarjeta real", () => {
  test("axe WCAG A/AA sin violaciones en los 3 stories de extensiones", async ({ page }) => {
    for (const story of ["state-target-pressed", "hero-draft-slot-show-plate", "composed-card"]) {
      await open(page, `${EXT}--${story}`);
      const result = await new AxeBuilder({ page }).include("#storybook-root").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).disableRules(["color-contrast"]).analyze();
      expect(result.violations.map((violation) => violation.id), story).toEqual([]);
    }
  });

  test("un solo <button> por tarjeta, sin anidados, aria-pressed correcto, Tab y foco visible", async ({ page }) => {
    await open(page, `${EXT}--composed-card`);
    const buttons = page.locator("#storybook-root button");
    expect(await buttons.count()).toBe(4);
    expect(await page.locator("#storybook-root button button, #storybook-root button [role=button]").count()).toBe(0);
    const pressed = await buttons.evaluateAll((items) => items.map((item) => item.getAttribute("aria-pressed")));
    expect(pressed).toEqual(["false", "true", "false", "true"]);
    const states = await buttons.evaluateAll((items) => items.map((item) => item.getAttribute("data-state")));
    expect(states).toEqual(["recommended", "recommended", "rest", "rest"]);
    for (let index = 0; index < 4; index += 1) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        return { tag: element.tagName, visible: element.matches(":focus-visible"), outline: getComputedStyle(element).outlineStyle };
      });
      expect(focused).toEqual({ tag: "BUTTON", visible: true, outline: "solid" });
    }
  });
});
