type Raw = Record<string, string | string[] | undefined>;

/** current / live / v2 = the first micro-prototype panels. a / b / c = the production-format candidates (see FORMATS). */
export type PanelId = "current" | "live" | "v2" | "a" | "b" | "c";
export type CoachMotionLabProps = { panels: readonly PanelId[]; theme: "dark" | "light"; inspect: boolean };

const ALL: readonly PanelId[] = ["current", "live", "v2", "a", "b", "c"];
const DEFAULT: readonly PanelId[] = ["current", "live", "v2"];
/** `?mode=format`: LIVE against the three production-format candidates. */
const FORMAT: readonly PanelId[] = ["live", "a", "b", "c"];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Query params are external input: checked against a closed set. `?panels=v2` mounts only the prerendered panel
    (that is the page used to prove the runtime never fetches Three.js or the 7.7 MB model). `?inspect=1` shows every
    stage at 2x, nearest-neighbour, for looking at compression artifacts only. */
export function parseCoachMotionParams(params: Raw): CoachMotionLabProps {
  const asked = (first(params.panels) ?? "").split(",").filter((p): p is PanelId => (ALL as readonly string[]).includes(p));
  const fallback = first(params.mode) === "format" ? FORMAT : DEFAULT;
  return { panels: asked.length ? ALL.filter((p) => asked.includes(p)) : fallback, theme: first(params.theme) === "light" ? "light" : "dark", inspect: first(params.inspect) === "1" };
}
