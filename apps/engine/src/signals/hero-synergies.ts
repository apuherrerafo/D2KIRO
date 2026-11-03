import rawSynergies from "./hero-synergies.json";
import type { HeroId } from "../draft/reducer";
import { CURATED_HERO_IDS } from "./curated-hero-ids";

// Sinergias de PAREJA (dos héroes concretos que se potencian en el mismo equipo: Magnus + Queen of
// Pain, Io + Tiny...). Dato curado, mismo patrón que `hero-counters.json` (familia S9): lo genera
// la base de conocimiento (docs/knowledge-pilot/tools/build_engine_data.py) solo con parejas
// respaldadas por el usuario, un analista o dos guías escritas vigentes, cada una con su porqué.
//
// Formato del archivo: lista de parejas `{ a, b, why }` (sin dirección). Se valida en el borde y se
// devuelve simétrico (la pareja aparece en la lista de `a` y en la de `b`). Archivo corrupto, raíz
// que no es lista, ids desconocidos, `a === b` o `why` vacío -> la entrada se descarta; nunca lanza
// y, sin entradas válidas, `team_synergy` se comporta exactamente como antes de existir este archivo.

export interface CuratedSynergy {
  with: HeroId;
  why: string;
}

function isKnownHero(value: unknown): value is HeroId {
  return Number.isInteger(value) && CURATED_HERO_IDS.has(value as number);
}

export function parseHeroSynergies(raw: unknown): Map<HeroId, CuratedSynergy[]> {
  const result = new Map<HeroId, CuratedSynergy[]>();
  if (!Array.isArray(raw)) return result;

  const add = (hero: HeroId, partner: HeroId, why: string): void => {
    const list = result.get(hero) ?? [];
    if (list.some((entry) => entry.with === partner)) return; // pareja repetida -- conserva la primera
    list.push({ with: partner, why });
    result.set(hero, list);
  };

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { a, b, why } = entry as Record<string, unknown>;
    if (!isKnownHero(a) || !isKnownHero(b) || a === b) continue;
    if (typeof why !== "string" || why.trim().length === 0) continue;
    add(a, b, why.trim());
    add(b, a, why.trim());
  }

  return result;
}

export function loadHeroSynergies(): Map<HeroId, CuratedSynergy[]> {
  return parseHeroSynergies(rawSynergies);
}
