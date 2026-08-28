export interface DraftTurnLike { readonly order?: number; readonly hero_id?: number; readonly is_pick?: boolean; }
export interface DraftLike { readonly match_id?: number | string; readonly patch?: number | string; readonly picks_bans?: readonly DraftTurnLike[]; }
export interface DraftValidation { readonly valid: boolean; readonly errors: readonly string[]; }

// Snapshot curado de /api/heroes (OpenDota, 2026-08-27). Los IDs no son contiguos:
// Valve reserva huecos y los héroes nuevos ya superan el antiguo límite 127.
export const CURATED_HERO_IDS: ReadonlySet<number> = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
  25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44,
  45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64,
  65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84,
  85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103,
  104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 119, 120, 121, 123, 126,
  128, 129, 131, 135, 136, 137, 138, 145, 155,
]);

export function validateDraftShape(draft: DraftLike): DraftValidation {
  const errors: string[] = [];
  if (draft.match_id === undefined || String(draft.match_id).length === 0) errors.push("missing_match_id");
  const turns = draft.picks_bans ?? [];
  if (turns.length !== 24) errors.push("incomplete_picks_bans");
  const orders = turns.map((turn) => turn.order);
  if (orders.some((order) => !Number.isInteger(order)) || new Set(orders).size !== orders.length || orders.some((order, i) => order !== i)) errors.push("invalid_draft_order");
  if (turns.some((turn) => !Number.isInteger(turn.hero_id) || !CURATED_HERO_IDS.has(turn.hero_id as number))) errors.push("invalid_hero_id");
  if (typeof draft.patch !== "number" && typeof draft.patch !== "string") errors.push("missing_patch");
  return { valid: errors.length === 0, errors };
}
