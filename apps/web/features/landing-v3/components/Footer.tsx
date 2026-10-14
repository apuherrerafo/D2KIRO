/* LANDING V3 · footer. Minimal: wordmark, in-page navigation, the not-affiliated line. Privacy / Terms appear only when their pages exist
   (LEGAL_COPY_BLOCKED until then): the footer never links to a page that is not there. */
import { FOOTER } from "../copy";
import { LANDING_CONFIG } from "../config";

export function Footer() {
  const legal = [
    { label: FOOTER.privacy, destination: LANDING_CONFIG.legal.privacy },
    { label: FOOTER.terms, destination: LANDING_CONFIG.legal.terms },
  ].filter((item) => item.destination !== null);
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-row">
          <a aria-label="D2KIRO home" className="brand" href="#top">
            {/* eslint-disable-next-line @next/next/no-img-element -- 26px pre-rendered Coach still */}
            <img alt="" height={26} loading="lazy" src="/coach-web-pack/memory/watching-c.webp" width={26} />
            D2KIRO
          </a>
          <span className="foot-tag">{FOOTER.tag}</span>
          <nav aria-label={FOOTER.navLabel} className="main">
            {FOOTER.links.map((link) => <a href={link.href} key={link.href}>{link.label}</a>)}
          </nav>
        </div>
        <div className="foot-sub">
          <p className="legal">{FOOTER.legal}</p>
          {legal.length > 0 && (
            <nav aria-label={FOOTER.legalNavLabel}>
              {legal.map((item) => <a href={item.destination?.href} key={item.label}>{item.label}</a>)}
            </nav>
          )}
        </div>
      </div>
    </footer>
  );
}
