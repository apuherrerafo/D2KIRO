/* Lab plumbing for Round 3A motion studies: one shared context decides whether motion is full or
   reduced (system preference OR the in-page simulation toggle) and whether demos auto-advance.
   Demos only tick while their study is on screen and the document is visible — no offscreen work. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";

export type MotionMode = "system" | "reduced" | "full";

type LabState = { autoplay: boolean; mode: MotionMode };

const LabContext = createContext<LabState>({ autoplay: false, mode: "system" });
export const LabProvider = LabContext.Provider;

export function useLabState() {
  return useContext(LabContext);
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const query = window.matchMedia(REDUCED_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function systemPrefersReduced() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(REDUCED_QUERY).matches;
}

function serverPrefersReduced() {
  return false;
}

/** True when motion must be replaced by its reduced equivalent. */
export function useReducedMotion() {
  const { mode } = useContext(LabContext);
  const system = useSyncExternalStore(subscribeReduced, systemPrefersReduced, serverPrefersReduced);
  if (mode === "reduced") return true;
  if (mode === "full") return false;
  return system;
}

export function useInView(ref: RefObject<Element | null>) {
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      setInView(entries.some((entry) => entry.isIntersecting));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return inView;
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function documentVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/**
 * Steps through `length` demo states. Auto-advances only when autoplay is on, the study is in
 * view and the tab is visible; manual stepping always works (keyboard and pointer alike).
 */
export function useDemoSteps(length: number, intervalMs: number, ref: RefObject<Element | null>) {
  const { autoplay } = useContext(LabContext);
  const inView = useInView(ref);
  const visible = useSyncExternalStore(subscribeVisibility, documentVisible, () => true);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!autoplay || !inView || !visible) return;
    const timer = window.setInterval(() => setStep((current) => (current + 1) % length), intervalMs);
    return () => window.clearInterval(timer);
  }, [autoplay, inView, intervalMs, length, visible]);

  const next = useCallback(() => setStep((current) => (current + 1) % length), [length]);
  return { next, setStep, step };
}

/** Returns a counter that bumps every time `value` changes — used as a key to replay one-shot CSS. */
export function useChangeCount(value: unknown) {
  const [seen, setSeen] = useState({ count: 0, value });
  if (!Object.is(seen.value, value)) setSeen({ count: seen.count + 1, value });
  return Object.is(seen.value, value) ? seen.count : seen.count + 1;
}

/**
 * FLIP for ranked rows: measures each keyed child before and after a reorder and animates the
 * delta with a transform-only Web Animation. Uses a non-overshooting easing by contract.
 */
export function useFlip(
  container: RefObject<HTMLElement | null>,
  order: string,
  options: { durationMs: number; easing: string; reduced: boolean },
) {
  const positions = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const rows = [...root.querySelectorAll<HTMLElement>("[data-flip-key]")];
    const next = new Map<string, number>();

    for (const row of rows) {
      const key = row.dataset.flipKey ?? "";
      const top = row.getBoundingClientRect().top;
      next.set(key, top);
      const before = positions.current.get(key);
      if (before === undefined || options.reduced || typeof row.animate !== "function") continue;
      const delta = before - top;
      if (Math.abs(delta) < 1) continue;
      row.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }],
        { duration: options.durationMs, easing: options.easing },
      );
    }

    positions.current = next;
  }, [container, order, options.durationMs, options.easing, options.reduced]);
}
