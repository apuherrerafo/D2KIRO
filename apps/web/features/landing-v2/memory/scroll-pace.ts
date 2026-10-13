/* LANDING V2 · MEMORY · playback pace. Scroll is authoritative: it names the scene that should be on screen (the target),
   and the story must keep up with it. When the rendered scene is in step the approved choreography plays at 1x with its
   hold between scenes. When the scroll is ahead, the hold goes and the sim clock is sped up so the story catches up
   instead of building a backlog. Scenes still play in order, forward only, each from the settled state of the one before. */

/** Hold between one scene settling and the next beginning, when in step with the scroll. */
export const HOLD_MS = 520;
export const HOLD_REDUCED_MS = 260;

/** Match 24 is the peak: never played faster than this unless it is skipped past, so it stays legible while catching up. */
const PEAK_SCENE = 2;
const PEAK_MAX_PACE = 4.2;
const MAX_PACE = 12;

/** EXIT CATCH-UP: from this scroll progress the viewer is leaving, so a story still behind must finish now. Holds go and
    the Match 24 ceiling is lifted (leaving beats Match 24's full duration). */
export const LATE_PROGRESS = 0.86;
const LATE_PACE = 12;
/** EXIT DEADLINE: still behind this far into the pin, snap to the settled final composition. It is before the release so
    Final is on screen while Memory is still in view, however far a momentum flick carries the page afterwards. */
export const EXIT_DEADLINE_PROGRESS = 0.95;
/** A fast flick covers the last stretch in a couple of frames, so the deadline looks this far ahead along the scroll velocity. */
export const EXIT_LOOKAHEAD_MS = 220;
/** ...but only in the last third of the pin, so slow-down after a mid-pin flick never reads as an exit. */
const LOOKAHEAD_FROM = 0.8;

/** Whether the exit deadline has been reached, counting where the current scroll velocity (progress per ms) will be shortly. */
export function pastExitDeadline(progress: number, velocity: number): boolean {
  return progress >= LOOKAHEAD_FROM && progress + Math.max(0, velocity) * EXIT_LOOKAHEAD_MS >= EXIT_DEADLINE_PROGRESS;
}

/** Sim-clock multiplier for the scene on screen while the scroll asks for `target`. */
export function paceFor(shown: number, target: number, last: number, late = false): number {
  const lag = target - shown;
  if (lag <= 0) return 1;
  let pace = lag === 1 ? 2 : lag === 2 ? 4 : 8;
  // the closing scene is the one the pin releases on: its approach is the most urgent
  if (target >= last) pace *= 1.5;
  pace = Math.min(MAX_PACE, pace);
  if (late) return Math.max(pace, LATE_PACE);
  if (shown === PEAK_SCENE) pace = Math.min(pace, PEAK_MAX_PACE);
  return pace;
}

/** Wait before advancing to the next scene: only when the scroll is not asking for more. */
export function holdFor(shown: number, target: number, reduced: boolean): number {
  if (target > shown) return 0;
  return reduced ? HOLD_REDUCED_MS : HOLD_MS;
}

/** The exit deadline has passed with the story still behind: settle on the final composition (no scroll is held back for it). */
export function mustSettle(shown: number, last: number, pastDeadline: boolean): boolean {
  return pastDeadline && shown < last;
}
