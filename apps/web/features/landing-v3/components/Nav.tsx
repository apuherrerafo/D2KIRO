/* LANDING V3 · top bar: wordmark, four in-page links and the one action (the canonical quiet action, as on Landing V2). Dark, as the whole D2KIRO product. */
"use client";

import { ActionQuiet } from "@/design/canonical/primitives";
import { useReducedMotion } from "@/design/round-3a/lab-context";
import { scrollToId } from "@/features/landing/scroll";
import { NAV } from "../copy";

export function Nav() {
  const reduced = useReducedMotion();
  function handleJoin() {
    scrollToId("waitlist", reduced);
  }
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
        <ActionQuiet onPress={handleJoin}>{NAV.join}</ActionQuiet>
      </div>
    </header>
  );
}
