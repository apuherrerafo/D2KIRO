/**
 * R3.3 -- el QA aislado NO depende de `hero-counters.json` real.
 *
 * Antes (hallazgo ALTA de la revision independiente de R3): `createFixtureRoutes()` omitia `heroCounters`, el motor caia a su default
 * (el archivo curado real) y la referencia hasheaba ese archivo: cada curacion por parche ponia la suite en rojo o la dejaba cubriendo otra cosa.
 *
 * Prueba conductual: se corre la matriz completa en subprocesos separados con el modulo `hero-counters.json` SUSTITUIDO (vacio / otro contenido)
 * y se exige que el perfil de cobertura sea identico al de la corrida normal. Si el motor volviera a leer el archivo real, el perfil cambiaria.
 * No lee `hero-counters.json` desde la prueba: solo observa lo que el subproceso reporta.
 */
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const HERE = import.meta.dir;
const PROBE = resolve(HERE, "isolation/profile-probe.ts");
const PRELOAD = resolve(HERE, "isolation/empty-counters.preload.ts");

interface ProbeOutput { engineSeenKeys: number; profile: Record<string, unknown> }

function runProbe(mode: "real" | "empty" | "scrambled"): ProbeOutput {
  const args = mode === "real" ? [PROBE] : ["--preload", PRELOAD, PROBE];
  const result = Bun.spawnSync([process.execPath, ...args], { env: { ...process.env, QA_ISOLATION_MODE: mode, LOG_LEVEL: "silent" }, cwd: resolve(HERE, "../..") });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  const line = result.stdout.toString().split("\n").find((entry) => entry.startsWith("ISOLATION_PROBE "));
  expect(line, "la sonda no imprimio su resultado").toBeDefined();
  return JSON.parse(line!.slice("ISOLATION_PROBE ".length)) as ProbeOutput;
}

describe("independencia del QA respecto de hero-counters.json (R3.3)", () => {
  const real = runProbe("real");
  const empty = runProbe("empty");
  const scrambled = runProbe("scrambled");

  test("premisa no vacua: la sustitucion SI llega al motor (mismo especificador de modulo) y la matriz produce tarjetas", () => {
    expect(empty.engineSeenKeys).toBe(0);
    expect(scrambled.engineSeenKeys).toBe(2);
    expect(real.engineSeenKeys).toBeGreaterThan(2);
    expect(Number(real.profile.withCards)).toBeGreaterThan(0);
  });

  test("con el archivo curado vacio, el perfil de la matriz es identico", () => {
    expect(empty.profile).toEqual(real.profile);
  });

  test("con el archivo curado reemplazado por otro contenido, el perfil de la matriz es identico", () => {
    expect(scrambled.profile).toEqual(real.profile);
  });
});

describe("independencia estatica: ningun archivo del QA lee el dato curado real", () => {
  test("ningun .ts bajo qa/ (salvo esta prueba y su sonda) abre hero-counters.json ni lo importa", async () => {
    const offenders: string[] = [];
    for (const file of new Bun.Glob("**/*.ts").scanSync({ cwd: resolve(HERE, ".."), absolute: true })) {
      if (file.endsWith("curated-independence.test.ts") || file.includes("/isolation/") || file.includes("\isolation\\")) continue;
      const text = await Bun.file(file).text();
      const code = text.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
      if (/hero-counters\.json/.test(code) || /\b(readFileSync|readFile|Bun\.file)\b[^\n]*hero-counters/.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
