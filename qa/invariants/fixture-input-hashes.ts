/**
 * R3.3 -- huella (sha256) de los FIXTURES sinteticos de los que depende la referencia de cobertura. Sin I/O: no lee ningun archivo curado
 * (antes, R3.2, leia `hero-counters.json` real y la suite se ponia roja con cada curacion por parche).
 *
 * Por que se conserva: la matriz depende de los counters inyectados. Si alguien edita `qa/scenarios/synthetic-counters.ts`, la referencia deja de
 * ser comparable: el guard lo diagnostica como REFERENCE_INCOMPATIBLE y NO como regresion del Coach.
 */
import { createHash } from "node:crypto";
import { FILLER, HERO_POSITIONS } from "../scenarios/generate";
import { syntheticCountersSha256 } from "../scenarios/synthetic-counters";

/** Debe coincidir con las claves de `provenance.fixtureInputs` de la referencia. */
export const FIXTURE_INPUT_NAMES = Object.freeze(["synthetic-counters", "scenario-universe"] as const);

export function fixtureInputHashes(): Record<string, string> {
  // El fixture de counters solo produce tarjetas contra los ids baneados de relleno y sobre el universo de heroes del generador: si cambian, la
  // referencia deja de ser comparable aunque los counters no se hayan tocado.
  const universe = { filler: FILLER, heroPositions: Object.entries(HERO_POSITIONS).map(([hero, rows]) => [Number(hero), rows]).sort(([a], [b]) => (a as number) - (b as number)) };
  return { "synthetic-counters": syntheticCountersSha256(), "scenario-universe": createHash("sha256").update(JSON.stringify(universe)).digest("hex") };
}
