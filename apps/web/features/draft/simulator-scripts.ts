// Espejo de apps/engine/src/simulator/scripts.json -- mismo patrón de sincronización a mano que
// types.ts (apps/web y apps/engine son dos procesos independientes, no un paquete compartido).
// Mismos dos guiones exactos, sin contenido nuevo (TSK-016, alcance: reutilizar, no inventar).

import type { DraftFormatId, HeroId, TeamSide } from "./types";

export type SimulatorEvent =
  | { type: "session_started"; format: DraftFormatId | "unknown"; patch: string }
  | { type: "local_side_identified"; side: TeamSide }
  | { type: "hero_banned"; hero: HeroId; side: TeamSide | "unknown" }
  | { type: "hero_picked"; hero: HeroId; side: TeamSide }
  | { type: "pick_reverted"; hero: HeroId; side: TeamSide }
  | { type: "session_ended"; reason: "completed" | "aborted" | "lost_capture" };

export interface SimulatorScriptEntry {
  event: SimulatorEvent;
  delayMs?: number;
}

export interface SimulatorScript {
  schema: "draft-script/v1";
  name: string;
  events: SimulatorScriptEntry[];
}

export type SimulatorScenarioId = "captainsMode" | "allPick";

export const SIMULATOR_SCENARIO_LABELS: Record<SimulatorScenarioId, string> = {
  captainsMode: "Captain Mode",
  allPick: "All Pick",
};

export const SIMULATOR_SCENARIOS: Record<SimulatorScenarioId, SimulatorScript> = {
  captainsMode: {
    schema: "draft-script/v1",
    name: "captains-mode-demo",
    events: [
      { event: { type: "session_started", format: "captains_mode", patch: "7.35d" }, delayMs: 0 },
      { event: { type: "local_side_identified", side: "radiant" }, delayMs: 500 },
      { event: { type: "hero_banned", hero: 14, side: "dire" }, delayMs: 2000 },
      { event: { type: "hero_banned", hero: 101, side: "radiant" }, delayMs: 2000 },
      { event: { type: "hero_banned", hero: 44, side: "dire" }, delayMs: 2000 },
      { event: { type: "hero_banned", hero: 6, side: "radiant" }, delayMs: 2000 },
      { event: { type: "hero_picked", hero: 8, side: "radiant" }, delayMs: 3000 },
      { event: { type: "hero_picked", hero: 86, side: "dire" }, delayMs: 3000 },
      { event: { type: "hero_banned", hero: 120, side: "radiant" }, delayMs: 2000 },
      { event: { type: "hero_banned", hero: 74, side: "dire" }, delayMs: 2000 },
      { event: { type: "hero_picked", hero: 35, side: "dire" }, delayMs: 3000 },
      { event: { type: "pick_reverted", hero: 35, side: "dire" }, delayMs: 800 },
      { event: { type: "hero_picked", hero: 46, side: "dire" }, delayMs: 3000 },
      { event: { type: "hero_picked", hero: 9, side: "radiant" }, delayMs: 3000 },
      { event: { type: "hero_banned", hero: 26, side: "dire" }, delayMs: 2000 },
      { event: { type: "hero_banned", hero: 5, side: "radiant" }, delayMs: 2000 },
      { event: { type: "hero_picked", hero: 2, side: "dire" }, delayMs: 3000 },
      { event: { type: "hero_picked", hero: 7, side: "radiant" }, delayMs: 3000 },
      { event: { type: "hero_picked", hero: 1, side: "dire" }, delayMs: 3000 },
      { event: { type: "hero_picked", hero: 3, side: "radiant" }, delayMs: 3000 },
      { event: { type: "hero_picked", hero: 4, side: "dire" }, delayMs: 3000 },
      { event: { type: "hero_picked", hero: 10, side: "radiant" }, delayMs: 3000 },
      { event: { type: "session_ended", reason: "completed" }, delayMs: 500 },
    ],
  },
  allPick: {
    schema: "draft-script/v1",
    name: "all-pick-demo",
    events: [
      { event: { type: "session_started", format: "all_pick", patch: "7.35d" }, delayMs: 0 },
      { event: { type: "local_side_identified", side: "dire" }, delayMs: 500 },
      { event: { type: "hero_banned", hero: 11, side: "radiant" }, delayMs: 1500 },
      { event: { type: "hero_banned", hero: 22, side: "unknown" }, delayMs: 1500 },
      { event: { type: "hero_banned", hero: 100, side: "dire" }, delayMs: 1500 },
      { event: { type: "hero_banned", hero: 101, side: "radiant" }, delayMs: 1500 },
      { event: { type: "hero_banned", hero: 102, side: "unknown" }, delayMs: 1500 },
      { event: { type: "hero_banned", hero: 103, side: "dire" }, delayMs: 1500 },
      { event: { type: "hero_banned", hero: 104, side: "radiant" }, delayMs: 1500 },
      { event: { type: "hero_banned", hero: 105, side: "unknown" }, delayMs: 1500 },
      { event: { type: "hero_banned", hero: 106, side: "dire" }, delayMs: 1500 },
      { event: { type: "hero_banned", hero: 107, side: "radiant" }, delayMs: 1500 },
      { event: { type: "hero_banned", hero: 108, side: "unknown" }, delayMs: 1500 },
      { event: { type: "hero_banned", hero: 109, side: "dire" }, delayMs: 1500 },
      { event: { type: "hero_banned", hero: 110, side: "radiant" }, delayMs: 1500 },
      { event: { type: "hero_banned", hero: 111, side: "unknown" }, delayMs: 1500 },
      { event: { type: "hero_banned", hero: 112, side: "dire" }, delayMs: 1500 },
      { event: { type: "hero_banned", hero: 113, side: "radiant" }, delayMs: 1500 },
      { event: { type: "hero_picked", hero: 18, side: "dire" }, delayMs: 2500 },
      { event: { type: "hero_picked", hero: 19, side: "radiant" }, delayMs: 2500 },
      { event: { type: "hero_picked", hero: 20, side: "dire" }, delayMs: 2500 },
      { event: { type: "pick_reverted", hero: 20, side: "dire" }, delayMs: 800 },
      { event: { type: "hero_picked", hero: 24, side: "dire" }, delayMs: 2500 },
      { event: { type: "hero_picked", hero: 23, side: "radiant" }, delayMs: 2500 },
      { event: { type: "hero_picked", hero: 26, side: "dire" }, delayMs: 2500 },
      { event: { type: "hero_picked", hero: 25, side: "radiant" }, delayMs: 2500 },
      { event: { type: "hero_picked", hero: 28, side: "dire" }, delayMs: 2500 },
      { event: { type: "hero_picked", hero: 27, side: "radiant" }, delayMs: 2500 },
      { event: { type: "hero_picked", hero: 30, side: "radiant" }, delayMs: 2500 },
      { event: { type: "hero_picked", hero: 21, side: "dire" }, delayMs: 2500 },
      { event: { type: "session_ended", reason: "completed" }, delayMs: 500 },
    ],
  },
};
