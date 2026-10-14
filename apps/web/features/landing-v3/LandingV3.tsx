/* LANDING V3 · the integrated page. One narrative, one thread:
     Hero (a draft that adapts to you) → handoff (cyan trace) → differentiation (the meta knows the game; D2KIRO knows yours) →
     living decision graph (the one expressive peak) → payoff (same draft, different player, different pick) → trust (one pick,
     every reason on screen) → built for your next draft → FAQ → join the waitlist.
   Colour: cyan = evidence / memory / reasoning · pink = contradiction / pressure · lime = personal resolution.
   This page IS the D2KIRO product's visual system: the canonical tokens, Glass, actions, hero media and motion language, the real Hero Loop
   and Coach Motion V2. What is new is the architecture of the story and the agent's travel across the graph, not a second skin.
   The interactive pieces (Hero loop, Differentiation figure, graph, waitlist forms) are small client islands. */
import "@/design/round-3a-labs.css";
import "@/design/round-3b-labs.css";
import "@/design/canonical/tokens.css";
import "@/design/canonical/primitives/primitives.css";
import "@/design/canonical/canonical.css";
import "@/design/canonical/motion/motion.css";
import "../hero-loop/hero-loop.css";
import "./landing-v3.css";
import { motionCssVars } from "@/design/round-3a/motion-tokens";
import type { CSSProperties } from "react";
import { Close } from "./components/Close";
import { Differentiation } from "./components/Differentiation";
import { Faq } from "./components/Faq";
import { Footer } from "./components/Footer";
import { Handoff } from "./components/Handoff";
import { Hero } from "./components/Hero";
import { LivingGraph } from "./components/LivingGraph";
import { Nav } from "./components/Nav";
import { Payoff } from "./components/Payoff";
import { Practical } from "./components/Practical";
import { Seam } from "./components/Seam";
import { Shell } from "./components/Shell";
import { Trust } from "./components/Trust";
import { WaitlistProvider } from "./components/WaitlistProvider";
import { faqJsonLd, jsonLdString } from "./seo";

const MOTION_VARS = motionCssVars() as CSSProperties;

export function LandingV3() {
  return (
    <div className="r3-page ld-root lv3-page" data-landing="v3" data-testid="landing-v3" style={MOTION_VARS}>
      <Shell>
        <div className="lv3" data-theme="dark">
          <script type="application/ld+json">{jsonLdString(faqJsonLd())}</script>
          <WaitlistProvider>
            <div aria-hidden="true" className="atmos" />
            <Nav />
            <main id="top">
              <Hero />
              <Handoff />
              <Differentiation />
              <Seam />
              <LivingGraph />
              <Payoff />
              <Trust />
              <Practical />
              <Faq />
              <Close />
            </main>
            <Footer />
          </WaitlistProvider>
        </div>
      </Shell>
    </div>
  );
}
