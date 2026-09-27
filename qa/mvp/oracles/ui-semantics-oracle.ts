/**
 * QA-only mapping oracle.
 *
 * PRODUCTION_DECISION_PATH: coach-client/protocol-client -> Zustand store -> CopilotPanel -> HeroGrid.
 * QA_ORACLE_PATH: public parsed payload and explicit source tag -> highlighted hero ids.
 * SHARED_RAW_INPUT: RecommendationSetV2 and RecommendationOutputV3 JSON shapes.
 * INDEPENDENT_LOGIC: this intentionally does not import CopilotPanel's selector.
 */
export type HighlightSource = "coach-team-shortlist" | "v2-personal-recommendations";

export interface PublicV2Action { hero: number; slot: { position?: number | null } }
export interface PublicV2Recommendation { actions: readonly PublicV2Action[] }
export interface PublicCoachCard { heroId: number; position: number | null }

export function expectedHighlightIds(
  source: HighlightSource,
  v2: readonly PublicV2Recommendation[],
  coach: readonly PublicCoachCard[] | null,
): number[] {
  if (source === "coach-team-shortlist") return (coach ?? []).map((card) => card.heroId);
  return v2.flatMap((entry) => entry.actions.map((action) => action.hero));
}

export function isPersonalPositionLabelAccurate(source: HighlightSource, labelledPosition: number | null, coach: readonly PublicCoachCard[] | null): boolean {
  if (source === "v2-personal-recommendations") return true;
  if (labelledPosition === null || !coach || coach.length === 0) return true;
  return coach.every((card) => card.position === labelledPosition);
}
