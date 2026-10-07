import type { Pt } from "./types";

/* Local, deterministic resampling for the Memory Strip motion pass. Two paths with different point counts can't be
   interpolated point by point, so both are sampled ALONG THE CURVE they actually draw (the same Catmull-Rom as
   `smoothPath`, the same quadratic blob as `polygonPath`) into N equally spaced points. The samples lie on the rendered
   curve, so swapping to the exact path at the end of a transition is invisible. Not a path-animation framework. */

export const SAMPLE_N = 64;
const DENSE = 24;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerpPt = (a: Pt, b: Pt, t: number): Pt => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

/** Resample a dense polyline (open or closed) to `n` points equally spaced by arc length. */
function byArcLength(dense: readonly Pt[], n: number, closed: boolean): Pt[] {
  const pts = closed ? [...dense, dense[0]] : [...dense];
  const cum = [0];
  for (let i = 1; i < pts.length; i += 1) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1] || 1;
  const count = closed ? n : n - 1;
  const out: Pt[] = [];
  let seg = 1;
  for (let k = 0; k < n; k += 1) {
    const target = (k / count) * total;
    while (seg < cum.length - 1 && cum[seg] < target) seg += 1;
    const span = cum[seg] - cum[seg - 1] || 1;
    out.push(lerpPt(pts[seg - 1], pts[seg], Math.min(1, Math.max(0, (target - cum[seg - 1]) / span))));
  }
  return out;
}

/** Points along the same Catmull-Rom curve `smoothPath` draws. */
export function sampleOpen(points: readonly Pt[], n = SAMPLE_N): Pt[] {
  if (points.length < 2) return Array.from({ length: n }, () => (points[0] ?? [0, 0]) as Pt);
  const at = (i: number): Pt => points[Math.min(points.length - 1, Math.max(0, i))];
  const dense: Pt[] = [points[0]];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    for (let s = 1; s <= DENSE; s += 1) {
      const t = s / DENSE, u = 1 - t;
      dense.push([
        u * u * u * p1[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p2[0],
        u * u * u * p1[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p2[1],
      ]);
    }
  }
  return byArcLength(dense, n, false);
}

/** Points along the closed outline `polygonPath` draws, with a canonical start (top-most) and winding so two rings morph without twisting. */
export function sampleClosed(points: readonly Pt[], n = SAMPLE_N): Pt[] {
  const m = points.length;
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const dense: Pt[] = [];
  for (let i = 0; i < m; i += 1) {
    const start = mid(points[i], points[(i + 1) % m]);
    const ctrl = points[(i + 1) % m];
    const end = mid(points[(i + 1) % m], points[(i + 2) % m]);
    for (let s = 0; s < DENSE; s += 1) {
      const t = s / DENSE, u = 1 - t;
      dense.push([u * u * start[0] + 2 * u * t * ctrl[0] + t * t * end[0], u * u * start[1] + 2 * u * t * ctrl[1] + t * t * end[1]]);
    }
  }
  const ring = byArcLength(dense, n, true);
  const area = ring.reduce((sum, p, i) => sum + (p[0] * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * p[1]), 0);
  const wound = area < 0 ? [...ring].reverse() : ring;
  let top = 0;
  wound.forEach((p, i) => { if (p[1] < wound[top][1]) top = i; });
  return [...wound.slice(top), ...wound.slice(0, top)];
}

export const lerpPts = (a: readonly Pt[], b: readonly Pt[], t: number): Pt[] => a.map((p, i) => lerpPt(p, b[i], t));

/** The first `fraction` of a sampled path (a path drawing itself from its starting point). */
export function revealPts(sample: readonly Pt[], fraction: number): Pt[] {
  const f = Math.min(1, Math.max(0, fraction)) * (sample.length - 1);
  const whole = Math.floor(f);
  const head = sample.slice(0, whole + 1);
  if (whole < sample.length - 1) head.push(lerpPt(sample[whole], sample[whole + 1], f - whole));
  return head;
}

/** Closest point of a sampled polyline to `p`. */
export function nearestOn(sample: readonly Pt[], p: Pt): Pt {
  let best = sample[0], bestD = Infinity;
  for (const q of sample) {
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
}

export const centroid = (points: readonly Pt[]): Pt => [
  points.reduce((s, p) => s + p[0], 0) / points.length,
  points.reduce((s, p) => s + p[1], 0) / points.length,
];

/** A sampled polyline as an SVG path (straight segments — dense enough to read as the curve). */
export function polylinePath(points: readonly Pt[], close = false): string {
  if (points.length === 0) return "";
  const r = (n: number) => Math.round(n * 10) / 10;
  return `M${points.map((p) => `${r(p[0])} ${r(p[1])}`).join(" L")}${close ? " Z" : ""}`;
}
