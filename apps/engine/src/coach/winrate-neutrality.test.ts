import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import type { HeroCapabilities } from "../draft-paths/types";
import { buildSuggestions } from "../signals/mix";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import type { HeroPatchBracketStat, MetaSnapshot, SignalContribution } from "../signals/types";
import { deriveCandidateResult } from "./current-human-decision";
import { hidden, recSet, resolvedImpact, revealed, view, type HeroFixture } from "./test.fixtures";

// P0-04 -- NEUTRALIDAD DEL WINRATE GLOBAL. El winrate global de un héroe (hero_patch_stats) es un dato INFORMATIVO: si SOLO cambia ese dato, el
// Coach debe recomendar EXACTAMENTE lo mismo (orden, puntaje, tarjetas, fuerza de la evidencia, posición). Estas pruebas corren el V6 REAL
// (`buildSuggestions`, sin scorer falso) y alimentan sus señales reales al contrato de elegibilidad. Fixtures inline: ningún dato curado real.
// El winrate de un MATCHUP concreto (counter estadístico) NO es winrate global: es evidencia contextual y aquí se mantiene constante.

const PATCH = "7.41e";
const ENEMY = 900;
const LINA = 11; // 57 % global en la variante "alta"
const STORM = 12; // 49 % global
const HEROES = Array.from({ length: 24 }, (_, index) => index + 1);
const POSITIONS: HeroPositions = Object.fromEntries(HEROES.map((id) => [id, [{ position: 1 as const, matches: 3000 }]]));
const CAPABILITIES: HeroCapabilities[] = [];
const WHY = "Orchid lo silencia y no puede hacer nada";
const counter = (vs: number): CuratedCounter => ({ vs, level: "hard", why: WHY });

function stateWith(enemyPicks: number[]): DraftState {
  return {
    sessionId: "wr-neutral",
    schema: "draft-state/v1",
    format: "all_pick",
    patch: PATCH,
    localSide: "radiant",
    phase: "active",
    banned: [],
    picks: { radiant: [], dire: enemyPicks },
    lastSeq: 0,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "2026-11-08T00:00:00Z",
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
  };
}

/** Winrate global por héroe -> filas de `hero_patch_stats` (5000 partidas bajo/medio cada una: el parche queda "listo"). */
function patchStatsOf(winrates: Record<number, number>): Record<number, HeroPatchBracketStat[]> {
  return Object.fromEntries(
    HEROES.map((id) => [id, [{ patch: PATCH, bracket: "archon" as const, picks: 5000, wins: Math.round(5000 * (winrates[id] ?? 0.5)) }]]),
  );
}

function metaOf(patchStats: Record<number, HeroPatchBracketStat[]> | undefined, heroPool: number[] = []): MetaSnapshot {
  return {
    heroes: Object.fromEntries([...HEROES, ENEMY].map((id) => [id, { id, localizedName: `Hero ${id}` }])),
    matchups: {},
    ...(patchStats ? { patchStats } : {}),
    ...(heroPool.length > 0 ? { heroPool: heroPool.map((hero) => ({ hero, source: "manual" as const, personalWinrate: null, personalGames: 0, updatedAt: "2026-11-01" })) } : {}),
  };
}

const BASE_WR: Record<number, number> = { [LINA]: 0.5, [STORM]: 0.5 };
const VARIANTS: Record<string, MetaSnapshot["patchStats"]> = {
  "linea base 50/50": patchStatsOf(BASE_WR),
  "Lina 40 -> 65": patchStatsOf({ ...BASE_WR, [LINA]: 0.65 }),
  "Lina 57 / Storm 49": patchStatsOf({ ...BASE_WR, [LINA]: 0.57, [STORM]: 0.49 }),
  "winrates intercambiados": patchStatsOf({ ...BASE_WR, [LINA]: 0.49, [STORM]: 0.57 }),
  "todo el mundo 58 %": patchStatsOf(Object.fromEntries(HEROES.map((id) => [id, 0.58]))),
  "sin datos de winrate": undefined,
};

interface Scenario {
  name: string;
  enemyPicks: number[];
  heroCounters: Map<number, CuratedCounter[]>;
  heroPool: number[];
}
const SCENARIOS: Scenario[] = [
  { name: "draft temprano, sin evidencia fuerte", enemyPicks: [], heroCounters: new Map(), heroPool: [] },
  { name: "counter STRONG de Storm contra un enemigo revelado", enemyPicks: [ENEMY], heroCounters: new Map([[ENEMY, [counter(STORM)]]]), heroPool: [] },
  { name: "Hero Pool (Lina dentro, Storm OFF-POOL con counter STRONG)", enemyPicks: [ENEMY], heroCounters: new Map([[ENEMY, [counter(STORM)]]]), heroPool: [LINA, 13] },
];

/** Lo que el Coach DECIDE: nada de esto puede depender del winrate global. La señal informativa `patch_meta` se excluye a propósito. */
const decisionSignals = (signals: readonly SignalContribution[]) => signals.filter((s) => s.signal !== "patch_meta");

function decisionOf(scenario: Scenario, patchStats: MetaSnapshot["patchStats"]) {
  const meta = metaOf(patchStats, scenario.heroPool);
  const set = buildSuggestions(stateWith(scenario.enemyPicks), meta, {
    heroPositions: POSITIONS,
    heroCapabilities: CAPABILITIES,
    heroCounters: scenario.heroCounters,
    heroSynergies: new Map(),
    metaIsStale: false,
    limit: 12,
    now: () => 0,
  });
  const fixtures: HeroFixture[] = set.suggestions.map((s) => ({ heroId: s.hero, signals: s.signals, impact: resolvedImpact(1), confidence: s.confidence }));
  const enemyView = scenario.enemyPicks.length > 0 ? [revealed(ENEMY)] : [hidden()];
  const cards = deriveCandidateResult({
    targetPosition: 1,
    targetRanking: recSet(fixtures),
    view: view("PICK_ROUND_2", [], enemyView),
    heroPositions: POSITIONS,
    heroCounters: scenario.heroCounters,
    heroSynergies: new Map(),
    heroCapabilities: CAPABILITIES,
    personalPoolApplied: false,
  });
  return {
    ranking: set.suggestions.map((s) => ({
      hero: s.hero,
      rank: s.rank,
      score: s.score,
      confidence: s.confidence,
      evidenceCoverage: s.evidenceCoverage,
      reason: s.reason,
      signals: decisionSignals(s.signals),
    })),
    degraded: set.degraded,
    cards: cards.cards.map((c) => ({ heroId: c.heroId, rank: c.rank, evidenceStrength: c.evidenceStrength, rationale: c.rationale, badges: c.badges, hide: c.hideRationale })),
    state: cards.state,
  };
}

describe("P0-04: cambiar SOLO el winrate global no cambia lo que el Coach recomienda (V6 real)", () => {
  for (const scenario of SCENARIOS) {
    describe(scenario.name, () => {
      const reference = decisionOf(scenario, VARIANTS["linea base 50/50"]);
      for (const [label, patchStats] of Object.entries(VARIANTS)) {
        test(`${label}: ranking, puntajes, tarjetas, evidencia y razones idénticos`, () => {
          const got = decisionOf(scenario, patchStats);
          expect(got.ranking).toEqual(reference.ranking);
          expect(got.cards).toEqual(reference.cards);
          expect(got.state).toBe(reference.state);
          expect(got.degraded).toEqual(reference.degraded);
        });
      }
    });
  }

  test("un héroe con SOLO buen winrate (Lina 65 %) no recibe tarjeta en un draft sin fundamentos", () => {
    const got = decisionOf(SCENARIOS[0]!, VARIANTS["Lina 40 -> 65"]);
    expect(got.cards.map((c) => c.heroId)).not.toContain(LINA);
  });

  test("Storm conserva su counter STRONG aunque Lina tenga más winrate global", () => {
    const got = decisionOf(SCENARIOS[1]!, VARIANTS["Lina 57 / Storm 49"]);
    expect(got.cards[0]?.heroId).toBe(STORM);
    expect(got.cards[0]?.evidenceStrength).toBe("STRONG");
    expect(got.cards.map((c) => c.heroId)).not.toContain(LINA);
  });

  test("OFF-POOL: Storm (STRONG, fuera del pool) sigue por encima de Lina (en el pool, sin fundamentos)", () => {
    const got = decisionOf(SCENARIOS[2]!, VARIANTS["Lina 57 / Storm 49"]);
    expect(got.cards[0]?.heroId).toBe(STORM);
    expect(got.cards.map((c) => c.heroId)).not.toContain(LINA);
  });

  test("el dato informativo SÍ cambia: la señal patch_meta sigue reportando el winrate (solo se muestra)", () => {
    const meta = metaOf(VARIANTS["Lina 57 / Storm 49"]);
    const set = buildSuggestions(stateWith([]), meta, { heroPositions: POSITIONS, heroCapabilities: CAPABILITIES, heroCounters: new Map(), heroSynergies: new Map(), metaIsStale: false, limit: 24, now: () => 0 });
    const lina = set.suggestions.find((s) => s.hero === LINA)?.signals.find((s) => s.signal === "patch_meta");
    expect(lina?.raw).toBeCloseTo(0.57, 2);
    expect(lina?.weighted).toBe(0);
  });
});
