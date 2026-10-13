import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/* Project cockpit visual check, through the real auth gate:
   npx playwright test -c playwright.landing-v2.config.ts cockpit */
const OUT = resolve("docs/project-status");
mkdirSync(OUT, { recursive: true });

test("cockpit renders without horizontal overflow", async ({ page }, info) => {
  await page.goto("/lab/status");
  await expect(page.getByText("PROJECT COCKPIT")).toBeVisible();
  await expect(page.getByText("89%").first()).toBeVisible();
  // scoped to the cockpit: the authenticated app shell around it has its own header
  const overflow = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll("main, main *")].map((e) => e.getBoundingClientRect().right - innerWidth)));
  expect(overflow).toBeLessThanOrEqual(0);
  if (info.project.name === "mobile") {
    const y = (t: string) => page.getByRole("heading", { name: t }).evaluate((e) => e.getBoundingClientRect().top);
    expect(await y("OPEN BEFORE PRODUCTION")).toBeLessThan(await y("STATUS"));
  }
  await page.screenshot({ path: resolve(OUT, `cockpit-${info.project.name}.png`), fullPage: true });
});
