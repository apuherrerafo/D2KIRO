/* LANDING V3 · tiny SVG helpers shared by the two imperative figures (the Differentiation figure and the living decision graph).
   Both figures are built client-side, only when they are about to be reached, so their Coach stills are not fetched at page entry.
   Hero art is the canonical media: the portrait URL comes from the same `getCanonicalHero` the DOM's HeroIcon uses. */

import { getCanonicalHero } from "@/design/canonical/hero-media/hero-adapter";
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

let portraitSeq = 0;

/** A real hero portrait (canonical art, Valve CDN allow-list) cropped to a rounded square, with its attribute rail underneath as a hairline.
    `class` lets the stylesheet light it (`.g-portrait[data-lit]`). Missing art falls back to a neutral plate, never an invented glyph. */
export function portrait(parent: Element, hero: HeroKey, x: number, y: number, size: number, rx = 4): SVGGElement {
  const g = el("g", { class: "g-portrait", "data-hero": hero }, parent);
  const canonical = getCanonicalHero(HEROES[hero].name);
  el("rect", { x, y, width: size, height: size, rx, class: "g-portrait-plate" }, g);
  if (canonical) {
    const id = `lv3-pt-${(portraitSeq += 1)}`;
    const clip = el("clipPath", { id }, g);
    el("rect", { x, y, width: size, height: size, rx }, clip);
    el("image", { href: canonical.imgUrl, x, y, width: size, height: size, preserveAspectRatio: "xMidYMid slice", "clip-path": `url(#${id})` }, g);
    el("rect", { x, y, width: size, height: size, rx, class: "g-portrait-edge", "data-attr": canonical.primaryAttr }, g);
  }
  return g;
}

/** The decorative marks inside an input box, laid out left to right. */
export function drawMarks(g: Element, marks: ReadonlyArray<{ hero?: HeroKey; icon?: "you" | "games" }>, x0: number, y0: number, size: number, gap: number, small: boolean): void {
  marks.forEach((mark, i) => {
    const x = x0 + i * (size + gap);
    if (mark.hero) {
      portrait(g, mark.hero, x, y0, size, 4);
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

/** The canonical spectrum (cyan · pink · lime) the scatter fragments and Coach particles borrow. */
export const SPECTRUM = ["var(--cyan)", "var(--pink)", "var(--lime)", "var(--cyan)", "var(--pink)", "var(--lime)"] as const;

/** Park–Miller: the same fragments every time, so the figure never reshuffles between renders. */
export function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}
