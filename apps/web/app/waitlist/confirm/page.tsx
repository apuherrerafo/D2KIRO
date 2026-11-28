import type { Metadata } from "next";
import { CONFIRM_COPY } from "@/features/waitlist/constants";
import { WaitlistConfirmPanel } from "@/features/waitlist";

export const metadata: Metadata = { title: "Confirm your email · D2KIRO", robots: { index: false } };

export default function WaitlistConfirmPage() {
  return (
    <main className="ap-main ap-main--center" lang="en" data-testid="waitlist-confirm-page">
      <h1 className="ap-title">{CONFIRM_COPY.title}</h1>
      <WaitlistConfirmPanel />
    </main>
  );
}
