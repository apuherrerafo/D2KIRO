import rawCorpus from "./pro-draft-corpus.json";
import type { HeroId } from "../draft/reducer";

// Fase 5 (pro-drafter-spec-v1.md §2.1): corpus de drafts profesionales, dato curado a mano --
// mismo patrón que capabilities.json/hero-positions.json: archivo estático versionado, validado
// al cargar, nunca SQLite ni red en el camino caliente.
//
// [SUPUESTO, ver plan de Fase 5-8]: el doc de investigación no especifica fuente ni formato para
// este corpus. Se resuelve acá con el mismo criterio que el hueco de 124/126 en capabilities.json:
// un seed pequeño e incompleto a propósito, marcado como tal -- completarlo con drafts reales de
// torneos profesionales es trabajo de curación aparte, no de esta tarea.

export interface DraftCandidate {
  readonly draftId: string;
  readonly patch: string;
  readonly radiantHeroes: readonly HeroId[];
  readonly direHeroes: readonly HeroId[];
  readonly winningSide: "radiant" | "dire";
}

const TEAM_SIZE = 5;

function isValidHeroId(value: unknown): value is HeroId {
  return Number.isInteger(value) && (value as number) > 0;
}

function isValidTeam(value: unknown): value is HeroId[] {
  if (!Array.isArray(value) || value.length !== TEAM_SIZE) return false;
  if (!value.every(isValidHeroId)) return false;
  return new Set(value).size === TEAM_SIZE; // sin héroes repetidos en el mismo equipo
}

function isValidDraftCandidate(value: unknown): value is DraftCandidate {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;

  return (
    typeof d.draftId === "string" &&
    d.draftId.length > 0 &&
    typeof d.patch === "string" &&
    d.patch.length > 0 &&
    isValidTeam(d.radiantHeroes) &&
    isValidTeam(d.direHeroes) &&
    (d.winningSide === "radiant" || d.winningSide === "dire")
  );
}

// Una entrada malformada (equipo incompleto, héroe repetido, heroId inválido, side desconocido)
// se descarta -- nunca tira el motor. Exportada por separado de `loadDraftCorpus` para probarla
// con fixtures sintéticos, nunca contra el archivo real (mismo criterio S9/S10): el corpus se
// amplía con curación manual, un test atado a su contenido se rompería en silencio al crecer.
export function parseDraftCorpus(raw: unknown): DraftCandidate[] {
  if (!Array.isArray(raw)) return [];

  const seenIds = new Set<string>();
  const result: DraftCandidate[] = [];

  for (const entry of raw) {
    if (!isValidDraftCandidate(entry)) continue;
    if (seenIds.has(entry.draftId)) continue; // duplicado -- conserva la primera aparición

    seenIds.add(entry.draftId);
    result.push(entry);
  }

  return result;
}

export function loadDraftCorpus(): DraftCandidate[] {
  return parseDraftCorpus(rawCorpus);
}
