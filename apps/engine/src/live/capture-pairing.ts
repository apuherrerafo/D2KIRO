import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { liveCaptureCredentials, liveCapturePairings } from "../db/schema";

// Overwolf live capture -- pairing a local capture adapter to the account's live session.
//
//   browser (account session) --POST--> a one-time PAIRING CODE for the account's live session (10 min)
//   adapter (no cookie)  --code--> a scoped CAPTURE CREDENTIAL (captureId + token, 12 h)
//   adapter --captureId + token--> may ONLY submit draft facts to that one session
//
// Same discipline as the Dota GSI link (gsi-links.ts): only SHA-256 of the secret is stored, the secret
// exists in clear text once (in the response that hands it over), every refusal is the same `null`,
// comparison is constant time, one row per account (re-pairing replaces, revoking deletes -- so the old
// credential stops authenticating at once). The pairing code is single use: redeeming DELETES it.

/** Long enough to read it off the page and type it in; short enough that a shoulder-surfed code is dead soon. */
export const CAPTURE_PAIRING_TTL_MS = 10 * 60 * 1000;
/** One long gaming session; the next one pairs again. */
export const CAPTURE_CREDENTIAL_TTL_MS = 12 * 60 * 60 * 1000;
// No 0/O/1/I/L: the code is typed by a person. 8 chars x 5 bits = 40 bits, behind a global failure limiter.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CAPTURE_CODE = /^[A-HJKMNP-Z2-9]{8}$/;
export const CAPTURE_ID = /^[A-Za-z0-9_-]{43}$/;
export const CAPTURE_TOKEN = /^[0-9a-f]{64}$/;

export interface IssuedPairingCode {
  /** Shown to the Player once, formatted `ABCD-2345`. Never stored, never logged. */
  code: string;
  sessionId: string;
  expiresAt: number;
}

export interface CaptureCredential {
  captureId: string;
  accountId: number;
  sessionId: string;
  createdAt: number;
  expiresAt: number;
}

export interface IssuedCaptureCredential extends CaptureCredential {
  /** Clear text, returned once to the adapter. Never stored, never logged. */
  token: string;
}

export interface CapturePairingStore {
  /** Replaces the account's pending code with a fresh one bound to `sessionId`. */
  issueCode(accountId: number, sessionId: string, now: number): IssuedPairingCode;
  /** One-time: a valid code becomes a credential (replacing the account's previous one) and is deleted. Anything else -> null. */
  redeem(code: string, now: number): IssuedCaptureCredential | null;
  /** The account's credential if unexpired, without its secret. */
  active(accountId: number, now: number): CaptureCredential | null;
  /** Deletes the account's pending code AND credential. */
  revoke(accountId: number): boolean;
  /** Fail closed: unknown / revoked id, wrong token, expired -> null. */
  verify(captureId: string, token: string, now: number): CaptureCredential | null;
}

/** `ABCD-2345` or `abcd2345` -> `ABCD2345`; null when it cannot be a code (never reaches the database). */
export function normalizeCaptureCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 32) return null;
  const compact = input.replace(/[\s-]/g, "").toUpperCase();
  return CAPTURE_CODE.test(compact) ? compact : null;
}

export function formatCaptureCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function hashCaptureCode(code: string): string {
  return createHash("sha256").update(`d2k-capture-code/v1|${code}`).digest("hex");
}

export function hashCaptureToken(token: string): string {
  return createHash("sha256").update(`d2k-capture-token/v1|${token}`).digest("hex");
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function randomCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

type CredentialRow = typeof liveCaptureCredentials.$inferSelect;

function toCredential(row: CredentialRow): CaptureCredential {
  return { captureId: row.captureId, accountId: row.accountId, sessionId: row.sessionId, createdAt: row.createdAt, expiresAt: row.expiresAt };
}

export interface CapturePairingStoreOptions {
  randomCode?: () => string;
  randomId?: () => string;
  randomToken?: () => string;
}

export function createCapturePairingStore<TSchema extends Record<string, unknown>>(db: BunSQLiteDatabase<TSchema>, options: CapturePairingStoreOptions = {}): CapturePairingStore {
  const nextCode = options.randomCode ?? randomCode;
  const nextId = options.randomId ?? (() => randomBytes(32).toString("base64url"));
  const nextToken = options.randomToken ?? (() => randomBytes(32).toString("hex"));

  return {
    issueCode(accountId, sessionId, now) {
      const code = nextCode();
      const expiresAt = now + CAPTURE_PAIRING_TTL_MS;
      db.transaction((tx) => {
        tx.delete(liveCapturePairings).where(eq(liveCapturePairings.accountId, accountId)).run();
        tx.insert(liveCapturePairings).values({ codeHash: hashCaptureCode(code), accountId, sessionId, createdAt: now, expiresAt }).run();
      });
      return { code: formatCaptureCode(code), sessionId, expiresAt };
    },
    redeem(code, now) {
      const normalized = normalizeCaptureCode(code);
      if (normalized === null) return null;
      return db.transaction((tx) => {
        const [row] = tx.select().from(liveCapturePairings).where(eq(liveCapturePairings.codeHash, hashCaptureCode(normalized))).limit(1).all();
        if (!row) return null;
        // Single use, whatever happens next: a code is never redeemable twice.
        tx.delete(liveCapturePairings).where(eq(liveCapturePairings.codeHash, row.codeHash)).run();
        if (row.expiresAt <= now) return null;
        const captureId = nextId();
        const token = nextToken();
        const expiresAt = now + CAPTURE_CREDENTIAL_TTL_MS;
        tx.delete(liveCaptureCredentials).where(eq(liveCaptureCredentials.accountId, row.accountId)).run();
        tx.insert(liveCaptureCredentials).values({ captureId, accountId: row.accountId, tokenHash: hashCaptureToken(token), sessionId: row.sessionId, createdAt: now, expiresAt }).run();
        return { captureId, accountId: row.accountId, sessionId: row.sessionId, createdAt: now, expiresAt, token };
      });
    },
    active(accountId, now) {
      const [row] = db.select().from(liveCaptureCredentials).where(eq(liveCaptureCredentials.accountId, accountId)).limit(1).all();
      return row && row.expiresAt > now ? toCredential(row) : null;
    },
    revoke(accountId) {
      const pending = db.delete(liveCapturePairings).where(eq(liveCapturePairings.accountId, accountId)).returning({ id: liveCapturePairings.codeHash }).all();
      const credentials = db.delete(liveCaptureCredentials).where(eq(liveCaptureCredentials.accountId, accountId)).returning({ id: liveCaptureCredentials.captureId }).all();
      return pending.length + credentials.length > 0;
    },
    verify(captureId, token, now) {
      if (!CAPTURE_ID.test(captureId) || !CAPTURE_TOKEN.test(token)) return null;
      const [row] = db.select().from(liveCaptureCredentials).where(eq(liveCaptureCredentials.captureId, captureId)).limit(1).all();
      if (!row) return null;
      // Compare before looking at expiry so every refusal of an existing credential costs the same work.
      const matches = sameHash(row.tokenHash, hashCaptureToken(token));
      if (!matches || row.expiresAt <= now) return null;
      return toCredential(row);
    },
  };
}
