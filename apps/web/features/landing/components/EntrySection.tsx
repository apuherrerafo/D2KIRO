/* LANDING-01B · closing CTA. ActionPrimary is the one spectral commitment of this view. The door in is real:
   the same Steam sign-in the whole product uses (`/login`). There is no sign-up form and no email list --
   the beta is private, and the page says so instead of pretending to collect anything. */
"use client";

import { ActionPrimary } from "@/design/canonical/primitives";
import { CTA_LABEL, ENTRY } from "../copy";
import { LandingSection } from "./LandingSection";

export const ENTRY_PATH = "/login";

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
      </div>
    </LandingSection>
  );
}
