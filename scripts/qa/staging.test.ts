import { expect, test } from "bun:test";
import { pollUntilAuthenticated, type AuthPoller } from "./staging";

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
