/* LANDING V2 · a seam between two chapters. Not a transition stunt: one hairline in the colour of the idea being carried
   (cyan = evidence kept, lime = personal resolution), drawn once downward when it is reached, ending in a node and one line of
   words. It says what the next chapter does with what the last one showed. Reduced motion shows it already drawn. */
"use client";

import { useRef } from "react";
import { useReducedMotion } from "@/design/round-3a/lab-context";
import { useSeen } from "@/features/landing/hooks";

export function Seam({ children, tone, testId }: { children: string; tone: "cyan" | "lime"; testId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const seen = useSeen(host, reduced);
  return (
    <div className="lv2-seam" data-seen={seen ? "true" : "false"} data-testid={testId} data-tone={tone} ref={host}>
      <span aria-hidden="true" className="lv2-seam-line" />
      <span aria-hidden="true" className="lv2-seam-node" />
      <p className="lv2-seam-text">{children}</p>
    </div>
  );
}
