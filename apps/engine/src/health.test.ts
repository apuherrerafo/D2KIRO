import { expect, test } from "bun:test";
import { getHealthStatus } from "./health";

test("getHealthStatus reporta status ok y respeta activeSessions recibido", () => {
  const health = getHealthStatus(0);

  expect(health.status).toBe("ok");
  expect(health.activeSessions).toBe(0);
  expect(health.uptimeMs).toBeGreaterThanOrEqual(0);
});

test("getHealthStatus refleja el conteo de sesiones activas que se le pasa", () => {
  const health = getHealthStatus(3);

  expect(health.activeSessions).toBe(3);
});
