import { expect, test } from "bun:test";
import { isAllowedClockRelayRequest } from "./start-e2e-runtime";

test("el relay de reloj permite solo la operación E2E exacta", () => {
  const clockPath = "/api/session/protocol/123e4567-e89b-42d3-a456-426614174000/test-advance-clock";

  expect(isAllowedClockRelayRequest("POST", clockPath)).toBe(true);
  expect(isAllowedClockRelayRequest("GET", clockPath)).toBe(false);
  expect(isAllowedClockRelayRequest("POST", "/api/session/protocol/test-advance-clock")).toBe(false);
  expect(isAllowedClockRelayRequest("POST", "/api/session/protocol/123e4567-e89b-42d3-a456-426614174000/pick")).toBe(false);
});
