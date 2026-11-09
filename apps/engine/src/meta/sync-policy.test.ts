import { expect, test } from "bun:test";
import { resolveMetaSyncPolicy } from "./sync-policy";

test("fuera de producción no hay sync sin autorización explícita", () => {
  expect(resolveMetaSyncPolicy({}).enabled).toBe(false);
  expect(resolveMetaSyncPolicy({ RAILWAY_ENVIRONMENT_NAME: "preview" }).enabled).toBe(false);
  expect(resolveMetaSyncPolicy({ RAILWAY_ENVIRONMENT_NAME: "staging" }).enabled).toBe(false);
});

test("producción de Railway conserva su comportamiento", () => {
  expect(resolveMetaSyncPolicy({ RAILWAY_ENVIRONMENT_NAME: "production" }).enabled).toBe(true);
});

test("META_SYNC manda sobre el entorno, en ambos sentidos", () => {
  expect(resolveMetaSyncPolicy({ META_SYNC: "on" }).enabled).toBe(true);
  expect(resolveMetaSyncPolicy({ META_SYNC: "ON" }).enabled).toBe(true);
  expect(resolveMetaSyncPolicy({ META_SYNC: "off", RAILWAY_ENVIRONMENT_NAME: "production" }).enabled).toBe(false);
  expect(resolveMetaSyncPolicy({ META_SYNC: "quizás" }).enabled).toBe(false);
});
