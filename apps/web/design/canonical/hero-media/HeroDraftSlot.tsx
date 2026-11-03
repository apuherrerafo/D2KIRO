"use client";

import type { KeyboardEvent } from "react";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import {
  getCanonicalHero,
  type CanonicalHero,
  type PrimaryAttribute,
} from "./hero-adapter";
import { HeroPortrait, type PortraitSize } from "./HeroPortrait";
import "./hero-media.css";

/* DS V1.1 · state grammar (Council C + A, CONSENSUS; see docs/design-system-v1/council-v1.1/SYNTHESIS.md).
   The art is never covered: every state lives OUTSIDE the image — ink brackets (hover), canonical focus
   (ring + brackets + node), a spectral segment on the bottom edge (selected), a hanging notch + 1 px
   spectral edge + one acquire (recommended), a closed ink perimeter only (confirmed — human lock; the lock
   glyph is unresolved, so none is drawn), grayscale + strike (banned), dashed neutral (unknown). No pulse, no amber / emerald. */
export type DraftSlotState = "selected" | "available" | "banned" | "unknown" | "recommended" | "confirmed";
export type DraftSlotSize = "sm" | "md" | "lg" | "fill";
/** Forced specimen states for the Master board. Same CSS rule as the real pseudo-class. */
export type DraftSlotPreview = "hover" | "focus";

export interface HeroDraftSlotProps {
  /**
   * Hero object (CanonicalHero or HeroMeta from product runtime),
   * hero ID (number), or hero localized name (string).
   * In 'unknown' state, hero can be omitted or null.
   */
  hero?: CanonicalHero | HeroMeta | number | string | null;
  /** Draft slot state treatment */
  state: DraftSlotState;
  /** Role label (e.g., "Pos 1 Carry", "Pos 2 Mid", "Offlane", etc.) */
  role?: string;
  /** Dota 2 position number (1..5) */
  position?: 1 | 2 | 3 | 4 | 5;
  /** Display size */
  size?: DraftSlotSize;
  /** Whether to show the role label (default: true) */
  showRole?: boolean;
  /** Whether to show the state badge (default: true) */
  showStateBadge?: boolean;
  /** Optional click handler (e.g., when clicking an available slot to pick) */
  onClick?: () => void;
  /** Forced hover / focus for specimens. */
  preview?: DraftSlotPreview;
  /** Accessible label override */
  alt?: string;
  /** Optional container class name */
  className?: string;
}

const POSITION_ROLE_LABELS: Record<number, string> = {
  1: "Pos 1 Carry",
  2: "Pos 2 Mid",
  3: "Pos 3 Offlane",
  4: "Pos 4 Support",
  5: "Pos 5 Hard Support",
};

const STATE_BADGE_LABELS: Record<DraftSlotState, string> = {
  selected: "Selected",
  available: "Available",
  banned: "Banned",
  unknown: "Unknown",
  recommended: "Recommended",
  confirmed: "Locked in",
};

const INTERACTIVE_STATES: DraftSlotState[] = ["available", "selected", "recommended"];

function SlotHeader({ role, showRole, showStateBadge, state }: { role?: string; showRole: boolean; showStateBadge: boolean; state: DraftSlotState }) {
  const roleVisible = showRole && Boolean(role);
  if (!roleVisible && !showStateBadge) return null;
  return (
    <div className="chm-slot-header" aria-hidden="true">
      <span className="chm-slot-role">{roleVisible ? role : ""}</span>
      <StateBadge show={showStateBadge} state={state} />
    </div>
  );
}

function StateBadge({ show, state }: { show: boolean; state: DraftSlotState }) {
  if (!show) return null;
  return (
    <span className="chm-slot-state-badge" data-state={state}>
      {STATE_BADGE_LABELS[state]}
    </span>
  );
}

/**
 * HeroDraftSlot — Canonical media primitive combining hero portrait with draft role and state treatments.
 * Never renders invented skulls or fantasy glyphs.
 */
export function HeroDraftSlot({
  hero,
  state,
  role,
  position,
  size = "md",
  showRole = true,
  showStateBadge = true,
  onClick,
  preview,
  alt,
  className = "",
}: HeroDraftSlotProps) {
  const isUnknown = state === "unknown";
  const resolved = isUnknown ? null : getCanonicalHero(hero);
  const displayName = resolved?.localizedName ?? (isUnknown ? "Unknown Hero" : "Hero");

  const effectiveRole = role ?? (position ? POSITION_ROLE_LABELS[position] : undefined);
  const stateBadgeText = STATE_BADGE_LABELS[state];

  const portraitSize: PortraitSize = size === "fill" ? "fill" : size;

  const accessibleLabel =
    alt ??
    `${displayName} (${effectiveRole ?? "Slot"} - ${stateBadgeText})`;

  const isInteractive = INTERACTIVE_STATES.includes(state) && Boolean(onClick);
  const focusable = isInteractive || preview === "focus";

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick?.();
    }
  }

  return (
    <div
      role={isInteractive ? "button" : "group"}
      tabIndex={focusable ? 0 : undefined}
      aria-label={accessibleLabel}
      aria-disabled={state === "banned" ? "true" : undefined}
      onClick={isInteractive ? onClick : undefined}
      onKeyDown={isInteractive ? handleKeyDown : undefined}
      className={`chm-slot ${className}`.trim()}
      data-interactive={isInteractive ? "true" : "false"}
      data-preview={preview}
      data-state={state}
      data-size={size}
    >
      <SlotHeader role={effectiveRole} showRole={showRole} showStateBadge={showStateBadge} state={state} />

      <div className="chm-slot-media">
        <HeroPortrait
          empty={isUnknown}
          hero={isUnknown ? null : resolved}
          name={isUnknown ? "Open Slot" : displayName}
          attribute={isUnknown ? ("uni" as PrimaryAttribute) : resolved?.primaryAttr}
          size={portraitSize}
          showPlate={!isUnknown}
          banned={state === "banned"}
          alt=""
        />
        <span className="chm-slot-frame" aria-hidden="true"><i /><i /><i /><i /><b /></span>
        <span className="chm-slot-seg" aria-hidden="true" />
      </div>
    </div>
  );
}
