/* LANDING V3 · 1 · HERO. "A draft that adapts to you." Real waitlist form, real product view (illustrative Draft A), an original
   Dota-style map behind it and the Coach inside the product. The static markup here is the page's first paint; the stage island
   adds the map, the system layer and the Coach's walk on top of it. */
import { HERO } from "../copy";
import { HeroStage } from "./HeroStage";
import { ProductCard } from "./ProductCard";
import { WaitlistForm } from "./WaitlistForm";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="hero" data-testid="hero">
      <HeroStage />
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <p className="kicker">{HERO.kicker}<b>{HERO.kickerGame}</b></p>
          <h1 id="hero-title">{HERO.title}</h1>
          <p className="hero-sub">{HERO.sub}</p>
          <WaitlistForm inputId="wl-hero" variant="hero" />
        </div>
        <ProductCard />
      </div>
    </section>
  );
}
