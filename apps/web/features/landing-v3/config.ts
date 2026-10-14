/* LANDING V3 · what is wired and what is not yet. Every field below is an integration boundary, not a feature:
     joinWaitlist  the ONE place a real sign-up endpoint plugs in. There is no approved waitlist backend in this repo yet
                   (WAITLIST_BACKEND_BLOCKED), so it is null and the forms run as a clearly marked PREVIEW: they validate, they
                   say "Preview only", and they never claim anything was sent or stored.
     legal         Privacy / Terms destinations. No approved pages or copy exist (LEGAL_COPY_BLOCKED), so they are null and the
                   footer shows no inert links.
     help          "Want to help shape D2KIRO?" destinations (feedback, follow). None approved: the success state shows no inert buttons.
   Public data collection is on only when ALL of: an endpoint, a Privacy page and a Terms page exist. */

export type JoinWaitlist = (email: string) => Promise<void>;

export interface Destination {
  href: string;
  /** external destinations open in a new tab */
  external?: boolean;
}

export interface LandingConfig {
  joinWaitlist: JoinWaitlist | null;
  legal: { privacy: Destination | null; terms: Destination | null };
  help: { feedback: Destination | null; follow: Destination | null };
}

export const LANDING_CONFIG: LandingConfig = {
  joinWaitlist: null,
  legal: { privacy: null, terms: null },
  help: { feedback: null, follow: null },
};

/** True only when a visitor's email can really be stored AND the legal pages that govern it exist. */
export function collectionEnabled(config: LandingConfig): boolean {
  return config.joinWaitlist !== null && config.legal.privacy !== null && config.legal.terms !== null;
}

/** The help actions that have a real destination, in display order. */
export function helpActions(config: LandingConfig): Array<{ id: "feedback" | "follow"; destination: Destination }> {
  const actions: Array<{ id: "feedback" | "follow"; destination: Destination }> = [];
  if (config.help.feedback) actions.push({ id: "feedback", destination: config.help.feedback });
  if (config.help.follow) actions.push({ id: "follow", destination: config.help.follow });
  return actions;
}
