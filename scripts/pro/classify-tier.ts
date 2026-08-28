export type DraftClass = "tier_1" | "tier_2" | "excluded" | "unclassifiable";

export interface ClassifiableDraft {
  readonly league?: { readonly tier?: string | null };
  readonly game_mode?: number;
  readonly od_data?: { readonly has_gcdata?: boolean };
  readonly picks_bans?: readonly { readonly is_pick: boolean; readonly hero_id: number; readonly team: 0 | 1 }[];
}

function hasCompletePicks(draft: ClassifiableDraft): boolean {
  if (!draft.picks_bans) return false;
  const picks = [0, 1].map((team) => draft.picks_bans!.filter((turn) => turn.is_pick && turn.team === team).length);
  return picks[0] === 5 && picks[1] === 5;
}

export function classifyTier(draft: ClassifiableDraft): DraftClass {
  if (!hasCompletePicks(draft) || draft.game_mode !== 2 || draft.od_data?.has_gcdata === false) return "unclassifiable";
  switch (draft.league?.tier) {
    case "premium": return "tier_1";
    case "professional": return "tier_2";
    case "excluded":
    case "amateur":
    case "unknown":
    default: return "excluded";
  }
}

export function classifyDrafts(drafts: readonly ClassifiableDraft[]): Record<DraftClass, number> {
  const counts: Record<DraftClass, number> = { tier_1: 0, tier_2: 0, excluded: 0, unclassifiable: 0 };
  for (const draft of drafts) counts[classifyTier(draft)] += 1;
  return counts;
}
