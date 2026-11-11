import { test as base } from "@playwright/test";

/** Attach browser-only diagnostics without changing test assertions or retry policy. */
//
// P0 «Simulador jugable»: el producto deja el «Detalle del coach» (Copilot V4) PLEGADO por defecto: el tablero es el único lugar de juego.
// Las suites certificadas que leen el contenido de ese panel (decisión V4, creencias de rol, feedback) lo abren como lo haría un jugador;
// `test.use({ coachDetailsOpen: false })` conserva el estado plegado real (la aceptación jugable lo exige).
export const test = base.extend<{ coachDetailsOpen: boolean }>({
  coachDetailsOpen: [true, { option: true }],
  page: async ({ page, coachDetailsOpen }, use, testInfo) => {
    if (coachDetailsOpen) {
      await page.addInitScript(() => {
        const openOnce = () => {
          document.querySelectorAll<HTMLDetailsElement>('details[data-testid="coach-details"]:not([data-e2e-opened])').forEach((details) => {
            details.setAttribute("data-e2e-opened", "1");
            details.open = true;
          });
        };
        const watch = () => new MutationObserver(openOnce).observe(document.documentElement, { childList: true, subtree: true });
        if (document.documentElement) watch();
        else document.addEventListener("DOMContentLoaded", watch);
      });
    }
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
