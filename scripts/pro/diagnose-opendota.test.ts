import { expect, test } from "bun:test";
import { classifyConnectivityError } from "./diagnose-opendota";

test("distingue fallo DNS de fallo HTTP", () => {
  expect(classifyConnectivityError(new Error("getaddrinfo ENOTFOUND api.opendota.com"))).toBe("dns_failed");
  expect(classifyConnectivityError(new Error("fetch failed: timeout"))).toBe("http_failed");
});
