/* LANDING-01B · top bar. The only action here is the quiet one: the single spectral commitment of the
   first view is the hero's, so the nav never competes with it. */
import { ActionQuiet } from "@/design/canonical/primitives";
import { CTA_LABEL, NAV_LINKS } from "../copy";
import { scrollToId } from "../scroll";

function NavLinks() {
  return (
    <ul className="ld-nav-links">
      {NAV_LINKS.map((link) => <li key={link.href}><a className="ld-nav-link" href={link.href}>{link.label}</a></li>)}
    </ul>
  );
}

export function LandingNav({ reducedMotion }: { reducedMotion: boolean }) {
  function handleJoin() {
    scrollToId("waitlist", reducedMotion);
  }
  return (
    <nav aria-label="D2KIRO" className="ld-nav">
      <div className="ld-wrap ld-nav-row">
        <span className="ld-wordmark">D2KIRO</span>
        <NavLinks />
        <ActionQuiet onPress={handleJoin}>{CTA_LABEL}</ActionQuiet>
      </div>
    </nav>
  );
}
