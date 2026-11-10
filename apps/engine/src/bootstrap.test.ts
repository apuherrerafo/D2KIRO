import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { shouldStartGlobalMetaRefresh } from "./bootstrap";

// La sincronización automática con OpenDota es de PRODUCCIÓN (y del modo local dev:mvp). El E2E corre sobre una base sembrada con
// datos fijos y no debe tocar la red: si la baja en vivo, los bans "con semilla fija" cambian según el día y la prueba se vuelve aleatoria.

const read = (...parts: string[]) => readFileSync(join(import.meta.dir, ...parts), "utf8");

describe("bootstrap -- sincronización automática del meta", () => {
  test("sin autorización explícita NO arranca (preview/local); solo META_SYNC=on arranca (ni siquiera production de Railway); el flag de prueba la apaga", () => {
    expect(shouldStartGlobalMetaRefresh({}, {})).toBe(false);
    expect(shouldStartGlobalMetaRefresh({}, { RAILWAY_ENVIRONMENT_NAME: "preview" })).toBe(false);
    expect(shouldStartGlobalMetaRefresh({}, { RAILWAY_ENVIRONMENT_NAME: "production" })).toBe(false);
    expect(shouldStartGlobalMetaRefresh({}, { META_SYNC: "on" })).toBe(true);
    expect(shouldStartGlobalMetaRefresh({ disableGlobalMetaRefresh: false }, { META_SYNC: "on" })).toBe(true);
    expect(shouldStartGlobalMetaRefresh({ disableGlobalMetaRefresh: true }, { META_SYNC: "on" })).toBe(false);
  });

  test("solo los lanzadores del E2E la apagan: producción y dev:mvp siguen sincronizando", () => {
    expect(read("index.e2e.ts")).toContain('disableGlobalMetaRefresh: process.env.E2E_OFFLINE_META === "1"');
    expect(read("..", "..", "..", "playwright.config.ts")).toContain('E2E_OFFLINE_META: "1"');
    expect(read("..", "..", "..", "scripts", "e2e", "run.ts")).toContain('E2E_OFFLINE_META: "1"');
    expect(read("..", "..", "..", "scripts", "dev-mvp.ts")).not.toContain("E2E_OFFLINE_META");
    expect(read("index.ts")).not.toContain("disableGlobalMetaRefresh");
    expect(read("index.ts")).not.toContain("E2E_OFFLINE_META");
    // bootstrap.ts no lee el flag de ninguna variable de entorno: solo de sus overrides.
    expect(read("bootstrap.ts")).not.toContain("E2E_OFFLINE_META");
  });
});
