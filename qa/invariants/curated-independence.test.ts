/**
 * R3.3/R3.4 -- el QA aislado NO depende de los JSON curados reales del motor (counters, sinergias, posiciones, aprobados).
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
const PROBE = resolve(HERE, "../isolation/profile-probe.ts");
const PRELOAD = resolve(HERE, "../isolation/empty-counters.preload.ts");

interface ProbeOutput { seen: Record<"counters" | "synergies" | "positions" | "approved", number>; profile: Record<string, unknown> }

function runProbe(mode: "real" | "empty" | "scrambled"): ProbeOutput {
  const args = mode === "real" ? [PROBE] : ["--preload", PRELOAD, PROBE];
  const result = Bun.spawnSync([process.execPath, ...args], { env: { ...process.env, QA_ISOLATION_MODE: mode, LOG_LEVEL: "silent" }, cwd: resolve(HERE, "../..") });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  const line = result.stdout.toString().split("\n").find((entry) => entry.startsWith("ISOLATION_PROBE "));
  expect(line, "la sonda no imprimio su resultado").toBeDefined();
  return JSON.parse(line!.slice("ISOLATION_PROBE ".length)) as ProbeOutput;
}

describe("independencia del QA respecto de los JSON curados del motor (R3.3/R3.4: counters, sinergias, posiciones, aprobados)", () => {
  const real = runProbe("real");
  const empty = runProbe("empty");
  const scrambled = runProbe("scrambled");

  test("premisa no vacua: la sustitucion SI llega al motor en los 4 JSON curados (mismo especificador de modulo) y la matriz produce tarjetas", () => {
    expect(empty.seen).toEqual({ counters: 0, synergies: 0, positions: 0, approved: 0 });
    expect(scrambled.seen).toEqual({ counters: 2, synergies: 1, positions: 1, approved: 1 });
    for (const count of Object.values(real.seen)) expect(count).toBeGreaterThan(2);
    expect(Number(real.profile.withCards)).toBeGreaterThan(0);
  });

  test("con los 4 JSON curados vacios, el perfil de la matriz es identico", () => {
    expect(empty.profile).toEqual(real.profile);
  });

  test("con los 4 JSON curados reemplazados por otro contenido, el perfil de la matriz es identico", () => {
    expect(scrambled.profile).toEqual(real.profile);
  });
});

// Lectores AUTORIZADOS de datos curados reales: pruebas de integracion contra el artefacto publicado, declaradas como tales en su cabecera
// (`position-oracle.ts`: "SHARED_RAW_DATA ... hero-positions.json"). Solo `hero-positions.json`; cada entrada exige su motivo. Agregar otra es una decision a revisar.
const AUTHORIZED_REAL_READERS: Readonly<Record<string, string>> = {
  "mvp/position-oracle.ts": "oraculo independiente que audita el filtro de credibilidad de produccion contra el artefacto publicado (SHARED_RAW_DATA)",
  "mvp/matrix.test.ts": "integracion del corpus MVP sobre las posiciones publicadas, comparadas con el oraculo independiente",
  "mvp/baseline-pos2-probe.test.ts": "sonda QA-P0-001 sobre las posiciones publicadas (carries no credibles para Pos2); counters inyectados explicitamente",
};
const ANY_REAL_DATA = /\b(loadHeroCounters|loadHeroSynergies|loadHeroCapabilities|loadAdvertirApproved|loadCalibration|loadHeroPositions)\b|(hero-counters|hero-synergies|hero-positions|capabilities|advertir-approved|percentiles)\.json|\.sqlite\b/;
const NON_POSITIONS_DATA = /\b(loadHeroCounters|loadHeroSynergies|loadHeroCapabilities|loadAdvertirApproved|loadCalibration)\b|(hero-counters|hero-synergies|capabilities|advertir-approved|percentiles)\.json|\.sqlite\b/;

function withoutComments(text: string): string {
  return text.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
}

describe("independencia estatica: ningun archivo del QA lee datos curados reales fuera de la allowlist", () => {
  test("solo los lectores autorizados tocan datos curados reales, y solo hero-positions.json", async () => {
    const offenders: string[] = [];
    for (const file of new Bun.Glob("**/*.ts").scanSync({ cwd: resolve(HERE, ".."), absolute: true })) {
      const relative = file.split(String.fromCharCode(92)).join("/").split("/qa/")[1]!;
      if (relative === "invariants/curated-independence.test.ts" || relative.startsWith("isolation/")) continue;
      const code = withoutComments(await Bun.file(file).text());
      const match = ANY_REAL_DATA.exec(code);
      if (match === null) continue;
      if (!(relative in AUTHORIZED_REAL_READERS) || NON_POSITIONS_DATA.test(code)) offenders.push(`${relative}: ${match[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  test("la allowlist no tiene entradas muertas (cada lector autorizado existe y lee de verdad)", async () => {
    for (const relative of Object.keys(AUTHORIZED_REAL_READERS)) {
      const code = withoutComments(await Bun.file(resolve(HERE, "..", relative)).text());
      expect(ANY_REAL_DATA.test(code), relative).toBe(true);
    }
  });
});
