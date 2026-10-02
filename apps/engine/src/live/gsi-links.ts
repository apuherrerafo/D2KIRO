import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { liveGsiLinks } from "../db/schema";

// TSK-219 -- Dota GSI link: the credential an installed `.cfg` uses to POST to Railway.
//
//   liveId  (URL path, 256 bits, base64url)  -> which link
//   token   (cfg `auth.token`, 256 bits, hex) -> proves it is the cfg we generated
//
// Only SHA-256(token) is stored; the token exists in clear text exactly once, in the response that
// becomes the downloaded file. A link belongs to the account that generated it (authenticated
// server side) and points to ONE live protocol session. Generating a new cfg replaces the previous
// link of that account (rotation: the old row is deleted, so its cfg stops authenticating at once); a
// link also expires and can be revoked explicitly (deleted). At most one row per account.

/** Long enough to install once; short enough that a forgotten cfg stops working on its own. */
export const GSI_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const GSI_LIVE_ID = /^[A-Za-z0-9_-]{43}$/;
export const GSI_TOKEN = /^[0-9a-f]{64}$/;

export interface GsiLink {
  liveId: string;
  accountId: number;
  sessionId: string;
  createdAt: number;
  expiresAt: number;
}

export interface IssuedGsiLink extends GsiLink {
  /** Clear-text credential, returned once to be written into the cfg. Never stored, never logged. */
  token: string;
}

export interface GsiLinkStore {
  /** Replaces the account's link with a fresh one (new liveId, token and live session). */
  issue(accountId: number, now: number): IssuedGsiLink;
  /** The account's link if not expired, without its credential. */
  active(accountId: number, now: number): GsiLink | null;
  /** Deletes the account's link; false when there was none. */
  revoke(accountId: number): boolean;
  /** Fail closed: unknown (or revoked) id, wrong token, expired -> null. Constant-time token comparison. */
  verify(liveId: string, token: string, now: number): GsiLink | null;
}

export function hashGsiToken(token: string): string {
  return createHash("sha256").update(`d2k-gsi-token/v1|${token}`).digest("hex");
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

type Row = typeof liveGsiLinks.$inferSelect;

function toLink(row: Row): GsiLink {
  return { liveId: row.liveId, accountId: row.accountId, sessionId: row.sessionId, createdAt: row.createdAt, expiresAt: row.expiresAt };
}

export interface GsiLinkStoreOptions {
  randomId?: () => string;
  randomToken?: () => string;
  randomSessionId?: () => string;
}

export function createGsiLinkStore<TSchema extends Record<string, unknown>>(db: BunSQLiteDatabase<TSchema>, options: GsiLinkStoreOptions = {}): GsiLinkStore {
  const randomId = options.randomId ?? (() => randomBytes(32).toString("base64url"));
  const randomToken = options.randomToken ?? (() => randomBytes(32).toString("hex"));
  const randomSessionId = options.randomSessionId ?? (() => randomUUID());


  return {
    issue(accountId, now) {
      const liveId = randomId();
      const token = randomToken();
      const sessionId = randomSessionId();
      const createdAt = now;
      const expiresAt = now + GSI_LINK_TTL_MS;
      db.transaction((tx) => {
        tx.delete(liveGsiLinks).where(eq(liveGsiLinks.accountId, accountId)).run();
        tx.insert(liveGsiLinks).values({ liveId, accountId, tokenHash: hashGsiToken(token), sessionId, createdAt, expiresAt }).run();
      });
      return { liveId, accountId, sessionId, createdAt, expiresAt, token };
    },
    active(accountId, now) {
      const [row] = db.select().from(liveGsiLinks).where(eq(liveGsiLinks.accountId, accountId)).limit(1).all();
      return row && row.expiresAt > now ? toLink(row) : null;
    },
    revoke(accountId) {
      const removed = db.delete(liveGsiLinks).where(eq(liveGsiLinks.accountId, accountId)).returning({ liveId: liveGsiLinks.liveId }).all();
      return removed.length > 0;
    },
    verify(liveId, token, now) {
      if (!GSI_LIVE_ID.test(liveId) || !GSI_TOKEN.test(token)) return null;
      const [row] = db.select().from(liveGsiLinks).where(eq(liveGsiLinks.liveId, liveId)).limit(1).all();
      if (!row) return null;
      // Compare before looking at expiry so every refusal of an existing link costs the same work.
      const matches = sameHash(row.tokenHash, hashGsiToken(token));
      if (!matches || row.expiresAt <= now) return null;
      return toLink(row);
    },
  };
}
