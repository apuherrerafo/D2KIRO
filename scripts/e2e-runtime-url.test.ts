import { expect, test } from "bun:test";
import { engineDirectUrl } from "../e2e/support/wave1";

test("engineDirectUrl conserva el motor local si no hay runtime externo", () => {
  expect(engineDirectUrl({})).toBe("http://127.0.0.1:4100");
});

test("engineDirectUrl usa el puerto que reservó el runner gestionado (nunca un 4100 fijo)", () => {
  expect(engineDirectUrl({ E2E_ENGINE_PORT: "51234" })).toBe("http://127.0.0.1:51234");
});

test("engineDirectUrl: la URL externa gana sobre el puerto gestionado", () => {
  expect(engineDirectUrl({ E2E_EXTERNAL_ENGINE_URL: "http://127.0.0.1:3400", E2E_ENGINE_PORT: "51234" })).toBe("http://127.0.0.1:3400");
});

test("engineDirectUrl usa la URL publicada por el runtime Linux externo", () => {
  expect(engineDirectUrl({ E2E_EXTERNAL_ENGINE_URL: "http://127.0.0.1:3400" })).toBe("http://127.0.0.1:3400");
});
