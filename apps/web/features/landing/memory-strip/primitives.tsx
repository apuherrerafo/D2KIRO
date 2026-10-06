import type { CSSProperties } from "react";
import { HeroIcon } from "@/design/canonical/hero-media";
import { bandCorners, pct, polygonPath, smoothPath } from "./geometry";
import {
  MEMORY_VIEWBOX,
  type ContradictionItem,
  type EchoItem,
  type EvidenceItem,
  type EvidenceLabel,
  type MatchupItem,
  type NodeItem,
  type OriginItem,
  type PathItem,
  type Pt,
  type RegionItem,
  type RoleItem,
} from "./types";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

const at = (p: Pt): Vars => ({ left: pct(p[0], MEMORY_VIEWBOX.w), top: pct(p[1], MEMORY_VIEWBOX.h) });

/** Where an item's label hangs from, and how far (in scene units) it keeps from the item itself. */
export function labelAnchor(item: EvidenceItem): { point: Pt; gap: number } | null {
  switch (item.kind) {
    case "origin": return { point: item.at, gap: 38 };
    case "echo": return { point: item.at, gap: item.active ? 26 : 20 };
    case "node": return { point: item.at, gap: 12 };
    case "contradiction": return { point: item.at, gap: 16 };
    case "role": return { point: item.at, gap: 12 };
    case "region": {
      const xs = item.points.map((p) => p[0]);
      const top = Math.min(...item.points.map((p) => p[1]));
      return { point: [xs.reduce((a, b) => a + b, 0) / xs.length, top], gap: 10 };
    }
    default: return null;
  }
}

/* ───────── SVG layer ───────── */

export function UnresolvedRegion({ item }: { item: RegionItem }) {
  return <path className="ms-region" data-evidence={item.id} d={polygonPath(item.points)} />;
}

/** Retained = solid · uncertain = dashed and stops in an open ring · undertrace = thin and faint · qualified = ribbon (halo + core). */
export function EvidencePath({ item }: { item: PathItem }) {
  const d = smoothPath(item.points);
  const last = item.points[item.points.length - 1];
  return (
    <g className="ms-path" data-evidence={item.id} data-relation={item.relation} data-tone={item.tone}>
      {item.relation === "qualified" && <path className="ms-path-halo" d={d} />}
      <path className="ms-path-core" d={d} />
      {item.terminal && <circle className="ms-terminal" cx={last[0]} cy={last[1]} r={4.5} />}
    </g>
  );
}

export function MatchupSliver({ item, patternId }: { item: MatchupItem; patternId: string }) {
  const corners = bandCorners(item.from, item.to, 16);
  const points = corners.map((p) => p.join(",")).join(" ");
  return (
    <g className="ms-matchup" data-evidence={item.id}>
      <polygon className="ms-matchup-body" points={points} />
      <polygon className="ms-matchup-hatch" points={points} fill={`url(#${patternId})`} />
      <line className="ms-matchup-edge" x1={corners[0][0]} y1={corners[0][1]} x2={corners[1][0]} y2={corners[1][1]} />
      <line className="ms-matchup-edge" x1={corners[3][0]} y1={corners[3][1]} x2={corners[2][0]} y2={corners[2][1]} />
    </g>
  );
}

const DIAMOND = "M0 -6 L6 0 L0 6 L-6 0 Z";
const CAPSULE = "M-9 -4 H9 A4 4 0 0 1 9 4 H-9 A4 4 0 0 1 -9 -4 Z";

export function EvidenceNode({ item }: { item: NodeItem }) {
  const shape = item.shape === "capsule" ? CAPSULE : DIAMOND;
  return (
    <path className="ms-node" data-evidence={item.id} data-tone={item.tone} data-shape={item.shape} d={shape}
      transform={`translate(${item.at[0]} ${item.at[1]})`} />
  );
}

/** Two halves of one diamond, pulled apart, with a stroke crossing the gap. Not a warning icon. */
export function ContradictionMarker({ item }: { item: ContradictionItem }) {
  return (
    <g className="ms-contradiction" data-evidence={item.id} transform={`translate(${item.at[0]} ${item.at[1]}) rotate(${item.angle}) scale(1.25)`}>
      <path className="ms-contradiction-half" d="M-2.5 -8 L-10.5 0 L-2.5 8 Z" />
      <path className="ms-contradiction-half" d="M2.5 -8 L10.5 0 L2.5 8 Z" />
      <line className="ms-contradiction-cut" x1={0} y1={-12} x2={0} y2={12} />
    </g>
  );
}

/** A directional chevron: the lane this decision is made in, pointing the way the draft is read. */
export function RoleMarker({ item }: { item: RoleItem }) {
  return (
    <g className="ms-role" data-evidence={item.id} transform={`translate(${item.at[0]} ${item.at[1]})`}>
      <path d="M-7 -5 L-1 0 L-7 5" />
      <path d="M0 -5 L6 0 L0 5" />
    </g>
  );
}

export function EvidenceDefs({ patternId }: { patternId: string }) {
  return (
    <defs>
      <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
        <line x1="0" y1="0" x2="0" y2="6" className="ms-hatch-line" />
      </pattern>
    </defs>
  );
}

/* ───────── HTML layer (hero art and editorial labels stay real DOM: crisp, selectable, translatable) ───────── */

export function OriginSeal({ item }: { item: OriginItem }) {
  return (
    <div className="ms-origin" data-evidence={item.id} style={at(item.at)}>
      <svg className="ms-origin-ring" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="31" className="ms-origin-outer" />
        <path d="M32 1 A31 31 0 0 1 63 32" className="ms-origin-arc" />
      </svg>
      <span className="ms-icon" data-role="origin"><HeroIcon heroId={item.heroId} size="lg" alt="" /></span>
    </div>
  );
}

export function HeroEcho({ item }: { item: EchoItem }) {
  return (
    <div className="ms-echo" data-evidence={item.id} data-tone={item.tone} data-active={item.active ? "true" : "false"} style={at(item.at)}>
      <span className="ms-icon" data-role="echo"><HeroIcon heroId={item.heroId} size="sm" alt="" /></span>
    </div>
  );
}

export function EvidenceLabelTag({ itemId, label, anchor, active }: { itemId: string; label: EvidenceLabel; anchor: { point: Pt; gap: number }; active: boolean }) {
  const style: Vars = { ...at(anchor.point), "--gap": anchor.gap };
  return (
    <p className="ms-label" data-for={itemId} data-side={label.side} data-active={active ? "true" : "false"} style={style}>
      {label.kicker && <span className="ms-label-kicker">{label.kicker}</span>}
      <span className="ms-label-text">{label.text}</span>
    </p>
  );
}
