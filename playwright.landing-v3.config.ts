import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";

// Landing V3 release checks (NOT part of `bun run e2e`). `/` is public, so no session is needed: LANDING_VARIANT=v3 serves the page.
//   NEXT_DIST_DIR=.next-landing-v3 npx next build   (from apps/web, with SESSION_SECRET / INTERNAL_AUTH_SECRET set)
//   LAB_PROD=1 LAB_REUSE=1 LAB_PORT=3211 npx playwright test -c playwright.landing-v3.config.ts
// Four projects: the two desktop widths that matter, the phone (iPhone-class WebKit) and desktop with reduced motion.
const WEB_PORT = Number(process.env.LAB_PORT ?? 3151);
const SESSION_SECRET = process.env.LAB_SESSION_SECRET ?? randomBytes(32).toString("hex");
const INTERNAL_AUTH_SECRET = process.env.LAB_INTERNAL_AUTH_SECRET ?? randomBytes(32).toString("hex");

export default defineConfig({
  testDir: "./e2e-landing-v3",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${WEB_PORT}` },
  projects: [
    { name: "desktop-1440", use: { browserName: "chromium", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
    { name: "desktop-1024", use: { browserName: "chromium", viewport: { width: 1024, height: 900 }, deviceScaleFactor: 1 } },
    { name: "mobile-390", use: { ...devices["iPhone 14"], browserName: "webkit", viewport: { width: 390, height: 844 } } },
    { name: "reduced-1440", use: { browserName: "chromium", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" } },
  ],
  webServer: {
    command: process.env.LAB_PROD === "1" ? `npx next start -p ${WEB_PORT}` : `npx next dev -p ${WEB_PORT}`,
    cwd: "apps/web",
    port: WEB_PORT,
    reuseExistingServer: process.env.LAB_REUSE === "1",
    timeout: 600_000,
    env: { SESSION_SECRET, INTERNAL_AUTH_SECRET, NEXT_DIST_DIR: ".next-landing-v3", LANDING_VARIANT: "v3", PUBLIC_BASE_URL: `http://localhost:${WEB_PORT}` },
  },
});
