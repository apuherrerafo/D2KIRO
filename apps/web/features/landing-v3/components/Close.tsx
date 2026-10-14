/* LANDING V3 · 9 · FINAL WAITLIST. "Join the waitlist. Help shape what D2KIRO becomes next." Strong but simple; the Coach is back in its calm
   canonical Base Form. No donation UI, no pricing, no Founding Supporter payment. */
import { Glass } from "@/design/canonical/primitives/Glass";
import { CLOSE } from "../copy";
import { WaitlistForm } from "./WaitlistForm";

export function Close() {
  return (
    <section aria-labelledby="close-title" className="close" id="waitlist">
      <div className="wrap">
        <Glass className="close-stage" edge surfaceLevel="3">
          <div className="close-copy">
            <p className="kicker">{CLOSE.kicker}</p>
            <h2 id="close-title">{CLOSE.title}</h2>
            <p className="lede">{CLOSE.lede}</p>
            <WaitlistForm inputId="wl-close" variant="close" />
            <div className="close-extra">{CLOSE.extras.map((extra) => <span key={extra}>{extra}</span>)}</div>
          </div>
          <div aria-hidden="true" className="close-coach">
            {/* eslint-disable-next-line @next/next/no-img-element -- fixed pre-rendered raster (canonical Base Form) */}
            <img alt="" height={150} loading="lazy" src="/coach-web-pack/hero/watching-c.webp" width={150} />
            <span className="state-pill"><i />{CLOSE.restPill}</span>
          </div>
        </Glass>
      </div>
    </section>
  );
}
