import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { accounts } from "../../db/schema";
import type { AccountId } from "../../meta/provider";

export function createAccountRoutes<TSchema extends Record<string, unknown>>(db: BunSQLiteDatabase<TSchema>) {
  function get(accountId: AccountId): Response {
    const [account] = db.select().from(accounts).where(eq(accounts.steamAccountId, accountId)).limit(1).all();
    return account ? Response.json(account) : Response.json({ error: "unknown_account" }, { status: 401 });
  }

  function post(accountId: AccountId): Response {
    const existed = db.select({ id: accounts.steamAccountId }).from(accounts).where(eq(accounts.steamAccountId, accountId)).limit(1).all().length > 0;
    db.insert(accounts).values({ steamAccountId: accountId, createdAt: new Date().toISOString() }).onConflictDoNothing().run();
    const [account] = db.select().from(accounts).where(eq(accounts.steamAccountId, accountId)).limit(1).all();
    return Response.json(account, { status: existed ? 200 : 201 });
  }

  return { get, post };
}
