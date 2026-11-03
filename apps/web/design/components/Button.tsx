import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps {
  /** Accessible label when children is non-textual. */
  "aria-label"?: string;
  /** Automatically focuses the button on initial mount if true. */
  autoFocus?: boolean;
  /** Exposes progress while preventing duplicate activation. */
  busy?: boolean;
  /** Button contents or label text. */
  children: ReactNode;
  /** Disables user interaction and keyboard activation. */
  disabled?: boolean;
  /** Click handler callback. */
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>["onClick"];
  /** HTML button type. Default is 'button' to avoid unintended form submission. */
  type?: "button" | "submit" | "reset";
  /** Visual emphasis variant. Primary is reserved for dominant decision. */
  variant?: "primary" | "secondary";
}

/**
 * @purpose Triggers an explicit user action with strict visual and accessibility semantics.
 * @a11y Preserves stable accessible name model, native disabled semantics, and visible focus indicator.
 * @a11y Respects prefers-reduced-motion by removing transition animations.
 * @canonical Use primary only for the single dominant decision on a surface; use secondary for alternatives.
 */
export function Button({
  "aria-label": ariaLabel,
  autoFocus,
  busy = false,
  children,
  disabled = false,
  onClick,
  type = "button",
  variant = "primary",
}: ButtonProps) {
  const isDisabled = disabled || busy;

  const baseClasses =
    "inline-flex items-center justify-center font-medium text-caption px-4 py-2 rounded-control transition-colors duration-150 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50 select-none";

  const variantClasses =
    variant === "primary"
      ? "bg-accent-primary text-surface-base hover:bg-accent-primary-hover active:bg-accent-primary-hover"
      : "border border-surface-border bg-transparent text-content-secondary hover:border-accent-primary hover:text-content-primary active:text-content-primary";

  return (
    <button
      aria-busy={busy ? "true" : undefined}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      className={`${baseClasses} ${variantClasses}`}
      disabled={isDisabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}
