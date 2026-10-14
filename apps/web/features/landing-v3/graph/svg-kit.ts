/* LANDING V3 · tiny SVG helpers shared by the two imperative figures (the Differentiation figure and the living decision graph).
   Both figures are built client-side, only when they are about to be reached, so their Coach stills are not fetched at page entry. */

import { HEROES, type HeroKey } from "../fixture";

const NS = "http://www.w3.org/2000/svg";

export type Attrs = Record<string, string | number | undefined>;

export function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs, parent?: Element): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const key of Object.keys(attrs)) {
    const value = attrs[key];
    if (value !== undefined) node.setAttribute(key, String(value));
  }
  if (parent) parent.appendChild(node);
  return node;
}

export function text(parent: Element, x: number, y: number, content: string, cls: string, extra?: Attrs): SVGTextElement {
  const node = el("text", { x, y, class: cls, ...extra }, parent);
  node.textContent = content;
  return node;
}

export interface NodeSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  tiles?: readonly HeroKey[];
  icon?: "you" | "games";
  cls?: string;
}

/** The decorative marks inside an input box, laid out left to right. */
export function drawMarks(g: Element, marks: ReadonlyArray<{ hero?: HeroKey; icon?: "you" | "games" }>, x0: number, y0: number, size: number, gap: number, small: boolean): void {
  marks.forEach((mark, i) => {
    const x = x0 + i * (size + gap);
    if (mark.hero) {
      el("rect", { x, y: y0, width: size, height: size, rx: 4, fill: HEROES[mark.hero].tile, class: "g-tile" }, g);
      text(g, x + size / 2, y0 + size * 0.66, mark.hero, "g-tile-t", small ? { style: "font-size:9px" } : undefined);
      return;
    }
    if (mark.icon === "you") {
      el("circle", { cx: x + size / 2, cy: y0 + size / 2, r: size / 2 - 1.5, fill: "none", stroke: "var(--ink)", "stroke-width": 1.5 }, g);
      text(g, x + size / 2, y0 + size * 0.68, "2", "g-tile-t", { style: `fill:var(--ink);${small ? "font-size:11px" : ""}` });
      return;
    }
    [0, 1, 2].forEach((j) => el("rect", { x: x + 3, y: y0 + size * 0.26 + j * size * 0.22, width: size * 0.62 - j * size * 0.15, height: size * 0.1, rx: 1.5, fill: "var(--cyan)", opacity: 1 - j * 0.25 }, g));
  });
}

export type Point = readonly [number, number];

/** A smooth horizontal-leaning curve; `c` gives explicit control points. */
export function curve(a: Point, b: Point, c?: readonly [Point, Point]): string {
  const controls = c ?? ([[a[0] + (b[0] - a[0]) * 0.5, a[1]], [b[0] - (b[0] - a[0]) * 0.5, b[1]]] as const);
  return `M${a[0]},${a[1]} C${controls[0][0]},${controls[0][1]} ${controls[1][0]},${controls[1][1]} ${b[0]},${b[1]}`;
}

/** Brand colours as literals, for the places SVG paint servers cannot read a custom property (gradient stops). */
export const PAINT = { cyan: "#00718b" } as const;

/** Spectral colours the scatter fragments and Coach particles borrow. */
export const SPECTRUM = ["var(--cyan)", "var(--blue)", "var(--violet)", "var(--pink)", "var(--lime)", "var(--cyan-2)"] as const;

/** Park–Miller: the same fragments every time, so the figure never reshuffles between renders. */
export function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}
