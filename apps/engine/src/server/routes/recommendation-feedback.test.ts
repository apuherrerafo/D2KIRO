import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHmac } from "node:crypto";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { accounts, draftFeedback, heroes, heroMatchups, heroPatchStats, heroPool, metaSync, recommendationFeedback, settings, teamGroups, teamMembers } from "../../db/schema";
import { createApp } from "../app";
import { OpenDotaClient } from "../../meta/opendota-client";
import { getAllRecommendationFeedback } from "../../db/queries";

const TEST_ACCOUNT_HMAC_KEY = "test-internal-auth-secret-32-chars-long!";

let accountNonce = 0;
function mintToken(accountId: number, secretKey = TEST_ACCOUNT_HMAC_KEY, issuedAt = Date.now()): string {
  const nonce = (accountNonce++).toString(16).padStart(32, "0");
  const payload = `${accountId}.${issuedAt}.${nonce}`;
  const signature = createHmac("sha256", secretKey).update(`d2k-account-token/v1|${payload}`).digest("hex");
  return `${payload}.${signature}`;
}

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE heroes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, localized_name TEXT NOT NULL, img_url TEXT NOT NULL, primary_attr TEXT NOT NULL, attack_type TEXT NOT NULL, roles TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE hero_patch_stats (hero_id INTEGER NOT NULL, patch TEXT NOT NULL, bracket TEXT NOT NULL, picks INTEGER NOT NULL, wins INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (hero_id, patch, bracket));
    CREATE TABLE hero_matchups (hero_id INTEGER NOT NULL, vs_hero_id INTEGER NOT NULL, games INTEGER NOT NULL, wins INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (hero_id, vs_hero_id));
    CREATE TABLE meta_sync (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, rows_written INTEGER NOT NULL DEFAULT 0, error TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE accounts (steam_account_id INTEGER PRIMARY KEY, personal_baseline_winrate REAL, created_at TEXT NOT NULL);
    CREATE TABLE hero_pool (account_id INTEGER NOT NULL, hero_id INTEGER NOT NULL, source TEXT NOT NULL, personal_winrate REAL, personal_games INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY (account_id, hero_id));
    CREATE TABLE team_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, name TEXT NOT NULL, party_size INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE team_members (id INTEGER PRIMARY KEY AUTOINCREMENT, team_group_id INTEGER NOT NULL, slot INTEGER NOT NULL, name TEXT NOT NULL, hero_pool TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE draft_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, comment TEXT NOT NULL, draft_state TEXT NOT NULL, suggestions TEXT, created_at TEXT NOT NULL);
    CREATE TABLE recommendation_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, hero_id INTEGER NOT NULL,
      target_position INTEGER, rating TEXT NOT NULL, reason TEXT, comment TEXT,
      state_identity TEXT, ruleset_id TEXT, ruleset_version TEXT, account_id INTEGER,
      created_at TEXT NOT NULL
    );
  `);
  const db = drizzle(sqlite, { schema: { heroes, heroMatchups, heroPatchStats, metaSync, settings, accounts, heroPool, teamGroups, teamMembers, draftFeedback, recommendationFeedback } });
  db.insert(accounts).values({ steamAccountId: 1001, personalBaselineWinrate: null, createdAt: "2026-09-24T00:00:00Z" }).run();
  db.insert(heroes).values([
    { id: 1, name: "antimage", localizedName: "Anti-Mage", imgUrl: "/am.png", primaryAttr: "agi", attackType: "Melee", roles: ["Carry"], updatedAt: "2026-09-24" },
    { id: 7, name: "earthshaker", localizedName: "Earthshaker", imgUrl: "/es.png", primaryAttr: "str", attackType: "Melee", roles: ["Support"], updatedAt: "2026-09-24" },
    { id: 25, name: "lina", localizedName: "Lina", imgUrl: "/lina.png", primaryAttr: "int", attackType: "Ranged", roles: ["Nuker"], updatedAt: "2026-09-24" },
  ]).run();
  return { sqlite, db };
}

describe("POST /api/session/:sessionId/feedback -- Recommendation Feedback", () => {
  let server: ReturnType<ReturnType<typeof createApp>["start"]>;
  let baseUrl: string;
  let db: ReturnType<typeof createTestDb>["db"];
  let sessionId: string;

  beforeAll(async () => {
    const testDb = createTestDb();
    db = testDb.db;
    const app = createApp({
      db,
      openDotaClient: new OpenDotaClient(),
      captureToken: "test",
      internalAuthSecret: TEST_ACCOUNT_HMAC_KEY,
    });
    server = app.start("127.0.0.1", 0);
    baseUrl = `http://127.0.0.1:${server.port}`;

    // Create an authoritative protocol session to test trusted session reference
    const sessionRes = await fetch(`${baseUrl}/api/session/protocol`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-account-token": mintToken(1001) },
      body: JSON.stringify({
        rulesetId: "dota2/ranked-all-pick",
        patch: "7.41e",
        localSide: "radiant",
        adapterKind: "simulator",
        // PD-026/PD-027: Own Team truth is controlledPositions, never chronological roster seats.
        partyContext: { partySize: 5, side: "radiant", controlledSlots: [] },
        controlledPositions: [1, 2, 3, 4, 5],
      }),
    });
    expect(sessionRes.status).toBe(201);
    const sessionData = await sessionRes.json();
    sessionId = sessionData.sessionId;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("feedback positivo registra la identidad completa de la recomendación", async () => {
    const token = mintToken(1001);
    const res = await fetch(`${baseUrl}/api/session/${sessionId}/feedback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-account-token": token,
      },
      body: JSON.stringify({
        rating: "positive",
        heroId: 7,
        targetPosition: 4,
        stateIdentity: "state-hash-round-1",
        rulesetVersion: "7.41e",
      }),
    });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true });

    const rows = getAllRecommendationFeedback(db);
    const row = rows.find((r) => r.sessionId === sessionId && r.heroId === 7);
    expect(row).toBeDefined();
    expect(row!.rating).toBe("positive");
    expect(row!.targetPosition).toBe(4);
    expect(row!.reason).toBeNull();
    expect(row!.comment).toBeNull();
    expect(row!.stateIdentity).toBe("state-hash-round-1");
    expect(row!.rulesetId).toBe("dota2/ranked-all-pick");
    expect(row!.rulesetVersion).toBe("7.41f");
    expect(row!.accountId).toBe(1001);
  });

  test("feedback negativo con cada motivo permitido se almacena correctamente", async () => {
    const reasons = [
      "wrong_position",
      "poor_hero",
      "questionable_counter",
      "unclear_explanation",
      "not_useful",
      "other",
    ] as const;

    for (const [i, reason] of reasons.entries()) {
      const stateId = `negative-state-${i}`;
      const token = mintToken(1001);
      const res = await fetch(`${baseUrl}/api/session/${sessionId}/feedback`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-account-token": token,
        },
        body: JSON.stringify({
          rating: "negative",
          heroId: 25,
          targetPosition: 2,
          reason,
          comment: `Feedback motivo ${reason}`,
          stateIdentity: stateId,
        }),
      });

      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ accepted: true });

      const row = getAllRecommendationFeedback(db).find((r) => r.stateIdentity === stateId);
      expect(row).toBeDefined();
      expect(row!.rating).toBe("negative");
      expect(row!.reason as string).toBe(reason);
      expect(row!.comment).toBe(`Feedback motivo ${reason}`);
    }
  });

  test("comentario opcional: sin comentario se acepta y queda en null", async () => {
    const token = mintToken(1001);
    const res = await fetch(`${baseUrl}/api/session/${sessionId}/feedback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-account-token": token,
      },
      body: JSON.stringify({
        rating: "negative",
        heroId: 1,
        reason: "other",
        stateIdentity: "state-no-comment",
      }),
    });

    expect(res.status).toBe(202);
    const row = getAllRecommendationFeedback(db).find((r) => r.stateIdentity === "state-no-comment");
    expect(row).toBeDefined();
    expect(row!.comment).toBeNull();
  });

  test("comentario de más de 1000 caracteres es rechazado (400)", async () => {
    const token = mintToken(1001);
    const res = await fetch(`${baseUrl}/api/session/${sessionId}/feedback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-account-token": token,
      },
      body: JSON.stringify({
        rating: "negative",
        heroId: 1,
        reason: "other",
        comment: "x".repeat(1001),
        stateIdentity: "state-oversized-comment",
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("comment_too_long");
  });

  test("rating inválido es rechazado (400)", async () => {
    const token = mintToken(1001);
    const res = await fetch(`${baseUrl}/api/session/${sessionId}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-account-token": token },
      body: JSON.stringify({ rating: "thumbs_middle", heroId: 1 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_rating");
  });

  test("heroId inválido es rechazado (400)", async () => {
    const token = mintToken(1001);
    const res = await fetch(`${baseUrl}/api/session/${sessionId}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-account-token": token },
      body: JSON.stringify({ rating: "positive", heroId: -1 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_hero_id");
  });

  test("targetPosition inválido es rechazado (400)", async () => {
    const token = mintToken(1001);
    const res = await fetch(`${baseUrl}/api/session/${sessionId}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-account-token": token },
      body: JSON.stringify({ rating: "positive", heroId: 1, targetPosition: 9 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_target_position");
  });

  test("feedback positivo con motivo negativo es rechazado (400)", async () => {
    const token = mintToken(1001);
    const res = await fetch(`${baseUrl}/api/session/${sessionId}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-account-token": token },
      body: JSON.stringify({ rating: "positive", heroId: 1, reason: "poor_hero" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("reason_not_allowed_for_positive_rating");
  });

  test("petición sin x-account-token con secret activo es rechazada (401)", async () => {
    const res = await fetch(`${baseUrl}/api/session/${sessionId}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rating: "positive", heroId: 1 }),
    });
    expect(res.status).toBe(401);
  });

  test("petición con x-account-token forjado o inválido es rechazada (401)", async () => {
    const res = await fetch(`${baseUrl}/api/session/${sessionId}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-account-token": "bad" },
      body: JSON.stringify({ rating: "positive", heroId: 1 }),
    });
    expect(res.status).toBe(401);
  });

  test("accountId provisto por el cliente en el JSON es ignorado; se usa el del token", async () => {
    const token = mintToken(1001);
    const res = await fetch(`${baseUrl}/api/session/${sessionId}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-account-token": token },
      body: JSON.stringify({
        rating: "positive",
        heroId: 1,
        stateIdentity: "state-impersonate-test",
        accountId: 999999, // cliente intentando hacerse pasar por otra cuenta
      }),
    });
    expect(res.status).toBe(202);
    const row = getAllRecommendationFeedback(db).find((r) => r.stateIdentity === "state-impersonate-test");
    expect(row).toBeDefined();
    expect(row!.accountId).toBe(1001); // no 999999
  });

  test("sesión inexistente es rechazada (404 session_not_found)", async () => {
    const token = mintToken(1001);
    const res = await fetch(`${baseUrl}/api/session/non-existent-session-uuid/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-account-token": token },
      body: JSON.stringify({ rating: "positive", heroId: 1 }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("session_not_found");
  });

  test("envío repetido para la misma recomendación en el mismo estado es rechazado (409 duplicate_submission)", async () => {
    const token1 = mintToken(1001);
    const res1 = await fetch(`${baseUrl}/api/session/${sessionId}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-account-token": token1 },
      body: JSON.stringify({
        rating: "positive",
        heroId: 25,
        stateIdentity: "state-duplicate-check",
      }),
    });
    expect(res1.status).toBe(202);

    const token2 = mintToken(1001);
    const res2 = await fetch(`${baseUrl}/api/session/${sessionId}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-account-token": token2 },
      body: JSON.stringify({
        rating: "negative",
        heroId: 25,
        reason: "wrong_position",
        stateIdentity: "state-duplicate-check",
      }),
    });
    expect(res2.status).toBe(409);
    expect((await res2.json()).error).toBe("duplicate_submission");
  });

  test("comentario que contiene secretos o tokens sospechosos es rechazado (400 sensitive_data_rejected)", async () => {
    const token = mintToken(1001);
    const res = await fetch(`${baseUrl}/api/session/${sessionId}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-account-token": token },
      body: JSON.stringify({
        rating: "negative",
        heroId: 1,
        reason: "other",
        comment: "mi " + "api_" + "key: " + "abcdef1234567890abcdef123456" + " no funciona",
        stateIdentity: "state-secret-leak",
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("sensitive_data_rejected");
  });

  test("GET /api/recommendation-feedback no está expuesto públicamente (404 Not found)", async () => {
    const res = await fetch(`${baseUrl}/api/recommendation-feedback`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
});
