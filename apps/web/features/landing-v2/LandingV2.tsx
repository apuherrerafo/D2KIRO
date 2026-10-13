/* LANDING V2 · INTEGRATION CANDIDATE (lab route /lab/landing-v2; production `/` stays Landing 01B).
   One narrative, five chapters: Hero (D2KIRO makes the call) → Memory (then it remembers how you play) → Counterfactual (that
   memory can change the answer) → Proposition (one pick, every reason on screen) → CTA (take it into your next draft).
   One theme toggle, one motion preference, one atmosphere. Each chapter only animates while it is on or next to the screen. */
"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import "@/design/round-3a-labs.css";
import "@/design/round-3b-labs.css";
import "@/design/canonical/tokens.css";
import "@/design/canonical/primitives/primitives.css";
import "@/design/canonical/canonical.css";
import "@/design/canonical/motion/motion.css";
import "@/features/landing/landing.css";
import "../hero-loop/hero-loop.css";
import "../counterfactual-lab/counterfactual-lab.css";
import "./landing-v2.css";
import { LabProvider, useReducedMotion } from "@/design/round-3a/lab-context";
import { motionCssVars } from "@/design/round-3a/motion-tokens";
import { LandingFooter } from "@/features/landing/components/LandingFooter";
import { WaitlistSection } from "@/features/landing/components/WaitlistSection";
import { CounterfactualSection } from "./CounterfactualSection";
import { HeroSection } from "./HeroSection";
import { LandingV2Nav } from "./LandingV2Nav";
import type { LandingV2Props, PageTheme } from "./lab-params";
import { MemorySection } from "./MemorySection";
import { PropositionSection } from "./PropositionSection";
import { Seam } from "./Seam";
import { SEAM_HERO_MEMORY, SEAM_MEMORY_CF } from "./copy";

const MOTION_VARS = motionCssVars() as CSSProperties;
const THEME_KEY = "d2kiro.landing-v2.theme";

function readStoredTheme(): PageTheme | null {
  try {
    const value = window.sessionStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function storeTheme(theme: PageTheme) {
  try {
    window.sessionStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode: the choice just lasts until reload */
  }
}

function Body({ initialTheme }: { initialTheme: PageTheme | undefined }) {
  const reduced = useReducedMotion();
  const [theme, setTheme] = useState<PageTheme>(initialTheme ?? "dark");

  // the session's choice applies after hydration (the server cannot know it); an explicit ?theme= wins
  useEffect(() => {
    if (initialTheme) return;
    const stored = readStoredTheme();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is only readable after mount
    if (stored) setTheme(stored);
  }, [initialTheme]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === "light" ? "dark" : "light";
      storeTheme(next);
      return next;
    });
  }, []);

  return (
    <div className="lv2" data-motion={reduced ? "reduced" : "full"} data-testid="lv2" data-theme={theme}>
      <div aria-hidden="true" className="lv2-atmos" />
      <LandingV2Nav onToggleTheme={toggle} reducedMotion={reduced} theme={theme} />
      <main className="lv2-main">
        <HeroSection />
        <Seam testId="seam-hero-memory" tone="cyan">{SEAM_HERO_MEMORY}</Seam>
        <MemorySection />
        <Seam testId="seam-memory-cf" tone="lime">{SEAM_MEMORY_CF}</Seam>
        <CounterfactualSection />
        <PropositionSection />
        <WaitlistSection />
      </main>
      <LandingFooter />
    </div>
  );
}

export function LandingV2({ motion, theme }: LandingV2Props) {
  return (
    <div className="r3-page ld-root lv2-page" data-landing="v2" data-testid="landing-v2" style={MOTION_VARS}>
      <LabProvider value={{ autoplay: false, mode: motion }}>
        <Body initialTheme={theme} />
      </LabProvider>
    </div>
  );
}
