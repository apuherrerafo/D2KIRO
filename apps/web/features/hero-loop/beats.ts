import { buildBeats, type Beat } from "./loop";
import { LOOP_SCENARIOS } from "./scenarios";

/** Server- and client-safe: the page reads it to validate `?beat=`, the clock reads it to walk the loop. */
export const BEATS_BY_SCENARIO: readonly (readonly Beat[])[] = LOOP_SCENARIOS.map(buildBeats);
