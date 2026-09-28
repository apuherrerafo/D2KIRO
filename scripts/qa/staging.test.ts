import { expect, test } from "bun:test";
import {
  formatFailureReport,
  formatScenarioProgress,
  pollUntilAuthenticated,
  redactSessionId,
  type AuthPoller,
  type SmokeFailureReport,
} from "./staging";

function fakePoller(checks: (() => Promise<boolean>)[]): AuthPoller & { calls: number } {
  const state = { calls: 0 };
  return {
    calls: state.calls,
    async check() {
      const step = checks[Math.min(state.calls, checks.length - 1)];
      state.calls += 1;
      this.calls = state.calls;
      return step();
    },
    async wait() {
      // No espera real: la resolución de qué tan seguido se sondea no es el objeto de estas
      // pruebas, sólo el control de flujo (sigue sondeando vs. corta y guarda).
    },
  };
}

test("sesion no autenticada al inicio -> sigue sondeando hasta autenticarse", async () => {
  const poller = fakePoller([
    async () => false,
    async () => false,
    async () => true,
  ]);

  const authenticated = await pollUntilAuthenticated(poller, 5_000, 0);

  expect(authenticated).toBe(true);
  expect(poller.calls).toBe(3);
});

test("la autenticacion nunca llega -> corta por timeout sin declarar exito", async () => {
  const poller = fakePoller([async () => false]);

  const authenticated = await pollUntilAuthenticated(poller, 30, 5);

  expect(authenticated).toBe(false);
  expect(poller.calls).toBeGreaterThan(1);
});

test("un error transitorio de sondeo (navegacion en curso por el redirect de Steam) no aborta el sondeo", async () => {
  const poller = fakePoller([
    async () => {
      throw new Error("Execution context was destroyed, most likely because of a navigation.");
    },
    async () => true,
  ]);

  const authenticated = await pollUntilAuthenticated(poller, 5_000, 0);

  expect(authenticated).toBe(true);
  expect(poller.calls).toBe(2);
});

function fixtureFailureReport(overrides: Partial<SmokeFailureReport> = {}): SmokeFailureReport {
  return {
    scenario: "SMOKE-07 BASIC PROGRESSION",
    route: "/engine/api/session/protocol/abc123/command",
    method: "POST",
    status: 409,
    expectedStatus: 202,
    errorClass: "no_accepted_human_pick",
    errorMessage: "no_accepted_human_pick",
    lastGoodState: "SMOKE-02/03/04/05 SOLO POS2",
    unexpected5xx: 0,
    artifactDir: "artifacts/qa/staging/2026-09-28T16-34-42-896Z",
    sessionId: "11111111-2222-3333-4444-555555555555",
    ...overrides,
  };
}

test("el reporte de fallo imprime el escenario que falló", () => {
  const report = formatFailureReport(fixtureFailureReport({ scenario: "SMOKE-03 RESOLVE_BANS" }));

  expect(report).toContain("STAGING_SMOKE_FAIL");
  expect(report).toContain("FAILED_SCENARIO:\nSMOKE-03 RESOLVE_BANS");
});

test("el reporte de fallo incluye el status HTTP real observado", () => {
  const report = formatFailureReport(fixtureFailureReport({ status: 409 }));

  expect(report).toContain("HTTP_STATUS:\n409");
  expect(report).toContain("ACTUAL_STATUS:\n409");
});

test("el reporte de fallo incluye la clase de error", () => {
  const report = formatFailureReport(fixtureFailureReport({ errorClass: "no_accepted_human_pick" }));

  expect(report).toContain("FAILURE_CLASS:\nno_accepted_human_pick");
});

test("el reporte de fallo sin status HTTP disponible (fallo de invariante, no de red) dice N/A, no null crudo", () => {
  const report = formatFailureReport(fixtureFailureReport({ status: null, expectedStatus: null }));

  expect(report).toContain("HTTP_STATUS:\nN/A");
  expect(report).not.toContain("EXPECTED_STATUS:");
});

test("el reporte de fallo nunca imprime el session id completo, solo una forma truncada", () => {
  const fullSessionId = "11111111-2222-3333-4444-555555555555";
  const report = formatFailureReport(fixtureFailureReport({ sessionId: fullSessionId }));

  expect(report).not.toContain(fullSessionId);
  expect(report).toContain(redactSessionId(fullSessionId));
});

test("el reporte de fallo nunca menciona cookies, tokens de cuenta ni storageState", () => {
  const report = formatFailureReport(fixtureFailureReport()).toLowerCase();

  expect(report).not.toContain("cookie");
  expect(report).not.toContain("storagestate");
  expect(report).not.toContain("account_token");
  expect(report).not.toContain("x-account-token");
});

test("un escenario exitoso imprime PASS con su nombre", () => {
  expect(formatScenarioProgress("SMOKE-01 HEALTH", true)).toBe("SMOKE-01 HEALTH: PASS");
});

test("un escenario fallido imprime FAIL con su nombre, distinguible de PASS", () => {
  expect(formatScenarioProgress("SMOKE-03 RESOLVE_BANS", false)).toBe("SMOKE-03 RESOLVE_BANS: FAIL");
});

test("redactSessionId trunca un id largo y nunca devuelve el valor completo", () => {
  const fullSessionId = "11111111-2222-3333-4444-555555555555";

  const redacted = redactSessionId(fullSessionId);

  expect(redacted).not.toBe(fullSessionId);
  expect(redacted.startsWith("11111111")).toBe(true);
  expect(redacted.length).toBeLessThan(fullSessionId.length);
});
