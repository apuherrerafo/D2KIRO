import rawApproved from "./advertir-approved.json";
import type { HeroId } from "../draft-protocol/types";
import { CURATED_HERO_IDS } from "../signals/curated-hero-ids";

// ADVERTIR -- filtro explícito de presentación (PO, 2026-11-06). La sección "Amenazas libres a tus picks" solo muestra relaciones que una auditoría
// aprobó para ESA función. No toca `hero-counters.json` ni sus niveles: el Robo, "Se abre", el ranking y ELIGE AHORA siguen leyendo la base completa.
//
// Fail-safe: archivo ausente, raíz malformada o esquema distinto -> conjunto vacío -> la sección no muestra nada (nunca se inventa un peligro). Una
// entrada malformada, con un héroe desconocido o con un estado distinto de VALIDATED_HARD se descarta sola (nunca ensancha el filtro). Que una relación
// NO esté aquí no dice que el héroe sea seguro: solo que todavía no se auditó para avisarla (la UI lo dice así).
//
// La clave es "counter>víctima" (dirección conservada: A>B no implica B>A).

export const ADVERTIR_APPROVED_SCHEMA = "advertir-approved/v1";
const APPROVED_STATUS = "VALIDATED_HARD";

export function advertirKey(counter: HeroId, victim: HeroId): string {
  return `${counter}>${victim}`;
}

function isKnownHero(value: unknown): value is HeroId {
  return Number.isInteger(value) && CURATED_HERO_IDS.has(value as number);
}

/** Exportada para probarla con fixtures sintéticos; nunca contra el archivo real (familia S9). Pura, nunca lanza. */
export function parseAdvertirApproved(raw: unknown): ReadonlySet<string> {
  const approved = new Set<string>();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return approved;
  const root = raw as Record<string, unknown>;
  if (root.schema !== ADVERTIR_APPROVED_SCHEMA || !Array.isArray(root.relations)) return approved;
  for (const candidate of root.relations) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const entry = candidate as Record<string, unknown>;
    if (entry.status !== APPROVED_STATUS || !isKnownHero(entry.counter) || !isKnownHero(entry.victim) || entry.counter === entry.victim) continue;
    approved.add(advertirKey(entry.counter, entry.victim));
  }
  return approved;
}

export function loadAdvertirApproved(): ReadonlySet<string> {
  return parseAdvertirApproved(rawApproved);
}
