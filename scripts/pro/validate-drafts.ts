export interface DraftTurnLike { readonly order?: number; readonly hero_id?: number; readonly is_pick?: boolean; }
export interface DraftLike { readonly match_id?: number | string; readonly patch?: number | string; readonly picks_bans?: readonly DraftTurnLike[]; }
export interface DraftValidation { readonly valid: boolean; readonly errors: readonly string[]; }

// CURATED_HERO_IDS vive en apps/engine/src/ (dato de dominio que el motor consume en runtime).
// Se importa (uso local en validateDraftShape) y se re-exporta para no romper los consumidores
// de este módulo (ingest-drafts, tests). `apps/` NUNCA importa de `scripts/`; la dirección
// válida es `scripts/` -> `apps/`.
import { CURATED_HERO_IDS } from "../../apps/engine/src/signals/curated-hero-ids";
export { CURATED_HERO_IDS };

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
