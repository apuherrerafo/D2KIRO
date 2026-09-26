import { expect, test } from "bun:test";
import { engineDirectUrl } from "../e2e/support/wave1";

test("engineDirectUrl conserva el motor local si no hay runtime externo", () => {
  expect(engineDirectUrl({})).toBe("http://127.0.0.1:4100");
});

test("engineDirectUrl usa la URL publicada por el runtime Linux externo", () => {
  expect(engineDirectUrl({ E2E_EXTERNAL_ENGINE_URL: "http://127.0.0.1:3400" })).toBe("http://127.0.0.1:3400");
});
