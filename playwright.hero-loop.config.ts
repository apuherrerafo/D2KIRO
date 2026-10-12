import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Hero Loop Lab review harness (lab only; NOT part of `bun run e2e`). proxy.ts is untouched: a valid session cookie is
// sealed with this run's ephemeral SESSION_SECRET, so /lab/hero-loop is reached through the real gate.
//   npx playwright test -c playwright.hero-loop.config.ts
const WEB_PORT = 3130;
const SESSION_SECRET = process.env.LAB_SESSION_SECRET ?? randomBytes(32).toString("hex");
const INTERNAL_AUTH_SECRET = process.env.LAB_INTERNAL_AUTH_SECRET ?? randomBytes(32).toString("hex");
mkdirSync(resolve("e2e-hero-loop/.tmp"), { recursive: true });

process.env.LAB_SESSION_SECRET = SESSION_SECRET;
process.env.LAB_INTERNAL_AUTH_SECRET = INTERNAL_AUTH_SECRET;
process.env.LAB_BASE_URL = `http://localhost:${WEB_PORT}`;

const prod = process.env.LAB_SERVER === "prod";

export default defineConfig({
  testDir: "./e2e-hero-loop",
  globalSetup: "./e2e-hero-loop/global-setup.ts",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    storageState: "e2e-hero-loop/.tmp/session.json",
  },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] } } },
    // the product's phone target: iPhone-class WebKit, 390x844
    { name: "mobile", use: { ...devices["iPhone 14"], browserName: "webkit", viewport: { width: 390, height: 844 } } },
    // frame-accurate desktop capture: the default headless pipeline (the SwiftShader flags above slow compositing to ~5 fps)
    { name: "desktop-capture", use: { browserName: "chromium", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
    // frame-accurate mobile layout: Playwright's WebKit on Windows renders this page at ~4 fps, which cannot resolve a carry
    { name: "mobile-chromium", use: { ...devices["iPhone 14"], browserName: "chromium", defaultBrowserType: "chromium", viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: prod ? `npx next build && npx next start -p ${WEB_PORT}` : `npx next dev -p ${WEB_PORT}`,
    cwd: "apps/web",
    port: WEB_PORT,
    reuseExistingServer: process.env.LAB_REUSE === "1",
    timeout: 600_000,
    env: { SESSION_SECRET, INTERNAL_AUTH_SECRET, NEXT_DIST_DIR: ".next-hero-loop" },
  },
});
