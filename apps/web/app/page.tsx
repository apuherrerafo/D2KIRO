import type { Metadata } from "next";
import { LandingPage } from "@/features/landing";
import { LANDING_METADATA } from "@/features/landing/metadata";
import { hasActiveSession } from "@/lib/session";
import { AccountHome } from "./account-home";

// TSK-244: `/` serves two audiences. A visitor with a valid session lands on the account home (also
// the post-login redirect target); everyone else sees the public landing. The same LandingPage
// component Storybook renders -- no fork. The waitlist has no endpoint yet, so `onJoinWaitlist` is
// deliberately omitted: that is the seam for the backend, and the form stays a labelled preview.
// Only the public landing carries its own metadata; the account home keeps the app default.
export async function generateMetadata(): Promise<Metadata> {
  if (await hasActiveSession()) return {};
  return LANDING_METADATA;
}

export default async function Home() {
  if (await hasActiveSession()) return <AccountHome />;
  return <LandingPage />;
}
