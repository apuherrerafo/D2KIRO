/* Counterfactual personalization — the pure part: how the order is DERIVED (never stored), and what each candidate
   shows at each stage. No DOM, no clock: the ranking change and its cause are testable without a browser. */

import {
  COUNTERFACTUAL_STAGES, type CandidateFixture, type CandidateTag, type CounterfactualFixture, type CounterfactualStage, type TagTone,
} from "./types";

export type RankMode = "generic" | "personal";

export const stageIndex = (stage: CounterfactualStage) => COUNTERFACTUAL_STAGES.indexOf(stage);
const reached = (stage: CounterfactualStage, at: CounterfactualStage) => stageIndex(stage) >= stageIndex(at);

/** The lane reading in force for a mode: through the player's own games only in the personal reading. */
function laneLevel(candidate: CandidateFixture, mode: RankMode) {
  if (mode === "personal" && candidate.laneThroughYou) return candidate.laneThroughYou.qualified.level;
  return candidate.generic.lane.level;
}

/** Generic reads meta + lane. Personal reads the same two (lane re-read through the player's games) plus the player's history. */
export function scoreOf(candidate: CandidateFixture, mode: RankMode) {
  const shared = candidate.generic.meta.level + laneLevel(candidate, mode);
  return mode === "personal" ? shared + candidate.history.level : shared;
}

/** Hero names, best first. Ties keep the fixture order, so a tie can never reorder by accident. */
export function rankHeroes(fixture: CounterfactualFixture, mode: RankMode): string[] {
  return fixture.candidates
    .map((candidate, index) => ({ candidate, index, score: scoreOf(candidate, mode) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ candidate }) => candidate.hero.name);
}

export interface CandidateSlots {
  readonly hero: string;
  /** 0 = the decision position. */
  readonly from: number;
  readonly to: number;
  readonly role: "rises" | "falls" | "holds";
}

function roleOf(from: number, to: number): CandidateSlots["role"] {
  if (to < from) return "rises";
  if (to > from) return "falls";
  return "holds";
}

export function candidateSlots(fixture: CounterfactualFixture): CandidateSlots[] {
  const generic = rankHeroes(fixture, "generic");
  const personal = rankHeroes(fixture, "personal");
  return fixture.candidates.map((candidate) => {
    const from = generic.indexOf(candidate.hero.name);
    const to = personal.indexOf(candidate.hero.name);
    return { hero: candidate.hero.name, from, to, role: roleOf(from, to) };
  });
}

/** The hero in the decision position for a mode. */
export const winnerOf = (fixture: CounterfactualFixture, mode: RankMode) => rankHeroes(fixture, mode)[0];

/** The order a stage SHOWS: the generic one until the ranking moves, the personal one from then on. */
export const modeOfStage = (stage: CounterfactualStage): RankMode => (reached(stage, "reorder") ? "personal" : "generic");

/** What a candidate carries at a stage. Generic: meta + lane, all neutral. The model enters: a history tag per candidate
    (solid cyan where there is evidence, dashed neutral where there is none). The lane tag is then challenged (pink) and
    qualified (lime) where the player's games speak to it. Unchanged evidence never changes colour. */
export function tagsFor(candidate: CandidateFixture, stage: CounterfactualStage): CandidateTag[] {
  const tags: CandidateTag[] = [{ id: "meta", text: candidate.generic.meta.text, tone: "neutral", dashed: false }];
  let lane: CandidateTag = { id: "lane", text: candidate.generic.lane.text, tone: "neutral", dashed: false };
  const through = candidate.laneThroughYou;
  if (through && stage === "reinterpret") lane = { id: "lane", text: through.challenged, tone: "pink", dashed: false };
  if (through && reached(stage, "reorder")) lane = { id: "lane", text: through.qualified.text, tone: "lime", dashed: false };
  tags.push(lane);
  if (reached(stage, "context")) {
    const present = candidate.history.evidence === "present";
    tags.push({ id: "history", text: candidate.history.text, tone: present ? "cyan" : "neutral", dashed: !present });
  }
  return tags;
}

/** The model's own facts, as the chip reads them: the history fact lit cyan once the model arrives; the matchup fact
    neutral on arrival, pink while it challenges the generic reading, lime once it holds. Before the model enters, nothing is lit. */
export function factTone(id: "history" | "matchup", stage: CounterfactualStage): TagTone {
  if (!reached(stage, "context")) return "neutral";
  if (id === "history") return "cyan";
  if (stage === "context") return "neutral";
  return stage === "reinterpret" ? "pink" : "lime";
}

/** Why a hero stands where it does for this player: the personal evidence the generic reading did not have. Empty = unexplained. */
export function personalReasons(fixture: CounterfactualFixture, hero: string): string[] {
  const candidate = fixture.candidates.find((c) => c.hero.name === hero);
  if (!candidate) return [];
  const reasons: string[] = [];
  if (candidate.laneThroughYou) reasons.push(candidate.laneThroughYou.qualified.text);
  if (candidate.history.evidence === "present") reasons.push(candidate.history.text);
  return reasons;
}
