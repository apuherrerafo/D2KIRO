/* LANDING-01B · FAKE product state. Deterministic, hand-written, and ISOLATED: this is the only file
   that invents draft data. Swap `FAKE_PRODUCT_STATE` for an engine adapter and the page keeps working.
   Realistic Ranked All Pick shape: you are Pos 4 (Support); the enemy reveals picks; evidence can go
   thin; you lock a pick and the next open seat takes the clock. Numbers are illustrative, never a
   claim — the page says so on screen. */
import type { DraftFrame, LandingProductState, Seat } from "./types";

const BANS = ["Pudge", "Invoker", "Phantom Assassin", "Earthshaker", "Tiny", "Sniper"] as const;

function allies(hero4: string | null): readonly Seat[] {
  return [
    { position: 1, hero: "Juggernaut", locked: true },
    { position: 2, hero: null, locked: false },
    { position: 3, hero: "Mars", locked: true },
    { position: 4, hero: hero4, locked: hero4 !== null },
    { position: 5, hero: null, locked: false },
  ];
}

const OPENING: DraftFrame = {
  id: "opening",
  label: "Draft opens",
  narrative: "Two enemy picks are in. Pos 4 is yours and it is open.",
  allies: allies(null),
  enemies: ["Storm Spirit", "Axe", null, null, null],
  bans: BANS,
  youPosition: 4,
  onTheClock: 4,
  focus: "turn",
  basis: "STRATEGIC",
  confidence: "medium",
  evidenceSamples: 12,
  top3: [
    { rank: 1, hero: "Lion", fit: 74, position: 4, reasons: [{ kind: "counter", text: "Counters Storm Spirit" }, { kind: "synergy", text: "Chains with Mars" }, { kind: "position", text: "Fits Pos 4" }] },
    { rank: 2, hero: "Shadow Shaman", fit: 71, position: 4, reasons: [{ kind: "counter", text: "Counters Storm Spirit" }, { kind: "position", text: "Fits Pos 4" }] },
    { rank: 3, hero: "Snapfire", fit: 66, position: 4, reasons: [{ kind: "synergy", text: "Chains with Mars" }, { kind: "position", text: "Fits Pos 4" }] },
  ],
};

const ENEMY_REVEAL: DraftFrame = {
  id: "enemy-reveal",
  label: "Enemy reveals",
  narrative: "Crystal Maiden is revealed. A second lockdown makes a long disable matter more.",
  allies: allies(null),
  enemies: ["Storm Spirit", "Axe", "Crystal Maiden", null, null],
  bans: BANS,
  youPosition: 4,
  onTheClock: 4,
  focus: "rival",
  basis: "STRATEGIC",
  confidence: "medium",
  evidenceSamples: 11,
  top3: [
    { rank: 1, hero: "Shadow Shaman", fit: 76, position: 4, reasons: [{ kind: "counter", text: "Long disable into Axe and Storm" }, { kind: "position", text: "Fits Pos 4" }] },
    { rank: 2, hero: "Lion", fit: 72, position: 4, reasons: [{ kind: "counter", text: "Counters Storm Spirit" }, { kind: "synergy", text: "Chains with Mars" }, { kind: "position", text: "Fits Pos 4" }] },
    { rank: 3, hero: "Snapfire", fit: 65, position: 4, reasons: [{ kind: "synergy", text: "Chains with Mars" }, { kind: "position", text: "Fits Pos 4" }] },
  ],
};

const THIN_EVIDENCE: DraftFrame = {
  id: "thin-evidence",
  label: "Thin evidence",
  narrative: "An uncommon enemy pick. Too few matches to rank with conviction, so D2KIRO says so.",
  allies: allies(null),
  enemies: ["Storm Spirit", "Axe", "Crystal Maiden", "Muerta", null],
  bans: BANS,
  youPosition: 4,
  onTheClock: 4,
  focus: "evidence",
  basis: "DETERMINISTIC_DEFAULT",
  confidence: "low",
  evidenceSamples: 3,
  top3: [
    { rank: 1, hero: "Shadow Shaman", fit: 60, position: 4, reasons: [{ kind: "position", text: "A neutral starting view, not an advantage" }] },
    { rank: 2, hero: "Lion", fit: 59, position: 4, reasons: [{ kind: "position", text: "Fits Pos 4" }] },
    { rank: 3, hero: "Snapfire", fit: 57, position: 4, reasons: [{ kind: "position", text: "Fits Pos 4" }] },
  ],
};

const YOU_LOCK: DraftFrame = {
  id: "you-lock",
  label: "You lock a pick",
  narrative: "You lock Shadow Shaman. The clock moves to Pos 5 and the call is recomputed.",
  allies: allies("Shadow Shaman"),
  enemies: ["Storm Spirit", "Axe", "Crystal Maiden", "Muerta", null],
  bans: BANS,
  youPosition: 4,
  onTheClock: 5,
  focus: "pool",
  basis: "STRATEGIC",
  confidence: "medium",
  evidenceSamples: 9,
  top3: [
    { rank: 1, hero: "Dazzle", fit: 69, position: 5, reasons: [{ kind: "counter", text: "Save against burst" }, { kind: "position", text: "Fits Pos 5" }] },
    { rank: 2, hero: "Oracle", fit: 66, position: 5, reasons: [{ kind: "counter", text: "Dispel and save" }, { kind: "position", text: "Fits Pos 5" }] },
    { rank: 3, hero: "Witch Doctor", fit: 55, position: 5, reasons: [{ kind: "synergy", text: "Chains with Shadow Shaman" }, { kind: "position", text: "Fits Pos 5" }] },
  ],
};

export const FAKE_PRODUCT_STATE: LandingProductState = {
  illustrative: true,
  frames: [OPENING, ENEMY_REVEAL, THIN_EVIDENCE, YOU_LOCK],
};
