import { expect, test } from "bun:test";
import { defaultMvpPublicBaseUrl, resolveMvpDatabasePath } from "./dev-mvp-config";

test("dev:mvp usa localhost como host canónico", () => {
  expect(defaultMvpPublicBaseUrl("3000")).toBe("http://localhost:3000");
});

test("dev:mvp resuelve una DB relativa desde apps/engine, igual que el motor", () => {
  expect(resolveMvpDatabasePath("C:/repo", "data/custom.sqlite")).toBe("C:\\repo\\apps\\engine\\data\\custom.sqlite");
});
