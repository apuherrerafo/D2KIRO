import type { MotionMode } from "@/design/round-3a/lab-context";
import { BEATS, BEAT_FOR_PHASE, type BeatId, type Phase } from "./model";

type Raw = Record<string, string | string[] | undefined>;

export type LabTheme = "dark" | "light";

export type CounterfactualLabProps = {
  /** A fixed beat is a review capture: it holds. */
  beat?: BeatId;
  coach: boolean;
  motion: MotionMode;
  theme: LabTheme;
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const PHASES: readonly Phase[] = ["generic", "evidence", "personal"];

/** Query params are external input: each is checked against a closed set, else the default.
    ?phase=generic|evidence|personal  ?beat=generic|evidence|rerank|call|quiet  ?theme=dark|light  ?motion=full|reduced  ?coach=1|0 */
export function parseCounterfactualParams(params: Raw): CounterfactualLabProps {
  const rawBeat = first(params.beat);
  const rawPhase = first(params.phase);
  const named = BEATS.find((b) => b.id === rawBeat)?.id;
  const phased = PHASES.find((p) => p === rawPhase);
  const beat: BeatId | undefined = named ?? (phased ? BEAT_FOR_PHASE[phased] : undefined);
  const rawMotion = first(params.motion);
  return {
    beat,
    coach: first(params.coach) !== "0",
    motion: rawMotion === "reduced" || rawMotion === "full" ? rawMotion : "system",
    theme: first(params.theme) === "light" ? "light" : "dark",
  };
}
