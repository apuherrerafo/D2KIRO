# R1 — Draft Product Wave (Slice 2): S2 Ranked AP + Parties, S3 Captain's Mode, S4 Role Belief

Status: implemented on branch `r1/draft-product-wave`, not merged, not pushed. Builds directly on
S1 (`.kiro/specs/r1-protocol-kernel/design.md`, merged to `master` at `384cf4b`). This document
records what this slice actually did, what it deliberately left legacy, and what it defers to S5/S6.

## What this slice is, and isn't

This slice wires S1's Protocol Kernel into a real, testable session/HTTP path for both rulesets
(S2, S3), and builds a canonical role-uncertainty layer on top of the party/participant model S1
laid down (S4). It does **not** build RecommendationSet/v2 (S5), lookahead (S6), or certification
(S7). It does **not** rip out the legacy reducer/SessionStore path or rewrite the frontend
`random-draft-simulator`'s UI — see "Legacy status" below for exactly what that means and why.

## S2 — Ranked All Pick + Parties

### New engine-side layer

```
apps/engine/src/draft-protocol/
  adapters/
    simulator-authority.ts   -- SIMULATOR_POLICY collision resolution (S2.4)
    suggestion-bridge.ts     -- PerspectiveDraftView -> legacy V6 suggestion-engine input (S2.2)
    cm-simulator.ts          -- drives Captain's Mode through the kernel (S3.5)
  participants.ts            -- controlled vs external roster slots, from PartyContext (S2.5/S4.4)
  validation.ts              -- edge validation for ProtocolCommand + session-creation bodies
apps/engine/src/server/
  protocol-session.ts        -- ProtocolSessionStore: the new session layer
  routes/protocol-sessions.ts -- HTTP surface: /api/session/protocol/*
```

The mandated flow is real end to end: **adapter → ProtocolKernel → authoritative state →
project(viewer) → legalGameplayActions**. `ProtocolSessionStore` never mutates state itself — it
only ever calls `applyProtocolCommand` (kernel.ts's one authoritative path) and hands back
`project()`/`legalActions()` results. HTTP routes are a thin translation of that same contract;
no route recomputes a protocol decision.

### Session creation & party sizes

`POST /api/session/protocol` accepts `{ rulesetId, patch, partyContext? }`. Party size 4 is
rejected twice, independently: at the HTTP edge (`isValidPartyContextInput`, before touching the
store) and again by S1's own `createPartyContext` (defense in depth, not redundancy — the edge
check exists so a malformed request never even reaches the kernel; the kernel check exists because
`ProtocolSessionStore` is a library other callers besides HTTP could use directly).

Captain's Mode has no `partyContext` slot in `CmState` — S1's frozen types don't carry one (only
`RankedApState` does). Rather than retrofit a frozen type for a purely structural, non-rule-
affecting concern, `ProtocolSessionStore` carries it in **session metadata** instead, and enforces
S3.2's requirement (**CM party size is exactly 5**) at that same boundary
(`CM_REQUIRES_PARTY_SIZE_5`). Ranked All Pick continues to thread it through kernel state itself,
as S1 already designed; metadata mirrors that value too so callers can read
`store.partyContext(sessionId)` uniformly regardless of ruleset.

### Sealed picks, hidden info, bots

`suggestion-bridge.ts` is the structural fix for the documented bug ("bot receives
pendingUserPicks", `engine.md`): it can only ever read a hero id off a `KNOWN`/`REVEALED`
`PerspectiveHeroSlot` — the `HIDDEN` variant carries no `heroId` field at all, so there is no code
path in the bridge that could leak one. `POST /api/session/protocol/:id/bot-selection` uses this
bridge to build the real V6 suggestion engine's input from `project(state, botSide)` alone, then
seals the top available suggestion into an open slot for that side. This endpoint is built and
tested (`routes/protocol-sessions.test.ts`, including a test that a human's same-round sealed pick
never appears in the bot's `computeSuggestions` input) but the frontend `random-draft-simulator`
has **not** been switched over to call it — see "Legacy status."

### Collision authority

`resolveSimulatorCollisionAuthority` (`adapters/simulator-authority.ts`) is explicitly
`SIMULATOR_POLICY`, versioned (`simulator-collision-authority/v1`), deterministic (seeded per
`sessionId`/round/heroId — same seed replayed against the same collision always picks the same
winner), and **never** mutates state itself: it only proposes an
`APPLY_AUTHORITATIVE_COLLISION_RESOLUTION` command for the caller to route through
`applyProtocolCommand`, exposed as its own endpoint
(`POST /api/session/protocol/:id/simulator-authority`) so it can never be reached by a caller that
doesn't explicitly know it's driving a simulator scenario. It is not, and does not claim to be,
real Valve arbitration — a future live adapter observing an actual game-state integration is a
different, not-yet-built module.

### Acceptance evidence

`server/protocol-session.integration.test.ts` drives full Ranked All Pick drafts through the real
stack for party sizes 1/2/3/5 (5 unique heroes per side at completion), proves party size 4 never
creates a session, exercises the hidden-twin property and reveal through the session/view layer
(not just the kernel directly, which S1 already covered), drives collisions 1→2→3 to
`WAITING_FOR_COLLISION_AUTHORITY` and resolves via the simulator adapter, and proves **adapter
parity**: two sessions fed the identical sealed-round batch in different arrival order produce a
byte-identical `authoritativeStateHash`.

## S3 — Captain's Mode end-to-end

The 24-step flow, `firstPickSide` resolution, `BAN_SKIPPED`/`AUTO_PICK`, and step-25 rejection were
all already correctly specified by S1's kernel and ruleset — this slice's job was proving they work
through a real session layer, not re-specifying them.
`server/protocol-session.cm-acceptance.test.ts` drives complete 24-action drafts for both
`FIRST=radiant` and `FIRST=dire` through `ProtocolSessionStore` (with a `partySize: 5` party
context, per S3.2), confirms the correct absolute actor resolves per step, exercises `BAN_SKIPPED`
and `AUTO_PICK` explicitly (not just as incidental coverage), confirms step 25 is
`STEP_AFTER_COMPLETION`, and confirms `ELIGIBILITY_UNVERIFIED` fail-closed behavior with zero
snapshot loaded (only `CM_BAN_SKIPPED` is ever legal in that state, matching S1's contract).

### CM Hero Eligibility pipeline (S3.4)

`scripts/cm-eligibility/` builds the extraction pipeline S1 deliberately deferred (S1 built the
`cm-hero-eligibility/v1` contract + validator, not an extractor):

```
pak01_dir.vpk --[vpk-reader.ts]--> scripts/npc/npc_heroes.txt bytes
  --[kv-parser.ts]--> parsed KeyValues tree
  --[npc-heroes.ts]--> eligible heroIds (HeroID > 0 && Enabled == 1 && CMEnabled == 1)
  --[computeEligibilityContentHash, reused from the kernel]--> signed cm-hero-eligibility/v1
```

- `kv-parser.ts` is a general Valve KeyValues (KV1) text parser — nested blocks, `//` comments,
  escaped strings, repeated-key arrays. Fully tested.
- `vpk-reader.ts` implements the **publicly documented** VPK v1/v2 binary directory format
  (header, extension/path/filename-terminated tree, per-entry preload bytes). It supports entries
  fully contained in preload bytes or embedded inline in the same `_dir.vpk` buffer
  (`archiveIndex === 0x7fff`) — the historical case for a small text file like `npc_heroes.txt`.
  **Multi-part numbered archives (`pak01_NNN.vpk`) are explicitly not implemented**: there is no
  real Steam depot in this environment to verify that path against, and a guess would be worse
  than a clearly-labeled refusal (`extractVpkEntry` throws a named error for that case).
- `npc-heroes.ts` applies the one frozen effective rule and reuses the kernel's own
  `computeEligibilityContentHash` — the artifact this tool builds is guaranteed byte-compatible
  with what `acceptCmHeroEligibilitySnapshot` verifies at `LOAD_CM_ELIGIBILITY` time, because it's
  the same function, not a re-implementation.
- `build-snapshot.ts` is the CLI orchestrator. Without `--vpk`, it runs in **demo mode**: builds a
  snapshot from a synthetic fixture to prove the pipeline is wired correctly end to end, and
  refuses to write that output to disk without `--allow-demo-output` — and when it does write it,
  `depotManifests["570"]` is literally the string `DEMO_FIXTURE_NOT_REAL_DEPOT_DATA`, so a demo
  artifact can never be mistaken for real data on disk or loaded into the kernel as if it were.

**REAL CM ELIGIBILITY SNAPSHOT: NOT AVAILABLE.** This environment has no licensed Dota 2
install/Steam depot to point `--vpk` at. Producing the real artifact is:
`bun scripts/cm-eligibility/build-snapshot.ts --vpk "<path>/pak01_dir.vpk" --patch <patch>
--build-id <id>` run on a machine with Dota 2 installed. Nothing in this pipeline falls back to
the global hero catalog if that's missing — CM without a loaded snapshot stays
`ELIGIBILITY_UNVERIFIED`, exactly as S1 specified.

### CM simulator (S3.5)

`adapters/cm-simulator.ts` drives **both sides** of a Captain's Mode draft through the same kernel
a future live adapter will use — `legalActions` → `applyProtocolCommand`, nothing else. Pluggable
`CmSimulatorStrategy` (default: lowest eligible heroId, deterministic). No second implementation
of turn order or eligibility.

## S4 — Role Belief / Flex / Party Assignment

```
apps/engine/src/draft-protocol/roles/
  role-belief.ts        -- computeRoleBelief: per-hero position uncertainty
  joint-assignment.ts   -- computeJointRoleAssignment: team-level, injective
```

`computeRoleBelief` layers evidence strictly by the frozen priority (highest wins): **(1) explicit
confirmation** — hard constraint, one-hot, short-circuits everything else; **(2) structural
constraints** (positions already confirmed-held by other own-team heroes); **(3) party
preference** — soft prior, boosts without ever zeroing/forcing; **(4) hero/patch distribution**
(reused directly from `intent/position-prior.ts`'s `deriveFlexDistribution`, Fase 7 — no second
position-probability model); **(5) neutral prior**. Implemented by layering lowest-priority-first
so a later, higher-priority layer always has final say. `status` is `CONFIRMED` (tier 1),
`LIKELY` (any of tiers 2-4 contributed), or `UNRESOLVED` (tier 5 only, i.e. genuinely no evidence)
— an honest signal, never a guess dressed up as confidence.

`computeJointRoleAssignment` is the actual fix for "a flex hero covers three holes simultaneously"
— independent per-hero marginals can't see that two heroes' individually-plausible positions can't
both be true at once; enumerating every injective (≤5! = 120) hero→position assignment and
weighting each by the product of per-hero beliefs can. `heroPositionMarginals` (derived from the
weighted joint distribution, not independent per-hero computation) is provably tighter than the
naive marginal whenever two heroes' beliefs overlap (tested explicitly). `positionCoverage`/
`expectedPositionNeed`/`openPositions` fall out of the same joint distribution. Two heroes both
hard-CONFIRMED to the same position (a genuinely contradictory input) falls back to a uniform
distribution over the injective sequences rather than dividing by zero or returning nothing.

`participants.ts` ties role state to **participant/slot**, not just heroId: `deriveOwnSideParticipantSlots`
splits a side's 5 roster slots into `controlled` (this session's `PartyContext.controlledSlots`)
vs. `external` (a real teammate this session doesn't drive). An external participant can still have
a `RoleBelief` computed for them (their revealed hero, hero/patch distribution) — nothing in this
slice's design prevents that — but no joint-assignment consumer is wired to treat that belief as
something to *act on* for them; that distinction is left to whatever S5 recommendation consumer
reads this layer.

**No threshold for "hero-only vs. hero+intended position" was frozen** (S4.5, deliberately) — the
distribution, `evidence`, and `entropy` this module exposes are exactly what a future calibration
pass (Golden R1) needs to set that threshold with real data, not a guess made here.

## PartyContext contract (cross-cutting, S2.5/S4.4)

| Concept | Where it lives | Notes |
|---|---|---|
| `PartyContext` (S1) | `draft-protocol/types.ts` | `partySize ∈ {1,2,3,5}`, `side`, `controlledSlots`. Frozen, unchanged this slice. |
| Ranked AP session party | `DraftProtocolState.rankedAp.partyContext` | Threaded through kernel state, S1 design. |
| Captain's Mode session party | `ProtocolSessionStore` metadata (session-layer, NOT `CmState`) | `CmState` has no party slot; retrofitting a frozen type for a structural-only concern wasn't warranted. Enforced `partySize === 5` at the session boundary. |
| Controlled vs external | `draft-protocol/participants.ts` | Derived from `PartyContext`, never persisted separately. |

## Legacy status (what migrated, what didn't)

| Path | Status |
|---|---|
| `draft-protocol/` (kernel, S1) | Authoritative, unchanged rules, additively used. |
| `server/protocol-session.ts` + `routes/protocol-sessions.ts` (S2, new) | Authoritative NEW path for kernel-backed sessions. |
| `draft/reducer.ts` + `turn-clock.ts` + `draft-format-turns.ts` (legacy) | **Marked non-authoritative** (header comment updated this slice) but **still live**: backs `SessionStore`/`/ws/draft`/`/ingest/draft-event`/`/api/session/manual`, which also serve hero-pool-aware suggestions, Team Groups, and Pro-Drafter preview — capabilities this wave did not migrate. Retiring it fully is future work. |
| `apps/engine/src/simulator/player.ts` (legacy capture simulator) | **Marked non-authoritative** (header comment updated), untouched otherwise — still feeds the legacy reducer for `routes/simulator-sessions.ts`. |
| `apps/web/features/random-draft-simulator/` (frontend's own AP protocol) | **Marked non-authoritative** at the exact leak site and at `store.ts`'s header (comments only, this slice). **Not rewired** to the new engine endpoints — that requires verifying the live browser experience, which this wave's environment cannot do. This is the one place the "no second protocol implementation" rule is still violated in practice; the replacement (`bot-selection`, sealed-pick submission via `/api/session/protocol/*`) is built, tested, and ready, but the swap-over itself is explicit deferred follow-up, not silently abandoned. |

## Explicit deferral to S5

- `RecommendationSet/v2` itself — not built. What IS built: `suggestion-bridge.ts` as the one
  stable translation from kernel-visible state to the existing V6 engine's input shape, so S5 has
  a real seam to extend rather than inventing one under deadline.
  `computeJointRoleAssignment`/`computeRoleBelief` are the role-uncertainty primitives S5 needs;
  no recommendation logic consumes them yet.
- Multi-slot-round compound suggestions (S2.6): the kernel already represents "N of our own slots
  open in this round" structurally (`legalActions` returns one `SUBMIT_SEALED_SELECTION` entry per
  open slot) — no new contract was needed to prepare for this; S5 decides how to combine them.
- Hero-only vs. hero+position threshold (S4.5) — deliberately unfrozen, see above.

## Explicit deferral to S6

- No lookahead of any kind was added anywhere in this slice.

## Local verification (this slice)

`bun run test` (three roots): 912 engine + 218 web + 392 scripts = 1522 tests, 0 failures.
`apps/engine`/`apps/web` `tsc --noEmit`: clean. `apps/web` lint: 0 errors (6 pre-existing warnings,
unrelated to this slice). `scripts/verify-simplicity.sh`: PASS. `bun run eval -- --enforce`
(Fase 9.1 gate): PASS, no regression (this slice never touches `apps/engine/src/signals/**` or any
scoring weight).
