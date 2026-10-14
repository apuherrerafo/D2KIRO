/* LANDING V3 · 2 · HANDOFF. The Hero's cyan trace continues below the stage and becomes the first nodes of the living decision graph.
   It sits on the centre line and never crosses the headline. Decorative: the sentence is the content. */
import { HANDOFF } from "../copy";

const FRAGMENTS = [
  { x: 128, y: 38, r: 12, s: 7, o: 0.32, d: 0 },
  { x: 108, y: 70, r: -8, s: 6, o: 0.2, d: -1.4 },
  { x: 228, y: 26, r: 30, s: 8, o: 0.42, d: -2.6 },
  { x: 318, y: 54, r: -14, s: 7, o: 0.34, d: -0.8 },
  { x: 396, y: 74, r: 20, s: 6, o: 0.2, d: -3.4 },
  { x: 300, y: 134, r: -24, s: 7, o: 0.3, d: -2 },
  { x: 140, y: 150, r: 8, s: 6, o: 0.2, d: -4.2 },
  { x: 380, y: 122, r: 36, s: 6, o: 0.18, d: -1.1 },
] as const;

export function Handoff() {
  return (
    <div className="wrap">
      <div className="handoff" data-testid="handoff">
        <svg aria-hidden="true" className="handoff-svg" focusable="false" viewBox="0 0 520 176">
          <path className="ho-edge" d="M170 56 C 215 56, 240 62, 260 74" />
          <path className="ho-edge" d="M352 88 C 310 88, 280 92, 260 100" />
          <path className="ho-edge" d="M196 128 C 230 128, 248 126, 260 120" />
          <path className="ho-trace" d="M260 0 V158" />
          <path className="ho-pulse" d="M260 0 V158" pathLength="100" />
          <circle className="ho-node" cx="170" cy="56" r="4" />
          <circle className="ho-node" cx="352" cy="88" r="4" />
          <circle className="ho-node" cx="196" cy="128" r="4" />
          {FRAGMENTS.map((f) => (
            <g key={`${f.x}-${f.y}`} transform={`translate(${f.x} ${f.y}) rotate(${f.r})`}>
              <rect className="ho-frag" height={f.s} opacity={f.o} rx="1.5" style={{ animationDelay: `${f.d}s` }} width={f.s} x={-f.s / 2} y={-f.s / 2} />
            </g>
          ))}
          <g transform="translate(260 166) rotate(45)"><rect className="ho-end" height="13" rx="2" width="13" x="-6.5" y="-6.5" /></g>
        </svg>
        <p className="handoff-text">{HANDOFF}</p>
      </div>
    </div>
  );
}
