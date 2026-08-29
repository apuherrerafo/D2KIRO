import rawCounters from "./hero-counters.json";
import type { HeroId } from "../draft/reducer";
import { CURATED_HERO_IDS } from "../../../../scripts/pro/validate-drafts";

// TSK-183 (SPEC.md §14.4): capa curada de counter-picks. Dato de dominio, NO en SQLite -- mismo
// patrón exacto que `hero-positions.json` (S10) y `capabilities.json` (S9). `counter` está
// estructuralmente muerto porque `RELATIONSHIP_MIN_GAMES=200` recorta ~93% de los matchups
// reales; esta capa le da un piso que no depende de que exista volumen estadístico.
//
// Keyed por la VÍCTIMA (el héroe al que le hacen counter). Cada entrada dice qué rival `vs` le
// gana y con qué fuerza (`level`). `why` es texto visible en el desglose de la señal.
//
// v1 cubre los ~30 héroes más pickeados; se expande incrementalmente (SPEC.md §14.11). El
// contenido lo revisa un humano antes del merge -- ninguna prueba puede depender de un counter
// puntual (familia S9): el archivo se cura por parche.

export interface CuratedCounter {
  vs: HeroId;
  level: "hard" | "medium";
  why: string;
}

const VALID_LEVELS = new Set<CuratedCounter["level"]>(["hard", "medium"]);

function isValidVs(value: unknown): value is HeroId {
  return Number.isInteger(value) && CURATED_HERO_IDS.has(value as number);
}

function isValidCuratedCounter(value: unknown): value is CuratedCounter {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    isValidVs(entry.vs) &&
    VALID_LEVELS.has(entry.level as CuratedCounter["level"]) &&
    typeof entry.why === "string" &&
    entry.why.trim().length > 0
  );
}

// Un archivo con la raíz mal formada, o una entrada malformada (sin `vs` entero, `level` fuera
// de la unión, `why` vacío, `vs` desconocido, `vs` duplicado en la lista de una víctima, clave
// de víctima no numérica o desconocida) se descarta -- degrada `counter` a "capa estadística
// sola", nunca tira el motor (criterio literal de `parseHeroPositions()` con archivo
// malformado). Exportada por separado de `loadHeroCounters` para probarla con fixtures
// sintéticos, nunca contra el archivo real (familia S9, testing-seams.md).
export function parseHeroCounters(raw: unknown): Map<HeroId, CuratedCounter[]> {
  const result = new Map<HeroId, CuratedCounter[]>();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return result;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const victim = Number(key);
    if (!Number.isInteger(victim) || !CURATED_HERO_IDS.has(victim)) continue;
    if (result.has(victim)) continue; // clave repetida tras Number() -- conserva la primera
    if (!Array.isArray(value)) continue;

    const seenVs = new Set<number>();
    const entries: CuratedCounter[] = [];
    for (const candidate of value) {
      if (!isValidCuratedCounter(candidate)) continue;
      if (seenVs.has(candidate.vs)) continue; // `vs` duplicado -- conserva la primera aparición
      seenVs.add(candidate.vs);
      entries.push({ vs: candidate.vs, level: candidate.level, why: candidate.why });
    }
    if (entries.length === 0) continue;

    result.set(victim, entries);
  }

  return result;
}

export function loadHeroCounters(): Map<HeroId, CuratedCounter[]> {
  return parseHeroCounters(rawCounters);
}
