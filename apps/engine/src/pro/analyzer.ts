import type { ProPatternMatch, ProQueryContext } from "./query";
import type { SignalContribution, SignalId } from "../signals/types";
import type { HeroId } from "../draft/reducer";

export interface AnalyzerEvidence { readonly kind: "matchup" | "synergy" | "professional"; readonly detail: string; }
export interface AnalyzerCandidateInput {
  readonly heroId: HeroId;
  readonly score: number;
  readonly signals: readonly SignalContribution[];
  readonly publicEvidence?: readonly AnalyzerEvidence[];
  readonly professionalPatterns?: readonly ProPatternMatch[];
  readonly discardedReason?: string;
  readonly diagnostic?: string;
}
export interface AnalyzerSignalAbsent { readonly signal: SignalId; readonly reason: "raw:null — falta de dato" | "applicable:false — señal no configurada"; }
export interface AnalyzerCandidateReport {
  readonly heroId: HeroId;
  readonly score: number;
  readonly signalsUsed: readonly SignalContribution[];
  readonly signalsAbsent: readonly AnalyzerSignalAbsent[];
  readonly publicEvidence: readonly AnalyzerEvidence[];
  readonly professionalEvidence: readonly ProPatternMatch[];
  readonly discardedReason: string | null;
  readonly diagnostic: string | null;
}
export interface AnalyzerReport {
  readonly context: ProQueryContext;
  readonly candidates: readonly AnalyzerCandidateReport[];
}

export function analyzeCandidate(input: AnalyzerCandidateInput): AnalyzerCandidateReport {
  const used: SignalContribution[] = [];
  const absent: AnalyzerSignalAbsent[] = [];
  for (const signal of input.signals) {
    if (signal.applicable === false) absent.push({ signal: signal.signal, reason: "applicable:false — señal no configurada" });
    else if (signal.raw === null) absent.push({ signal: signal.signal, reason: "raw:null — falta de dato" });
    else used.push(signal);
  }
  return {
    heroId: input.heroId, score: input.score, signalsUsed: used, signalsAbsent: absent,
    publicEvidence: input.publicEvidence ?? [], professionalEvidence: input.professionalPatterns ?? [],
    discardedReason: input.discardedReason ?? null, diagnostic: input.diagnostic ?? null,
  };
}

export function analyzeDraft(context: ProQueryContext, candidates: readonly AnalyzerCandidateInput[]): AnalyzerReport {
  return { context, candidates: candidates.map(analyzeCandidate).sort((a, b) => a.heroId - b.heroId) };
}
