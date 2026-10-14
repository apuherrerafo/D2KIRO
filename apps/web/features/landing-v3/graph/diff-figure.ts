/* LANDING V3 · Differentiation figure: general context vs player context.
   Two states of one figure: the generic ranking with the Coach WATCHING, then (when the figure reaches the reading band, `.is-in` on
   the figure) the Coach turns ANALYZING and a cyan path starts toward the ranking from YOUR GAMES. The ranking itself does not change here.
   Built client-side when the figure is about to be reached. */

import { DIFF } from "../copy";
import { HEROES, ranking, type HeroKey } from "../fixture";
import { coachUrl } from "./model";
import type { StageKind } from "./model";
import { curve, drawMarks, el, portrait, text, type NodeSpec, type Point } from "./svg-kit";

const anchorRight = (n: NodeSpec): Point => [n.x + n.w / 2, n.y];

function drawNode(parent: Element, n: NodeSpec, className = ""): SVGGElement {
  const g = el("g", { class: `g-node ${n.cls ?? ""} ${className}`.trim(), transform: `translate(${n.x - n.w / 2},${n.y - n.h / 2})` }, parent);
  el("rect", { width: n.w, height: n.h, rx: 6, class: "g-box" }, g);
  let tx = 14;
  if (n.tiles) {
    n.tiles.forEach((hero, i) => {
      const x = 9 + i * 31;
      const y = (n.h - 28) / 2;
      drawMarks(g, [{ hero }], x, y, 28, 0, false);
      tx = x + 28 + 10;
    });
  }
  if (n.icon === "games") {
    drawMarks(g, [{ icon: "games" }], 9, n.h / 2 - 14, 28, 0, false);
    tx = 44;
  }
  if (n.icon === "you") {
    el("circle", { cx: 22, cy: n.h / 2, r: 10, fill: "none", stroke: "var(--ink)", "stroke-width": 1.5 }, g);
    text(g, 22, n.h / 2 + 4, "2", "g-tile-t", { style: "fill: var(--ink)" });
    tx = 40;
  }
  text(g, tx, n.sub ? n.h / 2 - 2 : n.h / 2 + 5, n.label, "g-lbl");
  if (n.sub) text(g, tx, n.h / 2 + 14, n.sub, "g-sub");
  return g;
}

export function buildDiffFigure(host: HTMLElement, kind: StageKind): void {
  host.replaceChildren();
  const T = kind === "tall";
  const W = T ? 340 : 700;
  const H = T ? 560 : 430;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: `diff-svg ${kind}`, role: "img", "aria-label": DIFF.figureLabel }, host);
  const edges = el("g", {}, svg);
  const nodes = el("g", {}, svg);
  const card = T ? { x: 0, y: 158, w: 340, h: 228 } : { x: 420, y: 50, w: 280, h: 216 };
  text(svg, 0, 14, "GENERAL CONTEXT", "g-mono");

  const general: NodeSpec[] = T
    ? [
        { x: 82, y: 56, w: 164, h: 40, label: "You · Mid", icon: "you", cls: "g-you" },
        { x: 258, y: 56, w: 164, h: 40, label: "Axe", tiles: ["AX"] },
        { x: 82, y: 104, w: 164, h: 40, label: "Slark", tiles: ["SL"] },
        { x: 258, y: 104, w: 164, h: 40, label: "Your supports", tiles: ["ES", "CM"] },
      ]
    : [
        { x: 80, y: 60, w: 160, h: 44, label: "You · Mid", sub: "Position 2", icon: "you", cls: "g-you" },
        { x: 80, y: 120, w: 160, h: 44, label: "Axe", sub: "Enemy", tiles: ["AX"] },
        { x: 80, y: 180, w: 160, h: 44, label: "Slark", sub: "Enemy", tiles: ["SL"] },
        { x: 95, y: 240, w: 190, h: 44, label: "Your supports", tiles: ["ES", "CM"] },
      ];
  if (T) el("path", { d: `M170,40 V${card.y}`, class: "e", stroke: "var(--line-strong)", "stroke-width": 1.2 }, edges);
  general.forEach((n) => {
    if (!T) el("path", { d: curve(anchorRight(n), [card.x, card.y + 48 + (n.y - 60) * 0.55]), class: "e", stroke: "var(--line-strong)", "stroke-width": 1.2 }, edges);
    drawNode(nodes, n);
  });

  // the generic ranking: FOR ANYONE
  const cg = el("g", { transform: `translate(${card.x},${card.y})` }, nodes);
  el("rect", { width: card.w, height: card.h, rx: 6, class: "g-box" }, cg);
  text(cg, 16, 26, "FOR ANYONE", "g-mono", { style: "fill: var(--ink)" });
  text(cg, card.w - 16, 26, "TOP 3", "g-mono", { "text-anchor": "end" });
  ranking("anyone").forEach((c, i) => {
    const y = 44 + i * (T ? 60 : 56);
    const h = T ? 52 : 48;
    const hero: HeroKey = c.hero;
    el("rect", { x: 10, y, width: card.w - 20, height: h, rx: 5, fill: "var(--panel)", stroke: "var(--line)" }, cg);
    portrait(cg, hero, 20, y + (h - 32) / 2, 32, 4);
    text(cg, 64, y + h / 2 + 5, HEROES[hero].name, "g-lbl");
    text(cg, card.w - 22, y + h / 2 + 8, String(c.anyone.fit), "g-lbl", { "text-anchor": "end", style: "font: 700 22px var(--f-display)" });
  });

  // player context: YOUR GAMES, with a cyan path that starts toward the ranking and fades before it arrives
  text(svg, 0, T ? 420 : 322, "PLAYER CONTEXT", "g-mono", { style: "fill: var(--cyan)" });
  const games: NodeSpec = T
    ? { x: 86, y: 484, w: 172, h: 48, label: "Your games", icon: "games" }
    : { x: 80, y: 372, w: 160, h: 48, label: "Your games", icon: "games" };
  const gg = drawNode(nodes, games, "dg-games");
  text(gg, 44, games.h / 2 + 14, "Not read yet", "g-sub dg-w");
  text(gg, 44, games.h / 2 + 14, "Reading", "g-sub dg-a", { style: "fill: var(--cyan)" });
  gg.querySelector(".g-lbl")?.setAttribute("y", String(games.h / 2 - 2));
  const gradId = `dg-${kind}`;
  const defs = el("defs", {}, svg);
  const grad = el(
    "linearGradient",
    T ? { id: gradId, x1: 0, y1: games.y - games.h / 2, x2: 0, y2: card.y + card.h, gradientUnits: "userSpaceOnUse" } : { id: gradId, x1: 160, y1: 0, x2: 560, y2: 0, gradientUnits: "userSpaceOnUse" },
    defs,
  );
  el("stop", { offset: "0", style: "stop-color: var(--cyan)" }, grad);
  el("stop", { offset: ".55", style: "stop-color: var(--cyan)", "stop-opacity": ".8" }, grad);
  el("stop", { offset: "1", style: "stop-color: var(--cyan)", "stop-opacity": ".06" }, grad);
  const pathD = T
    ? `M${games.x},${games.y - games.h / 2} L${games.x},${card.y + card.h + 6}`
    : curve(anchorRight(games), [card.x + 110, card.y + card.h + 8], [[330, 372], [card.x + 110, 372]]);
  el("path", { d: pathD, class: "e dg-path", pathLength: 1, stroke: `url(#${gradId})`, "stroke-width": 2.5 }, edges);

  // the Coach: watching first, analyzing once the figure is in the reading band
  const cs = T ? 112 : 130;
  const cx = T ? 284 : 625;
  const cy = T ? 482 : 345;
  el("image", { href: coachUrl("watching-r"), x: cx - cs / 2, y: cy - cs / 2, width: cs, height: cs, class: "dg-w" }, nodes);
  el("image", { href: coachUrl("analyzing-ld"), x: cx - cs / 2, y: cy - cs / 2, width: cs, height: cs, class: "dg-a" }, nodes);
  const sg = el("g", { transform: `translate(${cx - 48},${cy + cs / 2 + (T ? -4 : 0)})` }, nodes);
  el("rect", { x: 0, y: -12, width: 98, height: 22, rx: 11, fill: "var(--raise)", stroke: "var(--line)" }, sg);
  el("circle", { cx: 12, cy: -1, r: 3, fill: "var(--muted)", class: "dg-w" }, sg);
  el("circle", { cx: 12, cy: -1, r: 3, fill: "var(--cyan)", class: "dg-a" }, sg);
  text(sg, 22, 3, "WATCHING", "g-mono dg-w", { style: "font-size: 9.5px" });
  text(sg, 22, 3, "ANALYZING", "g-mono dg-a", { style: "font-size: 9.5px" });
}
