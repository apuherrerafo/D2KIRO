import type { MotionMode } from "@/design/round-3a/lab-context";

type Raw = Record<string, string | string[] | undefined>;

export type PageTheme = "dark" | "light";

export type LandingV2Props = {
  motion: MotionMode;
  /** Only set when the query asks for one; otherwise the session's choice, then dark. */
  theme?: PageTheme;
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Query params are external input: each is checked against a closed set, else the default.
    ?theme=dark|light (first paint only; the toggle owns it afterwards)  ?motion=full|reduced (review captures) */
export function parseLandingV2Params(params: Raw): LandingV2Props {
  const rawMotion = first(params.motion);
  return {
    motion: rawMotion === "reduced" || rawMotion === "full" ? rawMotion : "system",
    theme: first(params.theme) === "light" ? "light" : first(params.theme) === "dark" ? "dark" : undefined,
  };
}
