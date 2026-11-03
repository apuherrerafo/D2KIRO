export type Position = 1 | 2 | 3 | 4 | 5;
export type ScenarioKind = "solo" | "party2" | "party3" | "party5" | "collision" | "yield" | "enemy-uncertainty" | "repeatability" | "off-meta";

export interface MvpScenario {
  id: string;
  kind: ScenarioKind;
  partySize: 1 | 2 | 3 | 5;
  humanPositions: readonly Position[];
  humanPosition: Position;
  seed: string;
  expectedControl: readonly Position[];
}

const seeds = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(3, "0")}`);
const solo = ([1, 2, 3, 4, 5] as const).flatMap((position) =>
  seeds(`QA-S${position}-`, position === 2 ? 20 : 10).map((seed): MvpScenario => ({
    id: `solo-pos${position}-${seed.slice(-3)}`, kind: "solo", partySize: 1, humanPositions: [position], humanPosition: position, seed, expectedControl: [position],
  })),
);
const party = ([
  [2, [1, 5]], [2, [2, 5]], [2, [2, 4]], [2, [1, 3]],
  [3, [1, 3, 5]], [3, [1, 2, 4]], [3, [2, 3, 5]], [3, [1, 4, 5]],
] as const).flatMap(([partySize, positions], index) => seeds(`QA-P${partySize}-${index + 1}-`, 5).map((seed): MvpScenario => ({
  id: `party${partySize}-${positions.join("-")}-${seed.slice(-3)}`, kind: partySize === 2 ? "party2" : "party3", partySize, humanPositions: positions, humanPosition: positions[0], seed, expectedControl: positions,
})));
const special: MvpScenario[] = (["collision", "yield", "enemy-uncertainty", "repeatability", "off-meta"] as const).flatMap((kind) =>
  seeds(`QA-${kind.toUpperCase()}-`, 4).map((seed): MvpScenario => ({ id: `${kind}-${seed.slice(-3)}`, kind, partySize: 1, humanPositions: [2], humanPosition: 2, seed, expectedControl: [2] })),
);
const party5 = seeds("QA-P5-", 10).map((seed): MvpScenario => ({ id: `party5-${seed.slice(-3)}`, kind: "party5", partySize: 5, humanPositions: [1, 2, 3, 4, 5], humanPosition: 2, seed, expectedControl: [1, 2, 3, 4, 5] }));

export const MVP_SCENARIOS: readonly MvpScenario[] = [...solo, ...party, ...party5, ...special];
