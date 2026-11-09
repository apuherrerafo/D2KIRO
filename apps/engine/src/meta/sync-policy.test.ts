import { expect, test } from "bun:test";
import { resolveMetaSyncPolicy } from "./sync-policy";

test("sin META_SYNC=on no hay sync, sea cual sea el entorno", () => {
  expect(resolveMetaSyncPolicy({}).enabled).toBe(false);
  expect(resolveMetaSyncPolicy({ RAILWAY_ENVIRONMENT_NAME: "preview" }).enabled).toBe(false);
  expect(resolveMetaSyncPolicy({ RAILWAY_ENVIRONMENT_NAME: "staging" }).enabled).toBe(false);
  expect(resolveMetaSyncPolicy({ RAILWAY_ENVIRONMENT_NAME: "production" }).enabled).toBe(false);
});

test("solo META_SYNC=on activa; cualquier otro valor desactiva", () => {
  expect(resolveMetaSyncPolicy({ META_SYNC: "on" }).enabled).toBe(true);
  expect(resolveMetaSyncPolicy({ META_SYNC: "ON" }).enabled).toBe(true);
  expect(resolveMetaSyncPolicy({ META_SYNC: "on", RAILWAY_ENVIRONMENT_NAME: "staging" }).enabled).toBe(true);
  expect(resolveMetaSyncPolicy({ META_SYNC: "off", RAILWAY_ENVIRONMENT_NAME: "production" }).enabled).toBe(false);
  expect(resolveMetaSyncPolicy({ META_SYNC: "quizás" }).enabled).toBe(false);
  expect(resolveMetaSyncPolicy({ META_SYNC: "" }).enabled).toBe(false);
});
