/* LANDING V3 · top bar: wordmark, four in-page links and the one action. No theme toggle: V3 ships the approved light design. */
import { NAV } from "../copy";

export function Nav() {
  return (
    <header className="nav">
      <div className="wrap nav-row">
        <a aria-label={NAV.homeLabel} className="brand" href="#top">
          {/* eslint-disable-next-line @next/next/no-img-element -- 30px pre-rendered Coach still, same-origin, allowlisted */}
          <img alt="" height={30} src="/coach-web-pack/memory/watching-c.webp" width={30} />
          D2KIRO
        </a>
        <nav aria-label={NAV.sectionsLabel} className="nav-links">
          {NAV.links.map((link) => <a href={link.href} key={link.href}>{link.label}</a>)}
        </nav>
        <a className="btn" href="#waitlist">{NAV.join} <span aria-hidden="true" className="arr">→</span></a>
      </div>
    </header>
  );
}
