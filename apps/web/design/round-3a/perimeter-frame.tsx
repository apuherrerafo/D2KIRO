/* Perimeter / stroke frame. A spectral segment lives on the component's own border and travels to
   the edge that matters. Idle = no segment (the hairline rests). Update = one brief flash on the
   segment, then rest. The segment takes the shortest way round, like a signal being routed. */
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "./lab-context";

export type PerimeterEdge = "top" | "right" | "bottom" | "left";

type Size = { height: number; width: number };

const SEGMENT_SHARE = 0.62;
/* Motion Canonical V1: one constant length on every edge, long enough to read as the stroke travelling (not a tick). */
const CANONICAL_SEGMENT_SHARE = 0.9;

function edgeGeometry(edge: PerimeterEdge, { height, width }: Size, constantLength = false) {
  const centers: Record<PerimeterEdge, number> = {
    top: width / 2,
    right: width + height / 2,
    bottom: width + height + width / 2,
    left: 2 * width + height + height / 2,
  };
  /* Motion Canonical V1: a constant segment length so the dash does not morph while it travels. */
  const edgeLength = constantLength ? Math.min(width, height) : edge === "top" || edge === "bottom" ? width : height;
  const length = constantLength ? Math.min(width, height) * CANONICAL_SEGMENT_SHARE : edgeLength * SEGMENT_SHARE;
  return { length, start: centers[edge] - length / 2 };
}

/** Picks the equivalent offset (offset + k·perimeter) closest to the current one. */
function nearestOffset(target: number, current: number, perimeter: number) {
  if (perimeter <= 0) return target;
  const turns = Math.round((current - target) / perimeter);
  return target + turns * perimeter;
}

function useElementSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<Size>({ height: 0, width: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setSize({ height: element.offsetHeight, width: element.offsetWidth });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

const TICK = 7;

/** Four open corner ticks on the same path the segment travels — the border is implied, not drawn. */
function cornerTicks({ height, width }: Size) {
  const right = width - 0.5;
  const bottom = height - 0.5;
  return [
    `M0.5 ${TICK}V0.5H${TICK}`,
    `M${right - TICK} 0.5H${right}V${TICK}`,
    `M${right} ${bottom - TICK}V${bottom}H${right - TICK}`,
    `M${TICK} ${bottom}H0.5V${bottom - TICK}`,
  ].join("");
}

export function PerimeterFrame({
  canonical = false,
  children,
  className = "",
  edge,
  label,
  pulse = 0,
  rest = "hairline",
  source = "strategic",
}: {
  /** Motion Canonical V1 behaviour: constant segment length + opacity-only flash. Default off: Round 3 / Landing unchanged. */
  canonical?: boolean;
  children: ReactNode;
  className?: string;
  /** The edge carrying attention. `null` = idle: nothing moves, nothing glows. */
  edge: PerimeterEdge | null;
  label: string;
  /** Bump to play one update flash on the segment. */
  pulse?: number;
  /** How the border looks at rest. Round 3B: "corners" marks the path without enclosing the content. */
  rest?: "hairline" | "corners" | "none";
  /** Deterministic default never receives the spectral segment (motion must not invent confidence). */
  source?: "strategic" | "default";
}) {
  const frame = useRef<HTMLDivElement>(null);
  const size = useElementSize(frame);
  const reduced = useReducedMotion();
  const gradientId = useId().replaceAll(":", "");
  const perimeter = 2 * (size.width + size.height);
  const geometry = edge ? edgeGeometry(edge, size, canonical) : null;
  const routeKey = `${edge ?? "idle"}:${size.width}x${size.height}`;
  const [route, setRoute] = useState({ key: "", offset: 0 });
  if (geometry && route.key !== routeKey) {
    setRoute({ key: routeKey, offset: nearestOffset(-geometry.start, route.offset, perimeter) });
  }
  const offset = geometry ? nearestOffset(-geometry.start, route.offset, perimeter) : route.offset;
  const flashKey = pulse;
  const dash = geometry ? `${geometry.length} ${Math.max(0, perimeter - geometry.length)}` : `0 ${perimeter}`;

  return (
    <div
      aria-label={label}
      className={`r3-perimeter ${className}`}
      data-canonical={canonical ? "true" : undefined}
      data-edge={edge ?? "idle"}
      data-rest={rest}
      data-reduced={reduced ? "true" : "false"}
      data-source={source}
      ref={frame}
      role="group"
    >
      {children}
      <svg aria-hidden="true" className="r3-perimeter-svg" height={size.height} viewBox={`0 0 ${size.width || 1} ${size.height || 1}`} width={size.width}>
        <defs>
          <linearGradient gradientUnits="userSpaceOnUse" id={gradientId} x1="0" x2={size.width} y1="0" y2={size.height}>
            <stop offset="0" stopColor="var(--r3-spec-pink)" />
            <stop offset="0.5" stopColor="var(--r3-spec-cyan)" />
            <stop offset="1" stopColor="var(--r3-spec-lime)" />
          </linearGradient>
        </defs>
        {rest === "hairline" ? <rect className="r3-perimeter-rest" height={Math.max(0, size.height - 1)} rx="3" width={Math.max(0, size.width - 1)} x="0.5" y="0.5" /> : null}
        {rest === "corners" ? <path className="r3-perimeter-rest" d={cornerTicks(size)} /> : null}
        <rect
          className="r3-perimeter-segment"
          data-visible={geometry && source === "strategic" ? "true" : "false"}
          height={Math.max(0, size.height - 1)}
          rx="3"
          stroke={`url(#${gradientId})`}
          strokeDasharray={dash}
          strokeDashoffset={offset}
          width={Math.max(0, size.width - 1)}
          x="0.5"
          y="0.5"
        />
        {geometry && source === "strategic" && flashKey > 0 ? (
          <rect
            className="r3-perimeter-flash"
            height={Math.max(0, size.height - 1)}
            key={flashKey}
            rx="3"
            stroke={`url(#${gradientId})`}
            strokeDasharray={dash}
            strokeDashoffset={offset}
            width={Math.max(0, size.width - 1)}
            x="0.5"
            y="0.5"
          />
        ) : null}
      </svg>
    </div>
  );
}
