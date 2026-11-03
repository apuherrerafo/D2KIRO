/* Glass — medium-protagonist material (Julio, 3B brief) at three recorded amounts:
   "a" = current 3B recipe (`.r3b-glass`, kept for comparison), "b" = V1.1 canonical (one step
   stronger), "c" = rejection boundary (aria-hidden specimen only). Glass is a layer over real content:
   it needs a bounded backdrop (ghost numeral ≤ --cx-ghost) or it reads as another dark rectangle. */
import type { ReactNode } from "react";

export type GlassLevel = "a" | "b" | "c";

export type GlassProps = {
  children: ReactNode;
  className?: string;
  /** Level 4: masked 1 px spectral edge. Only what is active, selected or being read. */
  edge?: boolean;
  level?: GlassLevel;
  /** Surface-hierarchy level this glass plays (3 = protagonist, 4 = active / Coach attention). */
  surfaceLevel?: "3" | "4";
};

export function Glass({ children, className = "", edge = false, level = "b", surfaceLevel }: GlassProps) {
  const recovered = level === "a" ? "r3b-glass" : "";
  const edgeClass = edge ? "cx-glass--edge" : "";
  return (
    <div className={`cx-glass ${recovered} ${edgeClass} ${className}`.replace(/\s+/g, " ").trim()} data-glass-level={level} data-surface-level={surfaceLevel}>
      {children}
    </div>
  );
}
