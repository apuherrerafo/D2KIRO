/* HERO-LOOP LAB · the pure model of the loop. No React, no DOM, no clock.
   draft → reveal → evidence → recommendation → lock → settle → carry → relax → (the next condition's draft)
   Everything the UI shows is `frameFor(scenario, beat)`; the hook only decides WHICH beat is current. The loop never
   resets: D2KIRO continues, the MATCH changes. The last beat of a pass (a finished draft) hands over to the first beat
   of the next scenario (the next draft), data swapped in place, and the Recent calls trace carries across. */

import type { Confidence, EvidenceStep, LoopScenario } from "./scenarios";

export const PHASES = ["draft", "reveal", "evidence", "recommendation", "lock", "settle", "carry", "relax"] as const;
export type Phase = (typeof PHASES)[number];

/** The shared motion language. REPEL exists for contradiction only. */
export const VERBS = ["GATHER", "ATTRACT", "TETHER", "SETTLE", "TRANSFER", "SCATTER", "REPEL"] as const;
export type Verb = (typeof VERBS)[number];

export type Beat = {
  /** Stable id for review links: "draft", "reveal", "evidence-1".."evidence-n", "recommendation", ... */
  id: string;
  phase: Phase;
  /** How many evidence steps have arrived (0..n). Scores, ranking and markers are a function of this and nothing else. */
  applied: number;
  ms: number;
  verb: Verb | null;
};

/** A step that drops the current leader by this much or more is a contradiction (and the only REPEL in the loop). */
export const CONTRADICTION_DROP = 3;

export const BEAT_MS = { draft: 1800, reveal: 1300, evidence: 1000, evidenceAbsent: 800, recommendation: 1500, lock: 800, settle: 900, carry: 1500, relax: 1300 } as const;

export function phaseIndex(phase: Phase): number {
  return PHASES.indexOf(phase);
}

export function reached(phase: Phase, at: Phase): boolean {
  return phaseIndex(phase) >= phaseIndex(at);
}

export function fitAt(scenario: LoopScenario, hero: string, applied: number): number {
  const base = scenario.candidates.find((c) => c.hero === hero)?.base ?? 0;
  return scenario.steps.slice(0, applied).reduce((sum, step) => sum + (step.deltas[hero] ?? 0), base);
}

export type RankRow = { fit: number; hero: string };

/** Candidates ordered by their live score after `applied` steps. Stable on ties (authoring order). */
export function rankAt(scenario: LoopScenario, applied: number): readonly RankRow[] {
  return scenario.candidates
    .map((c, index) => ({ fit: fitAt(scenario, c.hero, applied), hero: c.hero, index }))
    .sort((a, b) => b.fit - a.fit || a.index - b.index)
    .map(({ fit, hero }) => ({ fit, hero }));
}

/** The winner once every step has arrived. */
export function winnerOf(scenario: LoopScenario): string {
  return rankAt(scenario, scenario.steps.length)[0].hero;
}

/** The leader on the draft read alone (every step except the personal one). It is who the personal step has to beat. */
export function draftLeaderOf(scenario: LoopScenario): string {
  const draftOnly: LoopScenario = { ...scenario, steps: scenario.steps.filter((s) => s.kind !== "personal") };
  return rankAt(draftOnly, draftOnly.steps.length)[0].hero;
}

/** Whether step `index` (0-based) contradicts the leader going into it. */
export function contradicts(scenario: LoopScenario, index: number): boolean {
  const step = scenario.steps[index];
  if (!step) return false;
  const leader = rankAt(scenario, index)[0].hero;
  return (step.deltas[leader] ?? 0) <= -CONTRADICTION_DROP;
}

export function buildBeats(scenario: LoopScenario): readonly Beat[] {
  const beats: Beat[] = [
    { id: "draft", phase: "draft", applied: 0, ms: BEAT_MS.draft, verb: null },
    { id: "reveal", phase: "reveal", applied: 0, ms: BEAT_MS.reveal, verb: "GATHER" },
  ];
  const n = scenario.steps.length;
  scenario.steps.forEach((step, index) => {
    const verb: Verb | null = step.absent ? null : contradicts(scenario, index) ? "REPEL" : step.kind === "personal" ? "TETHER" : "ATTRACT";
    beats.push({ id: `evidence-${index + 1}`, phase: "evidence", applied: index + 1, ms: step.absent ? BEAT_MS.evidenceAbsent : BEAT_MS.evidence, verb });
  });
  beats.push(
    { id: "recommendation", phase: "recommendation", applied: n, ms: BEAT_MS.recommendation, verb: "SETTLE" },
    { id: "lock", phase: "lock", applied: n, ms: BEAT_MS.lock, verb: "TETHER" },
    { id: "settle", phase: "settle", applied: n, ms: BEAT_MS.settle, verb: "TRANSFER" },
    { id: "carry", phase: "carry", applied: n, ms: BEAT_MS.carry, verb: "TRANSFER" },
    { id: "relax", phase: "relax", applied: n, ms: BEAT_MS.relax, verb: "SCATTER" },
  );
  return beats;
}

export function totalMs(beats: readonly Beat[]): number {
  return beats.reduce((sum, b) => sum + b.ms, 0);
}

// ------------------------------------------------------------------ the Coach is told WHAT is happening, never how it looks

export type CoachCueState = "watching" | "analyzing" | "confirming" | "pointing";
export type CoachCueAim = "left" | "center" | "right";

export type CoachCue = {
  state: CoachCueState;
  aim: CoachCueAim;
  verb: Verb | null;
  /** Presence on stage (scale). Hierarchy is carried by this and by amplitude, never by palette. */
  scale: number;
  /** 0..1 motion amplitude of the pose and the verb impulse. */
  amplitude: number;
};

/** Confidence trims presence and amplitude: a lower-confidence call is quieter, not greyer. */
const CONFIDENCE_TRIM: Record<Confidence, { scale: number; amplitude: number }> = {
  high: { scale: 0, amplitude: 0 },
  medium: { scale: -0.04, amplitude: -0.15 },
  low: { scale: -0.08, amplitude: -0.3 },
};

const CUE_BY_PHASE: Record<Phase, { state: CoachCueState; aim: CoachCueAim; scale: number; amplitude: number }> = {
  draft: { state: "watching", aim: "center", scale: 0.88, amplitude: 0.6 },
  reveal: { state: "analyzing", aim: "right", scale: 0.92, amplitude: 0.8 },
  evidence: { state: "analyzing", aim: "right", scale: 0.92, amplitude: 0.9 },
  recommendation: { state: "pointing", aim: "right", scale: 1, amplitude: 1 },
  lock: { state: "confirming", aim: "right", scale: 1.04, amplitude: 1 },
  settle: { state: "confirming", aim: "right", scale: 1, amplitude: 0.9 },
  carry: { state: "pointing", aim: "right", scale: 0.94, amplitude: 0.8 },
  relax: { state: "watching", aim: "center", scale: 0.88, amplitude: 0.6 },
};

export function coachCueFor(beat: Beat, confidence: Confidence): CoachCue {
  const base = CUE_BY_PHASE[beat.phase];
  const trim = reached(beat.phase, "recommendation") && !reached(beat.phase, "relax") ? CONFIDENCE_TRIM[confidence] : { scale: 0, amplitude: 0 };
  return { ...base, verb: beat.verb, scale: base.scale + trim.scale, amplitude: Math.max(0.2, base.amplitude + trim.amplitude) };
}

// ------------------------------------------------------------------ the frame

export type Marker = { id: string; kind: EvidenceStep["kind"]; label: string; absent: boolean; state: "live" | "done" };

export type CardRow = {
  hero: string;
  rank: number;
  fit: number;
  base: number;
  /** Net change since the draft read began. */
  delta: number;
  /** What the NEWEST step did to this card (0 = nothing). */
  lastDelta: number;
  /** The newest cause that moved this card, e.g. "vs Axe". */
  cause: string | null;
  /** A qualitative note from the newest personal step for this card ("Often played"). Never a count or a rate. */
  detail: string | null;
  /** The loop flags this card as contradicted by the step that is arriving right now. */
  repelled: boolean;
  champion: boolean;
};

export type EnemyView = { hero: string; visible: boolean };

export type LoopFrame = {
  scenario: LoopScenario;
  beat: Beat;
  applied: number;
  rows: readonly CardRow[];
  enemies: readonly EnemyView[];
  markers: readonly Marker[];
  /** The step arriving at this very beat, or null. */
  arriving: EvidenceStep | null;
  confidence: Confidence;
  /** True once the personal step has arrived empty: the call stands on the draft read alone. */
  draftOnly: boolean;
  revealed: boolean;
  decided: boolean;
  locked: boolean;
  /** The hero is travelling from its card into the seat right now. */
  placing: boolean;
  /** The hero has landed in its seat (from `carry` on). */
  seated: boolean;
  carried: boolean;
  carrying: boolean;
  relaxed: boolean;
  /** The order changed because of the personal step (condition A in one boolean). */
  personalFlipped: boolean;
  coach: CoachCue;
};

export function confidenceAt(scenario: LoopScenario, applied: number): Confidence {
  const list = scenario.confidenceByApplied;
  return list[Math.min(applied, list.length - 1)];
}

export function frameFor(scenario: LoopScenario, beat: Beat): LoopFrame {
  const { applied, phase } = beat;
  const ranked = rankAt(scenario, applied);
  const arrivingIndex = phase === "evidence" ? applied - 1 : -1;
  const arriving = arrivingIndex >= 0 ? scenario.steps[arrivingIndex] : null;
  const decided = reached(phase, "recommendation");
  const newest = applied > 0 ? scenario.steps[applied - 1] : null;
  const repelled = arrivingIndex >= 0 && contradicts(scenario, arrivingIndex);
  const leaderBefore = applied > 0 ? rankAt(scenario, applied - 1)[0].hero : null;

  const rows: CardRow[] = ranked.map((row, index) => {
    const base = scenario.candidates.find((c) => c.hero === row.hero)?.base ?? 0;
    // the newest cause that actually moved this card
    let causeStep: EvidenceStep | null = null;
    for (let i = applied - 1; i >= 0; i -= 1) {
      if ((scenario.steps[i].deltas[row.hero] ?? 0) !== 0 || scenario.steps[i].detail?.[row.hero]) {
        causeStep = scenario.steps[i];
        break;
      }
    }
    return {
      hero: row.hero,
      rank: index + 1,
      fit: row.fit,
      base,
      delta: row.fit - base,
      lastDelta: newest ? newest.deltas[row.hero] ?? 0 : 0,
      cause: causeStep ? causeStep.label : null,
      detail: causeStep?.detail?.[row.hero] ?? null,
      repelled: repelled && row.hero === leaderBefore,
      champion: decided && index === 0,
    };
  });

  const personalIndex = scenario.steps.findIndex((s) => s.kind === "personal");
  const personalArrived = personalIndex >= 0 && applied > personalIndex;
  const confidence = confidenceAt(scenario, applied);

  return {
    scenario,
    beat,
    applied,
    rows,
    enemies: scenario.enemies.map((e) => ({ hero: e.hero, visible: reached(phase, "reveal") && applied >= e.revealAt })),
    markers: scenario.steps.slice(0, applied).map((s, i) => ({ id: s.id, kind: s.kind, label: s.label, absent: Boolean(s.absent), state: i === arrivingIndex ? "live" : "done" })),
    arriving,
    confidence,
    draftOnly: personalArrived && !scenario.personal,
    revealed: reached(phase, "reveal"),
    decided,
    locked: reached(phase, "lock"),
    placing: phase === "settle",
    // the hero is in its seat only once the flight (during `settle`) has landed
    seated: reached(phase, "carry"),
    carried: reached(phase, "carry"),
    carrying: phase === "carry",
    relaxed: phase === "relax",
    personalFlipped: personalArrived && scenario.personal && draftLeaderOf(scenario) !== winnerOf(scenario),
    coach: coachCueFor(beat, confidence),
  };
}

// ------------------------------------------------------------------ position in the endless loop

export type LoopPosition = { cycle: number; scenario: number; beat: number };

export function advance(position: LoopPosition, beats: readonly Beat[], scenarioCount: number): LoopPosition {
  const nextBeat = position.beat + 1;
  if (nextBeat < beats.length) return { ...position, beat: nextBeat };
  const nextScenario = position.scenario + 1;
  if (nextScenario < scenarioCount) return { cycle: position.cycle, scenario: nextScenario, beat: 0 };
  return { cycle: position.cycle + 1, scenario: 0, beat: 0 };
}

export const RECENT_CALLS_CAPACITY = 3;

/** Which draft of the endless session this is (1-based): the loop is consecutive drafts, not a carousel. */
export function draftNumber(position: LoopPosition, scenarioCount: number): number {
  return position.cycle * scenarioCount + position.scenario + 1;
}

/** Recent calls: the decisions carried so far, derived from the position alone (nothing else is stored). Newest first. */
export function recentCalls(scenarios: readonly LoopScenario[], position: LoopPosition, beats: readonly Beat[], capacity = RECENT_CALLS_CAPACITY): readonly { id: string; hero: string; label: string; position: number }[] {
  const count = scenarios.length;
  const passed = position.cycle * count + position.scenario; // drafts fully behind us
  const carriedNow = reached(beats[position.beat].phase, "carry") ? 1 : 0;
  const total = passed + carriedNow;
  const out: { id: string; hero: string; label: string; position: number }[] = [];
  for (let n = total - 1; n >= Math.max(0, total - capacity); n -= 1) {
    const s = scenarios[n % count];
    out.push({ id: `${n}-${s.id}`, hero: winnerOf(s), label: s.seat.label, position: s.seat.position });
  }
  return out;
}
