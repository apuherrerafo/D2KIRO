/* LANDING-01B · closing CTA. ActionPrimary is the one spectral commitment of this view. The door in is real:
   the same Steam sign-in the whole product uses (`/login`). The beta is private; whoever is not invited can
   follow one quiet link to the waitlist (`/waitlist`). The landing itself collects nothing. */
"use client";

import { ActionPrimary } from "@/design/canonical/primitives";
import { CTA_LABEL, ENTRY } from "../copy";
import { LandingSection } from "./LandingSection";

export const ENTRY_PATH = "/login";
export const WAITLIST_PATH = "/waitlist";

export function EntrySection() {
  function handleEnter() {
    window.location.assign(ENTRY_PATH);
  }

  return (
    <LandingSection id="entry" kicker={ENTRY.kicker} layout="split" lede={ENTRY.lede} title={ENTRY.title}>
      <div className="ld-waitlist">
        <div className="ld-waitlist-action">
          <ActionPrimary onPress={handleEnter} testId="landing-enter">{CTA_LABEL}</ActionPrimary>
        </div>
        <p className="ld-illustrative">{ENTRY.note}</p>
        <a className="ld-waitlist-link" href={WAITLIST_PATH} data-testid="landing-waitlist">{ENTRY.waitlist}</a>
      </div>
    </LandingSection>
  );
}
