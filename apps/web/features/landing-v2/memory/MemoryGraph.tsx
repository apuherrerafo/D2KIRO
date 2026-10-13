'use client';

/**
 * MemoryGraph - paints a Frame (live force world or reduced-motion composition) into SVG.
 * GRAPH = what D2KIRO knows. COACH = where it is looking, drawn at the graph's EDGE.
 *
 * Landing V2 differences from the approved Lab stage: no proxy Coach, no node dragging, no debug readout, and the paint
 * loop only runs while `active` (the section is on or next to the screen). Halting leaves the last frame painted.
 */

import React, { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import MemoryCoach from './MemoryCoach';
import { AimStabilizer, quantizeAim, toRenderState } from './coach-renderer';
import type { CoachRendererHandle } from './coach-renderer';
import { beamAllowed } from './coach-state';
import { LiveController, ReducedController } from './controllers';
import type { Controller } from './controllers';
import { COACH_POS, COACH_SPRITE_WIDTH, LAYOUTS, LINKS, NODES, REGIONS } from './fixtures';
import type { LayoutId, NodeId } from './types';

interface MemoryGraphProps {
  layout: LayoutId;
  reduced: boolean;
  scene: number;
  /** false = the paint loop is halted (offscreen). The graph keeps its last composition. */
  active: boolean;
  onDone: (scene: number) => void;
  /** playback speed: 1 in step with the scroll, higher while catching up to it. */
  pace: number;
  /** land on `scene` settled instead of playing it. */
  snap: boolean;
}

const LABEL_GAP = 7;

function convexHull(pts: Array<[number, number]>): Array<[number, number]> {
  if (pts.length < 3) return pts;
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: Array<[number, number]> = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function labelAttrs(dir: 't' | 'b' | 'l' | 'r', r: number): { x: number; y: number; anchor: string } {
  switch (dir) {
    case 't':
      return { x: 0, y: -(r + LABEL_GAP), anchor: 'middle' };
    case 'b':
      return { x: 0, y: r + LABEL_GAP + 8, anchor: 'middle' };
    case 'l':
      return { x: -(r + LABEL_GAP), y: 3.5, anchor: 'end' };
    default:
      return { x: r + LABEL_GAP, y: 3.5, anchor: 'start' };
  }
}

export default function MemoryGraph({ layout, reduced, scene, active, onDone, pace, snap }: MemoryGraphProps) {
  const dims = LAYOUTS[layout];
  const svgRef = useRef<SVGSVGElement | null>(null);
  const controller = useRef<Controller | null>(null);
  const spriteHandle = useRef<CoachRendererHandle | null>(null);
  const loop = useRef<{ run: () => void; halt: () => void } | null>(null);
  const activeRef = useRef(active);
  const nodeEls = useRef<Partial<Record<NodeId, SVGGElement | null>>>({});
  const labelEls = useRef<Partial<Record<NodeId, SVGTextElement | null>>>({});
  const linkEls = useRef<Record<string, SVGLineElement | null>>({});
  const strainEls = useRef<Record<string, SVGLineElement | null>>({});
  const softEls = useRef<Record<string, SVGPathElement | null>>({});
  const crispEls = useRef<Record<string, SVGPathElement | null>>({});
  const capEls = useRef<Record<string, SVGTextElement | null>>({});
  const ghostEls = useRef<Array<SVGLineElement | null>>([]);
  const trailEls = useRef<Partial<Record<NodeId, SVGLineElement | null>>>({});
  const ghostDots = useRef<Array<SVGCircleElement | null>>([]);
  const attEl = useRef<SVGCircleElement | null>(null);
  const toneCache = useRef<Partial<Record<NodeId, string>>>({});
  const cbRef = useRef({ onDone });
  const sceneRef = useRef(scene);
  const paceRef = useRef(pace);
  const snapRef = useRef(snap);

  useEffect(() => {
    cbRef.current = { onDone };
  }, [onDone]);

  // controller lifecycle: one per (layout, motion mode)
  useEffect(() => {
    const events = {
      onCoach: (_state: unknown, _focus: unknown, reconstruct?: boolean) => {
        if (reconstruct) spriteHandle.current?.reconstruct(performance.now());
      },
      onDone: (s: number) => cbRef.current.onDone(s),
    };
    const ctl: Controller = reduced ? new ReducedController(layout, events) : new LiveController(layout, events);
    controller.current = ctl;
    ctl.setPace(paceRef.current);
    ctl.goTo(sceneRef.current);

    const focusPt = { x: dims.w / 2, y: dims.h / 2 };
    let att = 0;
    let last = performance.now();
    let raf = 0;
    let running = false;
    const coachPos = COACH_POS[layout];
    const aimStable = new AimStabilizer();

    const paint = (now: number): void => {
      const dt = Math.min(400, now - last);
      last = now;
      ctl.tick(dt);
      const f = ctl.frame;

      // ---- Coach attention point (smoothed), strength follows state
      const live = f.coach.focus.filter((id) => f.nodes[id].a > 0.3);
      let hasFocus = false;
      if (live.length > 0) {
        let sx = 0;
        let sy = 0;
        for (const id of live) {
          sx += f.nodes[id].x;
          sy += f.nodes[id].y;
        }
        const tx = sx / live.length;
        const ty = sy / live.length;
        const k = reduced ? 1 : 1 - Math.exp(-dt / 140);
        focusPt.x += (tx - focusPt.x) * k;
        focusPt.y += (ty - focusPt.y) * k;
        hasFocus = true;
      }
      const attTarget = hasFocus && beamAllowed(f.coach.state) ? (f.coach.state === 'confirming' ? 0.7 : 1) : 0;
      att += (attTarget - att) * (1 - Math.exp(-dt / 260));
      const attR = 150 * LAYOUTS[layout].scale + 40;

      // ---- links
      for (const l of LINKS) {
        const el = linkEls.current[l.id];
        const strain = strainEls.current[l.id];
        if (!el || !strain) continue;
        const v = f.links[l.id];
        const a = f.nodes[l.a];
        const b = f.nodes[l.b];
        const vis = Math.min(a.a, b.a);
        if (v.p <= 0.001 || vis <= 0.01) {
          el.style.opacity = '0';
          strain.style.opacity = '0';
          continue;
        }
        const x2 = a.x + (b.x - a.x) * v.p;
        const y2 = a.y + (b.y - a.y) * v.p;
        el.setAttribute('x1', a.x.toFixed(1));
        el.setAttribute('y1', a.y.toFixed(1));
        el.setAttribute('x2', x2.toFixed(1));
        el.setAttribute('y2', y2.toFixed(1));
        strain.setAttribute('x1', a.x.toFixed(1));
        strain.setAttribute('y1', a.y.toFixed(1));
        strain.setAttribute('x2', x2.toFixed(1));
        strain.setAttribute('y2', y2.toFixed(1));
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const near = Math.max(0, 1 - Math.hypot(mx - focusPt.x, my - focusPt.y) / attR) * att;
        el.style.opacity = String(Math.min(1, (0.3 + 0.42 * l.weight) * (0.7 + 0.5 * near) * vis));
        el.setAttribute('stroke-width', (1.4 * (1 - 0.4 * v.stretch) + near * 0.6).toFixed(2));
        strain.style.opacity = String(v.stretch * 0.95 * vis);
      }

      // ---- undertrace
      for (let i = 0; i < ghostEls.current.length; i++) {
        const el = ghostEls.current[i];
        if (!el) continue;
        const g = f.ghost[i];
        if (!g || f.layers.ghost < 0.01) {
          el.style.opacity = '0';
          continue;
        }
        el.setAttribute('x1', g.ax.toFixed(1));
        el.setAttribute('y1', g.ay.toFixed(1));
        el.setAttribute('x2', g.bx.toFixed(1));
        el.setAttribute('y2', g.by.toFixed(1));
        el.style.opacity = f.layers.ghost.toFixed(3);
        // thins out as it fades: loud = active structure, faint = residual memory
        el.setAttribute('stroke-width', (0.7 + 0.8 * Math.min(1, f.layers.ghost / 0.55)).toFixed(2));
      }

      // ---- transfer trails: where each node started this scene -> where it is now
      const origins = f.origins;
      for (const def of NODES) {
        const el = trailEls.current[def.id];
        if (!el) continue;
        const o = origins?.[def.id];
        const v = f.nodes[def.id];
        if (!o || f.layers.trail < 0.01 || v.a < 0.5) {
          el.style.opacity = '0';
          continue;
        }
        const moved = Math.hypot(v.x - o.x, v.y - o.y);
        el.setAttribute('x1', o.x.toFixed(1));
        el.setAttribute('y1', o.y.toFixed(1));
        el.setAttribute('x2', v.x.toFixed(1));
        el.setAttribute('y2', v.y.toFixed(1));
        el.style.opacity = (f.layers.trail * Math.min(1, moved / 40) * 0.6).toFixed(3);
      }

      const dotSeen = new Set<string>();
      let dotIdx = 0;
      for (const g of f.ghost) {
        for (const [gx, gy] of [[g.ax, g.ay], [g.bx, g.by]]) {
          const key = `${Math.round(gx)}:${Math.round(gy)}`;
          if (dotSeen.has(key) || dotIdx >= ghostDots.current.length) continue;
          dotSeen.add(key);
          const dot = ghostDots.current[dotIdx++];
          if (!dot) continue;
          dot.setAttribute('cx', gx.toFixed(1));
          dot.setAttribute('cy', gy.toFixed(1));
          dot.style.opacity = f.layers.ghost.toFixed(3);
        }
      }
      for (let i = dotIdx; i < ghostDots.current.length; i++) {
        const dot = ghostDots.current[i];
        if (dot) dot.style.opacity = '0';
      }

      // ---- nodes
      for (const def of NODES) {
        const el = nodeEls.current[def.id];
        if (!el) continue;
        const v = f.nodes[def.id];
        if (v.a <= 0.005) {
          el.style.opacity = '0';
          continue;
        }
        const near = Math.max(0, 1 - Math.hypot(v.x - focusPt.x, v.y - focusPt.y) / attR) * att;
        el.setAttribute('transform', `translate(${v.x.toFixed(1)} ${v.y.toFixed(1)}) scale(${(1 + near * 0.1).toFixed(3)})`);
        el.style.opacity = v.a.toFixed(3);
        if (toneCache.current[def.id] !== v.tone) {
          toneCache.current[def.id] = v.tone;
          el.setAttribute('data-tone', v.tone);
        }
        const label = labelEls.current[def.id];
        if (label) label.style.opacity = String(0.62 + 0.38 * near);
      }

      // ---- regions (soft glow, crisp hull, caption)
      for (const reg of REGIONS) {
        const pts: Array<[number, number]> = [];
        let minY = Infinity;
        let maxY = -Infinity;
        let cx = 0;
        for (const id of reg.members) {
          const v = f.nodes[id];
          if (v.a > 0.4) {
            pts.push([v.x, v.y]);
            cx += v.x;
            if (v.y < minY) minY = v.y;
            if (v.y > maxY) maxY = v.y;
          }
        }
        const soft = softEls.current[reg.id];
        const crisp = crispEls.current[reg.id];
        const cap = capEls.current[reg.id];
        if (pts.length === 0) {
          if (soft) soft.style.opacity = '0';
          if (crisp) crisp.style.opacity = '0';
          if (cap) cap.style.opacity = '0';
          continue;
        }
        const hull = convexHull(pts);
        let d = '';
        if (hull.length === 1) d = `M${hull[0][0].toFixed(1)} ${hull[0][1].toFixed(1)}l0.01 0`;
        else d = 'M' + hull.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L') + (hull.length > 2 ? 'Z' : '');
        const dashedOnly = reg.dashed === true;
        if (soft) {
          soft.setAttribute('d', d);
          soft.style.opacity = String(f.layers.soft * (dashedOnly ? 0.5 : 1));
        }
        if (crisp) {
          crisp.setAttribute('d', d);
          crisp.style.opacity = String(f.layers.crisp * (dashedOnly ? 0 : 1));
        }
        if (cap) {
          const nar = layout === 'narrow' && reg.narrow && reg.narrow !== 'hidden' ? reg.narrow : null;
          const hidden = layout === 'narrow' && reg.narrow === 'hidden';
          cap.setAttribute('x', (cx / pts.length + (nar ? nar.dx : (reg.capDx ?? 0) * (layout === 'wide' ? 1 : 0.6))).toFixed(1));
          cap.setAttribute('y', ((reg.capDy > 0 && !nar ? maxY : minY) + (nar ? nar.dy : reg.capDy * (layout === 'wide' ? 1 : 0.75))).toFixed(1));
          cap.style.opacity = hidden ? '0' : f.layers.caption.toFixed(3);
        }
      }

      // ---- Coach: where it looks (the real Coach looks with its eyes; there is no beam)
      const state = f.coach.state;
      let aimX = 0;
      let aimY = 0;
      const gazeX = hasFocus ? focusPt.x : dims.w * 0.5;
      const gazeY = hasFocus ? focusPt.y : dims.h * 0.5;
      const gdx = gazeX - coachPos[0];
      const gdy = gazeY - coachPos[1];
      const gd = Math.hypot(gdx, gdy) || 1;
      if (state !== 'uncertain') {
        const mag = hasFocus ? 1 : 0.35;
        aimX = (gdx / gd) * mag;
        aimY = (gdy / gd) * mag;
      }
      // SVG y points down, the Coach contract's aim points up
      const aim = aimStable.next(quantizeAim(aimX, -aimY), now, reduced);
      spriteHandle.current?.set({ state: toRenderState(state), aim, motion: reduced ? 'reduced' : 'full' }, now);

      const attEl2 = attEl.current;
      if (attEl2) {
        attEl2.setAttribute('cx', focusPt.x.toFixed(1));
        attEl2.setAttribute('cy', focusPt.y.toFixed(1));
        attEl2.style.opacity = (att * 0.9).toFixed(3);
      }

      if (running) raf = requestAnimationFrame(paint);
    };

    const run = (): void => {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(paint);
    };
    const halt = (): void => {
      running = false;
      cancelAnimationFrame(raf);
    };
    loop.current = { run, halt };
    if (activeRef.current) run();
    else {
      // one frame so a graph that mounts offscreen still has its first composition on it
      running = true;
      raf = requestAnimationFrame((t) => {
        paint(t);
        running = false;
      });
    }
    return () => {
      halt();
      loop.current = null;
      controller.current = null;
    };
  }, [layout, reduced, dims.w, dims.h]);

  // visible or next to it: paint. Offscreen: halt and keep the last composition.
  useEffect(() => {
    activeRef.current = active;
    if (active) loop.current?.run();
    else loop.current?.halt();
  }, [active]);

  useEffect(() => {
    paceRef.current = pace;
    controller.current?.setPace(pace);
  }, [pace]);

  useEffect(() => {
    snapRef.current = snap;
  }, [snap]);

  // scene changes (declared after the snap sync so both see the same render)
  const first = useRef(true);
  useEffect(() => {
    sceneRef.current = scene;
    if (first.current) {
      first.current = false;
      return;
    }
    controller.current?.goTo(scene, snapRef.current);
  }, [scene]);

  const toSvg = (e: ReactPointerEvent): { x: number; y: number } | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const handlePointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (e.pointerType !== 'mouse') return;
    const p = toSvg(e);
    if (p) controller.current?.setPointer(p);
  };
  const handlePointerLeave = (): void => controller.current?.setPointer(null);

  const coachPos = COACH_POS[layout];

  return (
    <svg
      ref={svgRef}
      className="lv2m-svg"
      viewBox={`0 0 ${dims.w} ${dims.h}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Memory graph: how D2KIRO's picture of your games changes from match 1 to match 56"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <defs>
        <filter id="lv2m-blur-soft" filterUnits="userSpaceOnUse" x="-200" y="-200" width="1600" height="1200">
          <feGaussianBlur stdDeviation="26" />
        </filter>
        <radialGradient id="lv2m-att-grad">
          <stop offset="0" stopColor="var(--lv2m-cyan)" stopOpacity="0.16" />
          <stop offset="1" stopColor="var(--lv2m-cyan)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <g className="lv2m-fields">
        {REGIONS.map((r) => (
          <g key={r.id} data-tone={r.tone}>
            <path ref={(el) => void (softEls.current[r.id] = el)} className="lv2m-field-soft" filter="url(#lv2m-blur-soft)" style={{ opacity: 0 }} />
            <path ref={(el) => void (crispEls.current[r.id] = el)} className="lv2m-field-crisp" style={{ opacity: 0 }} />
          </g>
        ))}
      </g>

      <circle ref={attEl} className="lv2m-attention" r={150 * dims.scale + 40} fill="url(#lv2m-att-grad)" style={{ opacity: 0 }} />

      <g className="lv2m-ghosts">
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} ref={(el) => void (ghostEls.current[i] = el)} className="lv2m-ghost" style={{ opacity: 0 }} />
        ))}
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <circle key={i} ref={(el) => void (ghostDots.current[i] = el)} className="lv2m-ghost-dot" r="7" style={{ opacity: 0 }} />
        ))}
      </g>

      <g className="lv2m-trails">
        {NODES.map((n) => (
          <line key={n.id} ref={(el) => void (trailEls.current[n.id] = el)} className="lv2m-trail" data-tone={n.tone} style={{ opacity: 0 }} />
        ))}
      </g>

      <g className="lv2m-links">
        {LINKS.map((l) => (
          <g key={l.id} data-tone={l.tone}>
            <line ref={(el) => void (strainEls.current[l.id] = el)} className="lv2m-link-strain" style={{ opacity: 0 }} />
            <line ref={(el) => void (linkEls.current[l.id] = el)} className="lv2m-link" style={{ opacity: 0 }} />
          </g>
        ))}
      </g>

      <g className="lv2m-captions">
        {REGIONS.map((r) => (
          <text key={r.id} ref={(el) => void (capEls.current[r.id] = el)} className="lv2m-caption" textAnchor="middle" style={{ opacity: 0 }}>
            {r.caption}
          </text>
        ))}
      </g>

      <g className="lv2m-nodes">
        {NODES.map((n) => {
          const dir = layout === 'wide' ? n.dir : n.dirNarrow;
          const lab = labelAttrs(dir, n.r);
          return (
            <g
              key={n.id}
              ref={(el) => void (nodeEls.current[n.id] = el)}
              className="lv2m-node"
              data-kind={n.kind}
              data-tone={n.tone}
              data-node={n.id}
              style={{ opacity: 0 }}
            >
              {n.kind === 'open' ? (
                <circle className="lv2m-node-open" r={n.r} />
              ) : (
                <>
                  <circle className="lv2m-node-halo" r={n.r + 5} />
                  <circle className="lv2m-node-body" r={n.r} />
                  <circle className="lv2m-node-core" r={Math.max(2, n.r * 0.38)} />
                </>
              )}
              <text
                ref={(el) => void (labelEls.current[n.id] = el)}
                className="lv2m-label"
                data-kind={n.kind}
                x={lab.x}
                y={lab.y}
                textAnchor={lab.anchor as 'start' | 'middle' | 'end'}
              >
                {n.label}
              </text>
            </g>
          );
        })}
      </g>

      <MemoryCoach x={coachPos[0]} y={coachPos[1]} width={COACH_SPRITE_WIDTH[layout]} handle={spriteHandle} warmSheet={scene >= 1} />
    </svg>
  );
}
