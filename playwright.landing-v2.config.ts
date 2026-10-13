import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Landing V2 review harness (lab only; NOT part of `bun run e2e`). proxy.ts is untouched: a valid session cookie is
// sealed with this run's ephemeral SESSION_SECRET, so /lab/landing-v2 is reached through the real gate.
//   npx playwright test -c playwright.landing-v2.config.ts
const WEB_PORT = 3141;
const SESSION_SECRET = process.env.LAB_SESSION_SECRET ?? randomBytes(32).toString("hex");
const INTERNAL_AUTH_SECRET = process.env.LAB_INTERNAL_AUTH_SECRET ?? randomBytes(32).toString("hex");
mkdirSync(resolve("e2e-landing-v2/.tmp"), { recursive: true });

process.env.LAB_SESSION_SECRET = SESSION_SECRET;
process.env.LAB_INTERNAL_AUTH_SECRET = INTERNAL_AUTH_SECRET;
process.env.LAB_BASE_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: "./e2e-landing-v2",
  globalSetup: "./e2e-landing-v2/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${WEB_PORT}`, storageState: "e2e-landing-v2/.tmp/session.json" },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
    // the product's phone target: iPhone-class WebKit, 390x844
    { name: "mobile", use: { ...devices["iPhone 14"], browserName: "webkit", viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    // LAB_PROD=1 serves the production build (`NEXT_DIST_DIR=.next-landing-v2 npx next build` first) for measurements
    command: process.env.LAB_PROD === "1" ? `npx next start -p ${WEB_PORT}` : `npx next dev -p ${WEB_PORT}`,
    cwd: "apps/web",
    port: WEB_PORT,
    reuseExistingServer: process.env.LAB_REUSE === "1",
    timeout: 600_000,
    env: { SESSION_SECRET, INTERNAL_AUTH_SECRET, NEXT_DIST_DIR: ".next-landing-v2" },
  },
});
