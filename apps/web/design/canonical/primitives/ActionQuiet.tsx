/* ActionQuiet — text + 1 px rule (recovered: `.r3b-quiet`, round-3b-labs.css:207-212).
   V1.1 interaction: hover darkens the rule; contact draws the spectral rule left→right (recovered from
   Skin A's trace, round-3b-labs.css:232-245); selected (`aria-pressed`) keeps a 1.5 px cyan rule;
   focus = canonical ring + brackets + node. A glyph never travels without its visible label. */
/* eslint-disable design-system/no-native-button */
import type { ReactNode } from "react";
import { D2Icon, type IconName } from "../../round-3b/icons";
import { FocusMarks } from "./FocusMarks";
import type { ActionPreview } from "./ActionPrimary";
import { useCommit } from "./use-commit";

export type ActionQuietProps = {
  children: ReactNode;
  disabled?: boolean;
  icon?: IconName;
  onPress?: () => void;
  preview?: ActionPreview;
  selected?: boolean;
};

function QuietGlyph({ icon, playing }: { icon?: IconName; playing: boolean }) {
  if (!icon) return null;
  return <D2Icon name={icon} playing={playing} />;
}

export function ActionQuiet({ children, disabled = false, icon, onPress, preview, selected }: ActionQuietProps) {
  const { committing, onKeyDown, onPointerUp } = useCommit();

  function handleClick() {
    onPress?.();
  }

  return (
    <button
      aria-pressed={selected}
      className="cx-quiet cx-focusable"
      data-commit={committing ? "true" : undefined}
      data-state={preview}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={onKeyDown}
      onPointerUp={onPointerUp}
      type="button"
    >
      <QuietGlyph icon={icon} playing={Boolean(selected) || preview !== undefined} />
      <span>{children}</span>
      <FocusMarks />
    </button>
  );
}
