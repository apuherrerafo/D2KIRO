/* Metric — value first, then a written-out muted label (data grammar, Council B).
   Operational register: IBM Plex Sans 600 (its default figures are already tabular — measured equal
   advances at 400/600/700; there is no `tnum` feature to switch on). Expressive register (≥ 48 px:
   hero, reward, ghost numeral): Syne 700 with `tnum` + `lnum`, so a live value never jitters.
   Plex Mono is never a number carrier — only IDs, patch and code. */
import type { ReactNode } from "react";

export type MetricRegister = "operational" | "expressive";

function MetricDelta({ delta }: { delta?: ReactNode }) {
  if (!delta) return null;
  return <span className="cx-metric-delta">{delta}</span>;
}

export function Metric({ delta, label, register = "operational", value }: { delta?: ReactNode; label: string; register?: MetricRegister; value: string }) {
  return (
    <div className="cx-metric" data-register={register}>
      <span className="cx-metric-value">{value}</span>
      <MetricDelta delta={delta} />
      <span className="cx-metric-label">{label}</span>
    </div>
  );
}
