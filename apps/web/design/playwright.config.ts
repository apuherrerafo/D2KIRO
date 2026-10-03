import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.pw.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: "http://127.0.0.1:6110",
    colorScheme: "dark",
    locale: "en-US",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { height: 720, width: 960 },
  },
  webServer: {
    command: "bun run design/serve-static.ts",
    cwd: process.cwd(),
    port: 6110,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
