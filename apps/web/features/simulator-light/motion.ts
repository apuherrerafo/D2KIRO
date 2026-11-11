// Fase 3D · conductores de movimiento del prototipo. NO dibuja ningún efecto: solo DISPARA los canónicos, igual que los demos del Master
// (`canonical/motion/demos-focus.tsx` y `demos-data.tsx`, en el checkpoint b8c05619):
//   · `play` (WAAPI de una pasada; con movimiento reducido aplica el estado final y no anima),
//   · tokens `SNAPPY` / `DURATIONS` / `TIMING` (timing.ts) y `SPRINGS.settle` / `OPACITY` / `DISTANCES` / `EASINGS` (motion-tokens.ts),
//   · las clases de forma del DS (`.cm-corners`, `.cm-live-*`), que viven en motion.css.
// Regla del DS: nada se repite solo. Cada función corre UNA vez por cambio de datos o por una acción del usuario.

import { useEffect, useRef } from "react";
import { play } from "@/design/canonical/motion/play";
import { DURATIONS, SNAPPY, TIMING } from "@/design/canonical/motion/timing";
import { DISTANCES, EASINGS, OPACITY, SPRINGS, sampleSpring } from "@/design/round-3a/motion-tokens";

const SETTLE_PANEL = sampleSpring(SPRINGS.settle); // = SETTLE de timing.ts (337 ms, 0 % rebote)

const CORNER_OFFSETS = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Cuánto hay que desplazar (px) un marco ya colocado en `to` para que parezca salir de `from`. Pura. */
export function travelDelta(from: Box, to: Box): { x: number; y: number } {
  return { x: from.left - to.left, y: from.top - to.top };
}

/** Caja de un elemento relativa a otro (documento → contenedor). Pura sobre rectángulos. */
export function boxWithin(container: Pick<DOMRect, "left" | "top">, rect: Pick<DOMRect, "left" | "top" | "width" | "height">): Box {
  return { left: rect.left - container.left, top: rect.top - container.top, width: rect.width, height: rect.height };
}

/** Adquisición (patrón `closeCorners` del Master): las cuatro esquinas cierran desde `acquirePx` hacia el borde sobre `SNAPPY`, una vez. */
function closeCorners(host: Element, reduced: boolean) {
  host.querySelectorAll<HTMLElement>(".cm-corners i").forEach((corner, index) => {
    const offset = CORNER_OFFSETS[index];
    const away = `${offset.x * TIMING.acquirePx}px ${offset.y * TIMING.acquirePx}px`;
    play(corner, "close", [{ translate: away, opacity: OPACITY.soft }, { translate: "0 0", opacity: 1 }], { duration: SNAPPY.durationMs, easing: SNAPPY.easing }, reduced);
  });
}

/** Las esquinas se ven solo mientras dura la señal y se disuelven (mismo ciclo de vida que el `chm-acquire` del retrato recomendado). */
function echoCorners(host: Element, reduced: boolean) {
  const corners = host.querySelector<HTMLElement>(".p3d-corners");
  if (corners === null) return;
  play(corners, "life", [{ opacity: 1 }, { offset: 0.7, opacity: 1 }, { opacity: 0 }], { duration: SNAPPY.durationMs + DURATIONS.slow, easing: EASINGS.out }, reduced);
}

/** Llegó algo que merece atención (una recomendación nueva, un rival revelado): las esquinas cierran una vez sobre `host`. */
export function acquireCorners(host: Element | null, reduced: boolean) {
  if (host === null) return;
  closeCorners(host, reduced);
  echoCorners(host, reduced);
}

/**
 * La atención pasa de una tarjeta a otra (movimiento 09 «las esquinas siguen al objetivo»): el marco ya está colocado sobre el destino y se
 * desplaza desde el origen con `SNAPPY`, una vez. Sin origen (primera selección) es una adquisición. Reducido: no viaja, el segmento del destino ya cambió.
 */
export function transferCorners(overlay: HTMLElement, from: Box | null, to: Box, reduced: boolean) {
  overlay.style.left = `${to.left}px`;
  overlay.style.top = `${to.top}px`;
  overlay.style.width = `${to.width}px`;
  overlay.style.height = `${to.height}px`;
  if (from === null) {
    acquireCorners(overlay, reduced);
    return;
  }
  const delta = travelDelta(from, to);
  play(overlay, "travel", [{ translate: `${delta.x}px ${delta.y}px` }, { translate: "0 0" }], { duration: SNAPPY.durationMs, easing: SNAPPY.easing }, reduced);
  echoCorners(overlay, reduced);
}

/** Contenido que cambia de dueño (el panel de análisis): se desliza `DISTANCES.short` sobre el resorte `settle` (337 ms, sin rebote). NO baja la opacidad: el texto se lee desde el primer cuadro. */
export function settleIn(element: HTMLElement | null, reduced: boolean) {
  if (element === null) return;
    play(element, "settle-in", [{ translate: `0 ${DISTANCES.short}px` }, { translate: "0 0" }], { duration: SETTLE_PANEL.durationMs, easing: SETTLE_PANEL.easing }, reduced);
}

/** Cambio de estado en vivo (movimiento 05): el anillo del punto late UNA vez (`pulseMs`) y el barrido corre UNA vez (`sweepMs`). */
export function liveChange(root: Element | null, reduced: boolean) {
  if (root === null) return;
  const ring = root.querySelector<HTMLElement>('[data-motion-part="ring"]');
  const sweep = root.querySelector<HTMLElement>('[data-motion-part="sweep"]');
  if (ring !== null) play(ring, "ring", [{ opacity: 0.9, scale: 0.5 }, { opacity: 0, scale: 1.45 }], { duration: TIMING.pulseMs, easing: EASINGS.out }, reduced);
  if (sweep !== null) play(sweep, "sweep", [{ opacity: 1, transform: "scaleX(0)" }, { offset: 0.7, opacity: 1, transform: "scaleX(1)" }, { opacity: 0, transform: "scaleX(1)" }], { duration: TIMING.sweepMs, easing: EASINGS.out }, reduced);
}

/** Ejecuta `onChange` cuando `value` cambia DESPUÉS del primer render (nunca al montar: una pantalla que carga no se anima sola). */
export function useChanged<T>(value: T, onChange: (next: T, previous: T) => void) {
  const previous = useRef(value);
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => {
    if (Object.is(previous.current, value)) return;
    const before = previous.current;
    previous.current = value;
    latest.current(value, before);
  }, [value]);
}
