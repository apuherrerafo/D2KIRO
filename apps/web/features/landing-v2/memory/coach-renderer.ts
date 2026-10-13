/**
 * Memory Coach contract (Coach Web Pack V1, memory set).
 *
 * The Memory section speaks SEMANTICS: what the Coach is doing, where it looks, how much motion is allowed. It never learns
 * how the pixels are drawn: the memory-size Gold Master stills are pre-rendered (no Three.js, no canvas). The Hero Coach
 * (live on desktop) lives in features/hero-loop/coach and is not imported here.
 */

import type { CoachState as MemoryCoachState } from './types';

export type CoachRenderState = 'watching' | 'analyzing' | 'confirming' | 'pointing';
export type CoachAim = 'left-up' | 'left' | 'left-down' | 'center' | 'right-up' | 'right' | 'right-down';
export type CoachMotion = 'full' | 'reduced';

export interface CoachRenderInput {
  state: CoachRenderState;
  aim: CoachAim;
  motion: CoachMotion;
}

export interface CoachRendererHandle {
  /** Per-frame semantic input. Cheap when nothing changed. `tMs` is the caller's frame clock. */
  set(input: CoachRenderInput, tMs: number): void;
  /** Base Form dissolve/rebuild (NOT a morph). Ignored in reduced motion. */
  reconstruct(tMs: number): void;
}

/** The story's state machine also has `uncertain`; the Coach has no pose for it, so it reads as quiet watching. */
export function toRenderState(state: MemoryCoachState): CoachRenderState {
  return state === 'uncertain' ? 'watching' : state;
}

/**
 * Screen-space direction (x right, y UP, unit-ish) -> one of the pack's discrete directions.
 * A magnitude below the dead zone means "nothing to look at" -> center.
 */
export function quantizeAim(ax: number, ay: number): CoachAim {
  if (Math.hypot(ax, ay) < 0.2) return 'center';
  const col = ax < -0.25 ? -1 : ax > 0.25 ? 1 : 0;
  const row = ay > 0.3 ? 1 : ay < -0.3 ? -1 : 0;
  if (col === 0 && row === 0) return 'center';
  // straight up/down has no pack frame of its own: lean to the side the vector tips toward (right on an exact tie)
  const side = col !== 0 ? col : ax < 0 ? -1 : 1;
  if (side < 0) return row > 0 ? 'left-up' : row < 0 ? 'left-down' : 'left';
  return row > 0 ? 'right-up' : row < 0 ? 'right-down' : 'right';
}

const AIM_CODE: Record<CoachAim, string> = {
  'left-up': 'lu',
  left: 'l',
  'left-down': 'ld',
  center: 'c',
  'right-up': 'ru',
  right: 'r',
  'right-down': 'rd',
};

export const PACK_BASE = '/coach-web-pack';

export function stillUrl(input: Pick<CoachRenderInput, 'state' | 'aim'>): string {
  return `${PACK_BASE}/memory/${input.state}-${AIM_CODE[input.aim]}.webp`;
}

/** RECONSTRUCT filmstrip. Frames run row-major; the last frame is the assembled analyzing Coach. */
export const RECONSTRUCT = {
  url: `${PACK_BASE}/reconstruct-memory.webp`,
  frames: 20,
  cols: 5,
  framePx: 224,
  /** the sheet is rendered pulled back (camera zoom 0.8) so scatter is not clipped; draw its cell this much larger than a still */
  boxScale: 1.25,
  durationMs: 1200,
} as const;

export function reconstructFrame(elapsedMs: number): number {
  const f = Math.floor((elapsedMs / RECONSTRUCT.durationMs) * RECONSTRUCT.frames);
  return Math.max(0, Math.min(RECONSTRUCT.frames - 1, f));
}

/** The 28 stills a Memory view can ask for. */
export function allStillUrls(): string[] {
  const states: CoachRenderState[] = ['watching', 'analyzing', 'confirming', 'pointing'];
  const aims = Object.keys(AIM_CODE) as CoachAim[];
  return states.flatMap((state) => aims.map((aim) => stillUrl({ state, aim })));
}

/**
 * Debounces aim changes so the Coach does not flicker between neighbouring frames while the graph is still moving.
 * A new direction must hold for `holdMs` before it is adopted; in reduced motion the change is immediate.
 */
export class AimStabilizer {
  private current: CoachAim = 'center';
  private candidate: CoachAim = 'center';
  private since = 0;
  private readonly holdMs: number;

  constructor(holdMs = 160) {
    this.holdMs = holdMs;
  }

  next(raw: CoachAim, tMs: number, immediate: boolean): CoachAim {
    if (immediate) {
      this.current = raw;
      this.candidate = raw;
      return raw;
    }
    if (raw === this.current) {
      this.candidate = raw;
      return this.current;
    }
    if (raw !== this.candidate) {
      this.candidate = raw;
      this.since = tMs;
    } else if (tMs - this.since >= this.holdMs) {
      this.current = raw;
    }
    return this.current;
  }
}
