/**
 * D2KIRO P0-2 -- INV-BIND-001 (authoritative own-team position bindings outrank RoleBelief
 * inference).
 *
 * INDEPENDENCE (same discipline as ownership.test.ts, guarded mechanically by
 * oracle-independence.test.ts): this file never imports `apps/engine/src/coach/**` or
 * `apps/engine/src/recommendation/**`. It only:
 *   - drives the real ProtocolSessionStore through the real public routes (the system under test);
 *   - reads session-layer OWNERSHIP TRUTH (`humanOpenPositions`, `ownAssignedPositionForHero` --
 *     both computed by `ProtocolSessionStore`, never by the Coach/recommendation layer);
 *   - judges the serialized public V3 JSON the routes return, via the same
 *     `primaryActionPositions` oracle `ownership.test.ts` already uses for INV-OWN-001/003.
 * RoleBelief's own argmax is never imported/computed from production code here -- see the
 * `FLEX_HERO_ARGMAX_FOR_DISPLAY_ONLY` note below: it is a trivial, independently-computed number
 * from this file's OWN fixture data, printed for diagnostic context only, never the oracle's judge.
 *
 * BUG (confirmed by direct code reading, `docs/agents/journal.md`-free investigation for this
 * task): `apps/engine/src/coach/reveal-strategy.ts`'s `occupiedPositions()` derives which own-team
 * seats are "occupied" from `ownRoleBeliefs`' own argmax (the highest-probability position per
 * hero belief) -- never from the session's authoritative `assignedPosition` (the position the
 * human explicitly bound at `SUBMIT_SEALED_SELECTION` time, exposed as
 * `ProtocolSessionStore.ownAssignedPositionForHero` / `humanOpenPositions`). With a stock,
 * single-position fixture hero the two always agree (hidden defect); with a genuinely FLEX hero
 * (credible at 2+ positions, weighted AWAY from the position it was actually bound to) they can
 * disagree, and the Coach still treats the bound position as free.
 */
import { describe, test, expect } from "bun:test";
import type { HeroPositions } from "../../apps/engine/src/signals/hero-positions";
import { createFixtureRoutes, humanHeroFor, HERO_POSITIONS, fetchRecommendations, type Position } from "../scenarios/generate";
import { primaryActionPositions } from "../mvp/oracles/coach-primary-action-oracle";

// A hero id far outside the stock fixture's range (100..529, S2/S10 seam discipline) and outside
// the bot-pick filler range (1..48) -- no collision possible with any control-set/side/order
// combination `qa/invariants/ownership.test.ts` already exercises against the STOCK map.
const FLEX_HERO_ID = 90001;

// Canonical counterexample from the D2KIRO P0 audit: credible for Pos1 (700 matches), MORE
// credible for Pos2 (1000 matches) -- deriveFlexDistribution (position-prior.ts) normalizes these
// into probabilities[1] ~= 0.412, probabilities[2] ~= 0.588. Inlined here (not imported) so this
// file's own fixture data is legible on its own, independent of production's normalization code.
const FLEX_HERO_EVIDENCE: readonly { position: Position; matches: number }[] = [
  { position: 1, matches: 700 },
  { position: 2, matches: 1000 },
];
const FLEX_HERO_ARGMAX_FOR_DISPLAY_ONLY: Position = [...FLEX_HERO_EVIDENCE].sort((a, b) => b.matches - a.matches)[0]!.position;

const FLEX_HERO_POSITIONS: HeroPositions = {
  ...HERO_POSITIONS,
  [FLEX_HERO_ID]: FLEX_HERO_EVIDENCE.map((share) => ({ position: share.position, matches: share.matches })),
};

interface PublicSnapshotLite {
  view: { rankedAp: { phase: string } | null };
  legalActions: { type: string; side?: string; slotIndex?: number }[];
  ownAssignedPositions: { round: number; slotIndex: number; assignedPosition: Position }[];
  accepted?: boolean;
}

function minimalCounterexample(extra: Record<string, unknown>): string {
  return JSON.stringify({ inv: "INV-BIND-001", ...extra }, null, 2);
}

describe("INV-BIND-001 -- authoritative own-team position bindings outrank RoleBelief inference", () => {
  test("hero explicitly bound to Pos1 (session truth) with RoleBelief argmax at Pos2 must never see Pos1 offered again as a human action", async () => {
    const { store, routes } = createFixtureRoutes(FLEX_HERO_POSITIONS);

    const controlSetId = "party2-1-2";
    const side = "radiant" as const;
    const createBody = {
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41f",
      localSide: side,
      adapterKind: "simulator",
      partyContext: { partySize: 2 as const, side, controlledSlots: [] as const },
      controlledPositions: [1, 2] as const,
      humanPosition: 1 as const,
      simulatorSeed: "BINDGATE-0001",
    };
    const created = await routes.post(
      new Request("http://qa.local/session/protocol", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(createBody) }),
    );
    expect(created.status).toBe(201);
    const { sessionId } = (await created.json()) as { sessionId: string };

    const bansResponse = await routes.postResolveBans(
      new Request("http://qa.local/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerBanPreferences: [] }) }),
      sessionId,
    );
    expect(bansResponse.status).toBe(200);

    const driveResponse = await routes.postAutoDrive(sessionId);
    const drive = (await driveResponse.json()) as PublicSnapshotLite & { stopReason?: string };
    expect(drive.stopReason, `expected auto-drive to stop for human input at round 1; got ${JSON.stringify(drive)}`).toBe("human_input");
    expect(drive.view.rankedAp?.phase).toBe("PICK_ROUND_1");

    const ownOpenSlots = drive.legalActions.filter((action) => action.type === "SUBMIT_SEALED_SELECTION" && action.side === side);
    expect(ownOpenSlots.length, "expected at least one open own-side round-1 slot to bind the flex hero to Pos1").toBeGreaterThan(0);
    const targetSlot = ownOpenSlots[0]!;

    // The human binds the flex hero to Pos1 -- SESSION TRUTH, the only oracle this invariant trusts.
    // Deliberately never calls the separate Coach-side `assignPosition`/`onPlayerPositionAssigned`
    // action (POST .../assign-position) -- that is precisely the gap this defect lives in: a real
    // client that only submits the pick (as every AP Simulator/live-draft client does today) never
    // syncs the Coach's RoleBelief with the authoritative binding.
    const submitResponse = await routes.postCommand(
      new Request("http://qa.local/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: { type: "SUBMIT_SEALED_SELECTION", side, slotIndex: targetSlot.slotIndex, heroId: FLEX_HERO_ID }, assignedPosition: 1 }),
      }),
      sessionId,
    );
    const submitSnapshot = (await submitResponse.json()) as PublicSnapshotLite;
    expect(submitResponse.status).toBe(202);
    expect(submitSnapshot.accepted).toBe(true);

    // Session truth, read directly from the store (never re-derived, never from the Coach/recommendation layer).
    const authoritativeAssignedPosition = store.ownAssignedPositionForHero(sessionId, FLEX_HERO_ID);
    const humanOpenPositions = store.humanOpenPositions(sessionId) ?? [];
    expect(authoritativeAssignedPosition, "test premise: the flex hero must actually be bound to Pos1 in session truth").toBe(1);
    expect(humanOpenPositions, "test premise: Pos1 must no longer be an open human position once bound").toEqual([2]);

    const { v3, rawText } = await fetchRecommendations(routes, sessionId);
    expect(v3, `expected a Coach V3 output for this checkpoint; raw: ${rawText}`).not.toBeNull();

    const primaryTargets = primaryActionPositions(v3!.primaryAction.strategy);
    const shortlistPositions = v3!.shortlist.map((card) => card.position).filter((position): position is Position => position !== null);
    const offendingPrimary = (primaryTargets ?? []).filter((position) => !humanOpenPositions.includes(position));
    const offendingShortlist = shortlistPositions.filter((position) => !humanOpenPositions.includes(position));
    const ok = offendingPrimary.length === 0 && offendingShortlist.length === 0;

    if (!ok) {
      console.error(
        minimalCounterexample({
          controlSet: controlSetId,
          side,
          heroId: FLEX_HERO_ID,
          authoritativeAssignedPosition,
          roleBeliefArgmaxIndependentlyComputedFromFixtureEvidence: FLEX_HERO_ARGMAX_FOR_DISPLAY_ONLY,
          humanOpenPositions,
          coachPrimaryAction: v3!.primaryAction.strategy,
          coachShortlistPositions: shortlistPositions,
          offendingPrimary,
          offendingShortlist,
          step: "after_own_pick round 1 (single seat bound, second own seat still open)",
        }),
      );
    }
    expect(ok).toBe(true);
  });
});
