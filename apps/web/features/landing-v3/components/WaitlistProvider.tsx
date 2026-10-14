/* LANDING V3 · the waitlist's shared state. The page has two forms (Hero and closing); a sign-up through either one flips both to the
   success state. All backend access goes through `LANDING_CONFIG.joinWaitlist`: while it is null the forms run as a marked PREVIEW
   and never claim anything was sent or stored. */
"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { LANDING_CONFIG, collectionEnabled, type LandingConfig } from "../config";

const PREVIEW_DELAY_MS = 700;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const isValidEmail = (value: string): boolean => EMAIL_PATTERN.test(value.trim());

export type WaitlistSubmit = "ok" | "invalid" | "failed";

interface WaitlistValue {
  done: boolean;
  /** true while no real backend / legal pages exist: nothing is sent or stored */
  preview: boolean;
  config: LandingConfig;
  submit: (email: string) => Promise<WaitlistSubmit>;
}

const WaitlistContext = createContext<WaitlistValue | null>(null);

export function useWaitlist(): WaitlistValue {
  const value = useContext(WaitlistContext);
  if (!value) throw new Error("WaitlistForm needs a WaitlistProvider");
  return value;
}

export function WaitlistProvider({ children, config = LANDING_CONFIG }: { children: ReactNode; config?: LandingConfig }) {
  const [done, setDone] = useState(false);
  const preview = !collectionEnabled(config);

  const submit = useCallback(
    async (email: string): Promise<WaitlistSubmit> => {
      if (!isValidEmail(email)) return "invalid";
      try {
        if (preview || !config.joinWaitlist) await new Promise((resolve) => window.setTimeout(resolve, PREVIEW_DELAY_MS));
        else await config.joinWaitlist(email.trim());
      } catch {
        return "failed";
      }
      setDone(true);
      return "ok";
    },
    [config, preview],
  );

  const value = useMemo(() => ({ done, preview, config, submit }), [done, preview, config, submit]);
  return <WaitlistContext.Provider value={value}>{children}</WaitlistContext.Provider>;
}
