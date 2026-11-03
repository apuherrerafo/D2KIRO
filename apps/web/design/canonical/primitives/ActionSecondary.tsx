/* ActionSecondary — REUSE, not imitation: renders the real Round 3B ICON_SKIN_B control (corner
   brackets + micro-index, the only skin that passed the 3B anti-generic review). The canonical layer
   adds only the shared focus ring offset (primitives.css `.cx-secondary`), never a second skin. */
import { SkinControl, type SkinState } from "../../round-3b/hybrid-lab";
import type { IconName } from "../../round-3b/icons";

export type ActionSecondaryProps = {
  icon: IconName;
  index?: string;
  label: string;
  state?: SkinState;
};

export function ActionSecondary({ icon, index = "01", label, state = "reposo" }: ActionSecondaryProps) {
  const action = { data: "", icon, index, label, meta: "" };
  return (
    <span className="cx-secondary">
      <SkinControl action={action} replay={0} skin="B" state={state} />
    </span>
  );
}
