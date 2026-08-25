import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { verifyAccountToken } from "./account-token";

const VECTOR_HMAC_KEY = "d2k-test-vector-key-0123456789ab";
const NOW = 1787500000000;
const VECTOR_HEADER = "123456789.1787500000000.0123456789abcdef0123456789abcdef.033834d055eb3497adbe0188a53b636815f15e9f7e6836b0e66e9228a7f0be98";

function signToken(accountId: string, issuedAtMs: number, nonce: string, hmacKey = VECTOR_HMAC_KEY): string {
  const payload = `${accountId}.${issuedAtMs}.${nonce}`;
  const signature = createHmac("sha256", hmacKey).update(`d2k-account-token/v1|${payload}`).digest("hex");
  return `${payload}.${signature}`;
}

test("el vector compartido de §12.6 verifica la firma HMAC exacta", () => {
  const result = verifyAccountToken(VECTOR_HEADER, VECTOR_HMAC_KEY, () => NOW, new Map());

  expect(result).toEqual({ ok: true, accountId: 123456789 });
});

test("header ausente devuelve missing_account_token", () => {
  expect(verifyAccountToken(undefined, VECTOR_HMAC_KEY, () => NOW, new Map())).toEqual({ ok: false, error: "missing_account_token" });
});

test("una firma alterada se rechaza antes de evaluar una ventana vencida", () => {
  const token = signToken("123456789", NOW - 66000, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").replace(/.$/, "0");

  expect(verifyAccountToken(token, VECTOR_HMAC_KEY, () => NOW, new Map())).toEqual({ ok: false, error: "invalid_account_token" });
});

test("un token dentro de la ventana de 60 segundos es válido", () => {
  const token = signToken("123456789", NOW - 59999, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

  expect(verifyAccountToken(token, VECTOR_HMAC_KEY, () => NOW, new Map())).toEqual({ ok: true, accountId: 123456789 });
});

test("un token fuera de la ventana con tolerancia se rechaza como vencido", () => {
  const token = signToken("123456789", NOW - 65001, "cccccccccccccccccccccccccccccccc");

  expect(verifyAccountToken(token, VECTOR_HMAC_KEY, () => NOW, new Map())).toEqual({ ok: false, error: "expired_account_token" });
});

test("un nonce reenviado dentro de la ventana se rechaza como replay", () => {
  const nonceStore = new Map<string, number>();
  const token = signToken("123456789", NOW, "dddddddddddddddddddddddddddddddd");

  expect(verifyAccountToken(token, VECTOR_HMAC_KEY, () => NOW, nonceStore)).toEqual({ ok: true, accountId: 123456789 });
  expect(verifyAccountToken(token, VECTOR_HMAC_KEY, () => NOW, nonceStore)).toEqual({ ok: false, error: "replayed_account_token" });
});

test("accountId fuera del rango Steam32 se rechaza tras verificar la firma", () => {
  for (const accountId of ["0", "-1", "4294967296"]) {
    const token = signToken(accountId, NOW, `${accountId === "0" ? "e" : "f"}`.repeat(32));
    expect(verifyAccountToken(token, VECTOR_HMAC_KEY, () => NOW, new Map())).toEqual({ ok: false, error: "invalid_account_token" });
  }
});

test("la verificación completa mantiene p95 bajo 1 ms", () => {
  const durations: number[] = [];
  for (let index = 0; index < 200; index += 1) {
    const nonce = index.toString(16).padStart(32, "0");
    const token = signToken("123456789", NOW, nonce);
    const startedAt = performance.now();
    verifyAccountToken(token, VECTOR_HMAC_KEY, () => NOW, new Map());
    durations.push(performance.now() - startedAt);
  }
  durations.sort((left, right) => left - right);

  expect(durations[Math.floor(durations.length * 0.95)] ?? Infinity).toBeLessThan(1);
});
