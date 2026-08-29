// Fase 9.0, costura S17 — carga y valida el Golden Dataset etiquetado a mano.
// Mismo criterio que loadHeroPositions()/loadHeroCounters(): un CASO malformado se descarta con
// motivo; el archivo entero nunca tira el runner. Ninguna prueba lee eval/golden/ real.

import type { HeroId } from "../../apps/engine/src/draft/reducer";
import type { DraftDecisionContext } from "../../apps/engine/src/drafter/decision-context";
import type { Grade, GoldenLabels } from "./metrics";

export const GOLDEN_SCHEMA_VERSION = 1;

export const GOLDEN_STRATA = [
  "hard_counter",
  "flexibility",
  "role_scarcity",
  "team_needs",
  "composition",
  "punishability",
  "historical_failure",
] as const;
export type GoldenStratum = (typeof GOLDEN_STRATA)[number];

export interface GoldenLabelEntry {
  hero: HeroId;
  why: string;
}

export type GoldenSource =
  | { kind: "replay"; matchId: string; turnIndex: number }
  | { kind: "synthetic"; note: string };

/** El `state` se guarda como el DraftState serializado; el loader lo valida estructuralmente. */
export interface GoldenCase {
  id: string;
  source: GoldenSource;
  state: SerializedDraftState;
  side: "radiant" | "dire";
  decisionContext: DraftDecisionContext;
  strata: GoldenStratum[];
  labels: {
    excellent: GoldenLabelEntry[];
    acceptable: GoldenLabelEntry[];
    bad: GoldenLabelEntry[];
  };
  reasoningTags: string[];
  labeledAt: string;
  labeledBy: string;
}

/** Subconjunto de DraftState que un caso del Golden necesita para correr buildSuggestions. */
export interface SerializedDraftState {
  schema: "draft-state/v1";
  format: "all_pick" | "captains_mode" | "unknown";
  patch: string;
  localSide: "radiant" | "dire" | "unknown";
  phase: "idle" | "active" | "complete" | "aborted";
  banned: HeroId[];
  picks: { radiant: HeroId[]; dire: HeroId[] };
  lastSeq: number;
}

export interface LoadGoldenResult {
  cases: GoldenCase[];
  rejected: { id?: string; reason: string }[];
}

export interface LoadGoldenOptions {
  /** Si se pasa, un héroe fuera de este set descarta el caso. Si no, sólo se exige entero > 0. */
  knownHeroIds?: Set<HeroId>;
}

// ---------- guards ----------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isHeroId(v: unknown, known?: Set<HeroId>): v is HeroId {
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) return false;
  return known ? known.has(v) : true;
}

function isHeroIdArray(v: unknown, known?: Set<HeroId>): v is HeroId[] {
  return Array.isArray(v) && v.every((h) => isHeroId(h, known));
}

function validateState(v: unknown, known?: Set<HeroId>): string | null {
  if (!isRecord(v)) return "state no es un objeto";
  if (v.schema !== "draft-state/v1") return `state.schema inesperado: ${String(v.schema)}`;
  if (v.format !== "all_pick" && v.format !== "captains_mode" && v.format !== "unknown") {
    return `state.format inválido: ${String(v.format)}`;
  }
  if (typeof v.patch !== "string") return "state.patch no es string";
  if (v.localSide !== "radiant" && v.localSide !== "dire" && v.localSide !== "unknown") {
    return `state.localSide inválido: ${String(v.localSide)}`;
  }
  if (v.phase !== "idle" && v.phase !== "active" && v.phase !== "complete" && v.phase !== "aborted") {
    return `state.phase inválido: ${String(v.phase)}`;
  }
  if (!isHeroIdArray(v.banned, known)) return "state.banned inválido";
  if (!isRecord(v.picks) || !isHeroIdArray(v.picks.radiant, known) || !isHeroIdArray(v.picks.dire, known)) {
    return "state.picks inválido";
  }
  if (typeof v.lastSeq !== "number" || !Number.isInteger(v.lastSeq) || v.lastSeq < 0) {
    return "state.lastSeq inválido";
  }
  return null;
}

function validateLabelList(v: unknown, name: string, known?: Set<HeroId>): { entries: GoldenLabelEntry[] } | { error: string } {
  if (!Array.isArray(v)) return { error: `labels.${name} no es lista` };
  const entries: GoldenLabelEntry[] = [];
  for (const item of v) {
    if (!isRecord(item) || !isHeroId(item.hero, known) || typeof item.why !== "string" || item.why.trim() === "") {
      return { error: `labels.${name} tiene una entrada malformada (hero entero>0 conocido + why no vacío)` };
    }
    entries.push({ hero: item.hero, why: item.why });
  }
  return { entries };
}

function validateCase(raw: unknown, opts: LoadGoldenOptions): { case: GoldenCase } | { id?: string; error: string } {
  if (!isRecord(raw)) return { error: "el caso no es un objeto" };
  const id = typeof raw.id === "string" ? raw.id : undefined;

  if (id === undefined || id.trim() === "") return { error: "id ausente o vacío" };

  const src = raw.source;
  const validSource =
    isRecord(src) &&
    ((src.kind === "replay" && typeof src.matchId === "string" && Number.isInteger(src.turnIndex)) ||
      (src.kind === "synthetic" && typeof src.note === "string"));
  if (!validSource) return { id, error: "source inválido (replay{matchId,turnIndex} | synthetic{note})" };

  const stateErr = validateState(raw.state, opts.knownHeroIds);
  if (stateErr !== null) return { id, error: stateErr };

  if (raw.side !== "radiant" && raw.side !== "dire") return { id, error: `side inválido: ${String(raw.side)}` };

  const dc = raw.decisionContext;
  if (dc !== "team_opening" && dc !== "blind_second_pick" && dc !== "response_pick" && dc !== "closing_pick") {
    return { id, error: `decisionContext inválido: ${String(dc)}` };
  }

  if (!Array.isArray(raw.strata) || raw.strata.length === 0 || !raw.strata.every((s) => (GOLDEN_STRATA as readonly string[]).includes(s as string))) {
    return { id, error: "strata vacío o con un valor no reconocido" };
  }

  if (!isRecord(raw.labels)) return { id, error: "labels ausente" };
  const exc = validateLabelList(raw.labels.excellent, "excellent", opts.knownHeroIds);
  const acc = validateLabelList(raw.labels.acceptable, "acceptable", opts.knownHeroIds);
  const bad = validateLabelList(raw.labels.bad, "bad", opts.knownHeroIds);
  for (const r of [exc, acc, bad]) if ("error" in r) return { id, error: r.error };
  const excellent = (exc as { entries: GoldenLabelEntry[] }).entries;
  const acceptable = (acc as { entries: GoldenLabelEntry[] }).entries;
  const badE = (bad as { entries: GoldenLabelEntry[] }).entries;

  if (excellent.length === 0) return { id, error: "labels.excellent vacío" };

  // ningún héroe en dos listas a la vez
  const seen = new Map<HeroId, string>();
  for (const [list, entries] of [["excellent", excellent], ["acceptable", acceptable], ["bad", badE]] as const) {
    for (const e of entries) {
      const prev = seen.get(e.hero);
      if (prev !== undefined) return { id, error: `héroe ${e.hero} está en labels.${prev} y labels.${list}` };
      seen.set(e.hero, list);
    }
  }

  if (!Array.isArray(raw.reasoningTags) || !raw.reasoningTags.every((t) => typeof t === "string")) {
    return { id, error: "reasoningTags inválido" };
  }
  if (typeof raw.labeledAt !== "string" || typeof raw.labeledBy !== "string") {
    return { id, error: "labeledAt/labeledBy ausente" };
  }

  return {
    case: {
      id,
      source: src as GoldenSource,
      state: raw.state as SerializedDraftState,
      side: raw.side,
      decisionContext: dc,
      strata: raw.strata as GoldenStratum[],
      labels: { excellent, acceptable, bad: badE },
      reasoningTags: raw.reasoningTags as string[],
      labeledAt: raw.labeledAt,
      labeledBy: raw.labeledBy,
    },
  };
}

// ---------- entry point ----------

export function loadGoldenDataset(raw: unknown, opts: LoadGoldenOptions = {}): LoadGoldenResult {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { cases: [], rejected: [{ reason: "JSON inválido en la raíz" }] };
    }
  }
  if (!isRecord(parsed)) return { cases: [], rejected: [{ reason: "la raíz no es un objeto" }] };
  if (parsed.schemaVersion !== GOLDEN_SCHEMA_VERSION) {
    return { cases: [], rejected: [{ reason: `schemaVersion desconocida: ${String(parsed.schemaVersion)} (esperada ${GOLDEN_SCHEMA_VERSION})` }] };
  }
  if (!Array.isArray(parsed.cases)) return { cases: [], rejected: [{ reason: "cases no es una lista" }] };

  const cases: GoldenCase[] = [];
  const rejected: { id?: string; reason: string }[] = [];
  const ids = new Set<string>();

  for (const rawCase of parsed.cases) {
    const res = validateCase(rawCase, opts);
    if ("error" in res) {
      rejected.push({ id: res.id, reason: res.error });
      continue;
    }
    if (ids.has(res.case.id)) {
      rejected.push({ id: res.case.id, reason: "id duplicado" });
      continue;
    }
    ids.add(res.case.id);
    cases.push(res.case);
  }

  return { cases, rejected };
}

/** Conveniencia para el Benchmark A: convierte las 3 listas a los tipos que espera metrics.ts. */
export function toMetricLabels(c: GoldenCase): GoldenLabels {
  return {
    excellent: c.labels.excellent.map((e) => e.hero),
    acceptable: c.labels.acceptable.map((e) => e.hero),
    bad: c.labels.bad.map((e) => e.hero),
  };
}

export function toGradedMap(c: GoldenCase): Map<HeroId, Grade> {
  const m = new Map<HeroId, Grade>();
  for (const e of c.labels.bad) m.set(e.hero, 0);
  for (const e of c.labels.acceptable) m.set(e.hero, 1);
  for (const e of c.labels.excellent) m.set(e.hero, 2);
  return m;
}
