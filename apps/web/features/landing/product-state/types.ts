/* LANDING-01B · product-state contract. The landing renders ONLY this shape; it never imports engine
   types (the two processes are independent, see .claude/rules/invariantes.md). Today the frames come
   from `fake-scenario.ts`; the real engine replaces that file with an adapter that returns the same
   `LandingProductState` — no component changes. Field names follow the product contract
   (targetBasis, Pos1–Pos5, confidence labels), values are ILLUSTRATIVE. */

export type Position = 1 | 2 | 3 | 4 | 5;

/** Which section of the draft currently carries the importance (drives the perimeter segment). */
export type FocusSection = "turn" | "rival" | "evidence" | "pool";

export type TargetBasis = "STRATEGIC" | "DETERMINISTIC_DEFAULT";
export type ConfidenceLevel = "low" | "medium" | "high";
export type ReasonKind = "counter" | "synergy" | "position";

export type Seat = { hero: string | null; locked: boolean; position: Position };

export type Reason = { kind: ReasonKind; text: string };

export type Candidate = {
  fit: number;
  hero: string;
  position: Position;
  rank: 1 | 2 | 3;
  reasons: readonly Reason[];
};

/** How one signal moves each candidate on the ranking, in fit points. Illustrative until the engine reports it. */
export type SignalShift = { delta: number; hero: string };

export type SignalRow = { detail: string; id: string; label: string; shifts?: readonly SignalShift[]; value: string };

export type DraftFrame = {
  allies: readonly Seat[];
  /** Strategic = the Coach has a reason. Default = a neutral starting view (never shown as advantage). */
  basis: TargetBasis;
  bans: readonly string[];
  confidence: ConfidenceLevel;
  /** Real count of matches behind the recommendation. Markers in the UI are 1:1 with this number. */
  evidenceSamples: number;
  enemies: readonly (string | null)[];
  focus: FocusSection;
  id: string;
  /** Short step name, shown on the stepper. */
  label: string;
  /** One honest sentence about what changed in this frame. */
  narrative: string;
  /** The position the player is being asked to fill, or null when nothing is on the clock. */
  onTheClock: Position | null;
  signals: readonly SignalRow[];
  top3: readonly Candidate[];
  youPosition: Position;
};

export type LandingProductState = {
  frames: readonly DraftFrame[];
  /** True while the data is invented. The UI labels it; a real adapter sets it to false. */
  illustrative: boolean;
};

export const POSITION_NAMES: Readonly<Record<Position, string>> = {
  1: "Carry",
  2: "Mid",
  3: "Offlane",
  4: "Support",
  5: "Hard Support",
};

export function positionLabel(position: Position) {
  return `Pos ${position} ${POSITION_NAMES[position]}`;
}
