import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/design/round-3a/lab-context";
import { boxWithin, transferCorners, type Box } from "./motion";

export type SelectionKey = string;
export const keyOf = (position: number, heroId: number): SelectionKey => `${position}:${heroId}`;

function boxOfCard(stage: HTMLElement, key: SelectionKey): Box | null {
  const card = stage.querySelector<HTMLElement>(`[data-card-key="${key}"]`);
  if (card === null) return null;
  return boxWithin(stage.getBoundingClientRect(), card.getBoundingClientRect());
}

/** Movimiento 09 «las esquinas siguen al objetivo»: al cambiar el candidato analizado, un marco de esquinas viaja de la tarjeta anterior a la nueva, una vez. */
export function useSelectionTransfer(selectedKey: SelectionKey | null) {
  const reduced = useReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLSpanElement>(null);
  const previous = useRef<SelectionKey | null>(selectedKey);
  useEffect(() => {
    const before = previous.current;
    previous.current = selectedKey;
    if (selectedKey === null || before === selectedKey || stage.current === null || overlay.current === null) return;
    const to = boxOfCard(stage.current, selectedKey);
    if (to === null) return;
    const from = before === null ? null : boxOfCard(stage.current, before);
    transferCorners(overlay.current, from, to, reduced);
  }, [selectedKey, reduced]);
  return { stage, overlay };
}
