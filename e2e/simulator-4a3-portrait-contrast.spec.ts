import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "./support/failure-evidence";

// Fase 4A.3 · contraste del nombre del héroe sobre el retrato (texto sobre imagen: axe no lo decide). Se oculta el texto, se captura el fondo real
// y se calcula el ratio del color del texto contra el PEOR píxel (el más cercano en luminancia) y contra el percentil 95 de los píxeles de la caja.
test("4A.3 · contraste del nombre sobre el retrato (píxeles reales)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/simulator");
  await page.getByRole("group", { name: "Tu lado" }).getByRole("button", { name: "Radiant", exact: true }).click();
  await page.getByRole("group", { name: "Tamaño de party" }).getByRole("button", { name: "Solo (1)" }).click();
  await page.getByRole("group", { name: "Tu posición personal" }).getByRole("button", { name: "Posición 2 — Midlane" }).click();
  await page.locator('input[maxlength="8"]').fill("CURATED1");
  for (const hero of ["Anti-Mage", "Nyx Assassin", "Riki", "Disruptor"]) {
    await page.getByRole("button", { name: "Agregar héroe" }).click();
    await page.getByRole("dialog").locator(`button[title="${hero}"]`).click();
  }
  await page.getByRole("button", { name: "Iniciar Draft" }).click();
  await expect(page.getByTestId("team-coach-board").locator("[data-card-key] button").first()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("team-coach-board").locator("[data-card-key] button").first().click();
  const name = page.locator(".sl-detail .chm-portrait-name").first();
  await expect(name).toBeVisible();
  await page.waitForTimeout(800);
  const box = await name.boundingBox();
  const color = await name.evaluate((el) => getComputedStyle(el).color);
  const size = await name.evaluate((el) => `${getComputedStyle(el).fontSize}/${getComputedStyle(el).fontWeight}`);
  await name.evaluate((el) => { (el as HTMLElement).style.color = "transparent"; (el as HTMLElement).style.textShadow = "none"; });
  const png = await page.screenshot({ clip: { x: box!.x, y: box!.y, width: box!.width, height: box!.height } });
  await name.evaluate((el) => { (el as HTMLElement).style.color = ""; (el as HTMLElement).style.textShadow = ""; });
  const result = await page.evaluate(async ({ b64, textColor }) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d")!; g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    const t = /rgba?\(([^)]+)\)/.exec(textColor)![1].split(/[ ,/]+/).map(Number);
    const L = (r: number, gg: number, bb: number) => { const f = [r, gg, bb].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
    const lt = L(t[0], t[1], t[2]);
    const ratios: number[] = [];
    for (let i = 0; i < data.length; i += 4) { const lb = L(data[i], data[i + 1], data[i + 2]); ratios.push((Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05)); }
    ratios.sort((x, y) => x - y);
    return { pixels: ratios.length, worst: ratios[0], p05: ratios[Math.floor(ratios.length * 0.05)], median: ratios[Math.floor(ratios.length / 2)] };
  }, { b64: png.toString("base64"), textColor: color });
  writeFileSync(resolve(process.cwd(), "docs/research/phase-4a3/contrast-portrait-name.json"), JSON.stringify({ textColor: color, fontSizeWeight: size, box, ...result, required: 4.5 }, null, 2));
  expect(result.pixels).toBeGreaterThan(0);
});
