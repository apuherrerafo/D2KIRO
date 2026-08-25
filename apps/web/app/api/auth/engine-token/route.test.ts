import { describe, expect, test } from "bun:test";
import { verifyAccountToken } from "../../../../../engine/src/server/account-token";
import { mintAccountToken } from "@/lib/account-token";
import { createEngineTokenHandler } from "./route";

const NOW = 1_787_500_000_000;
const ACCOUNT_ID = 35_488_109;
const INTERNAL_KEY = "test-internal-" + "credential-with-at-least-thirty-two-characters";

function session(accountId = ACCOUNT_ID) {
  return { accountId } as Awaited<ReturnType<typeof import("@/lib/session").getSession>>;
}

describe("GET /api/auth/engine-token", () => {
  test("sin sesión válida responde 401", async () => {
    const response = await createEngineTokenHandler({
      getSession: async () => session(),
      renewSession: async () => false,
      mint: () => "unused",
      now: () => NOW,
      secret: () => INTERNAL_KEY,
    })();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  test("acuña un token de 60 segundos verificable por el motor", async () => {
    const response = await createEngineTokenHandler({
      getSession: async () => session(),
      renewSession: async () => true,
      mint: (accountId, secret, issuedAt) => mintAccountToken(accountId, secret, issuedAt, "0123456789abcdef0123456789abcdef"),
      now: () => NOW,
      secret: () => INTERNAL_KEY,
    })();
    const body = await response.json() as { token: string; expiresAt: number };

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.expiresAt).toBe(NOW + 60_000);
    expect(verifyAccountToken(body.token, INTERNAL_KEY, () => NOW, new Map())).toEqual({ ok: true, accountId: ACCOUNT_ID });
  });
});
