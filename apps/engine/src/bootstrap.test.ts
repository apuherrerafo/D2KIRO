import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { shouldStartGlobalMetaRefresh } from "./bootstrap";

// La sincronización automática con OpenDota es de PRODUCCIÓN. El E2E corre sobre una base sembrada con datos fijos y no
// debe tocar la red: si la baja en vivo, los bans "con semilla fija" cambian según el día y la prueba se vuelve aleatoria.

describe("bootstrap -- sincronización automática del meta", () => {
  test("producción (sin overrides) sí la arranca; solo el flag de prueba la apaga", () => {
    expect(shouldStartGlobalMetaRefresh({})).toBe(true);
    expect(shouldStartGlobalMetaRefresh({ disableGlobalMetaRefresh: false })).toBe(true);
    expect(shouldStartGlobalMetaRefresh({ disableGlobalMetaRefresh: true })).toBe(false);
  });

  test("el entrypoint del E2E la apaga y el de producción nunca lo hace", () => {
    const e2e = readFileSync(join(import.meta.dir, "index.e2e.ts"), "utf8");
    const production = readFileSync(join(import.meta.dir, "index.ts"), "utf8");
    expect(e2e).toContain("disableGlobalMetaRefresh: true");
    expect(production).not.toContain("disableGlobalMetaRefresh");
  });
});
