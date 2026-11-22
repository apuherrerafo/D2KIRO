/**
 * R3.2 -- huella (sha256) de los datos curados REALES de los que depende la referencia de cobertura. Es el unico lugar con I/O del guard:
 * solo LEE bytes para hashearlos (no interpreta ni valida su contenido) y se usa unicamente en `ownership.test.ts`.
 *
 * Por que: con `heroCounters` vacios inyectados la matriz entera produce 0 tarjetas. Las 194 de la referencia existen porque los ids de los
 * heroes del fixture (100-129) coinciden con heroes reales que tienen counters curados en `hero-counters.json`. Si ese archivo cambia
 * (curacion por parche), la referencia deja de ser comparable: el guard lo diagnostica como REFERENCE_INCOMPATIBLE y NO como regresion.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256Text } from "./matrix-coverage";

/** Archivo -> ruta relativa a la raiz del repo. Debe coincidir con las claves de `provenance.curatedInputs` de la referencia. */
export const CURATED_INPUT_FILES: Readonly<Record<string, string>> = Object.freeze({
  "hero-counters.json": "apps/engine/src/signals/hero-counters.json",
});

const REPO_ROOT = resolve(import.meta.dir, "../..");

/** sha256 por archivo; un archivo ilegible se omite (el guard lo reporta como REFERENCE_INCOMPATIBLE: "no se pudo calcular"). */
export function curatedInputHashes(): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const [name, relativePath] of Object.entries(CURATED_INPUT_FILES)) {
    try {
      hashes[name] = sha256Text(readFileSync(resolve(REPO_ROOT, relativePath), "utf8"));
    } catch {
      // omitido a proposito: la ausencia es el diagnostico
    }
  }
  return hashes;
}
