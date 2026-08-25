import { createHmac, randomBytes } from "node:crypto";

const ACCOUNT_TOKEN_DOMAIN = "d2k-account-token/v1";

export function mintAccountToken(
  accountId: number,
  secret: string,
  issuedAtMs = Date.now(),
  nonce = randomBytes(16).toString("hex"),
): string {
  if (!Number.isInteger(accountId) || accountId < 1 || accountId > 4_294_967_295) {
    throw new Error("Invalid account identity");
  }
  if (secret.length < 32) throw new Error("Invalid internal authentication configuration");

  const payload = `${accountId}.${issuedAtMs}.${nonce}`;
  const signature = createHmac("sha256", secret).update(`${ACCOUNT_TOKEN_DOMAIN}|${payload}`).digest("hex");
  return `${payload}.${signature}`;
}
