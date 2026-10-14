/* LANDING V3 · a seam: the thread handed from one chapter to the next, on the centre line. */
import type { CSSProperties } from "react";

export function Seam({ height = 96 }: { height?: number }) {
  const style = { "--h": `${height}px`, "--x": "50%" } as CSSProperties;
  return (
    <div className="wrap">
      <div aria-hidden="true" className="seam" style={style}><span className="seam-line" /><span className="seam-dot" /></div>
    </div>
  );
}
