import type { MotionMode } from "@/design/round-3a/lab-context";
import type { CoachOverride } from "./coach/HeroCoach";
import type { StageQuality } from "./coach/live-stage";
import type { HeroLoopLabProps } from "./HeroLoopLab";
import { BEATS_BY_SCENARIO } from "./beats";
import { LOOP_SCENARIOS, type ScenarioId } from "./scenarios";

type Raw = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Query params are external input: each one is checked against a closed set, else the default. */
export function parseHeroLoopParams(params: Raw): HeroLoopLabProps {
  const rawScenario = first(params.scenario)?.toUpperCase();
  const scenario: ScenarioId = (LOOP_SCENARIOS.find((s) => s.id === rawScenario)?.id ?? "A") as ScenarioId;
  const index = LOOP_SCENARIOS.findIndex((s) => s.id === scenario);
  const rawBeat = first(params.beat);
  const beat = rawBeat && BEATS_BY_SCENARIO[index].some((b) => b.id === rawBeat) ? rawBeat : undefined;
  const rawCoach = first(params.coach);
  const coach: CoachOverride = rawCoach === "live" || rawCoach === "sprite" ? rawCoach : "auto";
  const rawQuality = first(params.q);
  const quality: StageQuality = rawQuality === "full" ? "full" : "lite";
  const rawMotion = first(params.motion);
  const motion: MotionMode = rawMotion === "reduced" || rawMotion === "full" ? rawMotion : "system";
  return {
    beat,
    calls: first(params.calls) !== "0",
    coach,
    motion,
    // a fixed beat is a review capture: it must hold
    pause: first(params.pause) === "1" || beat !== undefined,
    quality,
    scenario,
    theme: first(params.theme) === "light" ? "light" : "dark",
  };
}
