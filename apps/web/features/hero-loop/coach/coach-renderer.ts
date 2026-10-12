/**
 * CoachRenderer contract, Hero subset (from Coach Web Pack V1).
 *
 * The Hero loop speaks SEMANTICS: what the Coach is doing, where it looks, how much motion is allowed. It never learns
 * whether the pixels come from the live Three.js Gold Master (desktop), the pre-rendered sprite pack (mobile) or a
 * static state frame (reduced motion). Memory-size sets and the RECONSTRUCT filmstrip are intentionally NOT carried over.
 */

export type CoachRenderState = "watching" | "analyzing" | "confirming" | "pointing";
export type CoachAim = "left" | "center" | "right";
export type CoachMotion = "full" | "reduced";

export interface CoachRenderInput {
  state: CoachRenderState;
  aim: CoachAim;
  motion: CoachMotion;
}

/** The three hero frames per state, in the pack's order. */
export const HERO_AIMS: readonly CoachAim[] = ["left", "center", "right"];
export const HERO_STATES: readonly CoachRenderState[] = ["watching", "analyzing", "confirming", "pointing"];

const AIM_CODE: Record<CoachAim, string> = { left: "l", center: "c", right: "r" };

export const PACK_BASE = "/coach-web-pack";

export function stillUrl(input: Pick<CoachRenderInput, "state" | "aim">): string {
  return `${PACK_BASE}/hero/${input.state}-${AIM_CODE[input.aim]}.webp`;
}

/** Every still the Hero can ask for (12), for preloading. */
export function allStillUrls(): string[] {
  return HERO_STATES.flatMap((state) => HERO_AIMS.map((aim) => stillUrl({ state, aim })));
}

/** Screen-space direction (x right) -> one of the Hero's three aims. A magnitude inside the dead zone means "centre". */
export function quantizeAim(ax: number): CoachAim {
  if (ax < -0.25) return "left";
  if (ax > 0.25) return "right";
  return "center";
}

/** Sprite aim -> the live renderer's continuous aim (-1..1, +y up). The sprite pack only knows three. */
export function aimVector(aim: CoachAim): { x: number; y: number } {
  return { x: aim === "left" ? -1 : aim === "right" ? 1 : 0, y: 0 };
}

/**
 * Debounces aim changes so the Coach does not flicker between neighbouring frames while the stage is still moving.
 * A new direction must hold for `holdMs` before it is adopted; in reduced motion the change is immediate.
 */
export class AimStabilizer {
  private current: CoachAim = "center";
  private candidate: CoachAim = "center";
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
