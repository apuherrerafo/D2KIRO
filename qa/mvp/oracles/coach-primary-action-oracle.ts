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
  // The `"position" in strategy` / `"possiblePositions" in strategy` guards (not just the `kind`
  // check) are load-bearing: PublicCoachStrategy's `{ kind: string }` catch-all member structurally
  // overlaps every specific `kind` literal, so a bare `strategy.kind === "REVEAL_POSITION"` check
  // alone does not narrow it away and `.position`/`.possiblePositions` would not typecheck.
  if ((strategy.kind === "REVEAL_POSITION" || strategy.kind === "REVEAL_HERO") && "position" in strategy) return [strategy.position];
  if (strategy.kind === "REVEAL_FLEX" && "possiblePositions" in strategy) return strategy.possiblePositions;
  if (strategy.kind === "REVEAL_SUPPORT_EARLY") return [4, 5];
  return null;
}

export function coachShortlistMatchesPrimaryAction(strategy: PublicCoachStrategy, shortlist: readonly PublicCoachCard[]): boolean {
  const targets = primaryActionPositions(strategy);
  if (targets === null || shortlist.length === 0) return true;
  return shortlist.every((card) => card.position !== null && targets.includes(card.position));
}
