"use client";

import { useState } from "react";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import {
  getCanonicalHero,
  hasImageFailed,
  isAllowedHeroImgHost,
  type CanonicalHero,
  type PrimaryAttribute,
} from "./hero-adapter";
import "./hero-media.css";

export type IconSize = "xs" | "sm" | "md" | "lg" | "xl" | number;

export interface HeroIconProps {
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
  /** Compact icon size preset or pixel number */
  size?: IconSize;
  /** Highlighted / lit state */
  lit?: boolean;
  /** Banned state with grayscale treatment */
  banned?: boolean;
  /** Accessible alt text */
  alt?: string;
  /** Optional container class name */
  className?: string;
  /** Callback fired when image fails to load */
  onImageError?: () => void;
}

const PRESET_SIZES: Record<string, number> = {
  xs: 20,
  sm: 28,
  md: 36,
  lg: 48,
  xl: 64,
};

/**
 * HeroIcon — Small square/compact version of canonical hero media.
 * For rows, chips, recommendations and dense compact UI.
 *
 * Reuses existing Valve CDN allowlist validation. Never renders invented skulls or fantasy glyphs.
 */
export function HeroIcon({
  hero,
  name,
  heroId,
  imgUrl,
  attribute,
  size = "lg",
  lit = false,
  banned = false,
  alt,
  className = "",
  onImageError,
}: HeroIconProps) {
  const [loadFailed, setLoadFailed] = useState(false);

  // Resolve hero metadata
  const resolved = getCanonicalHero(hero ?? heroId ?? name);
  const displayName = name ?? resolved?.localizedName ?? (heroId ? `Hero #${heroId}` : "Hero");
  const resolvedAttr = attribute ?? resolved?.primaryAttr ?? "all";
  const sourceUrl = imgUrl ?? resolved?.imgUrl ?? null;
  const isUrlAllowed = isAllowedHeroImgHost(sourceUrl);
  const showImage = isUrlAllowed && !loadFailed && sourceUrl;

  const accessibleLabel = alt ?? (showImage ? `${displayName} icon` : `${displayName} (No image)`);
  const initial = displayName.trim().charAt(0) || "?";

  // Determine size in pixels / preset
  const isPreset = typeof size === "string" && size in PRESET_SIZES;
  const customPx = typeof size === "number" ? size : (isPreset ? PRESET_SIZES[size] : 48);
  const style = typeof size === "number" ? { width: customPx, height: customPx } : undefined;

  function handleImageError() {
    setLoadFailed(true);
    onImageError?.();
  }

  function checkImage(img: HTMLImageElement | null) {
    if (hasImageFailed(img)) handleImageError();
  }

  return (
    <span
      role="img"
      aria-label={accessibleLabel}
      className={`chm-icon ${className}`.trim()}
      data-size={isPreset ? size : undefined}
      data-attr={resolvedAttr}
      data-lit={lit ? "true" : "false"}
      data-banned={banned ? "true" : "false"}
      data-art={showImage ? "image" : "fallback"}
      style={style}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- host validated against Valve CDN allowlist
        <img
          src={sourceUrl}
          alt=""
          className="chm-icon-img"
          onError={handleImageError}
          ref={checkImage}
        />
      ) : (
        /* Neutral missing-art state. NEVER invented skulls or fantasy glyphs. */
        <span className="chm-icon-fallback" aria-hidden="true">
          {initial}
        </span>
      )}
    </span>
  );
}
