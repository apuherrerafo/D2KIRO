/* LANDING V2 · STORY · the single narrative fixture. The Hero loop plays it and the Counterfactual re-reads draft A of it, so the
   two can never disagree. Moved verbatim from hero-loop/scenarios.ts (no value changed); hero-loop/scenarios.ts re-exports it. */
/* HERO-LOOP LAB · the three conditions the loop passes through, read as three CONSECUTIVE DRAFTS (D2KIRO continues, the
   match changes). ILLUSTRATIVE data, like fake-scenario-hero.ts: every FIT value on screen is `base + the evidence steps
   applied so far`, so a displayed delta always has a named cause. FIT is a recommendation score for the Lab, NOT a win
   rate, win chance, probability or confidence. Personal history is shown qualitatively only (no invented game counts).

   ILLUSTRATIVE — DOTA SIGN-OFF REQUIRED: every `signoff: true` step carries matchup/synergy numbers nobody has validated.
   The UI never says so; `DOTA_SIGNOFF` below lists exactly what an expert must review.

   A — personal evidence changes the order: the draft read alone leads with Queen of Pain; the player's own history flips it.
   B — no personal evidence: the same loop, honestly marked "draft read only"; the personal step arrives empty.
   C — later in the draft: more is known and it arrives in more pieces; confidence grows with each piece and one piece
       contradicts the early leader. */

export type Position = 1 | 2 | 3 | 4 | 5;
export type ScenarioId = "A" | "B" | "C";
export type Confidence = "low" | "medium" | "high";
export type EvidenceKind = "enemy" | "synergy" | "personal";

export type LoopSeat = { hero: string | null; position: Position; you: boolean };

export type EvidenceStep = {
  id: string;
  kind: EvidenceKind;
  /** Short name of the cause, shown on its marker ("vs Axe", "Your pool"). */
  label: string;
  /** Signed score change per candidate. Missing hero = 0. */
  deltas: Readonly<Record<string, number>>;
  /** Personal step with nothing behind it: it arrives, says so, and moves nothing. */
  absent?: boolean;
  /** One qualitative phrase per hero (never a count or a rate), shown on the card while this is the newest cause (personal step only). */
  detail?: Readonly<Record<string, string>>;
  /** ILLUSTRATIVE — DOTA SIGN-OFF REQUIRED: a matchup/synergy claim that is a placeholder until a Dota expert confirms it. Internal only. */
  signoff?: true;
};

export type LoopEnemy = {
  hero: string;
  /** The number of evidence steps that must have arrived before this pick is visible: it appears with the step that is about it. 0 = revealed with the first read. */
  revealAt: number;
};

export type LoopScenario = {
  id: ScenarioId;
  /** What this pass proves, in one line (lab chrome only). */
  condition: string;
  allies: readonly LoopSeat[];
  bans: readonly string[];
  candidates: readonly { base: number; hero: string }[];
  enemies: readonly LoopEnemy[];
  /** Confidence after `n` steps have arrived: the index is the count, clamped to the last entry. */
  confidenceByApplied: readonly Confidence[];
  /** Whether the personal step carries real data. */
  personal: boolean;
  /** The seat the player is filling. */
  seat: { label: string; position: Position };
  steps: readonly EvidenceStep[];
  summary: string;
  /** Why the call stands, shown with the lock. */
  why: readonly string[];
};

const A: LoopScenario = {
  id: "A",
  condition: "Personal evidence changes the order",
  seat: { position: 2, label: "Pos 2 Mid" },
  bans: ["Pudge", "Invoker", "Phantom Assassin", "Earthshaker", "Tiny", "Sniper"],
  allies: [
    { position: 1, hero: null, you: false },
    { position: 2, hero: null, you: true },
    { position: 3, hero: null, you: false },
    { position: 4, hero: "Earth Spirit", you: false },
    { position: 5, hero: "Crystal Maiden", you: false },
  ],
  enemies: [
    { hero: "Axe", revealAt: 0 },
    { hero: "Slark", revealAt: 0 },
  ],
  candidates: [
    { hero: "Queen of Pain", base: 85 },
    { hero: "Void Spirit", base: 82 },
    { hero: "Puck", base: 79 },
  ],
  steps: [
    { id: "vs-axe", kind: "enemy", label: "vs Axe", deltas: { "Queen of Pain": -1, "Void Spirit": -2, Puck: 1 }, signoff: true },
    { id: "vs-slark", kind: "enemy", label: "vs Slark", deltas: { "Queen of Pain": 1, "Void Spirit": -3, Puck: 1 }, signoff: true },
    { id: "supports", kind: "synergy", label: "Your supports", deltas: { "Queen of Pain": -1, "Void Spirit": 0, Puck: 1 }, signoff: true },
    {
      id: "pool",
      kind: "personal",
      label: "Your games",
      deltas: { "Queen of Pain": -1, "Void Spirit": 0, Puck: 6 },
      detail: { Puck: "Often played", "Queen of Pain": "Some history", "Void Spirit": "No history yet" },
    },
  ],
  confidenceByApplied: ["low", "medium", "medium", "medium", "high"],
  personal: true,
  summary: "Illustrative: the draft read leads with Queen of Pain at 84. The player's own history adds six points to Puck, the order flips and Puck is locked into Pos 2.",
  why: ["Holds up vs the enemy picks", "Pairs with your supports", "Often played by you"],
};

const B: LoopScenario = {
  id: "B",
  condition: "No personal evidence — draft read only",
  seat: { position: 1, label: "Pos 1 Carry" },
  bans: ["Axe", "Techies", "Phantom Assassin", "Pudge", "Sniper", "Tiny"],
  allies: [
    { position: 1, hero: null, you: true },
    { position: 2, hero: null, you: false },
    { position: 3, hero: null, you: false },
    { position: 4, hero: "Hoodwink", you: false },
    { position: 5, hero: "Lich", you: false },
  ],
  enemies: [
    { hero: "Viper", revealAt: 0 },
    { hero: "Pangolier", revealAt: 0 },
  ],
  candidates: [
    { hero: "Anti-Mage", base: 83 },
    { hero: "Faceless Void", base: 82 },
    { hero: "Luna", base: 79 },
  ],
  steps: [
    { id: "vs-viper", kind: "enemy", label: "vs Viper", deltas: { "Anti-Mage": 1, "Faceless Void": -2, Luna: 2 }, signoff: true },
    { id: "vs-pangolier", kind: "enemy", label: "vs Pangolier", deltas: { "Anti-Mage": -1, "Faceless Void": 1, Luna: 1 }, signoff: true },
    { id: "supports", kind: "synergy", label: "Your supports", deltas: { "Anti-Mage": 0, "Faceless Void": 3, Luna: 0 }, signoff: true },
    { id: "pool", kind: "personal", label: "Your games", absent: true, deltas: {} },
  ],
  confidenceByApplied: ["low", "low", "medium", "medium", "medium"],
  personal: false,
  summary: "Illustrative: a new player with no match history. The draft read alone puts Faceless Void first; the personal step arrives empty, moves nothing, and the call is labelled draft read only.",
  why: ["Holds up vs the enemy picks", "Pairs with your supports", "Draft read only"],
};

const C: LoopScenario = {
  id: "C",
  condition: "Later in the draft — information keeps growing",
  seat: { position: 3, label: "Pos 3 Offlane" },
  bans: ["Axe", "Techies", "Pudge", "Sniper", "Tiny", "Invoker", "Earthshaker", "Lion"],
  allies: [
    { position: 1, hero: "Juggernaut", you: false },
    { position: 2, hero: "Storm Spirit", you: false },
    { position: 3, hero: null, you: true },
    { position: 4, hero: "Rubick", you: false },
    { position: 5, hero: "Dazzle", you: false },
  ],
  enemies: [
    { hero: "Drow Ranger", revealAt: 0 },
    { hero: "Night Stalker", revealAt: 2 },
    { hero: "Spectre", revealAt: 3 },
    { hero: "Medusa", revealAt: 4 },
  ],
  candidates: [
    { hero: "Centaur Warrunner", base: 81 },
    { hero: "Mars", base: 80 },
    { hero: "Tidehunter", base: 79 },
  ],
  steps: [
    { id: "vs-drow", kind: "enemy", label: "vs Drow Ranger", deltas: { "Centaur Warrunner": 1, Mars: 1, Tidehunter: 0 }, signoff: true },
    { id: "vs-ns", kind: "enemy", label: "vs Night Stalker", deltas: { "Centaur Warrunner": 1, Mars: 0, Tidehunter: -1 }, signoff: true },
    { id: "vs-spectre", kind: "enemy", label: "vs Spectre", deltas: { "Centaur Warrunner": -5, Mars: 3, Tidehunter: 1 }, signoff: true },
    { id: "vs-medusa", kind: "enemy", label: "vs Medusa", deltas: { "Centaur Warrunner": 1, Mars: 2, Tidehunter: 3 }, signoff: true },
    { id: "supports", kind: "synergy", label: "Your team", deltas: { "Centaur Warrunner": 0, Mars: 1, Tidehunter: 0 }, signoff: true },
    {
      id: "pool",
      kind: "personal",
      label: "Your games",
      deltas: { "Centaur Warrunner": -1, Mars: 2, Tidehunter: 0 },
      detail: { Mars: "Often played", "Centaur Warrunner": "Few games", Tidehunter: "In your pool" },
    },
  ],
  confidenceByApplied: ["low", "low", "medium", "medium", "high", "high", "high"],
  personal: true,
  summary: "Illustrative: round 3, four enemy heroes known. Evidence arrives in six pieces and confidence grows with each. The third one, Spectre, contradicts the early leader Centaur Warrunner; Mars takes the lead and is locked into Pos 3.",
  why: ["Holds up vs four enemy picks", "Pairs with your team", "Often played by you"],
};

export const LOOP_SCENARIOS: readonly LoopScenario[] = [A, B, C];

/** What a Dota expert must confirm before any of this ships as more than a Lab illustration (never rendered). */
export const DOTA_SIGNOFF = LOOP_SCENARIOS.map((scenario) => ({
  scenario: scenario.id,
  seat: scenario.seat.label,
  candidates: scenario.candidates.map((c) => c.hero),
  steps: scenario.steps.filter((step) => step.signoff).map((step) => step.id),
}));

export const HERO_LOOP_COPY = {
  illustrative: "Illustrative draft",
  draftReadOnly: "Draft read only",
  noPersonal: "No personal history yet",
} as const;
