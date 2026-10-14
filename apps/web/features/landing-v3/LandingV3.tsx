/* LANDING V3 · the integrated page. One narrative, one thread:
     Hero (a draft that adapts to you) → handoff (cyan trace) → differentiation (the meta knows the game; D2KIRO knows yours) →
     living decision graph (the one expressive peak) → payoff (same draft, different player, different pick) → trust (one pick,
     every reason on screen) → built for your next draft → FAQ → join the waitlist.
   Colour: cyan = evidence / memory / reasoning · magenta = contradiction / pressure · lime = personal resolution.
   Server-rendered; the interactive pieces (Hero stage, Differentiation figure, graph, waitlist forms) are small client islands. */
import "./landing-v3.css";
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
import { Trust } from "./components/Trust";
import { WaitlistProvider } from "./components/WaitlistProvider";
import { LANDING_FONT_CLASSES } from "./fonts";
import { faqJsonLd, jsonLdString } from "./seo";

export function LandingV3() {
  return (
    <div className={`lv3 ${LANDING_FONT_CLASSES}`} data-landing="v3" data-testid="landing-v3">
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
  );
}
