# R1 — Protocol Kernel + Perspectives (Slice 1)

Status: implemented on branch `r1/protocol-kernel`, not yet wired into production traffic or
merged. This document materializes the R1 CONTRACT FREEZE this slice was built against, and
records the design decisions this slice had to make where the freeze was silent. Companion spec to
`.kiro/specs/r0-engineering-baseline-recovery/` (R0), which this slice builds on -- R0 is certified
GREEN and merged to `master` (`docs/agents/r0-certification.md`).

Code: `apps/engine/src/draft-protocol/`. Tests: one `*.test.ts` per module, 76 tests, `bun test`.

## What S1 is, and isn't

S1 is the architectural foundation for R1: a protocol-rule kernel (state machine + hidden
information + legal-action oracle) for two rulesets, independent of scoring, roles, or UI. It does
**not** touch V6 scoring, `SCORING_WEIGHTS_*`, lookahead, probabilistic roles, RecommendationSet/v2,
the Golden Dataset, Overwolf/OCR, or the Pro-Drafter migration -- those are later R1 slices.

S1 also does **not** wire the kernel into live production traffic. `apps/engine/src/draft/`
(`reducer.ts` + `turn-clock.ts` + `draft-format-turns.ts`) remains the authoritative implementation
behind `SessionStore`/WS/`/ingest/draft-event` for the rest of R1 S1. See "Legacy / migration"
below.

## Ruleset identities

| Field | Ranked All Pick | Captain's Mode |
|---|---|---|
| `id` | `dota2/ranked-all-pick` | `dota2/captains-mode` |
| `version` | `1.0.0` | `1.0.0` |
| `applicableFromPatch` | `7.35d` | `7.40` |
| `verifiedThroughPatch` | `7.41e` | `7.41e` |
| `rulesHash` / `sourceManifestHash` | sha256 over the ruleset's own canonical definition (round capacities/timers/collision policy for AP; the 24-step sequence + clock contract for CM) | — |

`rulesHash`/`sourceManifestHash` are computed by `canonicalHash()` (`hash.ts`) — a real canonical
JSON (recursive key sort, JS insertion order NOT relied on) + sha256 hex, in the same spirit as the
existing `scripts/eval/snapshot.ts` idiom (hash over *logical* content, never a file/commit SHA) —
necessarily a fresh implementation in `apps/` since `scripts/eval` cannot be imported from `apps/`
(invariantes.md). `RulesetIdentity` is a plain data value, computed once as a module constant; it
is never asserted against a network source in S1 (there is no ruleset registry/discovery yet).

## Ranked All Pick — state machine

```
BAN_RESOLUTION -> PICK_ROUND_1 -> PICK_ROUND_2 -> PICK_ROUND_3 -> COMPLETE
```

- **Bans are not interactive.** The kernel only accepts `RECORD_RESOLVED_BANS` (append resolved
  ban IDs) and an explicit `BAN_RESOLUTION_COMPLETE` command. Completion is never inferred from a
  ban count reaching 16 or any other number.
- **Capacities**: round 1 = 2/side, round 2 = 2/side, round 3 = 1/side. Base timers 25s/25s/20s
  (represented as data; S1 does not build a running clock, matching the CM clock-contract scope
  decision below).
- **Sealed picks**: within a round, `SUBMIT_SEALED_SELECTION` fills one (side, slotIndex) slot.
  Selections are held in `round.sealed`, invisible to the opponent (see Hidden Information below),
  until every slot in the round has a sealed selection — at that instant the kernel resolves the
  round in one pass.
- **Collision policy** (frozen, verbatim): collision count is **per round** (resets to 0 at the
  start of each round). Non-conflicting selections reveal simultaneously and confirm. A hero
  contested by both sides is a collision; collisions are processed in ascending `heroId` order for
  determinism. **Collisions #1 and #2 of the round**: the hero is banned, both slots reopen (no
  winner). **Collision #3 and any beyond**: transport/event-log arrival order is never authority.
  The kernel enters `WAITING_FOR_COLLISION_AUTHORITY`, exposes no gameplay action, and records no
  winner until an external authority supplies a distinct
  `APPLY_AUTHORITATIVE_COLLISION_RESOLUTION` command matching the pending round, hero and one of
  the two contenders. The winner then confirms, the loser's slot reopens, and the hero is **not**
  banned. Sealed batches are canonicalized when complete, so opposite transport order produces the
  same pending state, replay and final authoritative hash.
- **Design decisions made in the freeze's silence** (flagged explicitly so a reviewer can
  challenge them): (a) a round auto-resolves the instant every slot has a sealed selection — there
  is no separate explicit "close round" command; (b) within one resolution pass, multiple
  simultaneous collisions are processed in ascending `heroId` order; (c) the collision counter is
  per-round and covers every resolution pass within that round (reopened slots that collide again
  keep incrementing the same round-scoped counter); (d) a side may not seal the same hero twice in
  one round (rejected as `DUPLICATE_HERO_IN_ROUND`, distinct from a genuine cross-side collision).

### H0.1 — Party All Pick

`Party All Pick = ranked_all_pick ruleset + PartyContext`. `PartyContext` (`party-context.ts`) is a
structural, foundation-only layer: `partySize ∈ {1, 2, 3, 5}` (4 is explicitly rejected — Dota has
no 4-stack ranked queue option), a `side`, and `controlledSlots` (which of the side's 5 roster
slots this party controls). It never alters protocol transitions in S1 — no role inference (S4),
no turn/timer change. It threads through `RankedApState.partyContext` only for future consumers.

## Captain's Mode — state machine

- **`firstPickSide` is mandatory.** Until `CONFIRM_FIRST_PICK_SIDE` is accepted, `status` is
  `UNCONFIRMED_STATE`: no protocol advancement, no certified legal decision — every `CM_ACTION` /
  `CM_BAN_SKIPPED` / `CM_AUTO_PICK` is rejected `UNCONFIRMED_STATE`, independent of what step number
  the (unmoving) state claims to be at.
- **24-step canonical sequence**, encoded as a fixed array in `rulesets/captains-mode.ts`
  (`CANONICAL_SEQUENCE`), each entry carrying `{ step, phase, kind, actor, baseTimeMs }`. `actor`
  is relative (`first`/`second`), resolved to an absolute side via `firstPickSide`
  (`resolveAbsoluteSide`).
- **`currentStep` is an independent ordinal** (`CmState.currentStep`, 1..25, 25 = COMPLETE) —
  never derived by counting `bannedHeroes.length + picks.radiant.length + picks.dire.length`,
  because `BAN_SKIPPED` advances the step without adding a hero to any list.
- **Regression fixed in this slice**: the pre-existing `apps/engine/src/draft/draft-format-turns.json`
  had steps 17 and 18 swapped (17 was `first`, should be `second`; 18 was `second`, should be
  `first`) relative to the canonical sequence below. Corrected in the same commit as this kernel
  (that file backs the *legacy* reducer's CM turn-checking, so production behavior for those two
  steps is also fixed by this change, independent of whether/when the kernel itself is wired in).
  `rulesets/captains-mode.ts`'s own table was written correct from the start and is verified by a
  dedicated regression test (`captains-mode.test.ts`: "regresión: paso 17 es SECOND y paso 18 es
  FIRST").

  ```
   1  BAN_1  BAN   FIRST      7  BAN_1  BAN   SECOND     13 PICK_2 PICK SECOND    19 BAN_3  BAN   FIRST
   2  BAN_1  BAN   FIRST      8  PICK_1 PICK  FIRST      14 PICK_2 PICK FIRST     20 BAN_3  BAN   SECOND
   3  BAN_1  BAN   SECOND     9  PICK_1 PICK  SECOND     15 PICK_2 PICK FIRST     21 BAN_3  BAN   FIRST
   4  BAN_1  BAN   SECOND    10  BAN_2  BAN   FIRST      16 PICK_2 PICK SECOND    22 BAN_3  BAN   SECOND
   5  BAN_1  BAN   FIRST     11  BAN_2  BAN   FIRST      17 PICK_2 PICK SECOND    23 PICK_3 PICK FIRST
   6  BAN_1  BAN   SECOND    12  BAN_2  BAN   SECOND     18 PICK_2 PICK FIRST     24 PICK_3 PICK SECOND
  ```
- **`BAN_SKIPPED`** (`CM_BAN_SKIPPED`) and **`AUTO_PICK`** (`CM_AUTO_PICK`) are both represented as
  distinct `CmStepOutcome` variants in `history`, so a timeout is distinguishable from a real
  hero-action on replay. Both still go through actor/step/kind validation; `AUTO_PICK` additionally
  goes through the same eligibility/already-taken checks as a normal `PICK` (a real Valve auto-pick
  never targets an illegal hero, and the kernel doesn't special-case around that).
- **After step 24: `COMPLETE`.** Any further step (25+) is rejected `STEP_AFTER_COMPLETION`.
- **CM picks/bans are immediately `REVEALED`** — there is no sealed/blind phase in Captain's Mode
  (contrast with Ranked All Pick's genuine hidden round). See Hidden Information below.

### CM clock contract (representation only, S1 scope)

Steps 1–7: 15s base. Steps 8–24: 30s base. Reserve: 130s/side. `baseTimeMs` lives on each
`CmStepDefinition`; `CM_RESERVE_TIME_MS = 130000` is exported. S1 does not build a running
timer/UI — only the data + the `BAN_SKIPPED`/`AUTO_PICK` outcome representations a real timer
would eventually drive, per the freeze ("S1 needs the protocol representation/state transition
contract... Do not necessarily build the complete production timer UI").

### CM Hero Eligibility (`eligibility.ts`)

Canonical artifact `cm-hero-eligibility/v1`: `{ schema, appId: 570, patch, buildId,
depotManifests, sourceHashes, heroIds (ordered, unique, >0), contentHash }`. Frozen future
authority: Steam app 570's `game/dota/pak01_dir.vpk` / `scripts/npc/npc_heroes.txt`, effective rule
`HeroID > 0 && Enabled == 1 && CMEnabled == 1`.

S1 builds the contract + validator + fail-closed integration, **not** the VPK extraction pipeline
(no such mechanism exists anywhere in this repo today, and building one is out of scope for this
slice). Practical consequence: **without a `LOAD_CM_ELIGIBILITY` command carrying a snapshot that
passes both structural validation and content-hash integrity verification, the kernel certifies
zero CM hero actions** — every `CM_ACTION`/`CM_AUTO_PICK` targeting a hero is rejected
`ELIGIBILITY_UNVERIFIED` regardless of the step. It never falls back to a global hero catalog.
`CM_BAN_SKIPPED` is the one CM action that never needs eligibility (no hero involved).

## Hidden information / perspectives (`perspective.ts`, `types.ts`)

`Visibility = KNOWN | HIDDEN | REVEALED`. `PerspectiveHeroSlot` is a discriminated union where the
`HIDDEN` variant has no `heroId` field at all — the critical invariant ("a hidden enemy hero ID
must never appear in `PerspectiveDraftView`") is enforced by the type shape, not by a runtime
filter that could be forgotten at a call site.

`project(state, viewerSide): PerspectiveDraftView` is the one place authoritative state becomes a
per-viewer view:

- **Ranked All Pick has real hidden information.** A side's own sealed-but-unrevealed selection in
  the current round is `KNOWN` to itself; the opponent's sealed-but-unrevealed selection is
  `HIDDEN` (no `heroId`) until the round resolves, at which point it becomes `REVEALED`. A
  spectator/no-side (`viewerSide: null`) viewer trusts neither side and sees every currently-sealed
  selection (both sides') as `HIDDEN`.
- **Captain's Mode has none** — every pick/ban is immediately public, so a CM perspective only ever
  emits `KNOWN` (own) / `REVEALED` (opponent), consistent with the frozen contract's explicit "CM
  picks/bans are immediately REVEALED."
- **Bans are always fully visible** in both rulesets (a ban is never secret information).

**Hidden twin property** (tested in `perspective.test.ts`): two authoritative states identical
except for which hero the opponent sealed in an open round produce byte-identical
`PerspectiveDraftView`, `functionalIdentityHash` (`hash.ts`, strips timestamps/durations/transport
ids before hashing), and `legalActions` output — because neither the perspective projection nor the
legal-action oracle ever reads into a `HIDDEN` slot's content, only into open-slot bookkeeping that
is identical between the twins by construction.

## Legal Action Oracle (`kernel.ts` → `legalActions`, ruleset-level `*LegalActions` functions)

A single function per ruleset (dispatched by `kernel.legalActions(state)`) enumerates every
currently-legal command shape given: ruleset, phase/step, actor, action kind, hero eligibility (CM),
bans/previous picks (implicitly, via open-slot/step bookkeeping), and completion. The oracle and the
kernel's actual acceptance logic are kept consistent by construction (e.g. CM never advertises a
hero-targeting action as legal when no eligibility snapshot is loaded, matching the kernel's own
`ELIGIBILITY_UNVERIFIED` rejection) and cross-checked by a dedicated test
(`kernel.test.ts`: "cada acción devuelta por legalActions, aplicada literalmente, es aceptada por el
kernel").

## Protocol Kernel (`kernel.ts`) — the one authoritative path

```
createProtocolState(sessionId, rulesetId, options)   -- fails closed (RULESET_LOAD_FAILED) on an
                                                         unrecognized ruleset id; never returns a
                                                         half-built state.
applyProtocolCommand(state, command)                 -- validate transition -> update state ->
                                                         append to eventLog (only on acceptance).
legalActions(state)
project(state, viewerSide)
replayProtocolState(sessionId, rulesetId, events)     -- fold applyProtocolCommand over a canonical
                                                         event list from a fresh initial state.
```

Ruleset modules (`rulesets/ranked-all-pick.ts`, `rulesets/captains-mode.ts`) expose immutable
identity/policy/oracle helpers only. Factories and transition reducers are non-exported
implementation details inside `kernel.ts`, which owns event-log bookkeeping and collision
authority handling centrally. Adapters therefore have exactly one mutation entry point. A
rejected command never mutates `eventLog` or ruleset state — a
replay containing an individually-illegal historical command simply doesn't advance state at that
point and continues correctly from there (same discipline as the legacy reducer's
`RejectionReason` handling).

`status: "DEGRADED"` short-circuits every command to `RULESET_UNAVAILABLE`. S1 populates this path
structurally (`ProtocolDegradation` type, `RULESET_LOAD_FAILED` / `RULESET_HASH_MISMATCH` /
`ELIGIBILITY_UNVERIFIED` / `REQUIRED_STATE_MISSING` reasons) but does not yet have a caller that
sets `RULESET_HASH_MISMATCH` in practice (there is no ruleset registry/versioning consumer in S1)
— that is expected to activate once the kernel is wired to a real transport in S2.

## Determinism / hashing (`identity-hash.ts`)

Private canonical JSON recursively sorts object keys (arrays keep order — order is semantic for
e.g. the event log). The private functional-identity primitive additionally strips a fixed set of non-functional keys
(`timestamp`, `emittedAt`, `sentAt`, `updatedAt`, `turnStartedAt`, `duration`, `durationMs`,
`computedInMs`, `sessionId`, `transportId`, `connectionId`) before hashing, so two states/views
built from the same canonical inputs hash identically regardless of wall-clock or transport
differences — this is the literal mechanism behind both the hidden-twin property and
replay-determinism (`kernel.test.ts`: "reproducir el mismo ruleset + eventos produce exactamente el
mismo estado"). Only `authoritativeStateHash`, `perspectiveStateHash`, `rulesHash`, and
`eligibilityHash` are exported; generic hash primitives cannot be deep-imported.

## PRODUCT_POLICY vs AUTHORITATIVE

- **AUTHORITATIVE** (frozen contract, must not be reinterpreted): ruleset identities/patch ranges;
  AP phase order and 2/2/1 capacities; AP bans-are-not-interactive; the collision-count-is-per-round
  policy and its 1st/2nd-vs-3rd+ split; the hidden/known/revealed model and its "never leak a hidden
  heroId" invariant; CM's mandatory `firstPickSide`; the corrected 24-step CM sequence; CM's
  immediate-reveal rule; CM's clock numbers; CM eligibility's fail-closed posture (never fall back to
  the global catalog).
- **PRODUCT_POLICY** (this slice's own design decisions, made where the freeze was silent, listed
  so a future reviewer can revisit them without confusing them for frozen rules): auto-resolving a
  round the instant every slot is sealed (no explicit close-round command); ascending-`heroId`
  ordering for simultaneous multi-collision resolution within one pass; the round-scoped collision
  counter persisting across reopen/resubmit cycles within the same round; rejecting same-side
  same-hero re-sealing as `DUPLICATE_HERO_IN_ROUND` rather than treating it as a no-op; requiring
  eligibility for CM bans (not just picks), matching how a ban only makes sense against a hero that
  could otherwise be picked; `RECORD_RESOLVED_BANS` rejecting the whole batch if any hero in it is a
  duplicate or already banned (fail closed rather than silently deduping).

## Legacy / migration (explicit S2 scope, not built in S1)

Three separate "draft happens" implementations existed before this slice, per the architecture
research done at the start of S1:

1. `apps/engine/src/draft/reducer.ts` + `turn-clock.ts` + `draft-format-turns.ts` — the legacy
   engine reducer. **Remains authoritative for live production traffic** (`SessionStore`, WS,
   `/ingest/draft-event`) through the rest of R1 S1. Received the step-17/18 data fix in this slice
   (a real, isolated bug in curated data, safe to fix regardless of kernel wiring) and a header
   comment pointing at the new kernel; no rule logic was added to it.
2. `apps/engine/src/simulator/` (fixed-script capture simulator, `source: "simulator"`) — feeds the
   legacy reducer through real `DraftEventEnvelope`s; untouched.
3. `apps/web/features/random-draft-simulator/` — a fully independent, self-contained draft engine
   (own ban resolution, own blind-round/collision/reveal state machine, own bot heuristics), never
   round-tripping through the engine's reducer. This is the "old frontend simulator" the frozen
   contract's migration section names directly.

S1 does not touch any of the three. Wiring the new kernel into `SessionStore`/WS as the live
authoritative path, and retiring (or thinly adapting) the frontend simulator's own collision/reveal
implementation so it stops being a second source of protocol truth, are both explicit S2 work — the
frozen contract permits deferring full migration ("If fully migrating it belongs to S2, clearly
leave it as a legacy adapter/pending migration rather than duplicating new rules") and forbids a
large frontend redesign in this slice. No new protocol rule was written a second time anywhere in
`apps/web` in this slice.
