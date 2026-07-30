import type { DraftPath, VisibleDraftPathCard } from "./types";

function clampIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  if (index < 0) return 0;
  if (index >= total) return total - 1;
  return index;
}

export function getVisibleDraftPathCards(paths: DraftPath[], activeIndex: number): VisibleDraftPathCard[] {
  if (paths.length === 0) return [];
  const active = clampIndex(activeIndex, paths.length);
  const cards: VisibleDraftPathCard[] = [];

  const previous = paths[active - 1];
  if (previous) cards.push({ path: previous, index: active - 1, position: "previous" });

  cards.push({ path: paths[active]!, index: active, position: "active" });

  const next = paths[active + 1];
  if (next) cards.push({ path: next, index: active + 1, position: "next" });

  return cards;
}
