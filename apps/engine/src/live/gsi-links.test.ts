import { describe, expect, test } from "bun:test";
import { createGsiLinkTestDb } from "./gsi.fixtures";
import { createGsiLinkStore, GSI_LINK_TTL_MS, hashGsiToken } from "./gsi-links";

// TSK-219 -- the GSI link credential store, against the REAL migration 0009 SQL on an in-memory SQLite.

const T0 = 1_790_000_000_000;

describe("GsiLinkStore", () => {
  test("issue: opaque 256-bit id + token; only the token's hash is stored", () => {
    const { db, sqlite } = createGsiLinkTestDb();
    const store = createGsiLinkStore(db);
    const issued = store.issue(101, T0);
    expect(issued.liveId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.token).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.expiresAt).toBe(T0 + GSI_LINK_TTL_MS);
    const rows = sqlite.query("SELECT * FROM live_gsi_links").all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(issued.token);
    expect(rows[0]?.token_hash).toBe(hashGsiToken(issued.token));
  });

  test("verify: right token passes; wrong / malformed token and unknown id fail closed", () => {
    const store = createGsiLinkStore(createGsiLinkTestDb().db);
    const issued = store.issue(101, T0);
    expect(store.verify(issued.liveId, issued.token, T0 + 1)?.accountId).toBe(101);
    expect(store.verify(issued.liveId, "0".repeat(64), T0 + 1)).toBeNull();
    expect(store.verify(issued.liveId, issued.token.toUpperCase(), T0 + 1)).toBeNull();
    expect(store.verify(issued.liveId, "", T0 + 1)).toBeNull();
    expect(store.verify("A".repeat(43), issued.token, T0 + 1)).toBeNull();
    expect(store.verify("../etc", issued.token, T0 + 1)).toBeNull();
  });

  test("expiry: the token stops working at expiresAt", () => {
    const store = createGsiLinkStore(createGsiLinkTestDb().db);
    const issued = store.issue(101, T0);
    expect(store.verify(issued.liveId, issued.token, issued.expiresAt - 1)).not.toBeNull();
    expect(store.verify(issued.liveId, issued.token, issued.expiresAt)).toBeNull();
    expect(store.active(101, issued.expiresAt)).toBeNull();
  });

  test("rotation: issuing again replaces the account's previous link (and only that account's); one row per account", () => {
    const { db, sqlite } = createGsiLinkTestDb();
    const store = createGsiLinkStore(db);
    const first = store.issue(101, T0);
    const other = store.issue(202, T0);
    const second = store.issue(101, T0 + 10);
    expect(store.verify(first.liveId, first.token, T0 + 20)).toBeNull();
    expect(store.verify(second.liveId, second.token, T0 + 20)?.sessionId).toBe(second.sessionId);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(store.verify(other.liveId, other.token, T0 + 20)?.accountId).toBe(202);
    expect(store.active(101, T0 + 20)?.liveId).toBe(second.liveId);
    for (let i = 0; i < 5; i += 1) store.issue(101, T0 + 30 + i);
    expect((sqlite.query("SELECT account_id FROM live_gsi_links").all() as unknown[]).length).toBe(2);
  });

  test("revocation: explicit revoke kills the link; nothing left to revoke afterwards", () => {
    const store = createGsiLinkStore(createGsiLinkTestDb().db);
    const issued = store.issue(101, T0);
    expect(store.revoke(101)).toBe(true);
    expect(store.verify(issued.liveId, issued.token, T0 + 2)).toBeNull();
    expect(store.active(101, T0 + 2)).toBeNull();
    expect(store.revoke(101)).toBe(false);
  });

  test("ownership: one account's token never authenticates another account's link", () => {
    const store = createGsiLinkStore(createGsiLinkTestDb().db);
    const mine = store.issue(101, T0);
    const theirs = store.issue(202, T0);
    expect(store.verify(theirs.liveId, mine.token, T0 + 1)).toBeNull();
    expect(store.verify(mine.liveId, theirs.token, T0 + 1)).toBeNull();
  });
});
