import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// R1 S3 (final trust-boundary repair) -- candado del lado navegador.
//
// El cierre real vive en el motor (la ruta pública devuelve 403 admin_command_forbidden). Esto
// verifica lo complementario y igual de importante: apps/web NO TIENE NINGÚN CAMINO para invocar
// la carga confiable, ni siquiera uno que hoy nadie llame. Es una aserción sobre el código fuente
// a propósito -- un test de comportamiento no puede probar la AUSENCIA de una capacidad, y este
// fallaría en el momento exacto en que alguien volviera a escribir el comando en el cliente.

const WEB_ROOT = join(import.meta.dir, "..", "..", "..");

function sourceOf(...segments: string[]): string {
  return readFileSync(join(WEB_ROOT, ...segments), "utf-8");
}

describe("apps/web no puede promover un snapshot de elegibilidad a confiable", () => {
  test.each([
    ["features/random-draft-simulator/protocol-client.ts"],
    ["features/random-draft-simulator/use-random-draft-session.ts"],
    ["features/random-draft-simulator/store.ts"],
  ])("%s no menciona LOAD_CM_ELIGIBILITY", (relativePath: string) => {
    expect(sourceOf(...relativePath.split("/"))).not.toContain("LOAD_CM_ELIGIBILITY");
  });

  test("el cliente de protocolo sólo sabe construir los 3 comandos de gameplay/adapter", () => {
    const source = sourceOf("features", "random-draft-simulator", "protocol-client.ts");
    expect(source).toContain("RECORD_RESOLVED_BANS");
    expect(source).toContain("BAN_RESOLUTION_COMPLETE");
    expect(source).toContain("SUBMIT_SEALED_SELECTION");
    expect(source).not.toContain("cm-hero-eligibility");
    expect(source).not.toContain("OFFICIAL_DEPOT");
  });

  test("la allowlist de rewrites no expone ninguna ruta de administración/elegibilidad", () => {
    const source = sourceOf("next.config.ts");
    expect(source).not.toContain("eligibility");
    expect(source).not.toContain("/admin");
  });
});
