import type { EvidenceItem, MemoryScene, MemorySceneId, Pt } from "./types";

/* Fixture scenes (named fake-scenario-* so the landing guard keeps invented draft data in fixture files only). Ids are stable across scenes on purpose: `origin`, `path:main`, `role:you` and `region:open`
   exist in all five; one id always names one piece of evidence (continuity.ts says how it travels). Copy is fixture copy, not final. */

const PUCK = { id: 13, name: "Puck" } as const;
const VIPER = 47;
const STORM = 17;
const QOP = 39;
const VOID = 126;

const ORIGIN: Pt = [92, 250];
const ROLE = "You · Pos 2 Mid";
const CONTEXT = "Ranked All Pick · your pick, before the enemy mid is revealed";

const originItem = (at: Pt, meaning: string): EvidenceItem => ({ kind: "origin", id: "origin", at, heroId: PUCK.id, meaning, active: true });
const roleItem = (at: Pt): EvidenceItem => ({
  kind: "role", id: "role:you", at, meaning: `Role: ${ROLE}.`,
  label: { text: ROLE, side: "below" },
});

/* ───────── MATCH 01 — remembered, not modelled. One path, one open end, a lot of room left unsaid. ───────── */
const MATCH_01_NODE: Pt = [252, 206];
const match01: MemoryScene = {
  id: "match-01", hero: PUCK, role: ROLE, draftContext: CONTEXT,
  stage: { kicker: "Match", number: "01" },
  annotation: "Puck stayed with you. That is a memory, not a model.",
  evidenceNote: "One decision retained. Nothing yet says what it means.",
  items: [
    { kind: "region", id: "region:open", meaning: "Most of the picture is still unresolved: nothing is known there yet.",
      points: [[318, 92], [440, 84], [468, 190], [430, 350], [372, 424], [300, 372], [338, 252], [290, 168]] },
    { kind: "path", id: "path:main", relation: "retained", tone: "cyan", points: [[124, 250], [186, 236], MATCH_01_NODE],
      meaning: "Retained path: you kept the hero, and the memory followed." },
    { kind: "path", id: "path:open", relation: "uncertain", tone: "neutral", terminal: true, points: [[MATCH_01_NODE[0] + 14, 204], [300, 208], [334, 230]],
      meaning: "Uncertain path: where this goes next is not known, and it stops here." },
    { kind: "node", id: "node:m1", at: MATCH_01_NODE, tone: "cyan", shape: "diamond", active: true,
      meaning: "Match 01: you chose Puck.", label: { kicker: "Match 01", text: "You stayed with Puck", side: "above" } },
    originItem(ORIGIN, "Origin: the first retained decision, Puck."),
    { ...roleItem([92, 306]), active: true },
  ],
};

/* ───────── MATCH 08 — something starts to repeat. The Match 01 path is reinforced, not replaced; nothing is concluded. ───────── */
const match08: MemoryScene = {
  id: "match-08", hero: PUCK, role: ROLE, draftContext: CONTEXT,
  stage: { kicker: "Match", number: "08" },
  annotation: "Puck keeps coming back. Something is starting to repeat.",
  evidenceNote: "A possible preference, not a conclusion. Most of it is still open.",
  items: [
    { kind: "region", id: "region:open", meaning: "Still mostly unresolved: whether this is a preference is not known yet.",
      points: [[330, 84], [440, 80], [466, 176], [436, 330], [388, 372], [330, 320], [352, 236], [318, 150]],
      label: { kicker: "Open", text: "Maybe a preference", side: "above" } },
    { kind: "path", id: "path:main", relation: "retained", tone: "cyan", points: [[124, 250], [186, 236], MATCH_01_NODE],
      meaning: "Retained path: the Match 01 decision, now reinforced by what followed." },
    { kind: "path", id: "path:reuse", relation: "retained", tone: "cyan", points: [[186, 236], [236, 244], [292, 254]],
      meaning: "Reuse: the same hero is chosen again and the memory attaches to the first path." },
    { kind: "path", id: "path:weak", relation: "uncertain", tone: "neutral", points: [[236, 244], [246, 296], [262, 336]],
      meaning: "A weaker recurrence: another hero shows up alongside, faintly, without a pattern yet." },
    { kind: "path", id: "path:open", relation: "uncertain", tone: "neutral", terminal: true, points: [[MATCH_01_NODE[0] + 14, 204], [300, 208], [334, 230]],
      meaning: "Possible pattern: where this goes next is not known, and it stops here." },
    { kind: "node", id: "node:m1", at: MATCH_01_NODE, tone: "cyan", shape: "diamond", meaning: "Match 01: you chose Puck.",
      label: { kicker: "Match 01", text: "Where it began", side: "above" } },
    { kind: "node", id: "node:m2", at: [236, 244], tone: "cyan", shape: "diamond", meaning: "A later decision that reuses the same path." },
    { kind: "node", id: "node:m3", at: [292, 254], tone: "cyan", shape: "diamond", meaning: "Another later decision that reuses the same path." },
    { kind: "echo", id: "echo:a", at: [186, 236], heroId: PUCK.id, tone: "cyan", active: true, meaning: "Hero echo: Puck again, attached to the first decision.",
      label: { kicker: "Again", text: "Puck returns", side: "below" } },
    { kind: "echo", id: "echo:storm", at: [262, 336], heroId: STORM, tone: "cyan", meaning: "Weaker recurrence: Storm Spirit appears, faintly, in the same role." },
    originItem(ORIGIN, "Origin: the first retained decision, Puck."),
    { ...roleItem([92, 306]), active: true },
  ],
};

/* ───────── MATCH 24 — BEFORE → CONTRADICTION → QUALIFIED AFTER, legible without motion or colour. ───────── */
const C1: Pt = [300, 250];
const SLIVER_FROM: Pt = [262, 150];
const SLIVER_TO: Pt = [342, 354];
const match24: MemoryScene = {
  id: "match-24", hero: PUCK, role: ROLE, draftContext: CONTEXT,
  stage: { kicker: "Match", number: "24" },
  annotation: "You return to this choice—until the matchup changes what it means.",
  evidenceNote: "Contradicted by the lane matchup against Viper, not erased by it.",
  items: [
    { kind: "region", id: "region:open", meaning: "What happens beyond this is still unresolved.",
      points: [[352, 66], [436, 70], [458, 130], [420, 180], [372, 168], [344, 112]] },
    { kind: "path", id: "path:main", relation: "retained", tone: "cyan", points: [[124, 250], [178, 236], [236, 244], C1],
      meaning: "Before: the affinity path you kept returning to, drawn solid." },
    { kind: "path", id: "path:undertrace", relation: "undertrace", tone: "cyan", points: [C1, [372, 250], [442, 250]],
      meaning: "Undertrace: the original reading stays on record, fainter, after the contradiction." },
    { kind: "path", id: "path:qualified", relation: "qualified", tone: "lime", points: [C1, [350, 282], [398, 310], [426, 316]],
      meaning: "After: the route continues, but as a qualified reading rather than the original one." },
    { kind: "matchup", id: "matchup:m1", from: SLIVER_FROM, to: SLIVER_TO,
      meaning: "Contradicting evidence: the lane matchup against Viper cuts across the path." },
    { kind: "node", id: "node:m2", at: [236, 244], tone: "cyan", shape: "diamond", meaning: "Retained decision before the contradiction." },
    { kind: "echo", id: "echo:a", at: [178, 236], heroId: PUCK.id, tone: "cyan", meaning: "Hero echo: Puck again, earlier in the path.",
      label: { kicker: "Before", text: "Retained", side: "above" } },
    { kind: "echo", id: "echo:viper", at: SLIVER_FROM, heroId: VIPER, tone: "neutral", meaning: "Matchup evidence belongs to Viper.",
      label: { kicker: "Matchup", text: "vs Viper", side: "left" } },
    { kind: "contradiction", id: "marker:c1", at: C1, angle: 24, active: true,
      meaning: "Contradiction: the matchup intersects the retained path here.",
      label: { kicker: "Contradiction", text: "The matchup changes it", side: "below-left" } },
    { kind: "echo", id: "echo:b", at: [426, 316], heroId: PUCK.id, tone: "lime", active: true, meaning: "Qualified interpretation: Puck, with a condition attached.",
      label: { kicker: "After", text: "Qualified", side: "below" } },
    originItem(ORIGIN, "Origin: the first retained decision, Puck."),
    roleItem([92, 306]),
  ],
};

/* ───────── MATCH 56 — enough history to personalise, still not a model. Four groups of evidence added to the Match 24 object
   (affinity, role, matchup response, one exception); the contradiction history, the qualified route and the open space stay. ───────── */
const match56: MemoryScene = {
  id: "match-56", hero: PUCK, role: ROLE, draftContext: CONTEXT,
  stage: { kicker: "Match", number: "56" },
  annotation: "Enough history to start personalising—not enough to call it a model.",
  evidenceNote: "Affinity, role, matchup response and one exception, with the gaps left visible.",
  items: [
    { kind: "region", id: "region:open", meaning: "Unresolved: what happens beyond this is still not known.",
      points: [[348, 56], [440, 60], [466, 140], [430, 200], [372, 184], [340, 112]] },
    { kind: "path", id: "path:main", relation: "retained", tone: "cyan", points: [[124, 250], [178, 236], [236, 244], C1],
      meaning: "The affinity path you kept returning to, still drawn solid up to the contradiction." },
    { kind: "path", id: "path:undertrace", relation: "undertrace", tone: "cyan", points: [C1, [372, 250], [442, 250]],
      meaning: "Undertrace: the original reading stays on record, fainter, after the contradiction." },
    { kind: "path", id: "path:qualified", relation: "qualified", tone: "lime", points: [C1, [350, 282], [398, 310], [426, 316]],
      meaning: "The route continues as a qualified reading, and has since held." },
    { kind: "path", id: "path:affinity", relation: "retained", tone: "cyan", points: [[178, 236], [190, 190], [206, 142], [176, 96]],
      meaning: "Hero affinity: the heroes you reach for again and again, branching from the first decisions." },
    { kind: "path", id: "path:role", relation: "retained", tone: "cyan", points: [[122, 272], [168, 314], [210, 356]],
      meaning: "Role tendency: where you usually play, leaving from the origin." },
    { kind: "path", id: "path:exception", relation: "uncertain", tone: "neutral", points: [[398, 310], [384, 358], [404, 408]],
      meaning: "Situational exception: one case where you step away from the usual route." },
    { kind: "path", id: "path:open", relation: "uncertain", tone: "neutral", terminal: true, points: [[206, 142], [250, 106], [300, 82]],
      meaning: "Unresolved evidence: this reading stops before it closes." },
    { kind: "matchup", id: "matchup:m1", from: SLIVER_FROM, to: SLIVER_TO,
      meaning: "Matchup response: the lane matchup against Viper still cuts across the path." },
    { kind: "node", id: "node:m2", at: [236, 244], tone: "cyan", shape: "diamond", meaning: "Retained decision before the contradiction." },
    { kind: "node", id: "node:m1", at: [190, 190], tone: "cyan", shape: "diamond", meaning: "The first retained decision, Match 01, folded into the affinity branch." },
    { kind: "node", id: "node:q1", at: [398, 310], tone: "lime", shape: "diamond", meaning: "A decision made under the condition: the qualified reading holding up." },
    { kind: "node", id: "node:role", at: [168, 314], tone: "cyan", shape: "capsule", meaning: "Role tendency: mostly mid.",
      label: { text: "Mostly mid", side: "right", extraGap: 8 } },
    { kind: "node", id: "node:exc", at: [404, 408], tone: "neutral", shape: "capsule", meaning: "Situational exception, kept apart from the main pattern.",
      label: { kicker: "Exception", text: "Only in some lanes", side: "below" } },
    { kind: "echo", id: "echo:a", at: [178, 236], heroId: PUCK.id, tone: "cyan", meaning: "Hero echo: Puck, earlier in the path." },
    { kind: "echo", id: "echo:storm", at: [206, 142], heroId: STORM, tone: "cyan", meaning: "Hero affinity: Storm Spirit recurs beside Puck.",
      label: { kicker: "Affinity", text: "Keeps returning", side: "left" } },
    { kind: "echo", id: "echo:void", at: [176, 96], heroId: VOID, tone: "cyan", meaning: "Hero affinity: Void Spirit recurs on the same branch." },
    { kind: "echo", id: "echo:qop", at: [210, 356], heroId: QOP, tone: "cyan", meaning: "Role tendency: Queen of Pain, the hero you reach for in that role." },
    { kind: "echo", id: "echo:viper", at: SLIVER_FROM, heroId: VIPER, tone: "neutral", meaning: "Matchup evidence belongs to Viper." },
    { kind: "contradiction", id: "marker:c1", at: C1, angle: 24, active: true,
      meaning: "Contradiction: the matchup intersects the retained path here, and the record of it stays.",
      label: { kicker: "Contradiction", text: "The matchup changes it", side: "below-left" } },
    { kind: "echo", id: "echo:b", at: [426, 316], heroId: PUCK.id, tone: "lime", meaning: "Qualified interpretation: Puck, with a condition attached." },
    originItem(ORIGIN, "Origin: the first retained decision, Puck."),
    roleItem([92, 306]),
  ],
};

/* ───────── PLAYER MODEL — the same evidence, organised as an open decision contour (≈360×470 of the box). ───────── */
const place = ([x, y]: Pt): Pt => [60 + (x - 70) * 0.973, 12 + (y - 60) * 1.237];
const raw = (points: readonly Pt[]): Pt[] => points.map(place);
const MODEL_ORIGIN = place([112, 352]);
const MODEL_C1 = place([418, 276]);
const playerModel: MemoryScene = {
  id: "player-model", hero: PUCK, role: ROLE, draftContext: CONTEXT,
  stage: { kicker: "Player model" },
  annotation: "A player model is not a verdict. It is the shape evidence takes around your decisions.",
  evidenceNote: "One part of the contour stays open: that is where evidence is still missing.",
  items: [
    { kind: "region", id: "region:open", meaning: "Unresolved: the contour is open here, where evidence has not arrived.",
      points: raw([[408, 112], [462, 132], [480, 212], [468, 270], [440, 208]]),
      label: { kicker: "Unresolved", text: "Not enough evidence yet", side: "above" } },
    { kind: "path", id: "path:main", relation: "retained", tone: "cyan", points: raw([[112, 352], [72, 284], [88, 196], [142, 150], [170, 84], [262, 60], [318, 96]]),
      meaning: "Retained contour: the decisions you kept coming back to, top side." },
    { kind: "path", id: "path:contour-b", relation: "retained", tone: "cyan", points: raw([[112, 352], [160, 414], [236, 440], [290, 404], [322, 344], [384, 320], [418, 276]]),
      meaning: "Retained contour: the decisions you kept coming back to, lower side." },
    { kind: "path", id: "path:core", relation: "retained", tone: "cyan", points: raw([[112, 352], [170, 300], [220, 250], [262, 208]]),
      meaning: "Retained path from the origin toward the core of the pattern." },
    { kind: "path", id: "path:open", relation: "uncertain", tone: "neutral", terminal: true, points: raw([[318, 96], [366, 112], [396, 150]]),
      meaning: "Uncertain path: the contour continues, but evidence stops before it closes." },
    { kind: "path", id: "path:undertrace", relation: "undertrace", tone: "cyan", points: raw([[418, 276], [440, 236], [438, 196]]),
      meaning: "Undertrace: the earlier reading is kept, fainter, after the contradiction." },
    { kind: "path", id: "path:qualified", relation: "qualified", tone: "lime", points: raw([[418, 276], [362, 262], [312, 236], [262, 208]]),
      meaning: "Qualified path: after the contradiction the pattern holds, with a condition." },
    { kind: "matchup", id: "matchup:m1", from: place([398, 214]), to: place([438, 338]),
      meaning: "Contradicting evidence: a matchup cuts across the lower contour." },
    { kind: "node", id: "node:m1", at: place([142, 150]), tone: "cyan", shape: "diamond", meaning: "Retained decision from Match 01, now on the top contour." },
    { kind: "node", id: "node:contour-b", at: place([290, 404]), tone: "cyan", shape: "diamond", meaning: "Retained decision on the lower contour." },
    { kind: "node", id: "node:core", at: place([262, 208]), tone: "lime", shape: "capsule", meaning: "Where the retained and qualified paths meet." },
    { kind: "echo", id: "echo:storm", at: place([88, 196]), heroId: STORM, tone: "cyan", meaning: "Hero echo: Storm Spirit recurs on the left contour." },
    { kind: "echo", id: "echo:void", at: place([262, 60]), heroId: VOID, tone: "cyan", meaning: "Hero echo: Void Spirit recurs at the top." },
    { kind: "echo", id: "echo:qop", at: place([236, 440]), heroId: QOP, tone: "cyan", meaning: "Hero echo: Queen of Pain recurs on the lower contour." },
    { kind: "echo", id: "echo:viper", at: place([398, 214]), heroId: VIPER, tone: "neutral", meaning: "Matchup evidence belongs to Viper." },
    { kind: "echo", id: "echo:b", at: place([322, 344]), heroId: PUCK.id, tone: "lime", meaning: "Puck, qualified: kept, with a condition." },
    { kind: "contradiction", id: "marker:c1", at: MODEL_C1, angle: 24, meaning: "Contradiction: the matchup meets the contour here.",
      label: { kicker: "Qualified", text: "Holds, with a condition", side: "below-left", extraGap: 22 } },
    originItem(MODEL_ORIGIN, "Origin anchor: the first retained decision, Puck."),
    roleItem([MODEL_ORIGIN[0], MODEL_ORIGIN[1] + 56]),
  ],
};

export const MEMORY_SCENES: Record<MemorySceneId, MemoryScene> = {
  "match-01": match01,
  "match-08": match08,
  "match-24": match24,
  "match-56": match56,
  "player-model": playerModel,
};
