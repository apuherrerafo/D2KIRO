/* StateTarget — the canonical state grammar on one neutral carrier (a draft option). Each state owns ONE
   channel, so no two are confusable (Council C board, unified by D):
   hover → ink brackets · focus → ring + brackets + node · selected → spectral segment (bottom) ·
   active → spectral cue (left) · recommended → notch + 1 px spectral edge · confirmed → closed ink
   perimeter only (human lock; lock glyph unresolved, none drawn) · processing → neutral track while aria-busy · success →
   confirm glyph + words · warning → attention glyph + words (hue NEEDS JULIO) · uncertain → dashed
   neutral · disabled → drained, dotted. Spectral appears on exactly three states: selected, active,
   recommended. */
/* eslint-disable design-system/no-native-button */
import type { ReactNode } from "react";
import { D2Icon, type IconName } from "../../round-3b/icons";
import { FocusMarks } from "./FocusMarks";

export const TARGET_STATES = ["rest", "hover", "focus", "selected", "active", "recommended", "confirmed", "processing", "success", "warning", "uncertain", "disabled"] as const;
export type TargetState = (typeof TARGET_STATES)[number];

const NOTE: Partial<Record<TargetState, { icon?: IconName; text: string }>> = {
  active: { icon: "live", text: "Analizando la línea ahora" },
  confirmed: { text: "Bloqueado · tu pick" },
  processing: { text: "Calculando…" },
  success: { icon: "confirm", text: "Guardado" },
  warning: { icon: "attention", text: "Revisa: el rival puede contestar" },
  uncertain: { text: "Evidencia baja" },
  disabled: { text: "No disponible" },
};

function TargetNote({ override, state }: { override?: string; state: TargetState }) {
  const note = NOTE[state];
  if (!note) return null;
  return <span className="cx-target-note">{note.icon ? <D2Icon name={note.icon} playing={state === "success"} size={14} /> : null}{override ?? note.text}</span>;
}

function RecommendedNotch({ label = "Recomendado", state }: { label?: string; state: TargetState }) {
  if (state !== "recommended") return null;
  return <span className="cx-target-notch">{label}</span>;
}

function FocusLayer({ state }: { state: TargetState }) {
  if (state !== "focus") return null;
  return <FocusMarks />;
}

export type StateTargetProps = {
  children?: ReactNode;
  /** Text of the hanging notch on `recommended`. Defaults to the Spanish product label. */
  notch?: string;
  /** `note` replaces the built-in (Spanish) note text of the states that carry one, so a consumer in another language never ships a mixed-language card. */
  note?: string;
  /** Makes the target a real button (selectable option). Selection is `state="selected"`, never a second prop. */
  onPress?: () => void;
  state: TargetState;
  title: string;
  value: string;
};

function TargetContent({ children, notch, note, state, title, value }: Omit<StateTargetProps, "onPress">) {
  const busy = state === "processing";
  return (
    <>
      <span aria-hidden="true" className="cx-target-ticks"><i /><i /><i /><i /></span>
      <span aria-hidden="true" className="cx-target-cue" />
      <span aria-hidden="true" className="cx-target-seg" />
      <RecommendedNotch label={notch} state={state} />
      <span className="cx-target-title">{title}</span>
      <span className="cx-target-value">{value}</span>
      <TargetNote override={note} state={state} />
      {busy ? <span aria-hidden="true" className="cx-target-track" /> : null}
      {children}
      <FocusLayer state={state} />
    </>
  );
}

export function StateTarget({ onPress, ...content }: StateTargetProps) {
  const { state } = content;
  const busy = state === "processing";
  const className = state === "focus" || onPress ? "cx-target cx-focusable" : "cx-target";
  if (onPress) {
    return (
      <button aria-busy={busy ? "true" : undefined} aria-pressed={state === "selected"} className={className} data-interactive="true" data-state={state} data-target-state={state} onClick={onPress} type="button">
        <TargetContent {...content} />
      </button>
    );
  }
  return (
    <div aria-busy={busy ? "true" : undefined} className={className} data-state={state} data-target-state={state}>
      <TargetContent {...content} />
    </div>
  );
}
