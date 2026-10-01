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
import { createFixtureRoutes, humanHeroFor, HERO_POSITIONS, fetchRecommendations, type Position, type PublicV4 } from "../scenarios/generate";
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

  // Greptile PR #9 (P1) -- the same invariant, judged on the V4 ranking's ROLE FEASIBILITY. Adversarial
  // premise: HERO A's empirical evidence is EXCLUSIVELY Pos2, but the human authoritatively bound it to
  // Pos1. Pos2 stays human-open. A Pos2-only candidate must therefore be role-feasible at Pos2: the
  // only way "Pos2 is already occupied" can appear is if inference re-reads HERO A as Pos2 and
  // ignores the binding. Expected oracle (independent of production code): with A at Pos1 and the
  // candidate at Pos2, an injective assignment trivially exists -- so no ROLE_ASSIGNMENT_IMPOSSIBLE.
  test("V4: own hero with Pos2-only evidence bound to Pos1 never makes a Pos2-only candidate role-infeasible at the still-open Pos2", async () => {
    const POS2_ONLY_HERO_A = 90002;
    const heroPositions: HeroPositions = { ...HERO_POSITIONS, [POS2_ONLY_HERO_A]: [{ position: 2, matches: 1000 }] };
    const { store, routes } = createFixtureRoutes(heroPositions);
    const side = "radiant" as const;
    const created = await routes.post(postJson({
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41f",
      localSide: side,
      adapterKind: "simulator",
      partyContext: { partySize: 2, side, controlledSlots: [] },
      controlledPositions: [1, 2],
      humanPosition: 1,
      simulatorSeed: "BINDGATE-0002",
    }));
    expect(created.status).toBe(201);
    const { sessionId } = (await created.json()) as { sessionId: string };
    expect((await routes.postResolveBans(postJson({ playerBanPreferences: [] }), sessionId)).status).toBe(200);

    const drive = (await (await routes.postAutoDrive(sessionId)).json()) as PublicSnapshotLite & { stopReason?: string };
    expect(drive.stopReason).toBe("human_input");
    const slot = drive.legalActions.find((action) => action.type === "SUBMIT_SEALED_SELECTION" && action.side === side)!;
    const submit = await routes.postCommand(
      postJson({ command: { type: "SUBMIT_SEALED_SELECTION", side, slotIndex: slot.slotIndex, heroId: POS2_ONLY_HERO_A }, assignedPosition: 1 }),
      sessionId,
    );
    expect(submit.status).toBe(202);

    // Premises, from session truth only.
    expect(store.ownAssignedPositionForHero(sessionId, POS2_ONLY_HERO_A), "premise: HERO A is authoritatively bound to Pos1").toBe(1);
    expect(store.humanOpenPositions(sessionId), "premise: Pos2 remains human-open").toEqual([2]);
    if (store.humanActionability(sessionId)?.hasHumanAction !== true) {
      const next = (await (await routes.postAutoDrive(sessionId)).json()) as { stopReason?: string };
      expect(next.stopReason, "premise: the human still has to act on Pos2").toBe("human_input");
    }

    const response = await routes.getRecommendations(sessionId, new URL(`http://qa.local/${sessionId}/recommendations?format=v4&target=2`));
    expect(response.status).toBe(200);
    const { output } = (await response.json()) as { output: PublicV4 };
    expect(output.decision.kind).toBe("ACTIONABLE");
    const decision = output.decision as Extract<PublicV4["decision"], { kind: "ACTIONABLE" }>;
    expect(decision.viewedPosition).toBe(2);
    const candidates = decision.candidates;
    const roleImpossible = candidates.degradations.filter((degradation) => degradation.reason === "ROLE_ASSIGNMENT_IMPOSSIBLE");
    if (roleImpossible.length > 0 || candidates.state !== "RANKED") {
      console.error(minimalCounterexample({ step: "V4 viewing Pos2 after HERO A bound to Pos1", heroA: POS2_ONLY_HERO_A, candidates }));
    }
    expect(roleImpossible).toEqual([]);
    expect(candidates.state).toBe("RANKED");
    const cards = candidates.state === "RANKED" ? candidates.cards : [];
    // Fixture oracle: every stock Pos2 hero is id 2xx; HERO A itself is taken.
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.position === 2 && Math.floor(card.heroId / 100) === 2)).toBe(true);
  });
});

function postJson(body: unknown): Request {
  return new Request("http://qa.local/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
