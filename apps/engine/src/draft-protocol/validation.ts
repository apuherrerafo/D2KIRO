import { parseCmHeroEligibilitySnapshot } from "./eligibility";
import { isValidHeroId } from "./hero-id";
import { isValidPartySize } from "./party-context";
import type { PartyContextInput } from "./kernel";
import type { ControlledSlot, OpenSlot, ProtocolCommand, RulesetId, TeamSide } from "./types";

// R1 S2/S3 -- edge validation for ProtocolCommand and session-creation input, same discipline as
// server/edge.ts's isValidDraftEventEnvelope/isValidClientMessage: a command arriving over HTTP/WS
// is external input (security.md), validated here BEFORE it ever reaches applyProtocolCommand.
// Lives beside the kernel (not in server/edge.ts) because the command shape is intrinsic to
// draft-protocol's own contract, reusable by any transport (HTTP now, WS later) without server/
// depending on transport specifics twice.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isTeamSide(value: unknown): value is TeamSide {
  return value === "radiant" || value === "dire";
}

function isRelativeSide(value: unknown): value is "first" | "second" {
  return value === "first" || value === "second";
}

function isHeroIdArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isValidHeroId);
}

function isOpenSlot(value: unknown): value is OpenSlot {
  if (!isRecord(value)) return false;
  return isTeamSide(value.side) && Number.isInteger(value.slotIndex) && (value.slotIndex as number) >= 0;
}

export function isValidRulesetId(value: unknown): value is RulesetId {
  return value === "dota2/ranked-all-pick" || value === "dota2/captains-mode";
}

export function isValidProtocolCommand(value: unknown): value is ProtocolCommand {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "RECORD_RESOLVED_BANS":
      return isHeroIdArray(value.heroes);
    case "BAN_RESOLUTION_COMPLETE":
      return true;
    case "SUBMIT_SEALED_SELECTION":
      return isTeamSide(value.side) && Number.isInteger(value.slotIndex) && (value.slotIndex as number) >= 0 && isValidHeroId(value.heroId);
    case "APPLY_AUTHORITATIVE_COLLISION_RESOLUTION":
      return (value.round === 1 || value.round === 2 || value.round === 3) && isValidHeroId(value.heroId) && isOpenSlot(value.winner);
    case "CONFIRM_FIRST_PICK_SIDE":
      return isTeamSide(value.side);
    case "LOAD_CM_ELIGIBILITY":
      return parseCmHeroEligibilitySnapshot(value.snapshot) !== null;
    case "CM_ACTION":
      return isRelativeSide(value.actor) && (value.kind === "BAN" || value.kind === "PICK") && isValidHeroId(value.heroId);
    case "CM_BAN_SKIPPED":
      return isRelativeSide(value.actor);
    case "CM_AUTO_PICK":
      return isRelativeSide(value.actor) && isValidHeroId(value.heroId);
    default:
      return false;
  }
}

function isControlledSlot(value: unknown): value is ControlledSlot {
  if (!isRecord(value)) return false;
  return (
    isTeamSide(value.side) &&
    Number.isInteger(value.slotIndex) &&
    (value.slotIndex as number) >= 0 &&
    (value.slotIndex as number) <= 4 &&
    typeof value.controllerId === "string" &&
    value.controllerId.length > 0
  );
}

/** Structural shape only -- createPartyContext (party-context.ts) still owns real semantic validation (size/side/slot-range consistency). */
export function isValidPartyContextInput(value: unknown): value is PartyContextInput {
  if (!isRecord(value)) return false;
  return (
    typeof value.partySize === "number" &&
    isValidPartySize(value.partySize) &&
    isTeamSide(value.side) &&
    Array.isArray(value.controlledSlots) &&
    value.controlledSlots.every(isControlledSlot)
  );
}

export interface CreateProtocolSessionBody {
  rulesetId: RulesetId;
  patch: string;
  localSide: TeamSide;
  adapterKind: "manual" | "simulator";
  partyContext: PartyContextInput;
}

export function isValidCreateProtocolSessionBody(value: unknown): value is CreateProtocolSessionBody {
  if (!isRecord(value)) return false;
  if (!isValidRulesetId(value.rulesetId)) return false;
  if (typeof value.patch !== "string" || value.patch.length === 0) return false;
  if (!isTeamSide(value.localSide)) return false;
  if (value.adapterKind !== "manual" && value.adapterKind !== "simulator") return false;
  if (!isValidPartyContextInput(value.partyContext) || value.partyContext.side !== value.localSide) return false;
  return true;
}

export interface SubmitProtocolCommandBody {
  command: ProtocolCommand;
  /** Which side's perspective the response view is projected for; omitted/null -> spectator. */
  viewerSide?: TeamSide | null;
}

export function isValidSubmitProtocolCommandBody(value: unknown): value is SubmitProtocolCommandBody {
  if (!isRecord(value)) return false;
  if (!isValidProtocolCommand(value.command)) return false;
  if (value.viewerSide !== undefined && value.viewerSide !== null && !isTeamSide(value.viewerSide)) return false;
  return true;
}

export interface SimulatorAuthorityBody {
  seed: string;
}

export function isValidSimulatorAuthorityBody(value: unknown): value is SimulatorAuthorityBody {
  if (!isRecord(value)) return false;
  return typeof value.seed === "string" && value.seed.length > 0 && value.seed.length <= 64;
}

export type BotSelectionBody = Record<string, never>;

export function isValidBotSelectionBody(value: unknown): value is BotSelectionBody {
  if (!isRecord(value)) return false;
  return Object.keys(value).length === 0;
}
