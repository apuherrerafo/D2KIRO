import type { ReactNode } from "react";

export interface StatusNoticeProps {
  /** Notice body content explaining context, state, or remediation. */
  children: ReactNode;
  /** Notice title concisely describing state change. */
  title: string;
  /** Semantic status tone indicating operational status. */
  tone?: "neutral" | "warning" | "error";
}

/**
 * @purpose Communicates operational or draft state changes without unnecessary container decoration.
 * @a11y Errors announce as assertive alerts; warnings and neutral notices announce as polite status regions.
 * @a11y Explicit heading provides accessible landmark structure without relying solely on color.
 * @canonical Use only when state change directly affects the user's immediate decision.
 */
export function StatusNotice({
  children,
  title,
  tone = "neutral",
}: StatusNoticeProps) {
  const role: "alert" | "status" = tone === "error" ? "alert" : "status";
  const ariaLive = tone === "error" ? "assertive" : "polite";

  const toneClasses =
    tone === "error"
      ? "border-signal-negative"
      : tone === "warning"
        ? "border-signal-warning"
        : "border-surface-border";

  const titleToneClasses =
    tone === "error"
      ? "text-signal-negative"
      : tone === "warning"
        ? "text-signal-warning"
        : "text-content-primary";

  return (
    <section
      aria-live={ariaLive}
      className={`rounded-container border bg-surface-raised p-4 transition-colors duration-150 motion-reduce:transition-none ${toneClasses}`}
      role={role}
    >
      <h3 className={`text-body font-semibold ${titleToneClasses}`}>{title}</h3>
      <div className="mt-1 text-caption text-content-secondary">{children}</div>
    </section>
  );
}
