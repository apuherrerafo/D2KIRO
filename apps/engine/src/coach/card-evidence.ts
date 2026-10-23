import { assessCompositionNeeds, capabilitiesByHero, ownPicksRemainingOf, unfilledCriticalGaps, type CompositionNeeds } from "../draft-paths/gaps";
import type { DraftCapabilityGap, HeroCapabilities } from "../draft-paths/types";
import { perspectiveToLegacyDraftState } from "../draft-protocol/adapters/suggestion-bridge";
import type { HeroId, PerspectiveDraftView } from "../draft-protocol/types";
import type { CuratedCounter } from "../signals/hero-counters";
import type { SignalContribution, SignalId } from "../signals/types";
import { pickRationaleSignal, type HeroCandidate } from "./hero-card";
import type { BasisKind, BasisSource, CardBasis, CardRisk } from "./recommendation-output-v4";
import { curatedHardCounterStatus } from "./safe-core";

// TSK-254 (F1 / T5) -- what a V4 card is honest about: where its reason comes from (`basis`) and which
// risks the Player should weigh (`risks`). Read-only over the ranking: nothing here scores, re-ranks or
// filters a candidate, and no field is added to `SignalContribution`.
//
// BASIS is read from the SAME signal the card's rationale quotes (`pickRationaleSignal`), resolved with
// the concrete evidence behind it rather than a fixed signal -> kind table where the signal mixes layers:
//   - position_fit, patch_meta        -> statistical, with their sample (games).
//   - team_synergy, archetype_fit     -> curated (capabilities.json is a human judgement, not a measurement).
//   - hero_pool_fit                   -> statistical when it quotes the Player's own record, else curated
//                                        (the pool is a list the Player declared).
//   - counter                         -> per claim: a curated pair is curated, otherwise the matchup
//                                        statistic with its n; ban relief is curated. Several kinds -> mixed.
//   - no signal with its own data     -> inferred: the card is only here because the position credits it.
//
// RISKS are public-evidence checks over the curated hard counters (the same data and "off the table"
// semantic as Safe Core) plus the two per-hero risks V6 already derives for a recommendation (unresolved role,
// low evidence), plus CRITICAL_GAP (TSK-253's contract): the team lacks something critical, the picks are running out and
// THIS hero does not cover it. It is shown only when the gap is demonstrable -- every own pick has curated capabilities, it is
// inside the closing window, and the card's hero has curated capabilities that do not fill it. Unknown is never "lacking".

export interface CardEvidenceContext {
  /** Enemy heroes the Player can SEE. */
  revealedEnemies: readonly HeroId[];
  heroCounters?: ReadonlyMap<HeroId, readonly CuratedCounter[]>;
  bannedHeroes: readonly HeroId[];
}

/** A statistic quoted from a signal: its sample when known, otherwise null (never a made-up number). */
function statistical(signal: SignalContribution): BasisSource {
  return { kind: "statistical", sampleSize: signal.sampleSize > 0 ? signal.sampleSize : null };
}

const CURATED: BasisSource = { kind: "curated", sampleSize: null };

/**
 * Mirrors the branches of `signals/counter.ts` that decide what the explanation says: a curated HARD win over a
 * revealed enemy is named first; otherwise a qualifying statistic; otherwise a curated loss. Ban relief is always a
 * curated clause. A scorer with no statistical layer reports `sampleSize: 0`, which is what lets this fall back safely.
 */
function counterSources(heroId: HeroId, signal: SignalContribution, context: CardEvidenceContext): BasisSource[] {
  const curated = context.heroCounters;
  const ownCurated = curated?.get(heroId) ?? [];
  const curatedHardWin = context.revealedEnemies.some((enemy) => (curated?.get(enemy) ?? []).some((entry) => entry.vs === heroId && entry.level === "hard"));
  const curatedLoss = context.revealedEnemies.some((enemy) => ownCurated.some((entry) => entry.vs === enemy));
  const banRelief = ownCurated.some((entry) => context.bannedHeroes.includes(entry.vs));

  const sources: BasisSource[] = [];
  if (curatedHardWin) sources.push(CURATED);
  else if (signal.hasRevealedEnemyCounterEvidence === true) sources.push(signal.sampleSize > 0 ? statistical(signal) : CURATED);
  else if (curatedLoss) sources.push(CURATED);
  if (banRelief) sources.push(CURATED);
  if (sources.length === 0) sources.push(signal.sampleSize > 0 ? statistical(signal) : CURATED);
  return sources;
}

const SIGNAL_KIND: Partial<Record<SignalId, BasisKind>> = {
  position_fit: "statistical",
  patch_meta: "statistical",
  team_synergy: "curated",
  archetype_fit: "curated",
};

function sourcesOf(heroId: HeroId, signal: SignalContribution, context: CardEvidenceContext): BasisSource[] {
  if (signal.signal === "counter") return counterSources(heroId, signal, context);
  if (signal.signal === "hero_pool_fit") return [signal.sampleSize > 0 ? statistical(signal) : CURATED];
  return [SIGNAL_KIND[signal.signal] === "statistical" ? statistical(signal) : CURATED];
}

/** One entry per kind: a curated clause stated twice is still one curated source; the largest sample wins. */
function mergeSources(sources: readonly BasisSource[]): BasisSource[] {
  const byKind = new Map<BasisKind, BasisSource>();
  for (const source of sources) {
    const kept = byKind.get(source.kind);
    if (!kept || (source.sampleSize ?? 0) > (kept.sampleSize ?? 0)) byKind.set(source.kind, source);
  }
  return [...byKind.values()];
}

export function deriveCardBasis(candidate: HeroCandidate, hasCounterBadge: boolean, context: CardEvidenceContext): CardBasis {
  const signal = pickRationaleSignal(candidate, hasCounterBadge);
  const sources = signal ? mergeSources(sourcesOf(candidate.heroId, signal, context)) : [{ kind: "inferred" as const, sampleSize: null }];
  return { kind: sources.length === 1 ? sources[0]!.kind : "mixed", sources };
}

/** One available curated hard counter is already exposure; raise this to ask for more before warning. */
export const EXPOSURE_MIN_AVAILABLE_HARD_COUNTERS = 1;

/**
 * The rival only reacts to what it SEES: its picks of the same round were sealed before this reveal, so exposure
 * exists only while a later round is still to come (rounds 1 and 2). Outside Ranked AP there is no such round.
 */
function rivalCanStillReact(view: PerspectiveDraftView): boolean {
  const phase = view.rankedAp?.phase;
  return phase === "PICK_ROUND_1" || phase === "PICK_ROUND_2";
}

function counterNoun(count: number): string {
  return count === 1 ? "counter duro curado" : "counters duros curados";
}

/** What the team critically lacks right now (TSK-253's `assessCompositionNeeds`) and the curated capabilities to judge a card against it. */
export interface CardCompositionContext {
  needs: CompositionNeeds;
  capabilities: ReadonlyMap<HeroId, HeroCapabilities>;
}

/**
 * One per decision, from the same state the scorer read (`perspectiveToLegacyDraftState`) and the same picks-left count
 * (`ownPicksRemainingOf`), so the card and the ranking agree on whether the closing window is open. Undefined when no
 * capabilities were supplied: the risk then simply cannot be derived (never guessed).
 */
export function deriveCompositionContext(view: PerspectiveDraftView, capabilities: readonly HeroCapabilities[] | undefined): CardCompositionContext | undefined {
  if (!capabilities || capabilities.length === 0) return undefined;
  // `patch` only labels the legacy state; the gap functions read `localSide` and `picks`.
  const state = perspectiveToLegacyDraftState(view, { patch: "composition-needs" });
  return { needs: assessCompositionNeeds(state, [...capabilities], ownPicksRemainingOf(state)), capabilities: capabilitiesByHero([...capabilities]) };
}

const GAP_PHRASE: Record<DraftCapabilityGap, string> = {
  initiation: "iniciación",
  catch: "catch",
  waveclear: "waveclear",
  structural_damage: "daño a estructuras",
  teamfight: "teamfight",
  scaling: "scaling",
  damage_mix: "un segundo tipo de daño",
};

function listNaturally(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function picksLeftPhrase(count: number): string {
  return count === 1 ? "te queda 1 pick" : `te quedan ${count} picks`;
}

export function deriveCardRisks(candidate: HeroCandidate, view: PerspectiveDraftView, heroCounters: ReadonlyMap<HeroId, readonly CuratedCounter[]> | undefined, composition?: CardCompositionContext): CardRisk[] {
  const risks: CardRisk[] = [];
  const status = heroCounters ? curatedHardCounterStatus(candidate.heroId, view, heroCounters) : { revealed: [], available: [] };

  if (status.revealed.length > 0) {
    risks.push({
      kind: "countered_by_revealed",
      detail: `${status.revealed.length} ${counterNoun(status.revealed.length)} de este héroe ya ${status.revealed.length === 1 ? "está revelado" : "están revelados"} en el equipo rival.`,
      heroIds: status.revealed,
    });
  }
  if (status.available.length >= EXPOSURE_MIN_AVAILABLE_HARD_COUNTERS && rivalCanStillReact(view)) {
    risks.push({
      kind: "exposed_to_counter",
      detail: `${status.available.length} ${counterNoun(status.available.length)} ${status.available.length === 1 ? "sigue disponible" : "siguen disponibles"} y el rival todavía puede elegir después de ver tu pick.`,
      heroIds: status.available,
    });
  }
  if (composition) {
    // [] for a hero without curated capabilities: we do not know what it brings, so it is never said to leave the gap open.
    const missing = unfilledCriticalGaps(composition.capabilities.get(candidate.heroId), composition.needs);
    if (missing.length > 0) {
      risks.push({
        kind: "CRITICAL_GAP",
        detail: `A tu equipo le falta ${listNaturally(missing.map((gap) => GAP_PHRASE[gap]))} y ${picksLeftPhrase(composition.needs.ownPicksRemaining)}; este héroe no lo cubre (según las capacidades curadas).`,
        heroIds: [],
      });
    }
  }
  if (candidate.roleStatus === "UNRESOLVED") {
    risks.push({ kind: "unresolved_role", detail: "Sin evidencia de posición suficiente para confirmar el rol de este héroe.", heroIds: [] });
  }
  if (candidate.confidence === "baja") {
    risks.push({ kind: "low_evidence", detail: "La evidencia detrás de esta recomendación es baja.", heroIds: [] });
  }
  // `degraded_meta` is deliberately not a card risk: it is a fact about the whole ranking (identical on every
  // card) and the candidate section already states it once through `degradations` (stale_meta).
  return risks;
}
