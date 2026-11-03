/* One-shot Web Animations helper for the canonical motions. Replaces the study's two ways of replaying
   an effect — duplicate `a`/`b` keyframes and keyed remounts — because both restart from the keyframe
   start (an interrupted fade snaps) and the second one leaks state.
   - A new run on the same (element, slot) cancels the previous one first.
   - Reduced motion (or no WAAPI) applies the end state and never animates: substitute, don't disable.
   - State is readable without pixels: `data-motion-phase` = running | settled, `data-motion-run` = n. */

const slots = new WeakMap<Element, Map<string, Animation>>();

function slotMap(element: Element) {
  const existing = slots.get(element);
  if (existing) return existing;
  const created = new Map<string, Animation>();
  slots.set(element, created);
  return created;
}

export function cancelPlay(element: Element, slot: string) {
  const running = slotMap(element).get(slot);
  if (running) running.cancel();
  slotMap(element).delete(slot);
}

export function play(element: HTMLElement | SVGElement, slot: string, keyframes: Keyframe[], options: KeyframeAnimationOptions, reduced: boolean): Animation | null {
  cancelPlay(element, slot);
  const run = String(Number(element.dataset.motionRun ?? "0") + 1);
  element.dataset.motionRun = run;
  if (reduced || typeof element.animate !== "function") {
    element.dataset.motionPhase = "settled";
    return null;
  }
  element.dataset.motionPhase = "running";
  const animation = element.animate(keyframes, options);
  slotMap(element).set(slot, animation);
  const settle = () => {
    if (element.dataset.motionRun === run) element.dataset.motionPhase = "settled";
  };
  animation.finished.then(settle, settle);
  return animation;
}

/** Visual translate (px) an element has right now, from a computed `translate` value such as "12px -4px". */
export function parseTranslate(value: string): { x: number; y: number } {
  if (!value || value === "none") return { x: 0, y: 0 };
  const [x = "0", y = "0"] = value.trim().split(/\s+/);
  return { x: Number.parseFloat(x) || 0, y: Number.parseFloat(y) || 0 };
}

/** Quadratic arc used by the spectral displacement: midpoint pushed sideways, never a straight teleport. */
export function arcPoint(from: { x: number; y: number }, to: { x: number; y: number }, t: number) {
  const control = { x: (from.x + to.x) / 2 - (to.y - from.y) * 0.18, y: (from.y + to.y) / 2 + (to.x - from.x) * 0.18 };
  const u = 1 - t;
  return { x: u * u * from.x + 2 * u * t * control.x + t * t * to.x, y: u * u * from.y + 2 * u * t * control.y + t * t * to.y };
}
