// Auditoría 2026-08-22: no existía forma de validar el motor real (buildSuggestions) a escala --
// el Random Draft Simulator (apps/web) usa su propio bot-drafter.ts, deliberadamente independiente
// (engine.md, hallazgo TSK-062/063). Este script llena ese hueco: corre N drafts sintéticos
// directo contra buildSuggestions(), sin pasar por HTTP/WebSocket/SQLite -- mide consistencia y
// performance del motor real, no calidad de una heurística de bot separada.
//
// Nunca se ejecuta desde apps/engine en runtime, nunca programado -- se corre a mano, mismo
// criterio que el script de regeneración de hero-positions.json (engine.md, Fase 3). Cero red,
// cero SQLite: MetaSnapshot y DraftState son sintéticos, generados con un PRNG con seed fija para
// que una corrida sea reproducible (testing-seams.md: nunca depender de Math.random() no
// determinista en algo que se usa para diagnosticar).
//
// Uso: cd apps/engine && bun run src/tools/batch-harness.ts [N] [seed]

import { buildSuggestions } from "../signals/mix";
import type { HeroPositions } from "../signals/hero-positions";
import type { DraftState, HeroId, TeamSide } from "../draft/reducer";
import type { HeroMatchupStat, HeroPatchBracketStat, HeroPoolEntry, MetaHeroInfo, MetaSnapshot } from "../signals/types";
import type { Bracket } from "../meta/mappers";

const HERO_COUNT = 130;
const LOW_MID_BRACKETS: Bracket[] = ["herald", "guardian", "crusader", "archon"];
const ROLE_POOL = ["Carry", "Disabler", "Initiator", "Durable", "Pusher", "Support", "Nuker", "Escape", "Jungler"];
const PATCHES = ["7.36", "7.38", "7.41e"];

// mulberry32 -- PRNG determinista, sin dependencias nuevas (mismo criterio que seeded-rng del
// simulador en apps/web: una corrida con la misma seed es reproducible byte a byte).
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function buildSyntheticMeta(rng: () => number): MetaSnapshot {
  const heroes: Record<HeroId, MetaHeroInfo> = {};
  const matchups: Record<HeroId, HeroMatchupStat[]> = {};
  const patchStats: Record<HeroId, HeroPatchBracketStat[]> = {};

  for (let hero = 1; hero <= HERO_COUNT; hero++) {
    const roleCount = 1 + Math.floor(rng() * 3);
    const roles = Array.from({ length: roleCount }, () => pick(rng, ROLE_POOL));
    heroes[hero] = { id: hero, localizedName: `Hero ${hero}`, roles };

    // Matchups: ~15 enfrentamientos por héroe. La mayoría con deltas chicos (ruido realista); un
    // 10% con un delta grande a propósito -- para que el harness también ejercite el camino de un
    // hard counter real, no solo el caso promedio.
    const rows: HeroMatchupStat[] = [];
    for (let i = 0; i < 15; i++) {
      const vsHero = 1 + Math.floor(rng() * HERO_COUNT);
      if (vsHero === hero) continue;
      const games = 100 + Math.floor(rng() * 1800); // algunos quedan bajo el umbral de 200 a propósito
      const isHardCounter = rng() < 0.1;
      const winrate = isHardCounter ? 0.5 + (rng() * 0.1 - 0.05) + (rng() < 0.5 ? 0.08 : -0.08) : 0.5 + (rng() * 0.06 - 0.03);
      rows.push({ vsHero, games, wins: Math.round(games * Math.min(0.95, Math.max(0.05, winrate))) });
    }
    matchups[hero] = rows;

    const bracketRows: HeroPatchBracketStat[] = [];
    for (const patch of PATCHES) {
      for (const bracket of LOW_MID_BRACKETS) {
        const games = 200 + Math.floor(rng() * 2000); // algunos quedan bajo MIN_PATCH_GAMES (500) a propósito
        const winrate = 0.5 + (rng() * 0.16 - 0.08);
        bracketRows.push({ patch, bracket, picks: games, wins: Math.round(games * winrate) });
      }
    }
    patchStats[hero] = bracketRows;
  }

  // heroPool configurado en ~50% de las corridas (ver buildSyntheticState) -- acá se arma sin
  // condicionar nada, buildSyntheticState decide si lo adjunta o no a este snapshot por sesión.
  const heroPool: HeroPoolEntry[] = [];
  for (let hero = 1; hero <= 15; hero++) {
    heroPool.push({
      hero,
      source: rng() < 0.5 ? "calculated" : "manual",
      personalWinrate: rng() < 0.85 ? 0.4 + rng() * 0.3 : null,
      personalGames: 5 + Math.floor(rng() * 200),
      updatedAt: "2026-08-22T00:00:00Z",
    });
  }

  return { heroes, matchups, patchStats, heroPool, personalBaselineWinrate: 0.5 };
}

function buildSyntheticPositions(rng: () => number): HeroPositions {
  const positions: HeroPositions = {};
  for (let hero = 1; hero <= HERO_COUNT; hero++) {
    const primary = (1 + Math.floor(rng() * 5)) as 1 | 2 | 3 | 4 | 5;
    const shares = [{ position: primary, matches: 400 + Math.floor(rng() * 4000) }];
    // ~30% de los héroes son flex -- una segunda posición con menos muestra, mismo espíritu que
    // Pudge/Crystal Maiden en los fixtures reales de mix.test.ts.
    if (rng() < 0.3) {
      let secondary = (1 + Math.floor(rng() * 5)) as 1 | 2 | 3 | 4 | 5;
      if (secondary === primary) secondary = ((secondary % 5) + 1) as 1 | 2 | 3 | 4 | 5;
      shares.push({ position: secondary, matches: 200 + Math.floor(rng() * 1500) });
    }
    positions[hero] = shares;
  }
  return positions;
}

function buildSyntheticState(rng: () => number, sessionIndex: number): DraftState {
  const excluded = new Set<HeroId>();
  const drawUnique = (): HeroId => {
    let hero: HeroId;
    do hero = 1 + Math.floor(rng() * HERO_COUNT); while (excluded.has(hero));
    excluded.add(hero);
    return hero;
  };

  const bannedCount = Math.floor(rng() * 8);
  const banned = Array.from({ length: bannedCount }, drawUnique);

  const ownCount = Math.floor(rng() * 5);
  const enemyCount = Math.floor(rng() * 5);
  const localSide: TeamSide | "unknown" = pick(rng, ["radiant", "dire", "unknown"] as const);
  const own = Array.from({ length: ownCount }, drawUnique);
  const enemy = Array.from({ length: enemyCount }, drawUnique);
  const picks =
    localSide === "dire"
      ? { radiant: enemy, dire: own }
      : { radiant: own, dire: enemy }; // localSide "unknown": own/enemy no representan un lado real, es intencional (ejercita ese branch)

  const unconfirmedCount = rng() < 0.1 ? 1 : 0;

  return {
    sessionId: `harness-${sessionIndex}`,
    schema: "draft-state/v1",
    format: pick(rng, ["all_pick", "captains_mode", "unknown"] as const),
    patch: pick(rng, PATCHES),
    localSide,
    phase: "active",
    banned,
    picks,
    lastSeq: sessionIndex,
    appliedEventIds: [],
    quality: { unconfirmed: unconfirmedCount > 0 ? [drawUnique()] : [], captureStatus: "ok" },
    updatedAt: new Date(0).toISOString(),
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
  };
}

interface RunResult {
  computedInMs: number;
  wallClockMs: number;
  degradedPartialSignals: boolean;
  suggestionCount: number;
  threw: boolean;
}

function runOnce(rng: () => number, meta: MetaSnapshot, positions: HeroPositions, index: number): RunResult {
  const state = buildSyntheticState(rng, index);
  const start = performance.now();
  try {
    const result = buildSuggestions(state, meta, { heroPositions: positions });
    const wallClockMs = performance.now() - start;
    return {
      computedInMs: result.computedInMs,
      wallClockMs,
      degradedPartialSignals: result.degraded.includes("partial_signals"),
      suggestionCount: result.suggestions.length,
      threw: false,
    };
  } catch {
    const wallClockMs = performance.now() - start;
    return { computedInMs: wallClockMs, wallClockMs, degradedPartialSignals: false, suggestionCount: 0, threw: true };
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

function main(): void {
  const N = Number(process.argv[2] ?? 100);
  const seed = Number(process.argv[3] ?? 20260822);
  const rng = mulberry32(seed);

  const meta = buildSyntheticMeta(rng);
  const positions = buildSyntheticPositions(rng);

  const results: RunResult[] = [];
  for (let i = 0; i < N; i++) results.push(runOnce(rng, meta, positions, i));

  const wallClocks = results.map((r) => r.wallClockMs).sort((a, b) => a - b);
  const partialCount = results.filter((r) => r.degradedPartialSignals).length;
  const threwCount = results.filter((r) => r.threw).length;
  const emptyCount = results.filter((r) => r.suggestionCount === 0 && !r.threw).length;
  const avgSuggestionCount = results.reduce((sum, r) => sum + r.suggestionCount, 0) / results.length;

  const p50 = percentile(wallClocks, 50);
  const p95 = percentile(wallClocks, 95);
  const p99 = percentile(wallClocks, 99);
  const max = wallClocks[wallClocks.length - 1] ?? 0;

  console.log(`\nbatch-harness -- ${N} drafts sintéticos, seed=${seed}, ${HERO_COUNT} héroes\n`);
  console.log("Latencia (buildSuggestions, medida con performance.now()):");
  console.log(`  p50: ${p50.toFixed(2)}ms  p95: ${p95.toFixed(2)}ms  p99: ${p99.toFixed(2)}ms  max: ${max.toFixed(2)}ms`);
  console.log(`  Presupuesto normal (300ms): ${p95 < 300 ? "OK" : "EXCEDIDO"} en p95`);
  console.log(`  Corte duro (500ms): ${max < 500 ? "OK" : "EXCEDIDO"} en el peor caso\n`);
  console.log("Degradación:");
  console.log(`  degraded: partial_signals -> ${partialCount}/${N} (${((partialCount / N) * 100).toFixed(1)}%)`);
  console.log(`  suggestions: [] (sin candidatos) -> ${emptyCount}/${N} (${((emptyCount / N) * 100).toFixed(1)}%)`);
  console.log(`  promedio de sugerencias por corrida: ${avgSuggestionCount.toFixed(2)}\n`);
  console.log("Excepciones:");
  console.log(`  no capturadas -> ${threwCount}/${N} (${((threwCount / N) * 100).toFixed(1)}%) -- objetivo: 0%\n`);

  if (threwCount > 0) process.exitCode = 1;
}

main();
