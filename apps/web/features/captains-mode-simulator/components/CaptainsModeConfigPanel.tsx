"use client";

// R1 S7 (Blocker 2) -- minimal Captain's Mode entry point. Only what the frozen contract actually
// needs to create a session: local side, and firstPickSide (CONFIRM_FIRST_PICK_SIDE -- mandatory
// before any CM_ACTION, protocol-session.cm-acceptance.test.ts). No invitations, no multi-profile
// sync, no 24-step table duplicated here -- the engine stays the only authority on step order.
import type { TeamSide } from "@/features/draft/types";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";

const TEAM_LABELS: Record<TeamSide, string> = { radiant: "Radiant", dire: "Dire" };

interface SideToggleProps {
  label: string;
  value: TeamSide;
  onSelect: (side: TeamSide) => void;
}

function SideToggle({ label, value, onSelect }: SideToggleProps) {
  function selectRadiant() {
    onSelect("radiant");
  }
  function selectDire() {
    onSelect("dire");
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-content-secondary">{label}</span>
      <div className="flex gap-2">
        <button type="button" onClick={selectRadiant} className={value === "radiant" ? BUTTON_PRIMARY : BUTTON_SECONDARY}>
          {TEAM_LABELS.radiant}
        </button>
        <button type="button" onClick={selectDire} className={value === "dire" ? BUTTON_PRIMARY : BUTTON_SECONDARY}>
          {TEAM_LABELS.dire}
        </button>
      </div>
    </div>
  );
}

export interface CaptainsModeConfigPanelProps {
  localSide: TeamSide;
  firstPickSide: TeamSide;
  onLocalSideChange: (side: TeamSide) => void;
  onFirstPickSideChange: (side: TeamSide) => void;
  onStart: () => void;
}

export function CaptainsModeConfigPanel({
  localSide,
  firstPickSide,
  onLocalSideChange,
  onFirstPickSideChange,
  onStart,
}: CaptainsModeConfigPanelProps) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-surface-border bg-surface-raised p-4">
      <span className="text-heading text-content-primary">Configurar Captain&apos;s Mode</span>
      <SideToggle label="Tu lado" value={localSide} onSelect={onLocalSideChange} />
      <SideToggle label="Quién elige primero (FIRST)" value={firstPickSide} onSelect={onFirstPickSideChange} />
      <button type="button" onClick={onStart} className={`self-start ${BUTTON_PRIMARY}`}>
        Iniciar Captain&apos;s Mode
      </button>
    </div>
  );
}
