import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { accounts, recommendationFeedback } from "./schema";
import {
  getAllRecommendationFeedback,
  getRecommendationFeedbackByTarget,
  insertRecommendationFeedback,
} from "./queries";

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE accounts (
      steam_account_id INTEGER PRIMARY KEY,
      personal_baseline_winrate REAL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE recommendation_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      session_id TEXT NOT NULL,
      hero_id INTEGER NOT NULL,
      target_position INTEGER,
      rating TEXT NOT NULL,
      reason TEXT,
      comment TEXT,
      state_identity TEXT,
      ruleset_id TEXT,
      ruleset_version TEXT,
      account_id INTEGER REFERENCES accounts(steam_account_id),
      created_at TEXT NOT NULL
    );
  `);
  return drizzle(sqlite, { schema: { accounts, recommendationFeedback } });
}

test("insert + select de recommendation_feedback round-tripea feedback positivo", () => {
  const db = createTestDb();

  insertRecommendationFeedback(db, {
    sessionId: "proto-session-1",
    heroId: 7,
    targetPosition: 4,
    rating: "positive",
    stateIdentity: "sha256-state-identity-1",
    rulesetId: "dota2/ranked-all-pick",
    rulesetVersion: "7.41e",
    createdAt: "2026-09-24T00:00:00.000Z",
  });

  const rows = getAllRecommendationFeedback(db);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.sessionId).toBe("proto-session-1");
  expect(rows[0]!.heroId).toBe(7);
  expect(rows[0]!.targetPosition).toBe(4);
  expect(rows[0]!.rating).toBe("positive");
  expect(rows[0]!.reason).toBeNull();
  expect(rows[0]!.comment).toBeNull();
  expect(rows[0]!.stateIdentity).toBe("sha256-state-identity-1");
  expect(rows[0]!.rulesetId).toBe("dota2/ranked-all-pick");
  expect(rows[0]!.rulesetVersion).toBe("7.41e");
  expect(rows[0]!.accountId).toBeNull();
});

test("insert + select de recommendation_feedback round-tripea feedback negativo con motivo y comentario", () => {
  const db = createTestDb();

  insertRecommendationFeedback(db, {
    sessionId: "proto-session-2",
    heroId: 25,
    targetPosition: 2,
    rating: "negative",
    reason: "questionable_counter",
    comment: "Lina no counterea a Viper en esta fase",
    stateIdentity: "sha256-state-identity-2",
    rulesetId: "dota2/ranked-all-pick",
    rulesetVersion: "7.41e",
    accountId: 123456,
    createdAt: "2026-09-24T00:01:00.000Z",
  });

  const rows = getAllRecommendationFeedback(db);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.heroId).toBe(25);
  expect(rows[0]!.targetPosition).toBe(2);
  expect(rows[0]!.rating).toBe("negative");
  expect(rows[0]!.reason).toBe("questionable_counter");
  expect(rows[0]!.comment).toBe("Lina no counterea a Viper en esta fase");
  expect(rows[0]!.accountId).toBe(123456);
});

test("getRecommendationFeedbackByTarget localiza feedback por sessionId, heroId y stateIdentity", () => {
  const db = createTestDb();

  insertRecommendationFeedback(db, {
    sessionId: "proto-session-3",
    heroId: 10,
    targetPosition: 1,
    rating: "positive",
    stateIdentity: "state-A",
    createdAt: "2026-09-24T00:02:00.000Z",
  });

  insertRecommendationFeedback(db, {
    sessionId: "proto-session-3",
    heroId: 10,
    targetPosition: 1,
    rating: "negative",
    reason: "poor_hero",
    stateIdentity: "state-B",
    createdAt: "2026-09-24T00:03:00.000Z",
  });

  const matchA = getRecommendationFeedbackByTarget(db, "proto-session-3", 10, "state-A");
  expect(matchA).toHaveLength(1);
  expect(matchA[0]!.rating).toBe("positive");

  const matchB = getRecommendationFeedbackByTarget(db, "proto-session-3", 10, "state-B");
  expect(matchB).toHaveLength(1);
  expect(matchB[0]!.rating).toBe("negative");

  const matchC = getRecommendationFeedbackByTarget(db, "proto-session-3", 10, "state-C");
  expect(matchC).toHaveLength(0);
});

test("getAllRecommendationFeedback devuelve filas ordenadas por id descendente (más nuevo primero)", () => {
  const db = createTestDb();

  insertRecommendationFeedback(db, {
    sessionId: "proto-session-4",
    heroId: 1,
    rating: "positive",
    createdAt: "2026-09-24T00:00:00.000Z",
  });
  insertRecommendationFeedback(db, {
    sessionId: "proto-session-4",
    heroId: 2,
    rating: "negative",
    reason: "wrong_position",
    createdAt: "2026-09-24T00:00:00.000Z",
  });

  const rows = getAllRecommendationFeedback(db);
  expect(rows).toHaveLength(2);
  expect(rows[0]!.heroId).toBe(2);
  expect(rows[1]!.heroId).toBe(1);
});
