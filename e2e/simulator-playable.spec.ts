import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/failure-evidence";

// P0 «Simulador jugable» · aceptación en navegador REAL (motor V6 real + web de producción + base E2E determinista).
// Se juega como un jugador: lo que se afirma es lo que se VE (textos, botones por su nombre, posición en pantalla), no estructura interna.
// Los escenarios son los deterministas de la certificación 4A.3 (semilla + bans curados): mismas entradas, mismo motor, mismas recomendaciones.
// Capturas en docs/research/simulator-playable/<carpeta>/.


const OUT = resolve(process.cwd(), process.env.SIM_PLAYABLE_OUT ?? "docs/research/simulator-playable/after");
mkdirSync(OUT, { recursive: true });

interface Scenario {
  id: string;
  size: 1 | 2 | 3 | 5;
  positions: string[];
  personal: string;
  seed: string;
  bans: string[];
  /** Héroe que el motor real debe marcar como ELIGE AHORA (solo en los escenarios STRONG). */
  expectedRecommended?: string;
}

const POS2 = "Posición 2 — Midlane";
const SOLO_STRONG: Scenario = { id: "solo-strong", size: 1, positions: [], personal: POS2, seed: "CURATED1", bans: ["Anti-Mage", "Nyx Assassin", "Riki", "Disruptor"], expectedRecommended: "Leshrac" };
const SOLO_WEAK: Scenario = { id: "solo-weak", size: 1, positions: [], personal: POS2, seed: "SCAN0005", bans: [] };
const SOLO_CERO: Scenario = { id: "solo-cero", size: 1, positions: [], personal: POS2, seed: "SCAN0000", bans: [] };
const PARTY2: Scenario = { id: "party2", size: 2, positions: [POS2, "Posición 5 — Hard support"], personal: "Posición 5 — Hard support", seed: "CURATED3", bans: ["Doom", "Ancient Apparition", "Shadow Demon", "Troll Warlord"], expectedRecommended: "Oracle" };
const PARTY3: Scenario = { id: "party3", size: 3, positions: ["Posición 1 — Carry", "Posición 3 — Offlane", "Posición 5 — Hard support"], personal: "Posición 3 — Offlane", seed: "PARTY3AA", bans: [] };
const PARTY5: Scenario = { id: "party5", size: 5, positions: [], personal: POS2, seed: "PARTY5AA", bans: [] };

const CHOOSE_BUTTON = /^Elegir a .+ como Pos\d/;

async function begin(page: Page, item: Scenario): Promise<void> {
  await page.goto("/simulator");
  await page.getByRole("group", { name: "Tu lado" }).getByRole("button", { name: "Radiant", exact: true }).click();
  await page.getByRole("group", { name: "Tamaño de party" }).getByRole("button", { name: item.size === 1 ? "Solo (1)" : `Party ${item.size}` }).click();
  for (const position of item.positions) await page.getByRole("group", { name: "Posiciones de tu party" }).getByRole("button", { name: position }).click();
  await page.getByRole("group", { name: "Tu posición personal" }).getByRole("button", { name: item.personal }).click();
  await page.locator('input[maxlength="8"]').fill(item.seed);
  for (const name of item.bans) {
    await page.getByRole("button", { name: "Agregar héroe" }).click();
    await page.getByRole("dialog").locator(`button[title="${name}"]`).click();
  }
  await page.getByRole("button", { name: "Iniciar Draft" }).click();
  await expect(page.getByText(/Ronda 1 de 3 · Elige \d héroes?/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("team-coach-board").locator("[data-testid^='team-coach-column-']").first()).toBeVisible({ timeout: 60_000 });
  await settle(page);
}

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => [...document.querySelectorAll("img")].every((img) => img.complete), undefined, { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

function cards(page: Page): Locator {
  return page.getByTestId("team-coach-board").locator("[data-card-key] button");
}

/** ¿El jugador lo ve ahora mismo, sin desplazarse, y nada lo tapa (p. ej. la franja fija de arriba)? */
async function isUsableInView(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const top = document.elementFromPoint(x, y);
    const inside = box.top >= 0 && box.bottom <= window.innerHeight && box.left >= 0 && box.right <= window.innerWidth;
    return inside && top !== null && (top === element || element.contains(top));
  });
}

async function searchHero(page: Page, name: string): Promise<void> {
  const search = page.getByRole("region", { name: "Buscar otro héroe" });
  await search.getByPlaceholder("Buscar héroe...").fill(name);
  await search.getByRole("button", { name: new RegExp(`^${name}`) }).first().click();
}

interface ScreenState {
  done: boolean;
  round: number;
  pending: string | null;
  searchVisible: boolean;
}

/** Lo que el jugador ve ahora mismo, leído sin esperar (un texto que desaparece no bloquea la lectura). */
async function screenState(page: Page): Promise<ScreenState> {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const heading = /Ronda (\d) de 3 · Elige \d héroes?/.exec(text);
    return {
      done: text.includes("Draft completo"),
      round: heading === null ? 0 : Number(heading[1]),
      pending: document.querySelector('[data-testid="pending-human-positions"]')?.textContent ?? null,
      searchVisible: document.querySelector('[data-testid="other-hero-search"]') !== null,
    };
  });
}

/** Un humano que juega: carta si el coach propone algo, buscador si no; siempre confirmando con el botón. Devuelve las rondas que vio. */
async function playToEnd(page: Page, prefer: "card" | "search" = "card"): Promise<{ rounds: number[]; picks: number }> {
  const rounds = new Set<number>();
  let picks = 0;
  const deadline = Date.now() + 280_000;
  while (Date.now() < deadline) {
    const before = await screenState(page);
    if (before.done) break;
    if (before.round > 0) rounds.add(before.round);
    if (before.round === 0 || !before.searchVisible) {
      await page.waitForTimeout(400);
      continue;
    }
    const choose = page.getByRole("button", { name: CHOOSE_BUTTON });
    // Si el jugador ya dejó un héroe abierto con su botón a la vista, lo confirma; volver a tocar la carta cerraría el análisis.
    // Abrir el análisis es un TOGGLE: un segundo clic sobre la misma carta lo cierra. En CI (más lento) el tablero se reordena justo después de un pick y el primer
    // clic podía caer antes de que la carta estuviera lista o cerrar un análisis recién abierto. Por eso cada intento mira primero el ESTADO REAL (¿ya está el
    // botón «Elegir»?) y solo clica si no está -- nunca clica a ciegas dos veces ni alarga el plazo (3 intentos de 5 s).
    for (let attempt = 0; attempt < 3 && !(await choose.isVisible()); attempt += 1) {
      const available = prefer === "card" && (await cards(page).count()) > 0;
      if (available) await cards(page).first().click();
      else await page.getByRole("region", { name: "Buscar otro héroe" }).locator(".sl-picker-row:not([disabled])").first().click();
      await choose.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
    }
    // Si el botón visible era el del análisis del pick ANTERIOR (que se está cerrando), aparece un instante y desaparece: se vuelve a evaluar el estado real
    // desde el principio de la vuelta, en lugar de fallar o de confirmar un análisis que ya no existe.
    const ready = await choose.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false);
    if (!ready) continue;
    await choose.click();
    picks += 1;
    await expect
      .poll(async () => {
        const now = await screenState(page);
        return now.done || now.pending !== before.pending || !now.searchVisible || now.round !== before.round;
      }, { timeout: 150_000 })
      .toBe(true);
    // El análisis del pick recién sellado se cierra: no se arranca la vuelta siguiente con su botón todavía en pantalla.
    await choose.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
  }
  expect((await screenState(page)).done, "el draft termina").toBe(true);
  return { rounds: [...rounds].sort(), picks };
}

test.describe("Simulador jugable · escritorio 1600×900", () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test("1 · Solo completo: recomendado → ver por qué → «Elegir a …» → pick sellado → draft completo", async ({ page }) => {
    test.setTimeout(180_000);
    await begin(page, SOLO_STRONG);

    // ¿Dónde estoy y qué hago? La pantalla lo dice sin buscar nada.
    await expect(page.getByText("Ronda 1 de 3 · Elige 1 héroe")).toBeVisible();
    await expect(page.getByText("Tu posición", { exact: true })).toBeVisible();
    await expect(page.getByText("Posiciones humanas pendientes: Pos2")).toBeVisible();
    await expect(page.getByText("Selecciona un héroe para ver su análisis")).toBeVisible();
    await page.screenshot({ path: resolve(OUT, "1600x900-1-antes-de-elegir.png") });

    // Abro el recomendado (ELIGE AHORA). El clic solo abre el análisis.
    const recommended = page.getByTestId("team-coach-board").locator('[data-recommended="true"] button').first();
    await expect(recommended).toBeVisible();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await recommended.click();
    const choose = page.getByRole("button", { name: CHOOSE_BUTTON });
    await expect(choose).toBeVisible();
    await expect(choose).toHaveText(`Elegir a ${SOLO_STRONG.expectedRecommended}`);
    await expect(page.getByText("Análisis del candidato")).toBeVisible();
    // El botón está a la vista SIN desplazarse y nada lo tapa.
    expect(await page.evaluate(() => window.scrollY), "no hizo falta desplazarse").toBe(scrollBefore);
    expect(await isUsableInView(choose), "«Elegir a …» visible y sin tapar").toBe(true);
    // Y todavía no se eligió nada.
    await page.waitForTimeout(1_500);
    await expect(page.getByText("Posiciones humanas pendientes: Pos2")).toBeVisible();
    await expect(page.getByText("Draft completo")).toHaveCount(0);
    await page.screenshot({ path: resolve(OUT, "1600x900-2-heroe-seleccionado-con-boton.png") });

    // Confirmo con el botón: queda en SU posición y el draft sigue.
    await choose.click();
    await expect.poll(async () => new RegExp(`Pos2 Mid\\s+${SOLO_STRONG.expectedRecommended}\\b`).test(await page.locator("body").innerText()), { timeout: 30_000 }).toBe(true);
    await page.screenshot({ path: resolve(OUT, "1600x900-3-despues-de-confirmar.png") });
    await expect(page.getByText("Draft completo")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("summary-user-picks").first()).toContainText(SOLO_STRONG.expectedRecommended ?? "");
    await page.screenshot({ path: resolve(OUT, "1600x900-4-draft-solo-completo.png"), fullPage: true });
  });

  test("2 · Solo: elijo un héroe ALTERNATIVO (otra carta, no la recomendada)", async ({ page }) => {
    test.setTimeout(180_000);
    await begin(page, SOLO_STRONG);
    const alternative = page.getByTestId("team-coach-board").locator('[data-card-key]:not([data-recommended="true"]) button').first();
    await expect(alternative).toBeVisible();
    await alternative.click();
    const choose = page.getByRole("button", { name: CHOOSE_BUTTON });
    await expect(choose).toBeVisible();
    const name = ((await choose.textContent()) ?? "").replace(/^Elegir a /, "").trim();
    expect(name).not.toBe(SOLO_STRONG.expectedRecommended);
    expect(await isUsableInView(choose)).toBe(true);
    await choose.click();
    await expect(page.getByText("Draft completo")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("summary-user-picks").first()).toContainText(name);
  });

  test("3 · Solo: busco por nombre un héroe que el coach NO recomendó, se abre su análisis y lo elijo con el botón", async ({ page }) => {
    test.setTimeout(180_000);
    await begin(page, SOLO_STRONG);
    const proposed = await page.getByTestId("team-coach-board").locator("[data-card-key]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-hero-id")));
    expect(proposed.length).toBeGreaterThan(0);
    await searchHero(page, "Axe");
    // El resultado solo abre el análisis: hay botón, el pick sigue pendiente.
    const choose = page.getByRole("button", { name: "Elegir a Axe como Pos2 Mid" });
    await expect(choose).toBeVisible();
    await expect(page.getByText("El coach no analizó a este héroe")).toBeVisible();
    expect(await isUsableInView(choose)).toBe(true);
    await page.waitForTimeout(1_000);
    await expect(page.getByText("Posiciones humanas pendientes: Pos2")).toBeVisible();
    await page.screenshot({ path: resolve(OUT, "1600x900-5-busqueda-con-boton.png") });
    await choose.click();
    await expect(page.getByText("Draft completo")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("summary-user-picks").first()).toContainText("Axe");
  });

  test("4 · Un héroe baneado se ve deshabilitado y rotulado: no hay forma de elegirlo", async ({ page }) => {
    await begin(page, SOLO_STRONG);
    // Un héroe baneado DE VERDAD: el que la pantalla muestra en la franja de bans resueltos (no una nominación mía).
    const bannedNames = (await page.getByTestId("resolved-bans").locator("span.sr-only").allTextContents()).map((name) => name.trim()).filter((name) => name.length > 0);
    expect(bannedNames.length, "la franja de bans muestra los baneados").toBeGreaterThan(0);
    const bannedName = bannedNames[0];
    const search = page.getByRole("region", { name: "Buscar otro héroe" });
    await search.getByPlaceholder("Buscar héroe...").fill(bannedName);
    const banned = search.getByRole("button", { name: new RegExp(`^${bannedName}`) }).first();
    await expect(banned).toBeDisabled();
    await expect(banned).toContainText("baneado o ya elegido");
    await banned.click({ force: true, timeout: 2_000 }).catch(() => undefined);
    await expect(page.getByRole("button", { name: CHOOSE_BUTTON })).toHaveCount(0);
    await expect(page.getByText("Selecciona un héroe para ver su análisis")).toBeVisible();
    await page.screenshot({ path: resolve(OUT, "1600x900-6-baneado-deshabilitado.png") });
  });

  test("5 · Posición no controlada: en Solo solo existe Pos2 (una columna, un destino), nunca otra", async ({ page }) => {
    await begin(page, SOLO_STRONG);
    await expect(page.getByTestId("team-coach-board").locator("[data-testid^='team-coach-column-']")).toHaveCount(1);
    const group = page.getByRole("group", { name: "Posición para el próximo pick" });
    await expect(group.getByRole("button")).toHaveCount(1);
    await expect(group.getByRole("button", { name: /^Pos2 Mid/ })).toBeVisible();
    for (const other of ["Pos1", "Pos3", "Pos4", "Pos5"]) await expect(group.getByRole("button", { name: new RegExp(`^${other}`) })).toHaveCount(0);
    // Todas las cartas ofrecen elegir solo para Pos2.
    const total = await cards(page).count();
    for (let index = 0; index < Math.min(total, 3); index += 1) {
      await cards(page).nth(index).click();
      await expect(page.getByRole("button", { name: /^Elegir a .+ como Pos2 Mid$/ })).toBeVisible();
    }
  });

  test("6 · Sin recomendaciones del coach igual puedo hacer un pick legal con el buscador y terminar", async ({ page }) => {
    test.setTimeout(180_000);
    await begin(page, SOLO_CERO);
    await expect(cards(page)).toHaveCount(0);
    await expect(page.getByText(/Sin recomendaciones disponibles con la información actual/)).toBeVisible();
    // La salida está a la vista: el buscador está visible sin abrir nada y sin desplazarse.
    const search = page.getByRole("region", { name: "Buscar otro héroe" });
    await expect(search).toBeVisible();
    expect(await isUsableInView(search.getByPlaceholder("Buscar héroe..."))).toBe(true);
    await page.screenshot({ path: resolve(OUT, "1600x900-7-sin-recomendaciones.png") });
    await searchHero(page, "Axe");
    const choose = page.getByRole("button", { name: "Elegir a Axe como Pos2 Mid" });
    await expect(choose).toBeVisible();
    await choose.click();
    await expect(page.getByText("Draft completo")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("summary-user-picks").first()).toContainText("Axe");
  });

  test("9 · Reloj, reinicio y nuevo draft: el tiempo corre, «Reiniciar draft» vuelve a la configuración", async ({ page }) => {
    await begin(page, SOLO_STRONG);
    const strip = page.getByTestId("draft-sticky-strip");
    const seconds = async () => Number(/(\d+)s/.exec((await strip.innerText()) ?? "")?.[1] ?? "-1");
    const first = await seconds();
    expect(first).toBeGreaterThan(0);
    await expect.poll(seconds, { timeout: 10_000, message: "el reloj baja solo" }).toBeLessThan(first);
    await page.getByRole("button", { name: "Reiniciar draft" }).click();
    await expect(page.getByRole("button", { name: "Iniciar Draft" })).toBeVisible();
    await expect(page.getByText(/Ronda \d de 3/)).toHaveCount(0);
  });
});

test.describe("Simulador jugable · Party 2 / 3 / 5 (draft completo, cambio de ronda)", () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test("8 · Party 2: dos posiciones controladas, recomendado para Pos5 con su botón, y el draft termina pasando por las rondas", async ({ page }) => {
    test.setTimeout(300_000);
    await begin(page, PARTY2);
    await expect(page.getByText(/Tu party: Pos 2, Pos 5 · Tú: Pos5/)).toBeVisible();
    const columns = page.getByTestId("team-coach-board").locator("[data-testid^='team-coach-column-']");
    await expect(columns).toHaveCount(2);
    const group = page.getByRole("group", { name: "Posición para el próximo pick" });
    await expect(group.getByRole("button")).toHaveCount(2);
    const recommended = page.getByTestId("team-coach-board").locator('[data-recommended="true"] button').first();
    await recommended.click();
    const choose = page.getByRole("button", { name: CHOOSE_BUTTON });
    await expect(choose).toContainText(PARTY2.expectedRecommended ?? "");
    await expect(choose).toHaveAttribute("aria-label", /como Pos5 Hard Support$/);
    expect(await isUsableInView(choose)).toBe(true);
    await page.screenshot({ path: resolve(OUT, "1600x900-party2-con-boton.png") });
    await choose.click();
    const { rounds, picks } = await playToEnd(page);
    expect(picks).toBeGreaterThanOrEqual(1);
    expect(rounds.length).toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: resolve(OUT, "1600x900-party2-completo.png"), fullPage: true });
  });

  for (const item of [PARTY3, PARTY5]) {
    test(`8 · ${item.id}: columnas = posiciones controladas, un solo botón por análisis y el draft termina`, async ({ page }) => {
      test.setTimeout(420_000);
      await begin(page, item);
      const columns = page.getByTestId("team-coach-board").locator("[data-testid^='team-coach-column-']");
      await expect(columns).toHaveCount(item.size);
      if ((await cards(page).count()) > 0) {
        await cards(page).first().click();
        await expect(page.getByRole("button", { name: CHOOSE_BUTTON })).toHaveCount(1);
      }
      await page.screenshot({ path: resolve(OUT, `1600x900-${item.id}-inicio.png`) });
      const { rounds, picks } = await playToEnd(page);
      expect(picks, "cada posición controlada hace su pick humano").toBeGreaterThanOrEqual(item.size);
      expect(rounds.length, "el tablero atravesó varias rondas").toBeGreaterThanOrEqual(2);
      await page.screenshot({ path: resolve(OUT, `1600x900-${item.id}-completo.png`), fullPage: true });
    });
  }
});

const VIEWPORTS = [
  { name: "1600x900", width: 1600, height: 900, strict: true },
  { name: "1366x768", width: 1366, height: 768, strict: false },
  { name: "800x900", width: 800, height: 900, strict: false },
  { name: "390x844", width: 390, height: 844, strict: false },
] as const;

for (const view of VIEWPORTS) {
  test.describe(`Simulador jugable · una sola pantalla de juego · ${view.name}`, () => {
    test.use({ viewport: { width: view.width, height: view.height } });

    test("el botón para elegir queda a la vista al abrir un héroe, sin segundo tablero y sin desborde horizontal", async ({ page }) => {
      test.setTimeout(120_000);
      await begin(page, SOLO_STRONG);
      await page.screenshot({ path: resolve(OUT, `${view.name}-a-antes.png`) });

      await page.getByTestId("team-coach-board").locator('[data-recommended="true"] button').first().click();
      const choose = page.getByRole("button", { name: CHOOSE_BUTTON });
      await expect(choose).toBeVisible();
      await page.waitForTimeout(600);
      expect(await isUsableInView(choose), `«Elegir a …» a la vista en ${view.name}`).toBe(true);
      await page.screenshot({ path: resolve(OUT, `${view.name}-b-heroe-y-boton.png`) });

      // UN solo tablero, UN solo análisis, UN solo botón de elegir; el Copilot ya no es un segundo tablero.
      await expect(page.getByTestId("team-coach-board")).toHaveCount(1);
      await expect(page.getByText("Análisis del candidato")).toHaveCount(1);
      await expect(page.getByRole("button", { name: CHOOSE_BUTTON })).toHaveCount(1);
      await expect(page.getByTestId("team-roster")).toHaveCount(1);
      // El Copilot duplicado no existe en el DOM (ni plegado): ni panel, ni plegable de diagnóstico, ni su título.
      await expect(page.getByTestId("copilot-panel")).toHaveCount(0);
      await expect(page.getByTestId("coach-details")).toHaveCount(0);
      await expect(page.getByText("Detalle del coach")).toHaveCount(0);
      await expect(page.getByText("diagnóstico", { exact: false })).toHaveCount(0);
      const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
      expect(overflow, "sin scroll horizontal").toBeLessThanOrEqual(1);

      await choose.click();
      await expect.poll(async () => /Pos2 Mid\s+Leshrac\b/.test(await page.locator("body").innerText()), { timeout: 30_000 }).toBe(true);
      await page.screenshot({ path: resolve(OUT, `${view.name}-c-despues.png`) });
    });
  });
}

test.describe("Test de usabilidad automatizado · primer uso, solo con lo que ve el jugador", () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test("la pantalla comunica: dónde estoy, qué hago, qué héroe analizo, cómo lo elijo y qué ocurrió", async ({ page }) => {
    test.setTimeout(180_000);
    await begin(page, SOLO_STRONG);
    const log: string[] = [];

    // Dónde estoy.
    await expect(page.getByText(/Ronda 1 de 3/)).toBeVisible();
    await expect(page.getByText("Tu posición", { exact: true })).toBeVisible();
    log.push("DÓNDE ESTOY: ronda 1 de 3 y «Tu posición» visibles");
    // Qué debo hacer ahora.
    await expect(page.getByText("Elige 1 héroe")).toBeVisible();
    await expect(page.getByText(/Toca un héroe para ver por qué se recomienda y pulsa «Elegir» para confirmarlo/)).toBeVisible();
    log.push("QUÉ HAGO: «Elige 1 héroe» + instrucción de tocar, ver y pulsar «Elegir»");
    // Veo los héroes recomendados y el motor dice cuál es el de ahora.
    await expect(page.getByText("ELIGE AHORA").first()).toBeVisible();
    log.push("RECOMENDADOS: tarjetas por posición y «ELIGE AHORA»");
    // Qué héroe estoy analizando.
    await page.getByText("ELIGE AHORA").first().click();
    await expect(page.getByText("Análisis del candidato")).toBeVisible();
    await expect(page.getByRole("heading", { name: SOLO_STRONG.expectedRecommended ?? "", exact: true })).toBeVisible();
    log.push("ANALIZO: panel «Análisis del candidato» con el nombre del héroe");
    // Cómo lo elijo.
    const choose = page.getByRole("button", { name: `Elegir a ${SOLO_STRONG.expectedRecommended} como Pos2 Mid` });
    await expect(choose).toBeVisible();
    expect(await isUsableInView(choose)).toBe(true);
    log.push("CÓMO LO ELIJO: botón «Elegir a Leshrac» a la vista");
    await choose.click();
    // Qué ocurrió después.
    await expect(page.getByText(/Pos2 Mid\s*Leshrac/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Draft completo")).toBeVisible({ timeout: 120_000 });
    log.push("QUÉ OCURRIÓ: Leshrac queda en Pos2 Mid y aparece «Draft completo»");
    test.info().annotations.push({ type: "usabilidad", description: log.join(" | ") });
    console.log(`USABILIDAD ${log.join(" | ")}`);
  });
});
