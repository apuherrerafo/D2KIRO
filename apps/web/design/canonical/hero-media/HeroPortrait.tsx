"use client";

import { useState } from "react";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import {
  getCanonicalHero,
  isAllowedHeroImgHost,
  type CanonicalHero,
  type PrimaryAttribute,
} from "./hero-adapter";
import "./hero-media.css";

export type PortraitSize = "xs" | "sm" | "md" | "lg" | "xl" | "fill";

export interface HeroPortraitProps {
  /**
   * Hero object (CanonicalHero or HeroMeta from product runtime),
   * hero ID (number), or hero localized name (string).
   */
  hero?: CanonicalHero | HeroMeta | number | string | null;
  /** Explicit hero name if hero object is omitted */
  name?: string;
  /** Explicit hero id if hero object is omitted */
  heroId?: number;
  /** Explicit image URL from Valve CDN */
  imgUrl?: string;
  /** Primary attribute accent ("str" | "agi" | "int" | "all") */
  attribute?: PrimaryAttribute;
  /** Portrait visual scale */
  size?: PortraitSize;
  /** Whether to render the name overlay plate at the bottom (default: true for md/lg/xl/fill) */
  showPlate?: boolean;
  /** Highlighted / lit state for strategic attention */
  lit?: boolean;
  /** Banned state with grayscale and strikethrough treatment */
  banned?: boolean;
  /** Accessible alt text */
  alt?: string;
  /** Optional container class name */
  className?: string;
  /** Callback fired when the image fails to load and switches to neutral fallback */
  onImageError?: () => void;
}

const DEFAULT_PLATE_SIZES: ReadonlySet<PortraitSize> = new Set(["md", "lg", "xl", "fill"]);

/**
 * HeroPortrait — Canonical media primitive for large draft and marketing hero portraits.
 *
 * Image-dominant 16:9 presentation, optional name overlay plate, Dota attribute color rail.
 * Reuses existing Valve CDN allowlist validation. Never renders invented skulls or fantasy glyphs.
 *
 * Note: Internal Storybook use does NOT imply public marketing approval.
 */
export function HeroPortrait({
  hero,
  name,
  heroId,
  imgUrl,
  attribute,
  size = "lg",
  showPlate,
  lit = false,
  banned = false,
  alt,
  className = "",
  onImageError,
}: HeroPortraitProps) {
  const [loadFailed, setLoadFailed] = useState(false);

  // Resolve hero metadata
  const resolved = getCanonicalHero(hero ?? heroId ?? name);
  const displayName = name ?? resolved?.localizedName ?? (heroId ? `Hero #${heroId}` : "Hero");
  const resolvedAttr = attribute ?? resolved?.primaryAttr ?? "all";
  const sourceUrl = imgUrl ?? resolved?.imgUrl ?? null;
  const isUrlAllowed = isAllowedHeroImgHost(sourceUrl);
  const showImage = isUrlAllowed && !loadFailed && sourceUrl;

  const renderPlate = showPlate ?? DEFAULT_PLATE_SIZES.has(size);
  const accessibleLabel = alt ?? (showImage ? `${displayName} portrait` : `${displayName} (Art pending)`);

  function handleImageError() {
    setLoadFailed(true);
    onImageError?.();
  }

  // alt="" = decorative (the parent, e.g. HeroDraftSlot, already names the hero): hide it instead of
  // exposing an unnamed role="img" (axe: role-img-alt).
  const decorative = alt === "";

  return (
    <span
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? "true" : undefined}
      aria-label={decorative ? undefined : accessibleLabel}
      className={`chm-portrait ${className}`.trim()}
      data-size={size}
      data-attr={resolvedAttr}
      data-lit={lit ? "true" : "false"}
      data-banned={banned ? "true" : "false"}
      data-art={showImage ? "image" : "fallback"}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- host validated against Valve CDN allowlist
        <img
          src={sourceUrl}
          alt=""
          className="chm-portrait-img"
          onError={handleImageError}
        />
      ) : (
        /* Honest, neutral missing-art state. NEVER invented skulls or fantasy glyphs. */
        <span className="chm-portrait-fallback" aria-hidden="true">
          <span className="chm-portrait-fallback-badge">Art pending</span>
        </span>
      )}

      {/* Vignette shade for contrast with plate text */}
      <span className="chm-portrait-shade" aria-hidden="true" />

      {/* Name plate */}
      {renderPlate ? (
        <span className="chm-portrait-plate" aria-hidden="true">
          <span className="chm-portrait-name">{displayName}</span>
        </span>
      ) : null}

      {/* Dota attribute accent rail */}
      <i className="chm-portrait-rail" aria-hidden="true" />
    </span>
  );
}
