/* HERO-LOOP LAB · every portrait the three drafts will ever show is fetched and decoded BEFORE autoplay starts, so a
   seam between drafts never reveals a GATHER grid over an empty icon. The first draft is never held back (its own images
   are already in the DOM); only the clock waits. A portrait that fails is simply skipped: HeroIcon owns the fallback. */
"use client";

import { useEffect, useState } from "react";
import { getCanonicalHero } from "@/design/canonical/hero-media";
import type { LoopScenario } from "./scenarios";

/** Longest the clock will wait for the CDN before it starts anyway. */
const PRELOAD_TIMEOUT_MS = 6000;

/** Held for the page's lifetime so a decoded portrait is not evicted before its draft arrives. */
const keep = new Set<HTMLImageElement>();

export function heroNamesOf(scenarios: readonly LoopScenario[]): string[] {
  const names = new Set<string>();
  for (const s of scenarios) {
    s.bans.forEach((h) => names.add(h));
    s.enemies.forEach((e) => names.add(e.hero));
    s.allies.forEach((a) => a.hero && names.add(a.hero));
    s.candidates.forEach((c) => names.add(c.hero));
  }
  return [...names];
}

function load(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onerror = () => resolve();
    img.onload = () => {
      keep.add(img);
      (typeof img.decode === "function" ? img.decode() : Promise.resolve()).then(() => resolve(), () => resolve());
    };
    img.src = url;
  });
}

export function preloadPortraits(names: readonly string[]): Promise<void> {
  const urls = [...new Set(names.map((n) => getCanonicalHero(n)?.imgUrl).filter((u): u is string => Boolean(u)))];
  const all = Promise.all(urls.map(load)).then(() => undefined);
  const cap = new Promise<void>((resolve) => window.setTimeout(resolve, PRELOAD_TIMEOUT_MS));
  return Promise.race([all, cap]);
}

/** False until every portrait has settled (loaded, failed, or timed out). */
export function usePortraitsReady(scenarios: readonly LoopScenario[]): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void preloadPortraits(heroNamesOf(scenarios)).then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [scenarios]);
  return ready;
}
