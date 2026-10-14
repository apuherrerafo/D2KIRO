/* LANDING V3 · the page's one client boundary for the canonical lab context (motion mode, reduced-motion). Everything it wraps stays a server component. */
"use client";

import type { ReactNode } from "react";
import { LabProvider } from "@/design/round-3a/lab-context";

export function Shell({ children }: { children: ReactNode }) {
  return <LabProvider value={{ autoplay: false, mode: "system" }}>{children}</LabProvider>;
}
