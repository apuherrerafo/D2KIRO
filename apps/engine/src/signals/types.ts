import type { DraftState, HeroId } from "../draft/reducer";
import type { Bracket } from "../meta/mappers";

export type SignalId = "counter" | "patch_meta" | "team_synergy" | "role_gap";

export interface SignalContribution {
  signal: SignalId;
  raw: number | null;
  weighted: number;
  explanation: string;
  sampleSize: number;
}

export interface SignalScorer {
  id: SignalId;
  score(state: DraftState, candidate: HeroId, meta: MetaSnapshot): SignalContribution;
}

export interface HeroMatchupStat { vsHero: HeroId; games: number; wins: number }

export interface MetaHeroInfo { id: HeroId; localizedName: string }

export interface HeroPatchBracketStat { patch: string; bracket: Bracket; picks: number; wins: number }

export interface MetaSnapshot {
  heroes: Record<HeroId, MetaHeroInfo>;
  matchups: Record<HeroId, HeroMatchupStat[]>;
  // Opcional: los consumidores previos a TSK-006 (p. ej. counter.test.ts) no lo conocen todavía.
  patchStats?: Record<HeroId, HeroPatchBracketStat[]>;
}
