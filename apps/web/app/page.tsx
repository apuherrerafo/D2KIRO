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
// Landing V2 is switched on per environment, not per build: LANDING_VARIANT=v2 serves it at `/` (staging review); unset or anything else keeps Landing 01B.
// Reverting is removing the variable. Landing V2 is imported only inside its branch so its stylesheets never load for the legacy page.
const landingV2Enabled = () => process.env.LANDING_VARIANT === "v2";

export async function generateMetadata(): Promise<Metadata> {
  if (await hasActiveSession()) return {};
  return LANDING_METADATA;
}

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await hasActiveSession()) return <AccountHome />;
  if (landingV2Enabled()) {
    const [{ LandingV2 }, { parseLandingV2Params }] = await Promise.all([import("@/features/landing-v2/LandingV2"), import("@/features/landing-v2/lab-params")]);
    return <LandingV2 {...parseLandingV2Params(await searchParams)} />;
  }
  return <LandingPage />;
}
