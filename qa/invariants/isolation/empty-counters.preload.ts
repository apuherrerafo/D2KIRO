// Preload de la prueba de aislamiento (R3.3): sustituye el modulo `hero-counters.json` REAL por otro contenido ANTES de que el motor lo cargue.
// No lee el archivo real. El modo sale de QA_ISOLATION_MODE: "empty" -> {}, "scrambled" -> un mapa curado-falso que nada del QA reconoce.
import { mock } from "bun:test";
import { resolve } from "node:path";

const mode = process.env.QA_ISOLATION_MODE ?? "empty";
const content: Record<string, unknown> = mode === "scrambled" ? { "1": [{ vs: 2, level: "hard", why: "isolation probe" }], "100": [{ vs: 1, level: "hard", why: "isolation probe" }] } : {};
const target = resolve(import.meta.dir, "../../../apps/engine/src/signals/hero-counters.json");
mock.module(target, () => ({ default: content }));
