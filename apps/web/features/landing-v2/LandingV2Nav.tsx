/* LANDING V2 · top bar: wordmark, three in-page links, the quiet waitlist action and the page's ONE theme toggle. */
"use client";

import { ActionQuiet } from "@/design/canonical/primitives";
import { CTA_LABEL } from "@/features/landing/copy";
import { scrollToId } from "@/features/landing/scroll";
import { NAV } from "./copy";
import type { PageTheme } from "./lab-params";

type Props = { onToggleTheme: () => void; reducedMotion: boolean; theme: PageTheme };

export function LandingV2Nav({ onToggleTheme, reducedMotion, theme }: Props) {
  function handleJoin() {
    scrollToId("waitlist", reducedMotion);
  }
  const light = theme === "light";
  return (
    <nav aria-label={NAV.label} className="ld-nav lv2-nav">
      <div className="ld-wrap ld-nav-row">
        <span className="ld-wordmark">{NAV.label}</span>
        <ul className="ld-nav-links">
          {NAV.links.map((link) => <li key={link.href}><a className="ld-nav-link" href={link.href}>{link.label}</a></li>)}
        </ul>
        <ActionQuiet onPress={handleJoin}>{CTA_LABEL}</ActionQuiet>
        <button aria-label={light ? NAV.themeToDark : NAV.themeToLight} className="lv2-theme" data-testid="theme-toggle" onClick={onToggleTheme} type="button">
          <span aria-hidden="true" className="lv2-theme-icon" data-theme-icon={theme} />
          <span>{light ? NAV.themeLight : NAV.themeDark}</span>
        </button>
      </div>
    </nav>
  );
}
