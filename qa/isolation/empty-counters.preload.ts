// Preload de la prueba de aislamiento (R3.3/R3.4): sustituye los modulos JSON curados REALES que el motor carga por defecto ANTES de que se importen.
// No lee los archivos reales. QA_ISOLATION_MODE: "empty" -> {} en los cuatro; "scrambled" -> contenido ajeno (counters con 2 claves, el resto con una clave marca).
import { mock } from "bun:test";
import { resolve } from "node:path";

export const CURATED_MODULES = [
  "signals/hero-counters.json",
  "signals/hero-synergies.json",
  "signals/hero-positions.json",
  "coach/advertir-approved.json",
] as const;

const mode = process.env.QA_ISOLATION_MODE ?? "empty";
const scrambledCounters = { "1": [{ vs: 2, level: "hard", why: "isolation probe" }], "100": [{ vs: 1, level: "hard", why: "isolation probe" }] };
for (const relative of CURATED_MODULES) {
  const content: Record<string, unknown> = mode === "scrambled" ? (relative === "signals/hero-counters.json" ? scrambledCounters : { __qa_isolation__: [] }) : {};
  mock.module(resolve(import.meta.dir, "../../apps/engine/src", relative), () => ({ default: content }));
}
