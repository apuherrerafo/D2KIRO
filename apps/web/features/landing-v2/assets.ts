/* LANDING V2 · asset loading strategy. Nothing is fetched at page entry except what the first Hero cycle needs.
     INITIAL            Hero shell + the Hero's own portraits and its first Coach frames (owned by the Hero loop, untouched)
     HERO READY / IDLE  Memory-size Coach stills (28 small WebPs), then the Hero Coach stills for the Counterfactual
     BEFORE MEMORY      `ensureMemoryAssets()` — resolves once the memory stills are decoded (or after a cap), so Match 01 never
                        opens on a blank Coach. The RECONSTRUCT filmstrip is requested from Match 08 on (MemoryCoach).
     BEFORE COUNTERFACTUAL  its Coach reuses the Hero set, already warm from the idle phase
   The live Gold Master (Three.js + the 7.7 MB modular package) is not used by this page at all: the Hero, Memory and
   Counterfactual Coaches are all pre-rendered stills, on desktop and on phone. Data-saver connections skip the
   idle phase and fetch each set only when its section is about to be reached. */
"use client";

import { useEffect, useState } from "react";
import { allStillUrls as heroStillUrls } from "../hero-loop/coach/coach-renderer";
import { allStillUrls as memoryStillUrls } from "./memory/coach-renderer";

/** Longest a section waits for its images before it plays anyway. */
const ENSURE_TIMEOUT_MS = 3000;

/** Held for the page's lifetime so a decoded image is not evicted before its section arrives. */
const kept = new Map<string, Promise<void>>();

function load(url: string): Promise<void> {
  const known = kept.get(url);
  if (known) return known;
  const promise = new Promise<void>((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onerror = () => resolve();
    img.onload = () => (typeof img.decode === "function" ? img.decode().then(() => resolve(), () => resolve()) : resolve());
    img.src = url;
  });
  kept.set(url, promise);
  return promise;
}

function saveData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

export function ensureImages(urls: readonly string[], timeoutMs = ENSURE_TIMEOUT_MS): Promise<void> {
  const all = Promise.all(urls.map(load)).then(() => undefined);
  const cap = new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs));
  return Promise.race([all, cap]);
}

export const ensureMemoryAssets = () => ensureImages(memoryStillUrls());

function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: 2500 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 400);
  return () => window.clearTimeout(id);
}

/** Warms the later sections once the Hero is up. `heroReady` = the Hero's own portraits have settled. */
export function useIdlePrefetch(heroReady: boolean): void {
  useEffect(() => {
    if (!heroReady || saveData()) return;
    return whenIdle(() => {
      void ensureImages(memoryStillUrls(), 15000).then(() => ensureImages(heroStillUrls(), 15000));
    });
  }, [heroReady]);
}

/** False until the memory stills are decoded. Starts as soon as `near`, so the idle phase has usually finished already. */
export function useMemoryAssets(near: boolean): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!near || ready) return;
    let live = true;
    void ensureMemoryAssets().then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [near, ready]);
  return ready;
}
