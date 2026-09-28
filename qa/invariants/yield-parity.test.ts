/**
 * D2KIRO P0-3 -- INV-YIELD-001 (web-derived Yield eligibility vs actual server precondition) and
 * the INV-YIELD-002 note (error-presentation regression).
 *
 * INDEPENDENCE: this file drives the REAL ProtocolSessionStore through the REAL public routes
 * (`qa/scenarios/generate.ts`'s fixture, same S2/S10 seam discipline as `ownership.test.ts` and
 * `binding.test.ts`) and reads only session-layer truth (`ProtocolSessionStore.metadata`) plus the
 * serialized public snapshot JSON. It never imports `apps/engine/src/coach/**` or
 * `apps/engine/src/recommendation/**`.
 *
 * ORACLE DESIGN (task section 5 -- "do not duplicate the server's internal precondition into the
 * oracle"): `webCanYield` below is a literal, hand-copied mirror of the CLIENT'S OWN formula
 * (`apps/web/features/random-draft-simulator/use-random-draft-session.ts`, `beginAttempt`,
 * `canYield = attemptPositions.length > 0 && controlledPositions.length < 5`) -- never the
 * server's `unfilledAllyPositions < openOwnRoundSlots` check (`protocol-session.ts`,
 * `yieldRound`). The oracle is the OBSERVABLE CONTRACT: if the web would advertise Yield as
 * actionable, the real `POST /yield` route must actually accept it. `apps/web` itself is never
 * imported (Next.js path aliases / React would not resolve under a plain `bun test`, and the
 * point of this file is to compare the CLIENT'S FORMULA against the REAL SERVER, not to exercise
 * the client's React code) -- this is the same "mirror by hand, not import" discipline the repo
 * already uses everywhere `apps/web` and `apps/engine` meet (`.claude/rules/invariantes.md`,
 * "Frontera apps/engine <-> apps/web").
 *
 * BUG (confirmed by direct code reading for this task): the web's `canYield` only asks "is there
 * an unbound controlled position, and does the party control fewer than all 5 seats" -- it never
 * compares THIS ROUND'S own-side slot count against how many Ally Bot positions remain unfilled,
 * which is exactly the number the server's `yieldRound` rejects on
 * (`ally_bot_cannot_absorb_capacity`, `protocol-session.ts`). Canonical counterexample: Party2
 * [1,2], round 1 deferred (yielded) entirely to the Ally Bot, round 2 opens with 2 own-side slots
 * but the Ally Bot has only 1 of its 3 positions left unfilled -- the web still says Yield is
 * legal; the server rejects it.
 */
import { describe, test, expect } from "bun:test";
import { createFixtureRoutes, type Position } from "../scenarios/generate";

interface PublicSnapshotLite {
  view: { rankedAp: { phase: string } | null; status: string };
  legalActions: { type: string; side?: string; slotIndex?: number }[];
  ownAssignedPositions: { round: number; slotIndex: number; assignedPosition: Position }[];
  stopReason?: string;
  error?: string;
}

function post(body: unknown): Request {
  return new Request("http://qa.local/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

/**
 * Literal mirror of `use-random-draft-session.ts`'s `beginAttempt` -- NOT the server's own
 * precondition (see the file header). `controlledPositions`/`boundPositions` are session-layer
 * truth (`ProtocolSessionStore.metadata` / the public snapshot's `ownAssignedPositions`), exactly
 * what the real web client has access to via the same public routes.
 */
function webCanYield(controlledPositions: readonly Position[], boundPositions: ReadonlySet<Position>): { attemptPositions: Position[]; canYield: boolean } {
  const attemptPositions = controlledPositions.filter((position) => !boundPositions.has(position));
  const canYield = attemptPositions.length > 0 && controlledPositions.length < 5;
  return { attemptPositions, canYield };
}

function minimalCounterexample(extra: Record<string, unknown>): string {
  return JSON.stringify({ inv: "INV-YIELD-001", ...extra }, null, 2);
}

describe("INV-YIELD-001 -- the web may advertise Yield only in states where the server accepts POST /yield", () => {
  test("Party2 [1,2], round 1 deferred entirely, round 2 start: web says Yield is legal, server rejects it", async () => {
    const { store, routes } = createFixtureRoutes();
    const controlSetId = "party2-1-2";
    const side = "radiant" as const;

    const created = await routes.post(
      post({
        rulesetId: "dota2/ranked-all-pick",
        patch: "7.41f",
        localSide: side,
        adapterKind: "simulator",
        partyContext: { partySize: 2 as const, side, controlledSlots: [] as const },
        controlledPositions: [1, 2] as const,
        humanPosition: 1 as const,
        simulatorSeed: "YIELDGATE-0001",
      }),
    );
    expect(created.status).toBe(201);
    const { sessionId } = (await created.json()) as { sessionId: string };

    const bansResponse = await routes.postResolveBans(post({ playerBanPreferences: [] }), sessionId);
    expect(bansResponse.status).toBe(200);

    // Round 1: reach human_input, then defer (yield) the whole round to the Ally Bot -- PD-020,
    // "the human decides WHEN". Round 1's 3 Ally positions (3,4,5) are all still unfilled at this
    // point, so `unfilledAllyPositions(3) >= openOwnRoundSlots(2)`: the server accepts this yield.
    const round1 = (await (await routes.postAutoDrive(sessionId)).json()) as PublicSnapshotLite;
    expect(round1.stopReason, `expected round 1 human_input; got ${JSON.stringify(round1)}`).toBe("human_input");
    expect(round1.view.rankedAp?.phase).toBe("PICK_ROUND_1");

    const round1YieldResponse = await routes.postYield(sessionId);
    expect(round1YieldResponse.status, "expected round 1's yield to succeed: the Ally Bot has full complement capacity at round 1").toBe(200);

    // Keep driving (own capacity now belongs to the Ally Bot for round 1) until round 2's own
    // human_input stop -- one `postAutoDrive` call may only advance ONE leg (e.g. "round_revealed"
    // once round 1 resolves), same pattern `qa/scenarios/generate.ts`'s own driver loop uses.
    let drive: PublicSnapshotLite | null = null;
    for (let guard = 0; guard < 8; guard += 1) {
      const response = await routes.postAutoDrive(sessionId);
      drive = (await response.json()) as PublicSnapshotLite;
      if (drive.stopReason === "human_input" || drive.stopReason === "complete") break;
      if (drive.stopReason !== "round_revealed") throw new Error(`unexpected auto-drive stop: ${JSON.stringify(drive)}`);
    }
    if (!drive) throw new Error("auto-drive never returned a snapshot");
    expect(drive.stopReason, `expected to reach round 2's human_input; got ${JSON.stringify(drive)}`).toBe("human_input");
    expect(drive.view.rankedAp?.phase).toBe("PICK_ROUND_2");

    // ---- Session-layer truth, read the same way the real web client would (public snapshot + metadata). ----
    const controlledPositions = store.metadata(sessionId)?.controlledPositions ?? [];
    const humanOpenPositions = store.humanOpenPositions(sessionId) ?? [];
    // `ownAssignedPositions` covers EVERY own-side binding so far -- the human's controlled
    // positions AND whichever Ally Bot positions got filled while absorbing round 1's yielded
    // capacity. The web's own formula (mirrored below) does not distinguish the two either: it
    // filters `controlledPositions` (never Ally's) against this same set.
    const boundPositions = new Set(drive.ownAssignedPositions.map((binding) => binding.assignedPosition));
    expect(controlledPositions.some((position) => boundPositions.has(position)), "test premise: no HUMAN position bound yet -- round 1 was entirely deferred").toBe(false);
    expect(humanOpenPositions, "test premise: both controlled positions still open at round 2 start").toEqual([1, 2]);

    const ownRoundSlotCount = drive.legalActions.filter((action) => action.type === "SUBMIT_SEALED_SELECTION" && action.side === side).length;
    expect(ownRoundSlotCount, "test premise: round 2 opens with 2 own-side slots (canonical counterexample)").toBe(2);

    const { attemptPositions, canYield } = webCanYield(controlledPositions, boundPositions);

    // ---- The actual server precondition: never duplicated here, only OBSERVED. ----
    const yieldResponse = await routes.postYield(sessionId);
    const serverAccepted = yieldResponse.status === 200;
    const serverErrorCode = serverAccepted ? null : ((await yieldResponse.json()) as { error?: string }).error ?? null;

    const ok = !canYield || serverAccepted;
    if (!ok) {
      console.error(
        minimalCounterexample({
          controlSet: controlSetId,
          side,
          round: 2,
          controlledPositions,
          humanOpenPositions,
          attemptPositions,
          webCanYield: canYield,
          serverStatus: yieldResponse.status,
          serverErrorCode,
        }),
      );
    }
    expect(ok, "the web must never advertise Yield as actionable in a state where POST /yield is rejected").toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// INV-YIELD-002 (task section 6, error-presentation regression lock): a domain-level /yield
// rejection (409 ally_bot_cannot_absorb_capacity) must not be classified as engine/network
// unreachability.
//
// RECORDED AS PENDING, NOT SKIPPED: the misclassification itself lives in
// `apps/web/features/random-draft-simulator/use-random-draft-session.ts`'s `yieldRound()`
// callback -- a React-hook closure (`useCallback`) that calls `requestYield` (`protocol-client.ts`,
// whose `readSnapshot` throws `Error("protocol request failed (409)")` for ANY non-ok response,
// discarding the JSON body's `error` code) and, in its `catch`, unconditionally calls
// `setEngineStatus("unreachable")` regardless of WHY the promise rejected. Exercising that
// specific callback requires mounting/rendering the hook (React Testing Library `renderHook` or
// equivalent, a DOM environment, Zustand store wiring) -- infrastructure that lives in
// `apps/web`'s OWN test setup (`@happy-dom/global-registrator`, per `CLAUDE.md`'s own documented
// reason `bun test` at the repo root cannot be run as one process), not under `qa/**`. `qa/tsconfig.json`
// has no `dom`/`react-jsx` lib and this task's scope is `qa/**` only (section 2: no `apps/**` file
// may be modified to make this reachable, and this task does not add new test infrastructure).
// Per task section 6's own fallback clause, this is recorded explicitly rather than forced.
// ---------------------------------------------------------------------------------------------
describe("INV-YIELD-002 -- a domain-level /yield rejection must not be classified as engine/network unreachability", () => {
  test.todo(
    "P0_3B_UI_ERROR_MAPPING_PENDING -- lives in a React-hook closure (use-random-draft-session.ts's yieldRound) with no " +
      "DOM/React harness reachable from qa/**; protocol-client.ts's readSnapshot() discards the 409 body's `error` field " +
      "(`if (!response.ok) throw new Error('protocol request failed (' + response.status + ')')`), which is the production " +
      "evidence this defect is real -- not yet exercised as an executable red gate within this task's qa/**-only scope.",
    () => {},
  );
});
