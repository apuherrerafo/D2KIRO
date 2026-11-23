/**
 * R3.3 -- counters SINTETICOS del QA aislado. NO son conocimiento de Dota 2 ni evidencia de ningun matchup real.
 *
 * Por que existe: `createProtocolSessionRoutes` cae a `MODULE_HERO_COUNTERS` (el `hero-counters.json` curado real) cuando no recibe `heroCounters`.
 * La matriz del generador usa ids sinteticos (posicion*100 + offset) y, sin esto, sus tarjetas existian solo porque los ids 100-129 coincidian por
 * accidente con heroes reales con counters curados: una curacion por parche movia el QA sin que el Coach hubiera cambiado (invariantes.md: "ninguna
 * prueba lee un dato curado real"). Ahora el fixture es explicito, determinista y vive en el codigo del QA.
 *
 * Regla del fixture (deterministica, sin azar): el generador banea ids de relleno (1..48, `FILLER` en generate.ts) y la matriz solo produce
 * tarjetas para heroes de posicion 1 (ids 100-129; ver "Limites de cobertura registrados para R4" en coverage-reference.md). Por eso:
 *   - 3 de cada 4 heroes de posicion 1 (indice % 4 !== 3: 22 de 30) tienen 6 counters: 1 `hard` y 5 `medium` contra ids de relleno;
 *   - el cuarto restante NO tiene counters (abstencion legitima: sin fundamento no hay tarjeta);
 *   - el id contrincante de cada enlace es `1 + ((index * 5 + k * 7) % 48)` con k = 0..5 (k = 0 es el `hard`).
 * Ampliar a las posiciones 2-5 cambia el diseno de la matriz y exige regenerar la referencia con revision humana. */
import type { CuratedCounter } from "../../apps/engine/src/signals/hero-counters";
import { createHash } from "node:crypto";

export const SYNTHETIC_COUNTER_MARKER = "SYNTHETIC QA FIXTURE -- not Dota 2 knowledge";

const POSITION_ONE_BASE = 100;
const POSITION_ONE_HEROES = 30;
const FILLER_IDS = 48;
const LINKS_PER_HERO = 6;

export function buildSyntheticCounters(): Map<number, CuratedCounter[]> {
  const counters = new Map<number, CuratedCounter[]>();
  for (let index = 0; index < POSITION_ONE_HEROES; index += 1) {
    if (index % 4 === 3) continue; // heroe sin fundamento: abstencion legitima
    const list: CuratedCounter[] = [];
    for (let k = 0; k < LINKS_PER_HERO; k += 1) {
      list.push({ vs: 1 + ((index * 5 + k * 7) % FILLER_IDS), level: k === 0 ? "hard" : "medium", why: SYNTHETIC_COUNTER_MARKER });
    }
    counters.set(POSITION_ONE_BASE + index, list);
  }
  return counters;
}

/** Fixture por defecto de `createFixtureRoutes`. Se congela por referencia: nadie lo muta entre pruebas (cada llamada que necesite mutar usa `buildSyntheticCounters()`). */
export const SYNTHETIC_COUNTERS: ReadonlyMap<number, readonly CuratedCounter[]> = buildSyntheticCounters();

/** sha256 del contenido canonico del fixture (ids ordenados). Es la "procedencia" de la referencia de cobertura: sin I/O. */
export function syntheticCountersSha256(counters: ReadonlyMap<number, readonly CuratedCounter[]> = SYNTHETIC_COUNTERS): string {
  const canonical = [...counters.entries()].sort(([a], [b]) => a - b).map(([hero, list]) => [hero, list.map(({ vs, level, why }) => [vs, level, why])]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
