"use client";

import { ARCHETYPE_LABELS, ARCHETYPE_OPTIONS } from "@/features/draft/constants";
import { useDraftStore } from "@/features/draft/store";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";
import type { DraftArchetype } from "@/features/draft/types";

// TSK-181 / TSK-182 (Fase 4.3, SPEC.md §11.14): pura, exportada para probarla sin renderizar --
// mismo criterio que `isModeActive` en InputModeSelector. `null` = sin intención (ningún chip activo).
export function isIntentActive(current: DraftArchetype | null, option: DraftArchetype | null): boolean {
  return current === option;
}

interface IntentOptionProps {
  label: string;
  active: boolean;
  onSelect: () => void;
}

function IntentOption({ label, active, onSelect }: IntentOptionProps) {
  return (
    <button type="button" onClick={onSelect} aria-pressed={active} className={active ? BUTTON_PRIMARY : BUTTON_SECONDARY}>
      {label}
    </button>
  );
}

interface ArchetypeChipProps {
  archetype: DraftArchetype;
  active: boolean;
  onSelect: (archetype: DraftArchetype) => void;
}

function ArchetypeChip({ archetype, active, onSelect }: ArchetypeChipProps) {
  function handleSelect() {
    onSelect(archetype);
  }
  return <IntentOption label={ARCHETYPE_LABELS[archetype]} active={active} onSelect={handleSelect} />;
}

interface DraftIntentSelectorProps {
  value: DraftArchetype | null;
  onChange: (intent: DraftArchetype | null) => void;
}

// <Dominio><Cosa>: control visible de la intención de draft. Elegir un arquetipo activa la señal
// `archetype_fit` del motor (queda `applicable: false` sin intención). Prop-driven: lo usan tanto
// la vista en vivo (`DraftIntentSelectorConnected`) como el Simulador de Draft (su propio hook).
export function DraftIntentSelector({ value, onChange }: DraftIntentSelectorProps) {
  function clearIntent() {
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-caption text-content-muted">Intención de draft</span>
      <div className="flex flex-wrap gap-2">
        {ARCHETYPE_OPTIONS.map((archetype) => (
          <ArchetypeChip key={archetype} archetype={archetype} active={isIntentActive(value, archetype)} onSelect={onChange} />
        ))}
        <IntentOption label="Sin intención" active={isIntentActive(value, null)} onSelect={clearIntent} />
      </div>
    </div>
  );
}

// Enganchado al store de la vista de draft en vivo (`/live-draft`). El simulador NO usa este
// store -- pasa el `value`/`onChange` de su propio hook (`use-random-draft-session.ts`).
export function DraftIntentSelectorConnected() {
  const value = useDraftStore((s) => s.archetypeIntent);
  const onChange = useDraftStore((s) => s.setArchetypeIntent);
  return <DraftIntentSelector value={value} onChange={onChange} />;
}
