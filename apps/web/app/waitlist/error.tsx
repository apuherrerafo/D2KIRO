"use client";

import { AppNotice } from "@/components/app-shell/AppNotice";

interface WaitlistErrorProps {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}

// Error boundary de la waitlist, en inglés como el resto de su recorrido.
export default function WaitlistError({ unstable_retry }: WaitlistErrorProps) {
  return (
    <main className="ap-main ap-main--center" lang="en" data-testid="waitlist-error-state">
      <AppNotice tone="error" title="Something went wrong">
        <p>We could not show the waitlist. Nothing about your email changed.</p>
        <div className="ap-notice-actions">
          <button type="button" className="ap-btn" onClick={unstable_retry}>
            Try again
          </button>
        </div>
      </AppNotice>
    </main>
  );
}
