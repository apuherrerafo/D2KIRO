/* ActionPrimary — the single spectral commitment per view.
   SKIN (recovered, D): Round 3A Spectral Action, Typography C — 110° pink→cyan→lime fill at 200 %,
   Syne 700, 8 px radius, 40 px (round-3a-labs.css:156-173). Interim until Julio picks A vs B (the 3B
   corner cut, available here as `geometry="cut"` so nothing breaks either way).
   INTERACTION (V1.1, Council C + D, geometry-agnostic): hover = gradient slide; contact (80 ms) =
   the whole spectrum condenses into the face, the corner closes, the label settles 1 px; release =
   snappy spring; Enter and Space get the same contact through `data-commit`. No lift, no glow, no
   scale(.97). Focus = ring + brackets + node, drawn on the unclipped host.
   Raw <button> on purpose: this IS the canonical primitive the lint rule will point to. */
/* eslint-disable design-system/no-native-button */
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { D2Icon } from "../../round-3b/icons";
import { FocusMarks } from "./FocusMarks";
import { useCommit } from "./use-commit";

export type ActionStatus = "idle" | "busy" | "success";
/** Forced specimen state. Uses the same CSS rule as the real pseudo-class — never a separate copy. */
export type ActionPreview = "hover" | "focus" | "pressed";
export type ActionGeometry = "round" | "cut";

export type ActionPrimaryProps = {
  busyLabel?: string;
  children: ReactNode;
  disabled?: boolean;
  geometry?: ActionGeometry;
  onPress?: () => void;
  preview?: ActionPreview;
  status?: ActionStatus;
  style?: CSSProperties;
  successLabel?: string;
};

function BusyTrack({ show }: { show: boolean }) {
  if (!show) return null;
  return <span aria-hidden="true" className="cx-action-busy" />;
}

function SuccessGlyph({ show }: { show: boolean }) {
  if (!show) return null;
  return <D2Icon name="confirm" playing size={14} />;
}

function labelFor(status: ActionStatus, children: ReactNode, busyLabel: string, successLabel: string) {
  if (status === "busy") return busyLabel;
  if (status === "success") return successLabel;
  return children;
}

export function ActionPrimary({
  busyLabel = "Analizando…",
  children,
  disabled = false,
  geometry = "round",
  onPress,
  preview,
  status = "idle",
  style,
  successLabel = "Listo",
}: ActionPrimaryProps) {
  const { committing, onKeyDown, onPointerUp } = useCommit();
  const busy = status === "busy";
  const success = status === "success";

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (busy) {
      event.preventDefault();
      return;
    }
    onPress?.();
  }

  return (
    <>
      <button
        aria-busy={busy ? "true" : undefined}
        aria-disabled={busy ? "true" : undefined}
        className="cx-action cx-focusable"
        data-commit={committing ? "true" : undefined}
        data-geometry={geometry}
        data-state={preview}
        data-status={status}
        disabled={disabled}
        onClick={handleClick}
        onKeyDown={onKeyDown}
        onPointerUp={onPointerUp}
        style={style}
        type="button"
      >
        <span aria-hidden="true" className="cx-action-face">
          <span className="cx-action-spectrum" />
          <BusyTrack show={busy} />
        </span>
        <span className="cx-action-label">
          {labelFor(status, children, busyLabel, successLabel)}
          <SuccessGlyph show={success} />
        </span>
        <FocusMarks />
      </button>
      <span aria-live="polite" className="cx-sr" role="status">{success ? successLabel : ""}</span>
    </>
  );
}
