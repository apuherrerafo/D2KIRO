import type { DraftState, HeroId } from "../draft/reducer";
import type { Bracket } from "../meta/mappers";

// TSK-045 (Fase 3, SPEC.md §10.0): `role_gap` y `role_safety` se fusionan en `position_fit` --
// dejan de ser señales activas. V1/V2/V3 en weights.ts siguen congeladas con sus propios
// literales históricos (no dependen de esta unión), así que perder esos dos nombres acá no las
// rompe.
export type SignalId = "counter" | "patch_meta" | "team_synergy" | "hero_pool_fit" | "position_fit";

export interface SignalContribution {
  signal: SignalId;
  raw: number | null;
  weighted: number;
  explanation: string;
  sampleSize: number;
  // TSK-022 (fase 1b): ausente = true, los 4 scorers de fase 1 no lo tocan. "Esta señal no aplica
  // a este usuario ahora mismo" (pool nunca configurado) es distinto de `raw: null` ("hay hueco de
  // datos") -- no cuenta para computeConfidence ni dispara partial_signals (mix.ts, TSK-023).
  applicable?: boolean;
}

export interface SignalScorer {
  id: SignalId;
  score(state: DraftState, candidate: HeroId, meta: MetaSnapshot): SignalContribution;
}

export interface HeroMatchupStat { vsHero: HeroId; games: number; wins: number }

// `roles` opcional: los consumidores previos a TSK-007 (counter/patch-meta y sus pruebas) no lo
// conocen todavía, igual que `patchStats` abajo.
export interface MetaHeroInfo { id: HeroId; localizedName: string; roles?: string[] }

export interface HeroPatchBracketStat { patch: string; bracket: Bracket; picks: number; wins: number }

// TSK-022 (fase 1b, SPEC.md §9.4): mismo shape que el contrato de dominio de hero-pool/
// calculate-pool.ts y de la API (app.ts) -- `hero` (no `heroId`), cada capa define su propia
// vista igual que ya hacen HeroMatchupStat/MetaHeroInfo arriba, no se importa entre capas.
export interface HeroPoolEntry {
  hero: HeroId;
  source: "manual" | "calculated";
  personalWinrate: number | null;
  personalGames: number;
  updatedAt: string;
}

export interface MetaSnapshot {
  heroes: Record<HeroId, MetaHeroInfo>;
  matchups: Record<HeroId, HeroMatchupStat[]>;
  // Opcional: los consumidores previos a TSK-006 (p. ej. counter.test.ts) no lo conocen todavía.
  patchStats?: Record<HeroId, HeroPatchBracketStat[]>;
  // Opcionales (fase 1b): los consumidores previos a TSK-022 no los conocen todavía.
  heroPool?: HeroPoolEntry[];
  personalBaselineWinrate?: number | null;
}
