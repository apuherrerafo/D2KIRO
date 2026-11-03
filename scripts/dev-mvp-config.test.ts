import { expect, test } from "bun:test";
import { join, parse } from "node:path";
import { defaultMvpPublicBaseUrl, resolveMvpDatabasePath } from "./dev-mvp-config";

test("dev:mvp usa localhost como host canónico", () => {
  expect(defaultMvpPublicBaseUrl("3000")).toBe("http://localhost:3000");
});

test("dev:mvp resuelve una DB relativa desde apps/engine, igual que el motor", () => {
  // Raíz absoluta con la semántica de rutas del SO anfitrión (`<unidad>:\repo` en Windows,
  // `/repo` en Linux): un literal `C:\...` sólo es absoluto en Windows (TSK-236).
  const root = join(parse(process.cwd()).root, "repo");
  expect(resolveMvpDatabasePath(root, "data/custom.sqlite")).toBe(join(root, "apps", "engine", "data", "custom.sqlite"));
});
