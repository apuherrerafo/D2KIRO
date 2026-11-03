/* Motion Canonical V1 — every duration/spring the canonical motions use, with its evidence status.
   RECOVERED = the value exists in a study Julio saw (round-3a/motion-tokens.ts or round-3a-labs.css).
   PROVISIONAL = no evidence; invented here, never presented as approved. This is the ONLY TS file in
   `canonical/motion/` that may contain a millisecond literal (enforced by Motion.test.tsx). */
import { DURATIONS, EASINGS, SPRINGS, sampleSpring } from "../../round-3a/motion-tokens";

export { DURATIONS, EASINGS };

export const SNAPPY = sampleSpring(SPRINGS.snappy);
export const SETTLE = sampleSpring(SPRINGS.settle);
export const ELASTIC = sampleSpring(SPRINGS.elastic);

export type TimingStatus = "RECOVERED" | "PROVISIONAL";

export type TimingEntry = { note: string; status: TimingStatus; value: string };

/** Numbers the demos consume. Keep `TIMING_LEDGER` in step with this object. */
export const TIMING = {
  /** 01 — stagger per marker, forward only (reversal has zero delay). RECOVERED (round-3a-labs.css:260). */
  gatherStaggerMs: 14,
  /** 02 — ghosts on the trail and their life. RECOVERED (operational trail, round-3a-labs.css:273). */
  ghostCount: 3,
  ghostLifeMs: 300,
  ghostStepMs: 28,
  /** 03 — the gained row nudges 4 px in. RECOVERED (round-3a-labs.css:314). */
  gainPx: 4,
  /** 05 — dot ring once, sweep once. RECOVERED (round-3a-labs.css:371, 373). */
  pulseMs: 700,
  sweepMs: 620,
  /** 06 — 2 px lean, 420 ms; ghost tick fades. RECOVERED lean; the fade-to-zero floor is PROVISIONAL. */
  leanPx: 2,
  leanMs: 420,
  ghostFadeMs: 1600,
  /** 11 — pointer must rest before the brackets chase it. PROVISIONAL. */
  pointerRestMs: 60,
  /** Budget — a Coach/reward motion waits this long after every other protagonist went quiet. PROVISIONAL. */
  coachQuietMs: 700,
  /** Arrival offset the Coach acquire starts from (px). PROVISIONAL. */
  acquirePx: 8,
} as const;

export const TIMING_LEDGER: Record<string, TimingEntry> = {
  contact: { status: "RECOVERED", value: `${DURATIONS.instant} ms ease-out`, note: "motion.duration.instant (token table) — component contact, shown for reference" },
  snappy: { status: "RECOVERED", value: `spring ${SNAPPY.durationMs} ms · ${((SNAPPY.peak - 1) * 100).toFixed(1)} % overshoot`, note: "round-3a/motion-tokens.ts SPRINGS.snappy" },
  settle: { status: "RECOVERED", value: `spring ${SETTLE.durationMs} ms · 0 % overshoot`, note: "SPRINGS.settle — data-safe, asserted peak ≤ 1" },
  elastic: { status: "RECOVERED", value: `spring ${ELASTIC.durationMs} ms · ${((ELASTIC.peak - 1) * 100).toFixed(1)} % overshoot`, note: "SPRINGS.elastic — Coach / reward only" },
  gatherStagger: { status: "RECOVERED", value: `${TIMING.gatherStaggerMs} ms per marker (forward only)`, note: "round-3a-labs.css:260; the zero-delay reversal is NEW" },
  ghostTrail: { status: "RECOVERED", value: `${TIMING.ghostCount} ghosts · ${TIMING.ghostLifeMs} ms · ${TIMING.ghostStepMs} ms step`, note: "operational trail values, round-3a-labs.css:273" },
  gain: { status: "RECOVERED", value: `${TIMING.gainPx} px on snappy`, note: "round-3a-labs.css:314" },
  pulse: { status: "RECOVERED", value: `${TIMING.pulseMs} ms once`, note: "round-3a-labs.css:371" },
  sweep: { status: "RECOVERED", value: `${TIMING.sweepMs} ms once`, note: "round-3a-labs.css:373" },
  lean: { status: "RECOVERED", value: `${TIMING.leanPx} px · ${TIMING.leanMs} ms`, note: "round-3a-labs.css:399" },
  flash: { status: "RECOVERED", value: `${DURATIONS.slow} ms`, note: "perimeter flash duration; the OPACITY-ONLY shape is PROVISIONAL (stroke bloom 2→7 px removed)" },
  ghostFade: { status: "PROVISIONAL", value: `${TIMING.ghostFadeMs} ms to 0`, note: "recovered life 1600 ms, but the resting floor .25 is removed so the UI settles" },
  mutedOutgoing: { status: "PROVISIONAL", value: `${DURATIONS.fast} ms colour`, note: "03: outgoing row goes ink→muted by colour; replaces the .56 opacity dip (§9 already asked for colour)" },
  pointerRest: { status: "PROVISIONAL", value: `${TIMING.pointerRestMs} ms`, note: "11: brackets travel only when the pointer rests, never chase" },
  coachQuiet: { status: "PROVISIONAL", value: `${TIMING.coachQuietMs} ms`, note: "budget: Coach/reward needs this much silence from every other protagonist" },
  acquire: { status: "PROVISIONAL", value: `brackets close from ${TIMING.acquirePx} px on snappy, once`, note: "11 Coach acquire — the DS V1.1 'brackets close once' principle, distance is new" },
  coalesce: { status: "PROVISIONAL", value: `${DURATIONS.slow} ms`, note: "updates arriving inside one flash window coalesce into one event (no queue, no replay)" },
  budgetLease: { status: "RECOVERED", value: "lease = the motion's own duration token", note: "a protagonist holds the budget for exactly as long as its token says" },
};
