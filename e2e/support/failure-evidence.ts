import { test as base } from "@playwright/test";

/** Attach browser-only diagnostics without changing test assertions or retry policy. */
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? "unknown"}`));
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach("browser-failure-context", {
        contentType: "application/json",
        body: Buffer.from(JSON.stringify({
          scenario: testInfo.titlePath,
          commitSha: process.env.E2E_COMMIT_SHA ?? "unknown",
          consoleErrors,
          failedRequests,
        }, null, 2)),
      });
    }
  },
});

export { expect } from "@playwright/test";
