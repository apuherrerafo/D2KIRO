/* LANDING V3 · Hero scene: the drawn Dota map (original, no game art), the system layer over it (signal, evidence, trace) and the
   Coach's walk. One rAF loop on ONE virtual clock whose rate eases to 0 while the waitlist is being filled (or motion is paused):
   "calm" is a deceleration, so the Coach glides home instead of freezing mid-step.
   The Coach itself is a React slot (the approved Coach Motion V2 on supported desktop, stills on phones and in reduced motion):
   this module only decides where it stands and which cue (watching / analyzing) it follows.
   Everything that moves here is transform / opacity / a few SVG strokes. Off screen or in a hidden tab nothing runs. */

import { bezier, coachCue, ease, lerp, loopTime, poseLabel, ramp, smooth, walkAmount, clamp01, LOOP_MS, type HeroCue } from "./timeline";

const NS = "http://www.w3.org/2000/svg";
const CYAN = "var(--cyan)";
const PINK = "var(--pink)";

type Pt = readonly [number, number];

/* ─────────────────────────── motion clock ─────────────────────────── */

export interface MotionClock {
  /** current speed of the virtual clock, 1 = normal, 0 = at rest */
  readonly rate: number;
  /** a reason to be calm (the waitlist has focus, the visitor paused motion); released with `false` */
  hold: (reason: string, on: boolean) => void;
  destroy: () => void;
}

export function createMotionClock(root: HTMLElement): MotionClock {
  const holds = new Set<string>();
  const state = { rate: 1, target: 1, running: false, last: 0, raf: 0 };
  const step = (now: number) => {
    const dt = Math.min(100, now - state.last);
    state.last = now;
    state.rate += (state.target - state.rate) * (1 - Math.exp(-dt / (state.target < state.rate ? 200 : 420)));
    if (Math.abs(state.target - state.rate) < 0.01) state.rate = state.target;
    root.style.setProperty("--calm", (1 - state.rate).toFixed(3));
    if (state.rate !== state.target) state.raf = requestAnimationFrame(step);
    else state.running = false;
  };
  const retarget = () => {
    state.target = holds.size > 0 ? 0 : 1;
    root.dataset.calm = String(state.target === 0);
    if (!state.running) {
      state.running = true;
      state.last = performance.now();
      state.raf = requestAnimationFrame(step);
    }
  };
  return {
    get rate() {
      return state.rate;
    },
    hold: (reason, on) => {
      if (on) holds.add(reason);
      else holds.delete(reason);
      retarget();
    },
    destroy: () => cancelAnimationFrame(state.raf),
  };
}

/* ─────────────────────────── map geometry ─────────────────────────── */

// ally = graphite, enemy = magenta. Lime is reserved for personal resolution, which the Hero never claims.
const RGB = { ink: "21,25,26", river: "0,113,139", ally: "38,45,47", pink: "176,32,111", tree: "64,84,68" } as const;
// map space: u right, v down; Radiant bottom-left, Dire top-right. The projection puts Radiant left, Dire right, the mid lane across.
const LANES: Record<"top" | "mid" | "bot", readonly Pt[]> = {
  top: [[0.11, 0.86], [0.08, 0.5], [0.1, 0.1], [0.5, 0.08], [0.86, 0.11]],
  mid: [[0.14, 0.86], [0.5, 0.5], [0.86, 0.14]],
  bot: [[0.14, 0.89], [0.5, 0.92], [0.9, 0.9], [0.92, 0.5], [0.89, 0.14]],
};
const RIVER: readonly Pt[] = [[0, 0.06], [0.18, 0.22], [0.33, 0.36], [0.5, 0.5], [0.64, 0.63], [0.8, 0.8], [0.96, 1]];
/** Longest the placeholder waits for the Coach in the slot before the stage takes over anyway. */
const REVEAL_CAP_MS = 2500;
/** Half-height (CSS px) of the band a phone redraws each frame around the Mid lane. */
const BAND_PX = 150;
const SPAWN = 7000;
const TRAVEL = 15000;
const OFFSET = { mid: 0, top: 2300, bot: 4600 } as const;

const lengthOf = (pts: readonly Pt[]): number => {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return total;
};
function pointAt(pts: readonly Pt[], t: number): Pt {
  let d = Math.max(0, Math.min(1, t)) * lengthOf(pts);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d <= l) return [a[0] + ((b[0] - a[0]) * d) / l, a[1] + ((b[1] - a[1]) * d) / l];
    d -= l;
  }
  return pts[pts.length - 1];
}
const nearPath = (u: number, v: number, pts: readonly Pt[], r: number): boolean => {
  for (let t = 0; t <= 1; t += 0.01) {
    const p = pointAt(pts, t);
    if (Math.hypot(p[0] - u, p[1] - v) < r) return true;
  }
  return false;
};

/** The forest: the same trees every time. */
function makeTrees(): Array<readonly [number, number, number]> {
  let seed = 11;
  const rr = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const trees: Array<readonly [number, number, number]> = [];
  for (let i = 0; i < 1200 && trees.length < 420; i++) {
    const u = 0.03 + rr() * 0.94;
    const v = 0.03 + rr() * 0.94;
    if (Math.hypot(u - 0.1, v - 0.9) < 0.14 || Math.hypot(u - 0.9, v - 0.1) < 0.14) continue;
    if (nearPath(u, v, RIVER, 0.045) || nearPath(u, v, LANES.top, 0.035) || nearPath(u, v, LANES.mid, 0.035) || nearPath(u, v, LANES.bot, 0.035)) continue;
    trees.push([u, v, 0.6 + rr() * 0.8]);
  }
  return trees;
}

interface Geometry {
  P: (u: number, v: number) => Pt;
  laneY: number;
  boxTop: number;
}

interface MapView {
  geometry: () => Geometry | null;
  frame: (ms: number, full?: boolean) => void;
  resize: () => void;
}

function createMap(hero: HTMLElement, canvas: HTMLCanvasElement, onGeometry: () => void): MapView {
  const ctx = canvas.getContext("2d");
  const trees = makeTrees();
  const view = { W: 0, S: 0, cx: 0, cy: 0, dpr: 1, VF: 0.52, laneY: 0, boxTop: 0, ms: 0 };
  let base: HTMLCanvasElement | null = null;
  const P = (u: number, v: number): Pt => [view.cx + (u - v) * view.S * 0.7071, view.cy + (u + v - 1) * view.S * 0.7071 * view.VF];

  const drawStatic = (mono: string) => {
    base = document.createElement("canvas");
    base.width = canvas.width;
    base.height = canvas.height;
    const g = base.getContext("2d");
    if (!g) return;
    g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    const line = (pts: readonly Pt[]) => {
      g.beginPath();
      pts.forEach((p, i) => {
        const q = P(p[0], p[1]);
        if (i) g.lineTo(q[0], q[1]);
        else g.moveTo(q[0], q[1]);
      });
    };
    // map plate + fine grid
    line([[0, 0], [1, 0], [1, 1], [0, 1]]);
    g.closePath();
    g.fillStyle = "rgba(251,252,249,.55)";
    g.fill();
    g.strokeStyle = `rgba(${RGB.ink},.14)`;
    g.lineWidth = 1;
    g.stroke();
    g.strokeStyle = `rgba(${RGB.ink},.045)`;
    for (let k = 1; k < 16; k++) {
      const t = k / 16;
      line([[t, 0], [t, 1]]);
      g.stroke();
      line([[0, t], [1, t]]);
      g.stroke();
    }
    // river
    g.lineCap = "round";
    g.lineJoin = "round";
    line(RIVER);
    g.strokeStyle = `rgba(${RGB.river},.10)`;
    g.lineWidth = view.S * 0.05;
    g.stroke();
    line(RIVER);
    g.strokeStyle = `rgba(${RGB.river},.22)`;
    g.lineWidth = 1.2;
    g.stroke();
    // forest
    for (const [u, v, s] of trees) {
      const q = P(u, v);
      g.beginPath();
      g.ellipse(q[0], q[1], 3.6 * s, 2.2 * s, 0, 0, Math.PI * 2);
      g.fillStyle = `rgba(${RGB.tree},${(0.1 + s * 0.06) * (view.S < 500 ? 0.55 : 1)})`;
      g.fill();
    }
    // lanes (mid is your lane) and towers, three per side
    for (const k of ["top", "mid", "bot"] as const) {
      const mid = k === "mid";
      line(LANES[k]);
      g.strokeStyle = mid ? `rgba(${RGB.river},.16)` : `rgba(${RGB.ink},.07)`;
      g.lineWidth = 9;
      g.stroke();
      line(LANES[k]);
      g.strokeStyle = mid ? `rgba(${RGB.river},.45)` : `rgba(${RGB.ink},.2)`;
      g.lineWidth = 1;
      g.setLineDash(mid ? [] : [5, 6]);
      g.stroke();
      g.setLineDash([]);
      [0.1, 0.24, 0.38, 0.62, 0.76, 0.9].forEach((t, i) => {
        const p = pointAt(LANES[k], t);
        const q = P(p[0], p[1]);
        const c = i < 3 ? RGB.ally : RGB.pink;
        g.save();
        g.translate(q[0], q[1]);
        g.rotate(Math.PI / 4);
        g.fillStyle = "rgba(251,252,249,.9)";
        g.strokeStyle = `rgba(${c},.55)`;
        g.lineWidth = 1.2;
        g.fillRect(-3.5, -3.5, 7, 7);
        g.strokeRect(-3.5, -3.5, 7, 7);
        g.restore();
      });
    }
    // Ancients
    const ancients: Array<[number, number, string, string]> = [[0.1, 0.9, RGB.ally, "RADIANT"], [0.9, 0.1, RGB.pink, "DIRE"]];
    for (const [u, v, c, name] of ancients) {
      const q = P(u, v);
      g.beginPath();
      g.ellipse(q[0], q[1], 34, 18, 0, 0, Math.PI * 2);
      g.strokeStyle = `rgba(${c},.35)`;
      g.lineWidth = 1;
      g.setLineDash([3, 4]);
      g.stroke();
      g.setLineDash([]);
      g.save();
      g.translate(q[0], q[1]);
      g.rotate(Math.PI / 4);
      g.fillStyle = `rgba(${c},.55)`;
      g.fillRect(-6, -6, 12, 12);
      g.restore();
      g.font = `600 10px ${mono}`;
      g.fillStyle = `rgba(${c},.75)`;
      g.textAlign = "center";
      g.fillText(name, q[0], q[1] - 26);
    }
    g.font = `600 10px ${mono}`;
    g.textAlign = "center";
    const m = P(0.3, 0.7);
    g.fillStyle = `rgba(${RGB.river},.8)`;
    g.fillText("YOU · MID", m[0], m[1] - 12);
    const r = P(0.62, 0.62);
    g.fillStyle = `rgba(${RGB.river},.6)`;
    g.fillText("RIVER", r[0] + 26, r[1]);
  };

  /** Creep waves: both sides push every lane, meet in the middle and fade out. */
  const frame = (ms: number, full = false) => {
    view.ms = ms;
    if (!ctx || !base) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // On a phone the canvas is a tall column of which only a thin band around the Mid lane is visible (the CSS mask): after the first full
    // paint, each frame redraws just that band (about a tenth of the pixels).
    const band = view.W <= 640 && !full;
    const y0 = band ? Math.max(0, Math.floor((view.laneY - BAND_PX) * view.dpr)) : 0;
    const y1 = band ? Math.min(canvas.height, Math.ceil((view.laneY + BAND_PX) * view.dpr)) : canvas.height;
    ctx.clearRect(0, y0, canvas.width, y1 - y0);
    ctx.drawImage(base, 0, y0, canvas.width, y1 - y0, 0, y0, canvas.width, y1 - y0);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.save();
    if (band) {
      ctx.beginPath();
      ctx.rect(0, y0 / view.dpr, view.W, (y1 - y0) / view.dpr);
      ctx.clip();
    }
    for (const k of ["top", "mid", "bot"] as const) {
      for (let w = 0; w < 3; w++) {
        const age = (ms + w * SPAWN + OFFSET[k]) % (SPAWN * 3);
        if (age > TRAVEL) continue;
        const prog = age / TRAVEL;
        const fade = prog > 0.85 ? (1 - prog) / 0.15 : Math.min(1, prog * 8);
        const sides: Array<[string, number, number]> = [[RGB.ally, 0.5 * prog, -1], [RGB.pink, 1 - 0.5 * prog, 1]];
        for (const [c, t, dir] of sides) {
          for (let i = 0; i < 4; i++) {
            const p = pointAt(LANES[k], t + dir * i * 0.008);
            const q = P(p[0], p[1]);
            ctx.beginPath();
            ctx.arc(q[0] + (i % 2 ? 2 : -2), q[1] + (i % 2 ? -1 : 1), 2.1, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${c},${0.75 * fade})`;
            ctx.fill();
          }
        }
      }
    }
    ctx.restore();
  };

  const resize = () => {
    const box = canvas.getBoundingClientRect();
    const product = hero.querySelector(".product");
    if (!product || box.width === 0) return;
    view.dpr = Math.min(2, window.devicePixelRatio || 1);
    view.W = box.width;
    canvas.width = Math.round(box.width * view.dpr);
    canvas.height = Math.round(box.height * view.dpr);
    // The Mid lane runs through the stage strip: just below the product card, or on phones a thin, wider-than-screen band just above it.
    const phone = view.W <= 640;
    view.VF = phone ? 0.3 : 0.52;
    view.S = phone ? Math.max(view.W * 1.15, 420) : Math.min(Math.max(view.W * 0.82, 900), (view.W / 2 - 40) / 0.5657);
    view.cx = view.W * 0.5;
    const prod = product.getBoundingClientRect();
    view.laneY = phone ? prod.top - box.top - 24 : prod.bottom - box.top + (view.W <= 1200 ? 52 : 62);
    view.cy = view.laneY;
    (canvas.parentElement as HTMLElement).style.setProperty("--ly", `${view.laneY}px`);
    view.boxTop = box.top - hero.getBoundingClientRect().top;
    drawStatic(getComputedStyle(hero).getPropertyValue("--f-mono") || "monospace");
    frame(view.ms, true);
    onGeometry();
  };

  return {
    geometry: () => (view.W > 0 ? { P, laneY: view.laneY, boxTop: view.boxTop } : null),
    frame,
    resize,
  };
}

/* ─────────────────────────── stage (system layer + Coach walk) ─────────────────────────── */

export interface HeroSceneOptions {
  /** the `<section class="hero">` that holds the product card (measured, never mutated except the `has-stage` class) */
  hero: HTMLElement;
  /** the page root that carries `--calm` / `data-calm` (shared with the handoff) */
  root: HTMLElement;
  mapCanvas: HTMLCanvasElement;
  svg: SVGSVGElement;
  /** the React slot that holds the Coach; the scene only positions it */
  coachSlot: HTMLElement;
  /** reduced motion: everything is drawn once, static */
  still: boolean;
  /** called when the Coach should change semantic state */
  onCue: (cue: HeroCue) => void;
}

export interface HeroScene {
  clock: MotionClock;
  destroy: () => void;
  /** test hook: render the loop frozen at `ms` */
  seek: (ms: number) => void;
}

interface Layout {
  fs: number;
  D: number;
  home: Pt;
  field: Pt;
  K: Pt;
  ly: number;
  dire: Pt;
  rad: Pt;
  nodes: Pt[];
  phone: boolean;
  tablet: boolean;
  sc: number;
  down: boolean;
}

const rectIn = (el: Element, hr: DOMRect) => {
  const r = el.getBoundingClientRect();
  return { x: r.left - hr.left, y: r.top - hr.top, w: r.width, h: r.height };
};

export function createHeroScene(opts: HeroSceneOptions): HeroScene {
  const { hero, root, mapCanvas, svg, coachSlot, still } = opts;
  const stageEl = svg.parentElement as HTMLElement;
  const clock = createMotionClock(root);
  const mk = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
    const n = document.createElementNS(NS, tag);
    for (const key of Object.keys(attrs)) n.setAttribute(key, String(attrs[key]));
    svg.appendChild(n);
    return n;
  };

  // layered SVG (built once; geometry is set in layout())
  const gLane = mk("path", { fill: "none", stroke: CYAN, "stroke-width": 2.2, "stroke-linecap": "round", opacity: 0 });
  const five = [0, 1, 2, 3, 4];
  const gTr = five.map(() => mk("path", { fill: "none", stroke: CYAN, "stroke-width": 1.5, "stroke-linecap": "round", opacity: 0 }));
  const gNode = five.map(() => mk("circle", { r: 3.2, fill: "var(--raise)", stroke: CYAN, "stroke-width": 1.4, opacity: 0 }));
  const gPkt = five.map(() => mk("circle", { r: 2.4, fill: CYAN, opacity: 0 }));
  const gRing = mk("ellipse", { fill: "none", stroke: PINK, "stroke-width": 1.2, opacity: 0 });
  const gTrail = [3, 2, 1, 0].map((i) => mk("circle", { r: 2.2 + (3 - i) * 0.35, fill: PINK, opacity: 0 }));
  const gSig = mk("circle", { r: 4, fill: PINK, opacity: 0 });
  const gMark = mk("rect", { width: 9, height: 9, x: -4.5, y: -4.5, fill: "var(--raise)", stroke: PINK, "stroke-width": 1.4, opacity: 0 });
  const gShadow = mk("ellipse", { fill: "#1c2a28", opacity: 0 });
  const gDown = mk("path", { fill: "none", stroke: CYAN, "stroke-width": 2.2, "stroke-linecap": "round", opacity: 0 });
  const gDownPkt = mk("circle", { r: 2.6, fill: "#fff", opacity: 0 });
  const gPathHalo = mk("path", { fill: "none", stroke: CYAN, "stroke-width": 9, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0 });
  const gPath = mk("path", { fill: "none", stroke: CYAN, "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0 });
  const gHead = mk("circle", { r: 4, fill: CYAN, opacity: 0 });
  const gTarget = mk("circle", { r: 6, fill: "none", stroke: CYAN, "stroke-width": 1.5, opacity: 0 });
  const lens = new WeakMap<SVGPathElement, number>();
  const lenOf = (p: SVGPathElement): number => lens.get(p) ?? 0;

  // the state pill is mirrored into the stage so the Coach passes behind it, never over it
  const pill = hero.querySelector<HTMLElement>(".coach-state .state-pill");
  let pillClone: HTMLElement | null = null;
  let lastLabel = "";

  const state = { layout: null as Layout | null, vt: 0, prev: 0, onscreen: true, frozen: null as number | null, lastCue: "" as string, revealed: false, revealing: false, revealRaf: 0 };

  const layout = () => {
    const geo = map.geometry();
    if (!geo) return;
    const hr = hero.getBoundingClientRect();
    const img = hero.querySelector(".coach-zone img");
    const main = hero.querySelector(".product-main");
    const pend = hero.querySelector(".pending i");
    const rail = hero.querySelectorAll(".rail li")[2];
    if (!img || !main || !pend || !rail) return;
    const imgR = rectIn(img, hr);
    const pendR = rectIn(pend, hr);
    const railR = rectIn(rail, hr);
    const phone = hr.width <= 640;
    const tablet = !phone && hr.width <= 1200;
    if (pill) {
      if (!pillClone) {
        pillClone = pill.cloneNode(true) as HTMLElement;
        pillClone.style.position = "absolute";
        pillClone.style.margin = "0";
        stageEl.appendChild(pillClone);
        pill.style.visibility = "hidden";
        lastLabel = "";
      }
      const pr = rectIn(pill, hr);
      pillClone.style.left = `${pr.x}px`;
      pillClone.style.top = `${pr.y}px`;
    }
    const ly = geo.laneY + geo.boxTop;
    const D = imgR.w;
    const home: Pt = [imgR.x + D / 2, imgR.y + D / 2];
    const dire = geo.P(0.9, 0.1);
    const rad = geo.P(0.1, 0.9);
    const K: Pt = [hr.width / 2, ly]; // contact point: where Mid meets the river
    // phone: the Coach stays at home (static / light); otherwise it walks to a field spot that never lands on the product or the form
    const fs = phone ? 1 : tablet ? 0.6 : 0.82;
    const field: Pt = phone ? home : [K[0] - 185, ly + (tablet ? 6 : -D * 0.19)];
    const offsets: Pt[] = phone ? [[-110, 14], [-62, -14], [56, 14], [104, -14], [-20, 18]] : [[-250, 30], [-150, -34], [-70, 42], [120, -30], [240, 34]];
    const nodes: Pt[] = offsets.map((n) => [K[0] + n[0], ly + n[1]] as Pt);
    // the cyan trace goes where the evidence is being read: the rail's Evidence step on phones (the lane sits above the product), else the "reading the evidence" dot
    let route: Pt[];
    let tgt: Pt;
    if (phone) {
      tgt = [railR.x + railR.w / 2, railR.y + 1];
      route = [K, tgt];
    } else {
      const gx = pendR.x + pendR.w / 2 - 7.5;
      tgt = [pendR.x + pendR.w / 2, pendR.y + pendR.h / 2];
      route = [K, [gx, ly], [gx, tgt[1]], [tgt[0] - 5, tgt[1]]];
    }
    const L: Layout = { fs, D, home, field, K, ly, dire: [dire[0], ly], rad: [rad[0], ly], nodes, phone, tablet, sc: phone ? 0.55 : 1, down: !phone };
    state.layout = L;
    coachSlot.style.width = `${D}px`;
    coachSlot.style.height = `${D}px`;
    gLane.setAttribute("d", `M${L.rad[0] + 50},${ly} L${L.dire[0] - 50},${ly}`);
    nodes.forEach((n, i) => {
      gTr[i].setAttribute("d", `M${n[0]},${n[1]} Q${(n[0] + K[0]) / 2},${(n[1] + K[1]) / 2 + (n[1] > ly ? 26 : -26) * L.sc} ${K[0]},${K[1]}`);
      gNode[i].setAttribute("cx", String(n[0]));
      gNode[i].setAttribute("cy", String(n[1]));
      const len = gTr[i].getTotalLength();
      lens.set(gTr[i], len);
      gTr[i].setAttribute("stroke-dasharray", `${len} ${len}`);
    });
    const d = `M${route.map((p) => p.join(",")).join(" L")}`;
    gPath.setAttribute("d", d);
    gPathHalo.setAttribute("d", d);
    const routeLen = gPath.getTotalLength();
    lens.set(gPath, routeLen);
    for (const p of [gPath, gPathHalo]) p.setAttribute("stroke-dasharray", `${routeLen} ${routeLen}`);
    gTarget.setAttribute("cx", String(tgt[0]));
    gTarget.setAttribute("cy", String(tgt[1]));
    // the thread that leaves the stage toward the decision graph (continues in the handoff block below the hero)
    if (L.down) gDown.setAttribute("d", `M${K[0]},${K[1]} L${K[0]},${hr.height + 2}`);
    lens.set(gDown, L.down ? gDown.getTotalLength() : 0);
    gMark.setAttribute("transform", `translate(${K[0]},${K[1]}) rotate(45)`);
    revealWhenCoachDrawn();
    render(state.frozen ?? state.vt, still);
  };

  /** The card's static placeholder stays until the Coach in the slot has really been drawn (its still decoded), so there is never a blank Coach.
      After REVEAL_CAP_MS it reveals anyway. */
  const coachDrawn = (): boolean => {
    const layers = coachSlot.querySelectorAll<HTMLImageElement>("img.hl-sprite-layer");
    return Array.from(layers).some((img) => img.complete && img.naturalWidth > 0 && parseFloat(img.style.opacity || "0") > 0.5);
  };
  const revealWhenCoachDrawn = () => {
    if (state.revealed || state.revealing) return;
    state.revealing = true;
    const t0 = performance.now();
    const wait = () => {
      if (coachDrawn() || performance.now() - t0 > REVEAL_CAP_MS) {
        state.revealed = true;
        hero.classList.add("has-stage");
        return;
      }
      state.revealRaf = requestAnimationFrame(wait);
    };
    wait();
  };

  const map = createMap(hero, mapCanvas, layout);

  function render(ms: number, forceStill: boolean) {
    const L = state.layout;
    if (!L) return;
    const t = loopTime(ms);
    const st = forceStill;
    // —— Coach script: it follows two cues; between 3 s and 6 s it walks out into the field and back, whole
    const cue = st ? "watching" : coachCue(t);
    if (cue !== state.lastCue) {
      state.lastCue = cue;
      opts.onCue(cue);
    }
    const label = st ? "Watching" : poseLabel(t);
    if (pillClone && label !== lastLabel) {
      lastLabel = label;
      if (pillClone.lastChild) pillClone.lastChild.nodeValue = label;
    }
    // calm (waitlist focused / paused): as the clock eases to a stop the Coach glides home, so the pause is a rest pose, not a frozen mid-step
    const kq = 1 - smooth(clamp01(1 - clock.rate));
    const walk = !L.phone && !st;
    const u = (walk ? walkAmount(t) : 0) * kq;
    const H = L.home;
    const F = L.field;
    const sc = L.sc;
    const pos = u > 0 ? bezier(H, [H[0], F[1] + 10], F, u) : H;
    const s = lerp(1, L.fs, u);
    const bob = !st && u === 0 ? Math.sin(t * 2.4) * 2.5 : 0;
    coachSlot.style.transform = `translate3d(${pos[0] - L.D / 2}px,${pos[1] - L.D / 2 + bob}px,0) scale(${s})`;
    // shadow on the lane while the Coach is out in the field
    gShadow.setAttribute("cx", String(pos[0]));
    gShadow.setAttribute("cy", String(L.ly + 40 * sc));
    gShadow.setAttribute("rx", String(44 * sc * s));
    gShadow.setAttribute("ry", String(6 * sc * s));
    gShadow.setAttribute("opacity", (0.16 * smooth(clamp01((u - 0.35) / 0.65))).toFixed(3));

    // —— system layer: signal (magenta), evidence (cyan), trace (cyan)
    const ev = st ? 0.5 : ramp(t, 1.8, 3.2) * (1 - ramp(t, 6.3, 7.4));
    gLane.setAttribute("opacity", (ev * 0.38).toFixed(3));
    L.nodes.forEach((_, i) => {
      const dr = st ? 1 : ease(ramp(t, 2 + i * 0.18, 3.1 + i * 0.18));
      gTr[i].setAttribute("stroke-dashoffset", (lenOf(gTr[i]) * (1 - dr)).toFixed(1));
      gTr[i].setAttribute("opacity", (ev * 0.85).toFixed(3));
      gNode[i].setAttribute("opacity", (ev * Math.min(1, dr * 3)).toFixed(3));
      const pk = ramp(t, 3 + i * 0.12, 4.4 + i * 0.12);
      const pp = gTr[i].getPointAtLength(lenOf(gTr[i]) * ease(pk));
      gPkt[i].setAttribute("cx", String(pp.x));
      gPkt[i].setAttribute("cy", String(pp.y));
      gPkt[i].setAttribute("opacity", (!st && pk > 0 && pk < 1 ? Math.sin(Math.PI * pk) * 0.9 : 0).toFixed(3));
    });
    // enemy signal enters from Dire and rests at the contact point as a quiet pressure mark
    const sg = st ? 0 : ease(ramp(t, 1.5, 3));
    const sOut = 1 - ramp(t, 5.8, 6.6);
    const x0 = L.dire[0] - 30;
    const x1 = L.K[0];
    gSig.setAttribute("cx", String(lerp(x0, x1, sg)));
    gSig.setAttribute("cy", String(L.ly));
    gSig.setAttribute("opacity", (!st && t > 1.5 && t < 3.05 ? Math.min(1, ramp(t, 1.5, 1.7)) : 0).toFixed(3));
    gTrail.forEach((c, i) => {
      const g2 = ease(clamp01(ramp(t, 1.5, 3) - (i + 1) * 0.045));
      c.setAttribute("cx", String(lerp(x0, x1, g2)));
      c.setAttribute("cy", String(L.ly + (i % 2 ? 1.5 : -1.5)));
      c.setAttribute("opacity", (!st && t > 1.5 && t < 3.05 ? 0.5 - i * 0.1 : 0).toFixed(3));
    });
    const rr = ramp(t, 1.5, 2.3);
    gRing.setAttribute("cx", String(L.dire[0]));
    gRing.setAttribute("cy", String(L.ly));
    gRing.setAttribute("rx", String(10 + 42 * rr));
    gRing.setAttribute("ry", String((10 + 42 * rr) * 0.55));
    gRing.setAttribute("opacity", (!st && rr > 0 && rr < 1 ? (1 - rr) * 0.6 : 0).toFixed(3));
    gMark.setAttribute("opacity", (!st ? ramp(t, 2.9, 3.2) * sOut * (0.75 + 0.25 * Math.sin(t * 5)) : 0).toFixed(3));
    // cyan trace: leaves the contact point toward where the evidence is read, arrives, rings the target (still unresolved), then fades
    const lp = st ? 0 : ease(ramp(t, 6, 6.9));
    const lo = st ? 0 : (1 - ramp(t, 7.3, 7.9)) * ramp(t, 6, 6.15);
    const routeLen = lenOf(gPath);
    gPath.setAttribute("stroke-dashoffset", (routeLen * (1 - lp)).toFixed(1));
    gPathHalo.setAttribute("stroke-dashoffset", (routeLen * (1 - lp)).toFixed(1));
    gPath.setAttribute("opacity", (lo * 0.9).toFixed(3));
    gPathHalo.setAttribute("opacity", (lo * 0.13).toFixed(3));
    const hp = gPath.getPointAtLength(routeLen * lp);
    gHead.setAttribute("cx", String(hp.x));
    gHead.setAttribute("cy", String(hp.y));
    gHead.setAttribute("opacity", (lo * (lp > 0.02 ? 1 : 0)).toFixed(3));
    const gp = ramp(t, 6.8, 7.5);
    gTarget.setAttribute("r", String(6 + 12 * gp));
    gTarget.setAttribute("opacity", (gp > 0 ? (1 - gp) * 0.6 * lo : 0).toFixed(3));
    // the thread toward the graph: a faint standing line, brightened by a packet as the trace goes out
    if (L.down) {
      const dp = st ? 0 : ramp(t, 6.2, 7.6);
      gDown.setAttribute("opacity", (st ? 0.32 : 0.26 + 0.5 * Math.sin(Math.PI * dp)).toFixed(3));
      const q = gDown.getPointAtLength(lenOf(gDown) * ease(dp));
      gDownPkt.setAttribute("cx", String(q.x));
      gDownPkt.setAttribute("cy", String(q.y));
      gDownPkt.setAttribute("opacity", (dp > 0 && dp < 1 ? Math.sin(Math.PI * dp) : 0).toFixed(3));
    } else {
      gDown.setAttribute("opacity", "0");
      gDownPkt.setAttribute("opacity", "0");
    }
  }

  // —— the one loop
  let raf = 0;
  let lastMap = 0;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(100, now - state.prev);
    state.prev = now;
    if (state.frozen !== null || !state.onscreen || still || clock.rate === 0) return;
    state.vt += dt * clock.rate;
    render(state.vt, false);
    if (now - lastMap > 33) {
      map.frame(state.vt);
      lastMap = now;
    }
  };
  const io = new IntersectionObserver((entries) => {
    state.onscreen = entries[0].isIntersecting;
  });
  io.observe(hero);

  // geometry follows layout: size changes, the web font arriving, the card re-flowing
  const ro = new ResizeObserver(() => map.resize());
  ro.observe(hero);
  const product = hero.querySelector(".product");
  if (product) ro.observe(product);
  void document.fonts?.ready.then(() => map.resize());
  map.resize();

  // calm while the waitlist in the hero is being filled
  const form = hero.querySelector("form.wl");
  const onFocusIn = () => clock.hold("form", true);
  const onFocusOut = (e: Event) => {
    const next = (e as FocusEvent).relatedTarget as Node | null;
    if (!next || !form?.contains(next)) clock.hold("form", false);
  };
  form?.addEventListener("focusin", onFocusIn);
  form?.addEventListener("focusout", onFocusOut);

  state.prev = performance.now();
  if (!still) raf = requestAnimationFrame(tick);

  return {
    clock,
    destroy: () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(state.revealRaf);
      io.disconnect();
      ro.disconnect();
      form?.removeEventListener("focusin", onFocusIn);
      form?.removeEventListener("focusout", onFocusOut);
      clock.destroy();
      pillClone?.remove();
      if (pill) pill.style.visibility = "";
      hero.classList.remove("has-stage");
      svg.replaceChildren();
    },
    seek: (ms: number) => {
      state.frozen = ms;
      map.frame(ms);
      render(ms, false);
    },
  };
}

export const HERO_LOOP_MS = LOOP_MS;
