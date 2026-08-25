import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { accounts } from "../db/schema";
import type { AccountId } from "../meta/provider";
import { verifyAccountToken, type NonceStore } from "./account-token";

type Db<TSchema extends Record<string, unknown> = Record<string, never>> = BunSQLiteDatabase<TSchema>;

export function requireAccount<TSchema extends Record<string, unknown>>(
  request: Request,
  secret: string,
  now: () => number,
  nonceStore: NonceStore,
  db: Db<TSchema>,
  allowUnknown = false,
): { ok: true; accountId: AccountId } | { ok: false; response: Response } {
  const verified = verifyAccountToken(request.headers.get("x-account-token") ?? undefined, secret, now, nonceStore);
  if (!verified.ok) return { ok: false, response: Response.json({ error: verified.error }, { status: 401 }) };
  if (allowUnknown) return verified;
  const [account] = db.select({ id: accounts.steamAccountId }).from(accounts).where(eq(accounts.steamAccountId, verified.accountId)).limit(1).all();
  if (!account) return { ok: false, response: Response.json({ error: "unknown_account" }, { status: 401 }) };
  return verified;
}
