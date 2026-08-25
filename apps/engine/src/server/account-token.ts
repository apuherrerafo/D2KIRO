import { createHmac, timingSafeEqual } from "node:crypto";
import type { AccountId } from "../meta/provider";
import { isValidSteamAccountId } from "../meta/validation";

const ACCOUNT_TOKEN_PATTERN = /^[0-9]{1,10}\.[0-9]{13}\.[0-9a-f]{32}\.[0-9a-f]{64}$/;
const TOKEN_LIFETIME_MS = 60_000;
const FUTURE_CLOCK_TOLERANCE_MS = 5_000;
const NONCE_CLEANUP_THRESHOLD = 5_000;

export type AccountTokenError =
  | "missing_account_token"
  | "invalid_account_token"
  | "expired_account_token"
  | "replayed_account_token";

export type NonceStore = Map<string, number>;

function evictExpiredNonces(nonceStore: NonceStore, nowMs: number): void {
  if (nonceStore.size <= NONCE_CLEANUP_THRESHOLD) return;
  for (const [nonce, expiresAt] of nonceStore) {
    if (expiresAt < nowMs) nonceStore.delete(nonce);
  }
}

export function verifyAccountToken(
  header: string | undefined,
  secret: string,
  now: () => number,
  nonceStore: NonceStore,
): { ok: true; accountId: AccountId } | { ok: false; error: AccountTokenError } {
  if (header === undefined) return { ok: false, error: "missing_account_token" };
  if (!ACCOUNT_TOKEN_PATTERN.test(header)) return { ok: false, error: "invalid_account_token" };

  const [accountId, issuedAtMs, nonce, signature] = header.split(".");
  if (!accountId || !issuedAtMs || !nonce || !signature) return { ok: false, error: "invalid_account_token" };

  const payload = `${accountId}.${issuedAtMs}.${nonce}`;
  const expectedSignature = createHmac("sha256", secret).update(`d2k-account-token/v1|${payload}`).digest();
  if (!timingSafeEqual(Buffer.from(signature, "hex"), expectedSignature)) {
    return { ok: false, error: "invalid_account_token" };
  }

  const currentTime = now();
  const issuedAt = Number(issuedAtMs);
  if (issuedAt < currentTime - TOKEN_LIFETIME_MS || issuedAt > currentTime + FUTURE_CLOCK_TOLERANCE_MS) {
    return { ok: false, error: "expired_account_token" };
  }
  if (!isValidSteamAccountId(accountId)) return { ok: false, error: "invalid_account_token" };
  if (nonceStore.has(nonce)) return { ok: false, error: "replayed_account_token" };

  nonceStore.set(nonce, issuedAt + TOKEN_LIFETIME_MS);
  evictExpiredNonces(nonceStore, currentTime);
  return { ok: true, accountId: Number(accountId) };
}
