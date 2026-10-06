/* LANDING-01B · section scaffold (layout only — no skin of its own). The spectral rule at the top is
   the section transition: it is drawn once, left → right, when the section is first reached, which
   says "a new part of the page starts here" without fade-up. Reduced motion shows it already drawn. */
"use client";

import { useRef, type ReactNode } from "react";
import { useReducedMotion } from "@/design/round-3a/lab-context";
import { useSeen } from "../hooks";

export type LandingSectionProps = {
  children: ReactNode;
  id: string;
  kicker: string;
  lede?: string;
  title: string;
};

export function LandingSection({ children, id, kicker, lede, title }: LandingSectionProps) {
  const host = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const seen = useSeen(host, reduced);
  const headingId = `${id}-title`;
  return (
    <section aria-labelledby={headingId} className="ld-section" data-section={id} data-seen={seen ? "true" : "false"} id={id} ref={host} tabIndex={-1}>
      <span aria-hidden="true" className="ld-rule" />
      <div className="ld-wrap">
        <header className="ld-section-head">
          <p className="ld-kicker">{kicker}</p>
          <h2 className="ld-h2" id={headingId}>{title}</h2>
          <SectionLede lede={lede} />
        </header>
        {children}
      </div>
    </section>
  );
}

function SectionLede({ lede }: { lede?: string }) {
  if (!lede) return null;
  return <p className="ld-lede">{lede}</p>;
}
