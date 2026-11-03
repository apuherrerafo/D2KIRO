import { expect, test } from "bun:test";
import { engineDirectUrl, engineDirectHeaders } from "../e2e/support/wave1";
import { resolveInternalAuthSecret } from "../e2e/support/internal-auth-secret";
import { mintAccountToken } from "../apps/web/lib/account-token";

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

// Greptile PR #9 review #3 (P1): external-runtime clock auth secret.
const SECRET_A = "a".repeat(64);

test("runtime externo sin E2E_INTERNAL_AUTH_SECRET falla cerrado (no genera un secreto sustituto)", () => {
  expect(() => resolveInternalAuthSecret({}, true)).toThrow(/E2E_INTERNAL_AUTH_SECRET/);
  expect(() => resolveInternalAuthSecret({ E2E_INTERNAL_AUTH_SECRET: "" }, true)).toThrow(/E2E_INTERNAL_AUTH_SECRET/);
});

test("runtime externo con el secreto real: se usa exactamente ese y engineDirectHeaders acuña un token con formato válido", () => {
  const secret = resolveInternalAuthSecret({ E2E_INTERNAL_AUTH_SECRET: SECRET_A }, true);
  expect(secret).toBe(SECRET_A);
  const token = engineDirectHeaders({ E2E_INTERNAL_AUTH_SECRET: secret, E2E_ACCOUNT_ID: "4242" })["x-account-token"];
  expect(token).toMatch(/^4242\.\d+\.[0-9a-f]{32}\.[0-9a-f]{64}$/);
  // Firmado con ESE secreto: otro secreto da otra firma sobre el mismo payload.
  const [account, issuedAt, nonce, signature] = token.split(".");
  const reminted = mintAccountToken(Number(account), SECRET_A, Number(issuedAt), nonce).split(".")[3];
  const other = mintAccountToken(Number(account), "b".repeat(64), Number(issuedAt), nonce).split(".")[3];
  expect(signature).toBe(reminted);
  expect(signature).not.toBe(other);
});

test("runtime local sin E2E_INTERNAL_AUTH_SECRET conserva el secreto generado por corrida", () => {
  const first = resolveInternalAuthSecret({}, false);
  const second = resolveInternalAuthSecret({}, false);
  expect(first).toMatch(/^[0-9a-f]{64}$/);
  expect(second).not.toBe(first);
  expect(resolveInternalAuthSecret({ E2E_INTERNAL_AUTH_SECRET: SECRET_A }, false)).toBe(SECRET_A);
});
