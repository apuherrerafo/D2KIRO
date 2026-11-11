import { expect, test } from "bun:test";
import { join, parse } from "node:path";
import { classifyEngineCommand, defaultMvpPublicBaseUrl, engineLaunch, resolveMvpDatabasePath } from "./dev-mvp-config";

test("dev:mvp usa localhost como host canónico", () => {
  expect(defaultMvpPublicBaseUrl("3000")).toBe("http://localhost:3000");
});

test("dev:mvp resuelve una DB relativa desde apps/engine, igual que el motor", () => {
  // Raíz absoluta con la semántica de rutas del SO anfitrión (`<unidad>:\repo` en Windows,
  // `/repo` en Linux): un literal `C:\...` sólo es absoluto en Windows (TSK-236).
  const root = join(parse(process.cwd()).root, "repo");
  expect(resolveMvpDatabasePath(root, "data/custom.sqlite")).toBe(join(root, "apps", "engine", "data", "custom.sqlite"));
});

test("modo real (Live): mismo entrypoint que Railway, sin --watch, sin fixture de CM ni capacidades de prueba", () => {
  const live = engineLaunch(true);
  expect(live.args).toEqual(["run", "src/index.ts"]);
  expect(live.writeCmFixture).toBe(false);
  expect(live.args.join(" ")).not.toContain("e2e");
  expect(live.args).not.toContain("--watch");
});

test("modo desarrollo (dev:mvp) no cambia: index.e2e.ts con --watch y fixture de CM", () => {
  const dev = engineLaunch(false);
  expect(dev.args).toEqual(["run", "--watch", "src/index.e2e.ts"]);
  expect(dev.writeCmFixture).toBe(true);
});

test("clasifica el motor por su línea de comandos: el de pruebas se reconoce aunque venga con --watch o barras de Windows", () => {
  expect(classifyEngineCommand("bun run --watch src/index.e2e.ts")).toBe("test");
  expect(classifyEngineCommand("bun run src/index.ts")).toBe("production");
  expect(classifyEngineCommand("C:\\bun.exe run src\\index.ts")).toBe("production");
  expect(classifyEngineCommand("node otro.js")).toBe("unknown");
});

test("index.ts (el entrypoint real) no pasa NINGUNA capacidad de prueba a runEngine", async () => {
  const source = await Bun.file(join(import.meta.dir, "..", "apps", "engine", "src", "index.ts")).text();
  const code = source.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  expect(code).toMatch(/runEngine\(\s*\)/);
  expect(code).not.toMatch(/allow[A-Z]|disableGlobalMetaRefresh|cmEligibilityArtifactPath|process\.env/);
});
