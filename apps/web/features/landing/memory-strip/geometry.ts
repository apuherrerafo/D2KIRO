import type { Pt } from "./types";

const r = (n: number) => Math.round(n * 10) / 10;

/** Catmull-Rom through the given points, as one SVG path. Evidence nodes sit ON the points, so they stay on the line. */
export function smoothPath(points: readonly Pt[]): string {
  if (points.length < 2) return "";
  const at = (i: number): Pt => points[Math.min(points.length - 1, Math.max(0, i))];
  let d = `M${r(points[0][0])} ${r(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${r(c1[0])} ${r(c1[1])} ${r(c2[0])} ${r(c2[1])} ${r(p2[0])} ${r(p2[1])}`;
  }
  return d;
}

export function polygonPath(points: readonly Pt[]): string {
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const n = points.length;
  let d = "";
  for (let i = 0; i < n; i += 1) {
    const a = points[i], b = points[(i + 1) % n];
    const m = mid(a, b);
    d += i === 0 ? `M${r(m[0])} ${r(m[1])}` : "";
    const next = mid(b, points[(i + 2) % n]);
    d += ` Q${r(b[0])} ${r(b[1])} ${r(next[0])} ${r(next[1])}`;
  }
  return `${d} Z`;
}

/** The four corners of a band of `width` along from→to. */
export function bandCorners(from: Pt, to: Pt, width: number): Pt[] {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (width / 2), ny = (dx / len) * (width / 2);
  return [[from[0] + nx, from[1] + ny], [to[0] + nx, to[1] + ny], [to[0] - nx, to[1] - ny], [from[0] - nx, from[1] - ny]];
}

export const pct = (v: number, total: number) => `${r((v / total) * 100)}%`;
