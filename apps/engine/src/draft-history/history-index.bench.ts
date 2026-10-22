// Benchmark de `HistoryIndex.search` (TSK-249). NO es una prueba: `bun test` sólo recoge `*.test.ts`.
//
//   bun run apps/engine/src/draft-history/history-index.bench.ts
//   bun run apps/engine/src/draft-history/history-index.bench.ts --sizes=10000,50000 --queries=400 --seed=7
//
// Portable (sin rutas absolutas, sin SQLite, sin red, sin datos reales): genera el historial con un
// PRNG de semilla fija. Misma semilla + mismos parámetros => mismos registros y mismas consultas;
// los TIEMPOS dependen de la máquina, por eso se informan percentiles y se imprime el entorno.
//
// LIMITACIÓN CONOCIDA: estas mediciones aíslan `search` sobre datos sintéticos. NO garantizan el tiempo
// de respuesta una vez integrado en el Coach (otras señales, GC del proceso, carga concurrente, corpus
// real); esa cifra debe medirse de nuevo en la integración, contra el presupuesto de 300 ms del motor.

import { createArrayHistoryIndex } from "./history-index";
import type { DraftHistoryObservation, PatchState, Side, UnorderedDraftRecord } from "./types";

// ---- argumentos ------------------------------------------------------------------------------

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

const SIZES = arg("sizes", "10000,20000,50000").split(",").map(Number);
const QUERIES_PER_SCENARIO = Number(arg("queries", "300"));
const SEED = Number(arg("seed", "20261021"));
const WARMUP = 40;
const HERO_COUNT = 126; // orden de magnitud del universo real; los ids son sintéticos
const UNIVERSE: ReadonlySet<number> = new Set(Array.from({ length: HERO_COUNT }, (_, i) => i + 1));

// ---- PRNG y muestreo -------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Popularidad tipo Zipf (s = 0.8): unos pocos héroes aparecen en muchísimos drafts, que es el caso
// exigente para la búsqueda (muchas coincidencias por consulta).
function makeSampler(rand: () => number): () => number {
  const cumulative: number[] = [];
  let total = 0;
  for (let rank = 1; rank <= HERO_COUNT; rank += 1) {
    total += 1 / Math.pow(rank, 0.8);
    cumulative.push(total);
  }
  return () => {
    const x = rand() * total;
    let lo = 0;
    let hi = HERO_COUNT - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((cumulative[mid] as number) < x) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1; // el héroe de rango 1 tiene id 1
  };
}

function distinct(count: number, draw: () => number, taken: Set<number>): number[] {
  const out: number[] = [];
  while (out.length < count) {
    const hero = draw();
    if (taken.has(hero)) continue;
    taken.add(hero);
    out.push(hero);
  }
  return out;
}

const PATCHES: PatchState[] = [
  { state: "exact", label: "7.41e" },
  { state: "exact", label: "7.41c" },
  { state: "exact", label: "7.40" },
  { state: "source_id_only", sourceId: "60" },
  { state: "unknown" },
];

function makeRecords(count: number, rand: () => number): UnorderedDraftRecord[] {
  const draw = makeSampler(rand);
  const records: UnorderedDraftRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const taken = new Set<number>();
    const radiant = distinct(5, draw, taken).sort((a, b) => a - b);
    const dire = distinct(5, draw, taken).sort((a, b) => a - b);
    const r = rand();
    const winner: Side | null = r < 0.02 ? null : r < 0.51 ? "radiant" : "dire";
    records.push({
      schemaVersion: 1,
      format: rand() < 0.5 ? "ranked_all_pick" : "unknown",
      provenance: { source: "opendota_league", sourceMatchId: String(7_000_000_000 + i), fetchedAt: null },
      evidenceClass: "professional",
      outcome: winner === null ? { status: "unknown" } : { status: "known", winner },
      patch: PATCHES[Math.floor(rand() * PATCHES.length)] as PatchState,
      sourceGameMode: null,
      positions: [],
      picks: { radiant: { heroIds: radiant, complete: true }, dire: { heroIds: dire, complete: true } },
      bans: rand() < 0.5 ? { status: "unknown" } : { status: "confirmed_visible", heroIds: distinct(7, draw, taken) },
    });
  }
  return records;
}

// ---- escenarios de consulta ------------------------------------------------------------------

interface Scenario {
  name: string;
  make: (rand: () => number, draw: () => number, records: readonly UnorderedDraftRecord[]) => DraftHistoryObservation;
}

function observation(ally: number[], enemy: number[], rand: () => number): DraftHistoryObservation {
  return {
    schemaVersion: 1,
    perspective: rand() < 0.5 ? "radiant" : "dire",
    format: "ranked_all_pick",
    patch: { state: "exact", label: "7.41e" },
    allyHeroIds: ally,
    revealedEnemyHeroIds: enemy,
    bans: rand() < 0.5 ? { status: "unknown" } : { status: "confirmed_visible", heroIds: [] },
  };
}

// Sub-estado de un draft real del historial: garantiza coincidencias (pick k de cada lado).
function fromRecord(records: readonly UnorderedDraftRecord[], rand: () => number, k: number, m: number): DraftHistoryObservation {
  const rec = records[Math.floor(rand() * records.length)] as UnorderedDraftRecord;
  const flip = rand() < 0.5;
  const mine = (flip ? rec.picks.dire : rec.picks.radiant).heroIds;
  const theirs = (flip ? rec.picks.radiant : rec.picks.dire).heroIds;
  return observation(mine.slice(0, k), theirs.slice(0, m), rand);
}

const SCENARIOS: Scenario[] = [
  { name: "1 aliado populares (caso exigente)", make: (rand) => observation([1 + Math.floor(rand() * 3)], [], rand) },
  { name: "2 aliados + 1 enemigo populares", make: (rand) => {
      const a = 1 + Math.floor(rand() * 6);
      return observation([a, a + 7], [a + 14], rand);
    } },
  { name: "3 aliados + 2 enemigos aleatorios", make: (rand, draw) => {
      const taken = new Set<number>();
      return observation(distinct(3, draw, taken), distinct(2, draw, taken), rand);
    } },
  { name: "5 + 5 aleatorios (draft completo, pocas coincidencias)", make: (rand, draw) => {
      const taken = new Set<number>();
      return observation(distinct(5, draw, taken), distinct(5, draw, taken), rand);
    } },
  { name: "sub-draft real 1v0", make: (rand, _d, records) => fromRecord(records, rand, 1, 0) },
  { name: "sub-draft real 2v1", make: (rand, _d, records) => fromRecord(records, rand, 2, 1) },
  { name: "sub-draft real 3v3", make: (rand, _d, records) => fromRecord(records, rand, 3, 3) },
  { name: "sub-draft real 5v5 (match exacto)", make: (rand, _d, records) => fromRecord(records, rand, 5, 5) },
  { name: "héroes raros (sin coincidencias)", make: (rand) => observation([100 + Math.floor(rand() * 20)], [120 + Math.floor(rand() * 6)], rand) },
];

// ---- medición --------------------------------------------------------------------------------

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] as number;
}

const fmt = (ms: number): string => ms.toFixed(2).padStart(7);

console.log(`# history-index bench  seed=${SEED} queries/escenario=${QUERIES_PER_SCENARIO}`);
console.log(`# ${process.versions.bun === undefined ? `node ${process.version}` : `bun ${process.versions.bun}`} ${process.platform}/${process.arch}`);

for (const size of SIZES) {
  const rand = mulberry32(SEED);
  const records = makeRecords(size, rand);
  const buildStart = performance.now();
  const index = createArrayHistoryIndex(records, { heroUniverse: UNIVERSE });
  const buildMs = performance.now() - buildStart;
  console.log(`\n## ${size} registros  (construcción del índice: ${buildMs.toFixed(0)} ms)`);
  console.log("| escenario | p50 ms | p95 ms | p99 ms | max ms | coincidencias medias |");
  console.log("|---|---:|---:|---:|---:|---:|");

  const all: number[] = [];
  const draw = makeSampler(mulberry32(SEED ^ 0x9e3779b9));
  for (const scenario of SCENARIOS) {
    const qrand = mulberry32(SEED + size);
    const queries = Array.from({ length: QUERIES_PER_SCENARIO }, () => scenario.make(qrand, draw, records));
    for (let i = 0; i < WARMUP; i += 1) index.search(queries[i % queries.length]);
    const times: number[] = [];
    let matched = 0;
    for (const q of queries) {
      const t0 = performance.now();
      const result = index.search(q);
      times.push(performance.now() - t0);
      matched += result.population.matchedRecords;
    }
    all.push(...times);
    const sorted = [...times].sort((a, b) => a - b);
    console.log(
      `| ${scenario.name} | ${fmt(percentile(sorted, 0.5))} | ${fmt(percentile(sorted, 0.95))} | ${fmt(percentile(sorted, 0.99))} | ${fmt(sorted[sorted.length - 1] as number)} | ${(matched / queries.length).toFixed(0)} |`,
    );
  }
  const sortedAll = [...all].sort((a, b) => a - b);
  console.log(
    `| **TODOS** | ${fmt(percentile(sortedAll, 0.5))} | ${fmt(percentile(sortedAll, 0.95))} | ${fmt(percentile(sortedAll, 0.99))} | ${fmt(sortedAll[sortedAll.length - 1] as number)} | |`,
  );
}
