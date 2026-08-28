#!/usr/bin/env bun
// Agregador profesional "desde la base": lee los drafts completos de pro-drafts.sqlite y produce
// un JSON provisional y auditable para el motor Pro-Drafter. Alcance estrictamente offline:
//   - cero red (solo bun:sqlite sobre un archivo local, abierto en modo readonly),
//   - no toca apps/engine/src/pipeline/,
//   - no reimplementa ningún umbral: reutiliza las funciones de scripts/pro/aggregate.ts tal cual,
//   - nunca sobrescribe apps/engine/src/pro/pro-patterns.json (guardado explícito + salida por CLI).
//
// Nota de datos: hasta TSK-178 pro_draft_slots solo tenía los 5 slots de Radiant por partida
// (el ingestor colapsaba `players[].team` a 0 y la PK descartaba el lado Dire). Con la ingesta
// corregida + `scripts/pro/backfill-slots.ts`, los slots cubren ambos equipos; una SQLite sin
// backfillear todavía degrada la cobertura de posición a Radiant, sin romper nada. Parejas, tríos
// y respuestas a bans usan `turns` (24 acciones completas) y siempre cubrieron los dos lados.
import { Database } from "bun:sqlite";
import { loadDraftFormatTurnData } from "../../apps/engine/src/draft/draft-format-turns";
import type { Confidence, ProDraft, ProSourceRef } from "../../apps/engine/src/pro/types";
import {
  aggregateBanResponses,
  aggregateDrafts,
  aggregatePair,
  aggregateTriple,
  PRO_POSITION_MIN_GAMES,
  type AggregateInput,
  type BanResponsePattern,
  type PairPattern,
  type PositionAggregate,
  type TriplePattern,
} from "./aggregate";
import { classifyTier } from "./classify-tier";
import { normalizeDraft } from "./normalize";

const DEFAULT_DB_PATH = "apps/engine/data/pro-drafts.sqlite";
const PRO_PATTERNS_PATH = "apps/engine/src/pro/pro-patterns.json";
// Espejo de scripts/pro/aggregate.ts (aggregateBanResponses: `group.samples >= 10`, no exportado).
// Solo se usa para publicarlo en `thresholds`; nunca como lógica de filtrado en este archivo.
const BAN_RESPONSE_MIN_GAMES = 10;

export const DATASET_CONFIDENCE_MEDIUM_MIN = 200;
export const DATASET_CONFIDENCE_HIGH_MIN = 1000;

/** Confianza del conjunto agregado en función de cuántos drafts completos entraron. Provisional. */
export function datasetConfidence(draftCount: number): Confidence {
  if (!Number.isFinite(draftCount) || draftCount <= 0) return "none";
  if (draftCount < DATASET_CONFIDENCE_MEDIUM_MIN) return "exploratory";
  if (draftCount < DATASET_CONFIDENCE_HIGH_MIN) return "medium";
  return "high";
}

interface DraftRow {
  readonly match_id: string;
  readonly league_id: number;
  readonly patch: string;
  readonly start_time: number;
  readonly game_mode: number;
  readonly radiant_team_id: number | null;
  readonly dire_team_id: number | null;
  readonly winning_side: "radiant" | "dire";
  readonly source: ProSourceRef["source"];
  readonly fetched_at: string;
  readonly sample_size: number;
  readonly has_gcdata: number;
}
interface TurnRow { readonly draft_order: number; readonly is_pick: number; readonly hero_id: number; readonly team: number }
interface SlotRow {
  readonly hero_id: number;
  readonly team: number;
  readonly position_est: number;
  readonly lane_role: number;
  readonly is_roaming: number;
  readonly net_worth: number;
}

export interface PatternCoverage { readonly groups: number; readonly eligible: number; readonly discarded: number }
export interface AggregateCoverage {
  readonly completeDraftsInDb: number;
  readonly draftsAggregated: number;
  readonly draftsSkipped: number;
  readonly draftsSkippedByReason: Readonly<Record<string, number>>;
  readonly draftsWithoutSlots: number;
  readonly patches: Readonly<Record<string, number>>;
  readonly tiers: Readonly<Record<string, number>>;
  readonly observedHeroesByPosition: Readonly<Record<string, number>>;
  readonly eligibleHeroesByPosition: Readonly<Record<string, number>>;
  readonly samplesByHero: Readonly<Record<string, number>>;
  readonly patterns: {
    readonly positions: PatternCoverage;
    readonly pairs: PatternCoverage;
    readonly triples: PatternCoverage;
    readonly banResponses: PatternCoverage;
  };
}
export interface AggregateMetadata {
  readonly source: ProSourceRef["source"];
  readonly fetchedAt: string | null;
  readonly sampleSize: number;
  readonly confidence: Confidence;
}
export interface ProvisionalAggregateReport {
  readonly metadata: AggregateMetadata;
  readonly thresholds: {
    readonly positionMinGames: number;
    readonly pairMinGames: number;
    readonly tripleMinGames: number;
    readonly banResponseMinGames: number;
  };
  readonly coverage: AggregateCoverage;
  readonly positions: readonly PositionAggregate[];
  readonly pairs: readonly PairPattern[];
  readonly triples: readonly TriplePattern[];
  readonly banResponses: readonly BanResponsePattern[];
}
export interface AggregateFromDbResult { readonly report: ProvisionalAggregateReport; readonly json: string }

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true })));
}

function reconstructProDraft(db: Database, row: DraftRow): ProDraft {
  const turnRows = db
    .query("SELECT draft_order, is_pick, hero_id, team FROM pro_draft_turns WHERE match_id = ? ORDER BY draft_order")
    .all(row.match_id) as TurnRow[];
  const slotRows = db
    .query("SELECT hero_id, team, position_est, lane_role, is_roaming, net_worth FROM pro_draft_slots WHERE match_id = ? ORDER BY team, position_est")
    .all(row.match_id) as SlotRow[];
  const ref: ProSourceRef = { source: row.source, fetchedAt: row.fetched_at, sampleSize: row.sample_size };
  return {
    matchId: row.match_id,
    leagueId: row.league_id,
    patch: row.patch,
    startTime: row.start_time,
    gameMode: row.game_mode,
    radiantTeamId: row.radiant_team_id,
    direTeamId: row.dire_team_id,
    winningSide: row.winning_side,
    turns: turnRows.map((turn) => ({ order: turn.draft_order, isPick: turn.is_pick === 1, heroId: turn.hero_id, team: (turn.team === 1 ? 1 : 0) as 0 | 1 })),
    slots: slotRows.map((slot) => ({
      heroId: slot.hero_id,
      team: (slot.team === 1 ? 1 : 0) as 0 | 1,
      positionEst: Math.min(5, Math.max(1, slot.position_est)) as 1 | 2 | 3 | 4 | 5,
      laneRole: slot.lane_role,
      isRoaming: slot.is_roaming === 1,
      netWorth: slot.net_worth,
    })),
    ref,
  };
}

// Denominador de cobertura: cuenta grupos candidatos ANTES de aplicar ningún umbral, con las mismas
// claves de agrupación que scripts/pro/aggregate.ts. No calcula winrate ni confianza ni filtra por
// tamaño de muestra: solo permite reportar `discarded = grupos - elegibles` sin repetir el umbral.
function countPatternGroups(inputs: readonly AggregateInput[]): {
  positions: number;
  pairs: number;
  triples: number;
  banResponses: number;
} {
  const positions = new Set<string>();
  const pairs = new Set<string>();
  const triples = new Set<string>();
  const banResponses = new Set<string>();
  for (const input of inputs) {
    for (const slot of input.draft.slots) positions.add(`${slot.heroId}:${slot.positionEst}:${input.patch}:${input.tier}`);
    for (const team of [0, 1] as const) {
      const heroes = [...new Set(input.draft.turns.filter((turn) => turn.isPick && turn.team === team).map((turn) => turn.heroId))].sort((a, b) => a - b);
      for (let i = 0; i < heroes.length; i += 1) {
        for (let j = i + 1; j < heroes.length; j += 1) {
          pairs.add(`${heroes[i]}:${heroes[j]}:${input.patch}:${input.tier}`);
          for (let k = j + 1; k < heroes.length; k += 1) triples.add(`${heroes[i]}:${heroes[j]}:${heroes[k]}:${input.patch}:${input.tier}`);
        }
      }
    }
    for (const ban of input.draft.turns.filter((turn) => !turn.isPick)) {
      const next = input.draft.turns
        .filter((turn) => turn.isPick && turn.team === ban.team && turn.order > ban.order)
        .sort((a, b) => a.order - b.order)[0];
      if (next) banResponses.add(`${ban.heroId}:${next.heroId}:${input.patch}:${input.tier}`);
    }
  }
  return { positions: positions.size, pairs: pairs.size, triples: triples.size, banResponses: banResponses.size };
}

function byPosition(a: PositionAggregate, b: PositionAggregate): number {
  return a.heroId - b.heroId || a.positionEst - b.positionEst || a.patch.localeCompare(b.patch) || a.tier.localeCompare(b.tier);
}
function byPair(a: PairPattern, b: PairPattern): number {
  return a.heroes[0] - b.heroes[0] || a.heroes[1] - b.heroes[1] || a.patch.localeCompare(b.patch) || a.tier.localeCompare(b.tier);
}
function byTriple(a: TriplePattern, b: TriplePattern): number {
  return (
    a.heroes[0] - b.heroes[0] ||
    a.heroes[1] - b.heroes[1] ||
    a.heroes[2] - b.heroes[2] ||
    a.patch.localeCompare(b.patch) ||
    a.tier.localeCompare(b.tier)
  );
}
function byBanResponse(a: BanResponsePattern, b: BanResponsePattern): number {
  return a.bannedHero - b.bannedHero || a.nextPickHero - b.nextPickHero || a.patch.localeCompare(b.patch) || a.tier.localeCompare(b.tier);
}

/** Núcleo puro y determinista: mismas filas de SQLite => mismo `json`, byte a byte. Sin reloj, sin red. */
export function buildAggregateReport(db: Database): AggregateFromDbResult {
  const table = loadDraftFormatTurnData().captainsMode;
  if (!table) throw new Error("draft-format-turns.json: tabla de Captain's Mode no disponible");

  const draftRows = db
    .query(
      "SELECT match_id, league_id, patch, start_time, game_mode, radiant_team_id, dire_team_id, winning_side, source, fetched_at, sample_size, has_gcdata FROM pro_drafts WHERE ingest_status = 'complete' ORDER BY match_id",
    )
    .all() as DraftRow[];
  const tierByLeague = new Map(
    (db.query("SELECT league_id, tier FROM tournaments").all() as { league_id: number; tier: string }[]).map((r) => [r.league_id, r.tier] as const),
  );

  const inputs: AggregateInput[] = [];
  const skippedByReason: Record<string, number> = {};
  const patches: Record<string, number> = {};
  const tiers: Record<string, number> = {};
  const samplesByHero: Record<string, number> = {};
  const observedByPosition: Record<string, Set<number>> = { "1": new Set(), "2": new Set(), "3": new Set(), "4": new Set(), "5": new Set() };
  let draftsWithoutSlots = 0;
  let fetchedAt: string | null = null;

  for (const row of draftRows) {
    const proDraft = reconstructProDraft(db, row);
    const classification = classifyTier({
      league: { tier: tierByLeague.get(row.league_id) ?? null },
      game_mode: row.game_mode,
      od_data: { has_gcdata: row.has_gcdata === 1 },
      picks_bans: proDraft.turns.map((turn) => ({ is_pick: turn.isPick, hero_id: turn.heroId, team: turn.team })),
    });
    if (classification !== "tier_1" && classification !== "tier_2") {
      skippedByReason[classification] = (skippedByReason[classification] ?? 0) + 1;
      continue;
    }

    const normalized = normalizeDraft(proDraft, table);
    inputs.push({ draft: normalized, patch: proDraft.patch, tier: classification, ref: proDraft.ref, winningSide: proDraft.winningSide });

    if (proDraft.slots.length === 0) draftsWithoutSlots += 1;
    patches[proDraft.patch] = (patches[proDraft.patch] ?? 0) + 1;
    tiers[classification] = (tiers[classification] ?? 0) + 1;
    for (const turn of proDraft.turns) if (turn.isPick) samplesByHero[turn.heroId] = (samplesByHero[turn.heroId] ?? 0) + 1;
    for (const slot of proDraft.slots) observedByPosition[String(slot.positionEst)]?.add(slot.heroId);
    if (fetchedAt === null || row.fetched_at > fetchedAt) fetchedAt = row.fetched_at;
  }

  const positions = [...aggregateDrafts(inputs)].sort(byPosition);
  const pairs = [...aggregatePair(inputs)].sort(byPair);
  const triples = [...aggregateTriple(inputs)].sort(byTriple);
  const banResponses = [...aggregateBanResponses(inputs)].sort(byBanResponse);
  const groups = countPatternGroups(inputs);

  const eligibleByPosition: Record<string, Set<number>> = { "1": new Set(), "2": new Set(), "3": new Set(), "4": new Set(), "5": new Set() };
  for (const row of positions) eligibleByPosition[String(row.positionEst)]?.add(row.heroId);

  const toSizeRecord = (record: Record<string, Set<number>>): Record<string, number> =>
    sortedRecord(Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value.size])));

  const report: ProvisionalAggregateReport = {
    metadata: {
      source: draftRows[0]?.source ?? "opendota_match",
      fetchedAt,
      sampleSize: draftRows.length,
      confidence: datasetConfidence(inputs.length),
    },
    thresholds: {
      positionMinGames: PRO_POSITION_MIN_GAMES,
      pairMinGames: PRO_POSITION_MIN_GAMES,
      tripleMinGames: PRO_POSITION_MIN_GAMES,
      banResponseMinGames: BAN_RESPONSE_MIN_GAMES,
    },
    coverage: {
      completeDraftsInDb: draftRows.length,
      draftsAggregated: inputs.length,
      draftsSkipped: draftRows.length - inputs.length,
      draftsSkippedByReason: sortedRecord(skippedByReason),
      draftsWithoutSlots,
      patches: sortedRecord(patches),
      tiers: sortedRecord(tiers),
      observedHeroesByPosition: toSizeRecord(observedByPosition),
      eligibleHeroesByPosition: toSizeRecord(eligibleByPosition),
      samplesByHero: sortedRecord(samplesByHero),
      patterns: {
        positions: { groups: groups.positions, eligible: positions.length, discarded: groups.positions - positions.length },
        pairs: { groups: groups.pairs, eligible: pairs.length, discarded: groups.pairs - pairs.length },
        triples: { groups: groups.triples, eligible: triples.length, discarded: groups.triples - triples.length },
        banResponses: { groups: groups.banResponses, eligible: banResponses.length, discarded: groups.banResponses - banResponses.length },
      },
    },
    positions,
    pairs,
    triples,
    banResponses,
  };
  return { report, json: `${JSON.stringify(report, null, 2)}\n` };
}

async function main(): Promise<void> {
  const args = new Map(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=") as [string, string]));
  const dbPath = args.get("db") || DEFAULT_DB_PATH;
  const outPath = args.get("out");
  if (!outPath) {
    throw new Error("Uso: bun scripts/pro/aggregate-from-db.ts --out=<salida.json> [--db=<pro-drafts.sqlite>]");
  }
  if (outPath === PRO_PATTERNS_PATH || outPath.endsWith("/pro/pro-patterns.json")) {
    throw new Error(`negado: este script no sobrescribe ${PRO_PATTERNS_PATH}. Elige otra ruta con --out.`);
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const { report, json } = buildAggregateReport(db);
    await Bun.write(outPath, json);
    const coverage = report.coverage;
    console.log(`Drafts completos en DB: ${coverage.completeDraftsInDb}; agregados: ${coverage.draftsAggregated}; descartados: ${coverage.draftsSkipped}; sin slots: ${coverage.draftsWithoutSlots}`);
    console.log(`Posiciones: ${coverage.patterns.positions.eligible}/${coverage.patterns.positions.groups} elegibles (descartadas ${coverage.patterns.positions.discarded})`);
    console.log(`Parejas: ${coverage.patterns.pairs.eligible}/${coverage.patterns.pairs.groups}; Tríos: ${coverage.patterns.triples.eligible}/${coverage.patterns.triples.groups}; Respuestas a ban: ${coverage.patterns.banResponses.eligible}/${coverage.patterns.banResponses.groups}`);
    console.log(`JSON provisional escrito en ${outPath} — source ${report.metadata.source}, fetchedAt ${report.metadata.fetchedAt}, sampleSize ${report.metadata.sampleSize}, confidence ${report.metadata.confidence}`);
  } finally {
    db.close();
  }
}

if (import.meta.main) main().catch((error) => { console.error("aggregate-from-db falló:", error); process.exit(1); });
