/* Contact → commit → settle on every activation path. Pointer contact is `:active`; keyboard Enter has
   no `:active` at all and a touch tap can be shorter than a frame (Council C, measured), so both get a
   one-shot `data-commit` hold. The action itself still fires on click — never delayed. */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { DURATIONS } from "../../round-3a/motion-tokens";

/** Commit hold = motion.duration.fast. Long enough to read, short enough to never feel laggy. */
export const COMMIT_HOLD_MS = DURATIONS.fast;

export function useCommit() {
  const [committing, setCommitting] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  function pulse() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setCommitting(true);
    timer.current = window.setTimeout(() => setCommitting(false), COMMIT_HOLD_MS);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.repeat) return;
    if (event.key === "Enter" || event.key === " ") pulse();
  }

  function onPointerUp(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === "touch") pulse();
  }

  return { committing, onKeyDown, onPointerUp };
}
