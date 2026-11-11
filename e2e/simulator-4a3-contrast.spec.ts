import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { expect, test } from "./support/failure-evidence";
import type { Page } from "@playwright/test";

// Fase 4A.3 · los nodos `color-contrast` que axe marca como «incomplete» (no pudo decidir) se calculan a mano: color del texto compuesto sobre el fondo
// opaco efectivo (se sube por los ancestros componiendo alfas). Si el fondo es imagen/gradiente/no resoluble queda como NO RESUELTO (revisión visual).
// Umbral WCAG AA: 4.5:1 (3:1 si el texto es grande: >=24px, o >=18.66px en negrita). Dos escenarios reales: Solo STRONG (análisis abierto) y Party 2 STRONG.
const webRequire = createRequire(resolve(process.cwd(), "apps/web/package.json"));
const AxeBuilder = (webRequire("@axe-core/playwright") as { AxeBuilder?: unknown }).AxeBuilder as typeof import("@axe-core/playwright").AxeBuilder;
const OUT = resolve(process.cwd(), "docs/research/phase-4a3");
mkdirSync(OUT, { recursive: true });

interface Case { id: string; size: 1 | 2; positions: string[]; personal: string; seed: string; bans: string[] }
const CASES: Case[] = [
  { id: "solo-strong", size: 1, positions: [], personal: "Posición 2 — Midlane", seed: "CURATED1", bans: ["Anti-Mage", "Nyx Assassin", "Riki", "Disruptor"] },
  { id: "party2-strong", size: 2, positions: ["Posición 2 — Midlane", "Posición 5 — Hard support"], personal: "Posición 5 — Hard support", seed: "CURATED3", bans: ["Doom", "Ancient Apparition", "Shadow Demon", "Troll Warlord"] },
];

async function start(page: Page, item: Case) {
  await page.goto("/simulator");
  await page.getByRole("group", { name: "Tu lado" }).getByRole("button", { name: "Radiant", exact: true }).click();
  await page.getByRole("group", { name: "Tamaño de party" }).getByRole("button", { name: item.size === 1 ? "Solo (1)" : `Party ${item.size}` }).click();
  for (const pos of item.positions) await page.getByRole("group", { name: "Posiciones de tu party" }).getByRole("button", { name: pos }).click();
  await page.getByRole("group", { name: "Tu posición personal" }).getByRole("button", { name: item.personal }).click();
  await page.locator('input[maxlength="8"]').fill(item.seed);
  for (const name of item.bans) {
    await page.getByRole("button", { name: "Agregar héroe" }).click();
    await page.getByRole("dialog").locator(`button[title="${name}"]`).click();
  }
  await page.getByRole("button", { name: "Iniciar Draft" }).click();
  await expect(page.getByTestId("team-coach-board").locator("[data-recommended='true']").first()).toBeVisible({ timeout: 60_000 });
}

interface NodeResult { target: string; text: string; ratio: number | null; required: number; verdict: "OK" | "FALLA" | "NO RESUELTO"; why?: string }

for (const item of CASES) {
  test(`4A.3 · contraste incomplete · ${item.id}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await start(page, item);
    await page.getByTestId("team-coach-board").locator('[data-recommended="true"] button').first().click();
    await expect(page.getByTestId("sl-decision")).toBeVisible();
    await page.waitForTimeout(800); // settleIn del panel
    const axe = await new AxeBuilder({ page }).withTags(["wcag2aa", "wcag21aa", "wcag22aa"]).options({ runOnly: ["color-contrast"] }).analyze();
    const incomplete = axe.incomplete.find((entry) => entry.id === "color-contrast");
    const selectors = (incomplete?.nodes ?? []).map((node) => node.target.join(" "));
    const results: NodeResult[] = await page.evaluate((list) => {
      type Rgba = [number, number, number, number];
      function parse(value: string): Rgba | null {
        const m = /rgba?\(([^)]+)\)/.exec(value);
        if (!m) return null;
        const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return [p[0], p[1], p[2], p[3] ?? 1];
      }
      function over(top: Rgba, bottom: [number, number, number]): [number, number, number] {
        return [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])) as [number, number, number];
      }
      function lum(c: [number, number, number]): number {
        const f = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
      }
      return list.map((sel) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        const text = (el?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
        if (!el) return { target: sel, text, ratio: null, required: 4.5, verdict: "NO RESUELTO" as const, why: "nodo ya no existe" };
        const cs = getComputedStyle(el);
        const size = parseFloat(cs.fontSize);
        const bold = Number(cs.fontWeight) >= 700;
        const required = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
        // fondo: ancestros, de fuera hacia dentro
        const chain: HTMLElement[] = [];
        for (let n: HTMLElement | null = el; n; n = n.parentElement) chain.push(n);
        let unresolved: string | null = null;
        let bg: [number, number, number] = [255, 255, 255];
        let sawOpaque = false;
        for (const n of chain.reverse()) {
          const s = getComputedStyle(n);
          if (s.backgroundImage !== "none" && n !== el.parentElement && !sawOpaque) { /* se evalúa abajo */ }
          if (s.backgroundImage !== "none") unresolved = `fondo con imagen/gradiente en <${n.tagName.toLowerCase()} class="${n.className.toString().slice(0, 40)}">`;
          const c = parse(s.backgroundColor);
          if (c && c[3] > 0) { bg = over(c, bg); if (c[3] === 1) sawOpaque = true; }
          if (n !== el && s.opacity !== "1") unresolved = `opacity ${s.opacity} en un ancestro`;
        }
        const fg = parse(cs.color);
        if (!fg) return { target: sel, text, ratio: null, required, verdict: "NO RESUELTO" as const, why: "color de texto no legible" };
        const fgc = over(fg, bg);
        const a = lum(fgc), b = lum(bg);
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        if (unresolved !== null) return { target: sel, text, ratio: Math.round(ratio * 100) / 100, required, verdict: ratio >= required + 1.5 ? "OK" as const : "NO RESUELTO" as const, why: unresolved + (ratio >= required + 1.5 ? " (pero el ratio contra el color base supera el umbral con holgura 1.5)" : "") };
        return { target: sel, text, ratio: Math.round(ratio * 100) / 100, required, verdict: ratio >= required ? "OK" as const : "FALLA" as const };
      });
    }, selectors);
    const summary = { OK: results.filter((r) => r.verdict === "OK").length, FALLA: results.filter((r) => r.verdict === "FALLA").length, NO_RESUELTO: results.filter((r) => r.verdict === "NO RESUELTO").length };
    writeFileSync(resolve(OUT, `contrast-incomplete-${item.id}.json`), JSON.stringify({ incompleteNodes: selectors.length, summary, results }, null, 2));
    expect(selectors.length).toBeGreaterThan(0);
  });
}
