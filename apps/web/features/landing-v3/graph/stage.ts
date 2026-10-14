/* LANDING V3 · the living decision graph stage (imperative SVG, built client-side).
   One persistent Draft A: the ranking rows ARE the graph's output column, so the ranking physically reorders at beat 6.
   `setBeat(k)` is a pure function of the beat. Each beat then plays on its own clock (CSS transitions, one short rAF for the
   reorder, a few light packets); nothing here is driven frame by frame from scroll position.
   Motion language: ATTRACT (edges draw toward the pick) · REPEL (pressure, losing support) · TETHER (the unfinished link to
   "no history yet") · GATHER (evidence converging) · SCATTER (Void Spirit's old links break into fragments) · SETTLE (the reorder).
   The Coach in the graph uses the approved memory-set stills, moved by transform; it is not a second Coach Motion engine. */

import { BEATS, GRAPH } from "../copy";
import { CANDIDATES, HEROES, type Candidate, type CandidateId, type HeroKey } from "../fixture";
import {
  COACH,
  COACH_POSES,
  EDGES,
  NODE_VISIBILITY,
  ROW_STATE,
  SUB,
  TAGS,
  TALL_EDGES,
  clamp,
  coachUrl,
  easeInOut,
  lerp,
  rowFit,
  rowSlot,
  type CoachPose,
  type EdgeSpec,
  type InputId,
  type StageKind,
  type TagTone,
} from "./model";
import { SPECTRUM, curve, drawMarks, el, seeded, text, type Point } from "./svg-kit";

export interface Stage {
  svg: SVGSVGElement;
  setBeat: (k: number, instant?: boolean) => void;
  destroy: () => void;
  /** Screen-space geometry of the ranking column: lines the lime thread up with the payoff card. */
  column: () => { x: number; bottom: number } | null;
}

interface InputBox {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  tiles?: readonly HeroKey[];
  icon?: "you" | "games";
}

interface InputNode {
  g: SVGGElement;
  s: InputBox;
}

interface Row {
  c: Candidate;
  g: SVGGElement;
  rk: SVGTextElement;
  sb: SVGTextElement;
  sc: SVGTextElement;
  y: number;
  dx: number;
  s: number;
  shown: number;
}

interface EdgeRuntime {
  spec: EdgeSpec;
  path: SVGPathElement;
  halo: SVGPathElement | null;
  state: string;
}

const TAG_COLOR: Record<TagTone, string> = { cyan: "var(--cyan)", pink: "var(--pink)", mut: "var(--muted)", faint: "var(--faint)" };

export function makeStage(host: HTMLElement, kind: StageKind, still: boolean, reduced: boolean): Stage {
  const T = kind === "tall";
  const mv = !still && !reduced;
  const W = T ? 358 : 1100;
  const VY = T ? 44 : 0;
  const VH = T ? 440 : 640;
  const RX = T ? 104 : 790;
  const RW = T ? 196 : 300;
  const RH = T ? 72 : 84;
  const SLOT = T ? [138, 256, 374] : [160, 300, 440];
  const CS = T ? 62 : 112;

  host.replaceChildren();
  const svg = el("svg", { viewBox: `0 ${VY} ${W} ${VH}`, class: `gsvg ${kind}${still ? " still" : ""}`, role: "img", "aria-label": "" }, host);
  const gE = el("g", {}, svg);
  const gP = el("g", {}, svg);
  const gN = el("g", {}, svg);
  const gR = el("g", {}, svg);
  const gT = el("g", {}, svg);
  const gC = el("g", {}, svg);

  const INPUTS: Record<InputId, InputBox> = T
    ? {
        axe: { x: 34, y: 82, w: 60, h: 50, label: "Axe", tiles: ["AX"] },
        slark: { x: 34, y: 152, w: 60, h: 50, label: "Slark", tiles: ["SL"] },
        you: { x: 34, y: SLOT[1], w: 60, h: 50, label: "You · Mid", icon: "you" },
        sup: { x: 34, y: 388, w: 60, h: 50, label: "Supports", tiles: ["ES", "CM"] },
        games: { x: 34, y: 462, w: 60, h: 50, label: "Games", icon: "games" },
      }
    : {
        axe: { x: 130, y: 100, w: 150, h: 52, label: "Axe", sub: "Enemy", tiles: ["AX"] },
        slark: { x: 250, y: 192, w: 150, h: 52, label: "Slark", sub: "Enemy", tiles: ["SL"] },
        you: { x: 115, y: SLOT[1], w: 150, h: 52, label: "You · Mid", sub: "Position 2", icon: "you" },
        sup: { x: 178, y: 424, w: 246, h: 56, label: "Your supports", sub: "Earth Spirit · Crystal Maiden", tiles: ["ES", "CM"] },
        games: { x: 290, y: 534, w: 190, h: 52, label: "Your games", sub: "Your match history", icon: "games" },
      };

  // —— inputs
  const nodes = {} as Record<InputId, InputNode>;
  const placeInput = (id: InputId) => {
    const n = nodes[id];
    n.g.style.transform = `translate(${n.s.x - n.s.w / 2}px,${n.s.y - n.s.h / 2}px)`;
  };
  const drawInput = (id: InputId, s: InputBox) => {
    const g = el("g", { class: "gn", "data-id": id, "data-v": "x" }, gN);
    el("rect", { width: s.w, height: s.h, rx: 6, class: "g-box" }, g);
    const marks = s.tiles ? s.tiles.map((hero) => ({ hero })) : [{ icon: s.icon }];
    const size = T ? 22 : 28;
    const gap = T ? 4 : 3;
    const total = marks.length * size + (marks.length - 1) * gap;
    const x0 = T ? (s.w - total) / 2 : 10;
    const y0 = T ? 6 : (s.h - size) / 2;
    drawMarks(g, marks, x0, y0, size, gap, T);
    if (T) {
      text(g, s.w / 2, s.h - 7, s.label, "g-lbl", { "text-anchor": "middle" });
    } else {
      const tx = x0 + total + 10;
      text(g, tx, s.sub ? s.h / 2 - 2 : s.h / 2 + 5, s.label, "g-lbl");
      if (s.sub) text(g, tx, s.h / 2 + 14, s.sub, "g-sub");
    }
    nodes[id] = { g, s };
    placeInput(id);
  };

  // —— edges (geometry is set once the rows exist)
  const rows = {} as Record<CandidateId, Row>;
  const edges: Record<string, EdgeRuntime> = {};
  for (const spec of EDGES) {
    const halo = spec.halo ? el("path", { class: "e halo draw", "data-s": "x" }, gE) : null;
    const path = el("path", { class: `e ${spec.kind}`, "data-s": "x" }, gE);
    edges[spec.id] = { spec, path, halo, state: "x" };
  }
  const inputPort = (id: InputId): Point => [nodes[id].s.x + nodes[id].s.w / 2, nodes[id].s.y];
  const rowPort = (r: Row): Point => [RX + r.dx, r.y];
  const drawEdges = () => {
    for (const id of Object.keys(edges)) {
      const e = edges[id];
      const d = curve(inputPort(e.spec.from), rowPort(rows[e.spec.to]));
      e.path.setAttribute("d", d);
      if (e.spec.kind === "draw") e.path.style.setProperty("--len", String(Math.ceil(e.path.getTotalLength()) + 2));
      if (e.halo) {
        e.halo.setAttribute("d", d);
        e.halo.style.setProperty("--len", String(Math.ceil(e.path.getTotalLength()) + 2));
      }
    }
  };

  // —— rows
  const headY = SLOT[0] - RH / 2 - (T ? 40 : 46);
  const head = el("g", { class: "rk-head", "data-k": "any", transform: `translate(${RX},${headY})` }, gT);
  el("rect", { class: "hb", width: RW, height: T ? 26 : 28, rx: T ? 13 : 14 }, head);
  const headT = text(head, RW / 2, T ? 17 : 18, GRAPH.topAnyone, "ht", { "text-anchor": "middle" });
  for (const c of CANDIDATES) {
    const g = el("g", { class: "gr", "data-id": c.id, "data-t": "" }, gR);
    el("rect", { width: RW, height: RH, rx: 8, class: "g-box" }, g);
    const ts = T ? 28 : 40;
    const tx = T ? 26 : 44;
    const rk = text(g, T ? 8 : 18, T ? RH / 2 + 3 : RH / 2 + 4, "#1", "rk");
    el("rect", { x: tx, y: T ? 12 : (RH - ts) / 2, width: ts, height: ts, rx: 5, fill: HEROES[c.hero].tile, class: "g-tile" }, g);
    text(g, tx + ts / 2, (T ? 12 : (RH - ts) / 2) + ts * 0.62, c.hero, "g-tile-t", { style: T ? "font-size:10px" : "font-size:13px" });
    const nx = T ? 62 : 98;
    text(g, nx, T ? 27 : RH / 2 - 4, HEROES[c.hero].name, "nm");
    const sb = text(g, nx, T ? 47 : RH / 2 + 16, "", "sb");
    text(g, RW - (T ? 10 : 18), T ? 15 : RH / 2 - 16, "FIT", "fl");
    const sc = text(g, RW - (T ? 10 : 18), T ? 38 : RH / 2 + 14, String(c.anyone.fit), "sc");
    rows[c.id] = { c, g, rk, sb, sc, y: SLOT[c.anyone.slot], dx: 0, s: c.anyone.fit, shown: c.anyone.slot };
  }
  (Object.keys(INPUTS) as InputId[]).forEach((id) => drawInput(id, INPUTS[id]));

  // Slark is already in the draft: at beat 2 its outline pulses twice (it activates, it does not arrive)
  const echoes: SVGRectElement[] = [];
  {
    const s = INPUTS.slark;
    [0, 1].forEach((i) => {
      const ring = el("rect", { x: s.x - s.w / 2, y: s.y - s.h / 2, width: s.w, height: s.h, rx: 6, class: "gn-ring" }, gN);
      ring.style.animationDelay = `${i * 0.3}s`;
      echoes.push(ring);
    });
  }
  const layoutRows = () => {
    for (const id of Object.keys(rows) as CandidateId[]) {
      const r = rows[id];
      r.g.style.transform = `translate(${RX + r.dx}px,${r.y - RH / 2}px)`;
      r.sc.textContent = String(r.s);
    }
    drawEdges();
  };
  layoutRows();

  // end-cap of the unfinished tether (Void Spirit has no history yet)
  const vsEnd = el("circle", { r: 4, class: "g-end" }, gE);

  // —— tags (wide only)
  const tags: Array<{ g: SVGGElement; beats: readonly number[] }> = [];
  if (!T) {
    for (const tag of TAGS) {
      const path = edges[tag.edge].path;
      const p = path.getPointAtLength(path.getTotalLength() * tag.at);
      const w = tag.text.length * 6.7 + 20;
      const g = el("g", { class: "tg", transform: `translate(${p.x},${p.y})` }, gT);
      el("rect", { x: -w / 2, y: -11, width: w, height: 22, rx: 11, stroke: TAG_COLOR[tag.tone] }, g);
      text(g, 0, 4, tag.text, "", { fill: TAG_COLOR[tag.tone] });
      tags.push({ g, beats: tag.beats });
    }
  }

  // —— SCATTER: Void Spirit's old links break into fragments (beat 2)
  const frags: Array<{ r: SVGRectElement; dx: number; dy: number; rot: number }> = [];
  {
    const rn = seeded(19);
    for (const id of ["a_v", "y_v"]) {
      const path = edges[id].path;
      const len = path.getTotalLength();
      for (let i = 0; i < (T ? 7 : 11); i++) {
        const p = path.getPointAtLength(len * (0.38 + rn() * 0.3));
        const s = 3 + rn() * 4;
        const r = el("rect", { x: p.x - s / 2, y: p.y - s / 2, width: s, height: s, rx: 1, fill: i % 3 ? "var(--faint-line)" : SPECTRUM[i % SPECTRUM.length], class: "pt" }, gP);
        r.style.setProperty("--o", (0.25 + rn() * 0.45).toFixed(2));
        frags.push({ r, dx: (rn() - 0.3) * (T ? 26 : 60), dy: (rn() - 0.5) * (T ? 26 : 56), rot: rn() * 50 });
      }
    }
  }

  // —— GATHER: packets of evidence flowing along cyan / lime edges (wide, motion only)
  const pkts: Array<{ edge: string; ph: number; c: SVGCircleElement }> = [];
  if (!T && mv) {
    for (const id of ["a_p", "s_p", "sup_p", "g_p", "l_y"]) {
      for (let i = 0; i < 2; i++) pkts.push({ edge: id, ph: i / 2, c: el("circle", { r: 3, class: "pk" }, gE) });
    }
  }

  // —— the Coach (approved memory-set stills, moved by transform; the pose swaps by opacity)
  const coach = el("g", { class: "coach" }, gC);
  el("ellipse", { class: "cs", cx: 0, cy: CS * 0.4, rx: CS * 0.3, ry: CS * 0.05 }, coach);
  const body = el("g", { class: "cbody" }, coach);
  const poseImg = {} as Record<CoachPose, SVGImageElement>;
  for (const pose of COACH_POSES) {
    const img = el("image", { href: coachUrl(pose), x: -CS / 2, y: -CS / 2, width: CS, height: CS }, body);
    img.style.opacity = "0";
    poseImg[pose] = img;
  }
  const fx = el("g", { class: "cfx" }, coach);
  {
    const rn = seeded(5);
    for (let i = 0; i < 14; i++) {
      const a = rn() * 6.28;
      const r = CS * (0.28 + rn() * 0.2);
      const q = el("rect", { x: Math.cos(a) * r - 2.5, y: Math.sin(a) * r - 2.5, width: 5, height: 5, rx: 1, fill: SPECTRUM[i % SPECTRUM.length], class: "rq" }, fx);
      q.style.setProperty("--sx", `${Math.cos(a) * 22}px`);
      q.style.setProperty("--sy", `${Math.sin(a) * 22 - 6}px`);
      q.style.setProperty("--dl", `${(rn() * 0.3).toFixed(2)}s`);
    }
  }
  const pill = el("g", { class: "cpill", transform: `translate(${-46},${CS / 2 + (T ? 2 : 6)})` }, coach);
  el("rect", { x: 0, y: -11, width: 92, height: 22, rx: 11 }, pill);
  const pillDot = el("circle", { cx: 12, cy: 0, r: 3, fill: "var(--muted)" }, pill);
  const pillText = text(pill, 21, 3.4, "WATCHING", "");
  pill.style.opacity = T ? "0" : "1"; // the narrow rail is too thin for a label; the caption carries the state

  // —— state
  const S = { k: 0, raf: 0, pk: 0, timers: [] as number[] };

  const finishRows = (k: number) => {
    for (const c of CANDIDATES) {
      const r = rows[c.id];
      r.y = SLOT[rowSlot(c.id, k)];
      r.dx = 0;
      r.s = rowFit(c.id, k);
      r.shown = rowSlot(c.id, k);
      r.rk.textContent = `#${r.shown + 1}`;
    }
    headT.textContent = k === 6 ? GRAPH.topYou : GRAPH.topAnyone;
    head.setAttribute("data-k", k === 6 ? "you" : "any");
    layoutRows();
  };

  /** SETTLE: the three rows glide to their new slots; the one that rises leans out, the one that drops leans in. */
  const moveRows = (k: number, delay: number, dur: number, instant: boolean) => {
    cancelAnimationFrame(S.raf);
    if (!mv || instant) {
      finishRows(k);
      return;
    }
    const from = CANDIDATES.map((c) => ({ y: rows[c.id].y, s: rows[c.id].s }));
    const to = CANDIDATES.map((c) => ({ y: SLOT[rowSlot(c.id, k)], s: rowFit(c.id, k), slot: rowSlot(c.id, k) }));
    const pop: Record<CandidateId, number> = { puck: 1, qop: -1, vs: 0 };
    const amp = T ? 8 : 22;
    S.timers.push(
      window.setTimeout(() => {
        const t0 = performance.now();
        const step = (now: number) => {
          const u = clamp((now - t0) / dur, 0, 1);
          const e = easeInOut(u);
          CANDIDATES.forEach((c, i) => {
            const r = rows[c.id];
            const moved = Math.abs(to[i].y - from[i].y) > 1;
            r.y = lerp(from[i].y, to[i].y, e);
            r.dx = moved ? pop[c.id] * amp * Math.sin(Math.PI * e) : 0;
            r.s = Math.round(lerp(from[i].s, to[i].s, e));
            if (u > 0.5 !== (r.shown === to[i].slot)) {
              r.shown = u > 0.5 ? to[i].slot : r.shown;
              r.rk.textContent = `#${r.shown + 1}`;
            }
          });
          if (u > 0.55) {
            headT.textContent = k === 6 ? GRAPH.topYou : GRAPH.topAnyone;
            head.setAttribute("data-k", k === 6 ? "you" : "any");
          }
          layoutRows();
          if (u < 1) S.raf = requestAnimationFrame(step);
          else finishRows(k);
        };
        S.raf = requestAnimationFrame(step);
      }, delay),
    );
  };

  const setCoach = (k: number, prev: number) => {
    const [x, y, pose] = COACH[kind][k - 1];
    coach.style.transform = `translate(${x}px,${y}px)`;
    for (const p of COACH_POSES) poseImg[p].style.opacity = p === pose ? "1" : "0";
    const beat = BEATS[k - 1];
    pillText.textContent = beat.pose.toUpperCase();
    pillDot.setAttribute("fill", k === 6 ? "var(--lime)" : k === 1 ? "var(--muted)" : "var(--cyan)");
    if (mv && k === 4 && prev !== 4) {
      body.classList.remove("recon");
      fx.classList.remove("on");
      void body.getBoundingClientRect(); // restart the reconstruction pulse
      body.classList.add("recon");
      fx.classList.add("on");
    } else if (k !== 4) {
      body.classList.remove("recon");
      fx.classList.remove("on");
    }
  };

  const setBeat = (k: number, instant = false) => {
    const prev = S.k;
    S.k = k;
    S.timers.forEach((t) => window.clearTimeout(t));
    S.timers = [];
    svg.setAttribute("aria-label", BEATS[k - 1].aria);
    // nodes
    for (const id of Object.keys(nodes) as InputId[]) {
      const v = NODE_VISIBILITY[id][k - 1];
      const n = nodes[id];
      const was = n.g.getAttribute("data-v");
      n.g.style.transitionDelay = was === "x" && v !== "x" ? ".3s" : "0s";
      n.g.setAttribute("data-v", v);
      if (id === "slark") n.g.toggleAttribute("data-on", k === 2 || k === 3);
    }
    echoes.forEach((r) => r.classList.toggle("on", k === 2 && mv));
    // edges (narrow stage: only the 2–3 connections that carry this beat; the rest are not drawn)
    for (const id of Object.keys(edges)) {
      const e = edges[id];
      const next = T && !TALL_EDGES[k - 1].includes(id) ? "x" : e.spec.states[k - 1];
      const entering = e.state === "x" && next !== "x";
      for (const p of [e.path, e.halo]) {
        if (!p) continue;
        p.style.transitionDelay = entering ? (k === 6 ? ".1s" : ".5s") : "0s";
        p.setAttribute("data-s", next);
      }
      e.state = next;
    }
    {
      const path = edges.g_v.path;
      const end = path.getPointAtLength(path.getTotalLength() * 0.8);
      vsEnd.setAttribute("cx", String(end.x));
      vsEnd.setAttribute("cy", String(end.y));
      vsEnd.classList.toggle("on", T ? k === 4 : k >= 4);
    }
    // tags, scatter
    tags.forEach((t) => t.g.classList.toggle("on", t.beats.includes(k)));
    frags.forEach((f) => {
      f.r.classList.toggle("on", k >= 2);
      f.r.style.transform = k >= 2 ? `translate(${f.dx}px,${f.dy}px) rotate(${f.rot}deg)` : "none";
    });
    // rows: sub-line, state
    for (const c of CANDIDATES) {
      const r = rows[c.id];
      const [line, tone] = SUB[c.id][k - 1];
      r.sb.textContent = line;
      r.sb.setAttribute("data-tone", tone ?? "");
      r.g.setAttribute("data-t", ROW_STATE[c.id][k - 1]);
    }
    moveRows(k, k === 6 && prev < 6 ? 1100 : 0, k === 6 ? 1100 : 800, instant);
    setCoach(k, instant ? 0 : prev);
  };

  // —— packets only while the stage is on screen
  let live = false;
  const t0 = performance.now();
  const tickPackets = (now: number) => {
    if (!live) return;
    S.pk = requestAnimationFrame(tickPackets);
    for (const p of pkts) {
      const e = edges[p.edge];
      const on = e.state === "e" || e.state === "s" || e.state === "l";
      if (!on) {
        p.c.style.opacity = "0";
        continue;
      }
      const len = e.path.getTotalLength();
      const period = e.state === "l" ? 4200 : e.state === "s" ? 2800 : 3800;
      const u = ((now - t0) / period + p.ph) % 1;
      const q = e.path.getPointAtLength(len * u);
      p.c.setAttribute("cx", String(q.x));
      p.c.setAttribute("cy", String(q.y));
      p.c.setAttribute("fill", e.state === "l" ? "var(--lime)" : "var(--cyan)");
      p.c.style.opacity = (Math.sin(Math.PI * u) * 0.9).toFixed(2);
    }
  };
  const io = new IntersectionObserver((entries) => {
    const visible = entries[0].isIntersecting;
    if (visible && !live && pkts.length) {
      live = true;
      S.pk = requestAnimationFrame(tickPackets);
    } else if (!visible) {
      live = false;
      cancelAnimationFrame(S.pk);
    }
  });
  if (pkts.length) io.observe(host);

  return {
    svg,
    setBeat,
    destroy: () => {
      live = false;
      cancelAnimationFrame(S.pk);
      cancelAnimationFrame(S.raf);
      S.timers.forEach((t) => window.clearTimeout(t));
      io.disconnect();
    },
    column: () => {
      const m = svg.getScreenCTM();
      if (!m) return null;
      return { x: m.a * (RX + RW / 2) + m.e, bottom: m.d * (SLOT[2] + RH / 2 + 8) + m.f };
    },
  };
}
