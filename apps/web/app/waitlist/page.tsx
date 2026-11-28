import type { Metadata } from "next";
import { SIGNUP_COPY } from "@/features/waitlist/constants";
import { WaitlistSignupPanel } from "@/features/waitlist";

export const metadata: Metadata = { title: "Waitlist · D2KIRO", description: SIGNUP_COPY.lede };

export default function WaitlistPage() {
  return (
    <main className="ap-main ap-main--center" lang="en" data-testid="waitlist-page">
      <h1 className="ap-title">{SIGNUP_COPY.title}</h1>
      <p className="ap-hint">{SIGNUP_COPY.lede}</p>
      <WaitlistSignupPanel />
    </main>
  );
}
