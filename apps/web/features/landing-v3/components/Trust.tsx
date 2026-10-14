/* LANDING V3 · 6 · TRUST. "One pick. Every reason on screen." Controlled, no motion: the final call (Puck, FIT 88), the four reasons it
   stands on, and the Coach CONFIRMING. No lock button, no strength bars, no fake confidence. */
import type { CSSProperties } from "react";
import { HeroIcon, HeroPortrait } from "@/design/canonical/hero-media";
import { Glass } from "@/design/canonical/primitives/Glass";
import { TRUST } from "../copy";
import { candidate, HEROES } from "../fixture";

const EVIDENCE: Record<string, { heroes?: Array<"AX" | "SL" | "ES" | "CM">; text?: string }> = {
  COUNTER: { heroes: ["AX", "SL"] },
  SYNERGY: { heroes: ["ES", "CM"] },
  "YOUR GAMES": { text: "+6" },
  ROLE: { text: "POS 2" },
};

const TONE_VAR: Record<string, string> = { cyan: "var(--cyan)", muted: "var(--muted)" };

export function Trust() {
  const puck = candidate("puck");
  return (
    <section aria-labelledby="trust-title" className="trust" id="trust">
      <div className="wrap trust-grid">
        <div className="trust-copy">
          <p className="kicker">{TRUST.kicker}</p>
          <h2 className="h2" id="trust-title"><span>{TRUST.lineOne}</span><span>{TRUST.lineTwo}</span></h2>
          <p className="lede">{TRUST.lede}</p>
          <div aria-hidden="true" className="trust-who">
            {/* eslint-disable-next-line @next/next/no-img-element -- fixed pre-rendered raster */}
            <img alt="" height={132} loading="lazy" src="/coach-web-pack/hero/confirming-l.webp" width={132} />
            <span className="state-pill"><i />Confirming</span>
          </div>
        </div>
        <article aria-label={TRUST.callLabel} data-testid="trust-call">
          <Glass className="call" edge surfaceLevel="4">
            <div className="call-top">
              <HeroPortrait hero={HEROES[puck.hero].name} lit showPlate={false} size="sm" />
              <div><p className="kicker">{TRUST.callKicker}</p><h3>{HEROES[puck.hero].name}</h3><p className="meta">{TRUST.meta}</p></div>
              <span className="fit"><i>FIT</i><b>{puck.you.fit}</b></span>
            </div>
            <ul className="proof">
              {TRUST.proof.map((row) => {
                const evidence = EVIDENCE[row.key];
                return (
                  <li key={row.key} style={{ "--c": TONE_VAR[row.tone] } as CSSProperties}>
                    <span className="k">{row.key}</span>
                    <div><p>{row.line}</p><small>{row.detail}</small></div>
                    <span className="ev">
                      {evidence.heroes?.map((hero) => <HeroIcon hero={HEROES[hero].name} key={hero} size="sm" />)}
                      {evidence.text}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="call-foot">
              <p>{TRUST.backups}</p>
              <p className="note">{TRUST.note}</p>
            </div>
          </Glass>
        </article>
      </div>
    </section>
  );
}
