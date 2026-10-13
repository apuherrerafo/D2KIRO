'use client';

/**
 * MemoryCoach - the memory-size Coach: real Gold Master Base Form, pre-rendered (Coach Web Pack V1).
 * No Three.js, no canvas, no per-frame work unless the RECONSTRUCT filmstrip is running. States/aims are discrete
 * transparent stills that cross-fade on opacity only. Drawn inside an SVG host at (x, y), `width` viewBox units wide,
 * centred on the point. Image fetching is owned by the page's asset strategy (assets.ts), not by this component.
 */

import React, { useEffect, useImperativeHandle, useRef } from 'react';
import type { Ref } from 'react';
import { RECONSTRUCT, reconstructFrame, stillUrl } from './coach-renderer';
import type { CoachRenderInput, CoachRendererHandle } from './coach-renderer';

interface MemoryCoachProps {
  x: number;
  y: number;
  /** viewBox units */
  width: number;
  handle: Ref<CoachRendererHandle>;
  /** Start fetching + decoding the RECONSTRUCT filmstrip (hidden) so Match 24 never flashes an empty Coach. */
  warmSheet: boolean;
}

const FADE_MS = { full: 140, reduced: 200 } as const;
const REST = stillUrl({ state: 'watching', aim: 'center' });

export default function MemoryCoach({ x, y, width, handle, warmSheet }: MemoryCoachProps) {
  const root = useRef<SVGGElement | null>(null);
  const layers = useRef<Array<SVGImageElement | null>>([null, null]);
  const sheet = useRef<SVGSVGElement | null>(null);
  const sheetImage = useRef<SVGImageElement | null>(null);
  const front = useRef(0);
  const shown = useRef(REST);
  const latest = useRef<CoachRenderInput>({ state: 'watching', aim: 'center', motion: 'full' });
  const rec = useRef<{ start: number; frame: number } | null>(null);

  // requested from Match 08 on, not at mount: a visitor who never gets that far never pays for the filmstrip
  useEffect(() => {
    if (warmSheet && !sheetImage.current?.getAttribute('href')) sheetImage.current?.setAttribute('href', RECONSTRUCT.url);
  }, [warmSheet]);

  const apply = (input: CoachRenderInput): void => {
    const url = stillUrl(input);
    const el = root.current;
    if (el) {
      el.setAttribute('data-state', input.state);
      el.setAttribute('data-aim', input.aim);
      el.setAttribute('data-motion', input.motion);
    }
    if (url === shown.current) return;
    shown.current = url;
    const back = 1 - front.current;
    const inEl = layers.current[back];
    const outEl = layers.current[front.current];
    if (!inEl || !outEl) return;
    const ms = FADE_MS[input.motion];
    inEl.style.transition = `opacity ${ms}ms linear`;
    outEl.style.transition = `opacity ${ms}ms linear`;
    inEl.setAttribute('href', url);
    inEl.style.opacity = '1';
    outEl.style.opacity = '0';
    front.current = back;
  };

  const setSheetVisible = (visible: boolean, instant: boolean): void => {
    const s = sheet.current;
    if (!s) return;
    s.style.transition = instant ? 'none' : `opacity ${FADE_MS.full}ms linear`;
    s.style.opacity = visible ? '1' : '0';
  };

  useImperativeHandle(handle, () => ({
    set(input, tMs) {
      latest.current = input;
      const r = rec.current;
      if (!r) {
        apply(input);
        return;
      }
      // RECONSTRUCT owns the pixels; the newest semantic input waits for it to end
      const elapsed = tMs - r.start;
      if (elapsed >= RECONSTRUCT.durationMs || input.motion === 'reduced') {
        rec.current = null;
        root.current?.removeAttribute('data-reconstructing');
        apply(input);
        setSheetVisible(false, input.motion === 'reduced');
        return;
      }
      const frame = reconstructFrame(elapsed);
      if (frame !== r.frame) {
        r.frame = frame;
        const col = frame % RECONSTRUCT.cols;
        const row = Math.floor(frame / RECONSTRUCT.cols);
        sheet.current?.setAttribute('viewBox', `${col * RECONSTRUCT.framePx} ${row * RECONSTRUCT.framePx} ${RECONSTRUCT.framePx} ${RECONSTRUCT.framePx}`);
      }
    },
    reconstruct(tMs) {
      if (latest.current.motion === 'reduced' || rec.current) return;
      rec.current = { start: tMs, frame: 0 };
      if (!sheetImage.current?.getAttribute('href')) sheetImage.current?.setAttribute('href', RECONSTRUCT.url);
      root.current?.setAttribute('data-reconstructing', 'true');
      sheet.current?.setAttribute('viewBox', `0 0 ${RECONSTRUCT.framePx} ${RECONSTRUCT.framePx}`);
      setSheetVisible(true, true);
      // the stills are hidden instantly underneath: the filmstrip's first frame is the assembled Coach
      for (const l of layers.current) {
        if (l) {
          l.style.transition = 'none';
          l.style.opacity = '0';
        }
      }
      // force the layer that was in front to be re-shown by apply() when the event ends
      shown.current = '';
      front.current = 1 - front.current;
    },
  }));

  const half = width / 2;
  const cell = width * RECONSTRUCT.boxScale;
  return (
    <g ref={root} className="lv2-mcoach" data-testid="memory-coach" data-state="watching" data-aim="center" data-motion="full" transform={`translate(${x} ${y})`}>
      <g className="lv2-mcoach-bob">
        {[0, 1].map((i) => (
          <image
            key={i}
            ref={(el) => void (layers.current[i] = el)}
            href={i === 0 ? REST : undefined}
            x={-half}
            y={-half}
            width={width}
            height={width}
            preserveAspectRatio="xMidYMid meet"
            style={{ opacity: i === 0 ? 1 : 0 }}
            aria-hidden="true"
          />
        ))}
        <svg
          ref={sheet}
          x={-cell / 2}
          y={-cell / 2}
          width={cell}
          height={cell}
          viewBox={`0 0 ${RECONSTRUCT.framePx} ${RECONSTRUCT.framePx}`}
          style={{ opacity: 0, overflow: 'hidden' }}
          aria-hidden="true"
        >
          <image ref={sheetImage} width={RECONSTRUCT.framePx * RECONSTRUCT.cols} height={RECONSTRUCT.framePx * (RECONSTRUCT.frames / RECONSTRUCT.cols)} />
        </svg>
      </g>
    </g>
  );
}
