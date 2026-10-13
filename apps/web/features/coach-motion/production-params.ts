type Raw = Record<string, string | string[] | undefined>;

export type ProdPanel = "live" | "384" | "512";
export interface ProductionLabProps {
  panels: readonly ProdPanel[];
  theme: "dark" | "light";
  /** initial-ready deadline of the Motion V2 panels, ms (the failure tests shorten it) */
  timeoutMs: number | undefined;
  /** canvas device-pixel cap; 2 matches the Live canvas, 3 is for the physical DPR3 phone check */
  maxDpr: number;
}

const ALL: readonly ProdPanel[] = ["live", "384", "512"];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Query params are external input: checked against closed sets / ranges.
    ?panels=384,512 mounts only the prerendered panels (the page the network guard uses: no Three.js, no model) · ?theme=light|dark · ?timeout=ms · ?maxdpr=1..3 */
export function parseProductionParams(params: Raw): ProductionLabProps {
  const asked = (first(params.panels) ?? "").split(",").filter((p): p is ProdPanel => (ALL as readonly string[]).includes(p));
  const timeout = Number(first(params.timeout));
  const dpr = Number(first(params.maxdpr));
  return {
    panels: asked.length ? ALL.filter((p) => asked.includes(p)) : ALL,
    theme: first(params.theme) === "light" ? "light" : "dark",
    timeoutMs: Number.isFinite(timeout) && timeout >= 100 && timeout <= 60000 ? Math.round(timeout) : undefined,
    maxDpr: Number.isFinite(dpr) && dpr >= 1 && dpr <= 3 ? dpr : 2,
  };
}
