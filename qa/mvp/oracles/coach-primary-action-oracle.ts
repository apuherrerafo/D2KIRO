/**
 * QA-only semantic oracle for the Coach response.
 *
 * PRODUCTION_DECISION_PATH: coach/orchestrator -> recommendation-output-v3 -> HTTP response.
 * QA_ORACLE_PATH: serialized primary-action strategy + shortlist card positions -> this validator.
 * SHARED_RAW_INPUT: the public V3 JSON contract.
 * INDEPENDENT_LOGIC: no Coach strategy selector, hero-card builder, or production helper is imported.
 */
export type Position = 1 | 2 | 3 | 4 | 5;

export interface PublicCoachCard { heroId: number; position: Position | null }
export type PublicCoachStrategy =
  | { kind: "REVEAL_POSITION"; position: Position }
  | { kind: "REVEAL_HERO"; position: Position; heroId: number }
  | { kind: "REVEAL_FLEX"; possiblePositions: readonly Position[] }
  | { kind: "REVEAL_SUPPORT_EARLY" }
  | { kind: "ROLE_COLLISION" }
  | { kind: string };

export function primaryActionPositions(strategy: PublicCoachStrategy): readonly Position[] | null {
  if (strategy.kind === "REVEAL_POSITION" || strategy.kind === "REVEAL_HERO") return [strategy.position];
  if (strategy.kind === "REVEAL_FLEX") return strategy.possiblePositions;
  if (strategy.kind === "REVEAL_SUPPORT_EARLY") return [4, 5];
  return null;
}

export function coachShortlistMatchesPrimaryAction(strategy: PublicCoachStrategy, shortlist: readonly PublicCoachCard[]): boolean {
  const targets = primaryActionPositions(strategy);
  if (targets === null || shortlist.length === 0) return true;
  return shortlist.every((card) => card.position !== null && targets.includes(card.position));
}
