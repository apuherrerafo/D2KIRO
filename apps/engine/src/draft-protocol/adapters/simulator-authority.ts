import type { AuthoritativeCollisionResolution, OpenSlot, PendingCollisionAuthority, ProtocolCommand, TeamSide } from "../types";

// R1 S2.4 / AP Ranked Roles V1 (Wave 1, Task 11) -- SIMULATOR collision authority adapter.
//
// The kernel NEVER lets transport/arrival order pick a 3rd+ collision winner (S1, frozen
// contract) -- it canonicalizes ordering, pauses in WAITING_FOR_COLLISION_AUTHORITY and waits for a
// separate, out-of-band APPLY_AUTHORITATIVE_COLLISION_RESOLUTION command. In a real Ranked All Pick
// draft that authority is Valve; for the Simulator, THIS module supplies it.
//
// PRODUCT RULE (PD-022, Product Owner decision for Task 11): the third collision is won by
// whoever REGISTERED FIRST. The kernel deliberately discards arrival order, so the ordering
// evidence lives OUTSIDE the kernel, in the session-store registration ledger
// (server/protocol-session.ts): one monotonic ordinal per ACCEPTED SUBMIT_SEALED_SELECTION. This
// module only reads that evidence -- it has no seed, no PRNG, no hash and no other tie-break. If the
// evidence is missing or ambiguous it FAILS CLOSED: no winner is chosen.
//
// Not Valve internals; PRODUCT_POLICY for simulation only, versioned so a future real authority
// adapter can be swapped in without silently changing simulator replay history.
//
// This module NEVER touches DraftProtocolState. It only ever produces a ProtocolCommand -- the
// caller must still route it through applyProtocolCommand (kernel.ts), the one mutation path.

export const SIMULATOR_COLLISION_POLICY_VERSION = "simulator-collision-authority/v2-first-registration";

/** One ACCEPTED SUBMIT_SEALED_SELECTION, in the order the session store accepted it. */
export interface RegistrationRecord {
  /** Monotonic per session, starts at 1. Assigned only when the kernel accepted the command. */
  ordinal: number;
  round: 1 | 2 | 3;
  /** `round.collisionsResolved` when the selection was accepted: identifies the selection attempt. */
  collisionsResolved: number;
  side: TeamSide;
  slotIndex: number;
  heroId: number;
}

/** The ledger view for the session CURRENT round attempt. */
export interface CollisionRegistrationEvidence {
  collisionsResolved: number;
  records: readonly RegistrationRecord[];
}

export type CollisionAuthorityFailureReason = "REGISTRATION_EVIDENCE_MISSING" | "REGISTRATION_EVIDENCE_AMBIGUOUS";

export type SimulatorAuthorityOutcome =
  | {
      ok: true;
      policy: typeof SIMULATOR_COLLISION_POLICY_VERSION;
      command: Extract<ProtocolCommand, { type: "APPLY_AUTHORITATIVE_COLLISION_RESOLUTION" }>;
    }
  | { ok: false; policy: typeof SIMULATOR_COLLISION_POLICY_VERSION; reason: CollisionAuthorityFailureReason; detail: string };

function fail(reason: CollisionAuthorityFailureReason, detail: string): SimulatorAuthorityOutcome {
  return { ok: false, policy: SIMULATOR_COLLISION_POLICY_VERSION, reason, detail };
}

function registrationFor(
  pending: PendingCollisionAuthority,
  evidence: CollisionRegistrationEvidence,
  contender: OpenSlot,
): { ok: true; ordinal: number } | { ok: false; reason: CollisionAuthorityFailureReason; detail: string } {
  // Only THIS round CURRENT attempt participates: registrations from collision #1/#2 attempts or
  // from any earlier round can never influence the winner.
  const matches = evidence.records.filter(
    (record) =>
      record.round === pending.round &&
      record.collisionsResolved === evidence.collisionsResolved &&
      record.side === contender.side &&
      record.slotIndex === contender.slotIndex &&
      record.heroId === pending.heroId,
  );
  if (matches.length === 0) {
    return { ok: false, reason: "REGISTRATION_EVIDENCE_MISSING", detail: `no registration for ${contender.side} slot ${contender.slotIndex}` };
  }
  if (matches.length > 1) {
    return { ok: false, reason: "REGISTRATION_EVIDENCE_AMBIGUOUS", detail: `${matches.length} registrations for ${contender.side} slot ${contender.slotIndex}` };
  }
  return { ok: true, ordinal: matches[0]!.ordinal };
}

/**
 * Lower registration ordinal = registered first = wins. Requires authoritative ordering evidence:
 * there is deliberately no overload or default that decides without it.
 */
export function resolveSimulatorCollisionAuthority(
  pending: PendingCollisionAuthority,
  evidence: CollisionRegistrationEvidence,
): SimulatorAuthorityOutcome {
  const [a, b] = pending.contenders;
  const first = registrationFor(pending, evidence, a);
  if (!first.ok) return fail(first.reason, first.detail);
  const second = registrationFor(pending, evidence, b);
  if (!second.ok) return fail(second.reason, second.detail);
  if (first.ordinal === second.ordinal) return fail("REGISTRATION_EVIDENCE_AMBIGUOUS", "both contenders share one registration ordinal");

  const winner: AuthoritativeCollisionResolution["winner"] = first.ordinal < second.ordinal ? a : b;
  return {
    ok: true,
    policy: SIMULATOR_COLLISION_POLICY_VERSION,
    command: {
      type: "APPLY_AUTHORITATIVE_COLLISION_RESOLUTION",
      round: pending.round,
      heroId: pending.heroId,
      winner,
    },
  };
}
