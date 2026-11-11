/* LANDING-01B · top bar. The only action here is the quiet one: the single spectral commitment of the
   first view is the hero's, so the nav never competes with it. */
import { ActionQuiet } from "@/design/canonical/primitives";
import { CTA_LABEL, NAV_LINKS } from "../copy";
import { ENTRY_PATH } from "./EntrySection";

function NavLinks() {
  return (
    <ul className="ld-nav-links">
      {NAV_LINKS.map((link) => <li key={link.href}><a className="ld-nav-link" href={link.href}>{link.label}</a></li>)}
    </ul>
  );
}

export function LandingNav() {
  function handleJoin() {
    window.location.assign(ENTRY_PATH);
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
