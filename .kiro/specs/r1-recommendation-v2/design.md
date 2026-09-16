# R1 — Recommendation V2 (Slice 3): S5 RecommendationSet/v2 + Convergence

Status: implemented on branch `r1/recommendation-v2`, not merged, not pushed. Builds directly on
S1 (`.kiro/specs/r1-protocol-kernel/design.md`) and S2/S3/S4
(`.kiro/specs/r1-draft-product-wave/design.md`). This document records what this slice actually
did, what it deliberately left out, and what it defers to S6/S7.

## What this slice is, and isn't

This slice gives kernel-backed (`draft-protocol`) sessions ONE canonical recommendation truth --
`RecommendationSet/v2` -- built on top of V6 (`apps/engine/src/signals/mix.ts`, unchanged, still
the only scoring engine) and S4's role-uncertainty primitives (`role-belief.ts`,
`joint-assignment.ts`, previously built but never consumed). It does **not** build lookahead,
opponent-response modeling, steal detection, or counterfactual analysis (S6) -- those four fields
are carried as an explicit `NOT_COMPUTED` sentinel, never a fabricated value. It does **not**
touch `SCORING_WEIGHTS_V6`, any signal scorer, or Pro-Drafter (`drafter/team-opener.ts`) -- V6
stays the single scoring source, and Pro-Drafter stays out of this pipeline entirely (see
"Pro-Drafter is not a second recommender" below).

## New engine-side layer

```
apps/engine/src/recommendation/
  types.ts        -- the RecommendationSetV2 contract (basedOn/decision/recommendations/degradations/deferred)
  identity.ts      -- basedOn assembly (S5.identity)
  decision.ts      -- LEGAL ACTION FIRST: what's being decided + the certified hero universe
  role-impact.ts   -- role impact for a candidate action, over S4's joint-assignment primitive
  shortlist.ts     -- bounded shortlist + deterministic compound (pairwise) enumeration
  evidence.ts      -- SignalContribution/RoleBeliefEvidence -> structured EvidenceItem
  build.ts         -- buildRecommendationSetV2: the orchestrator (the one canonical pipeline)
  translate-v1.ts  -- honest V2 -> V1 projection (never rescores)
  index.ts         -- public surface
```

Wired into `apps/engine/src/server/routes/protocol-sessions.ts` as
`GET /api/session/protocol/:id/recommendations` (native V2) and
`GET /api/session/protocol/:id/recommendations?format=legacy` (V1 projection, same perspective
guard as the existing `GET /api/session/protocol/:id`: a caller can only ever request its own
side).

## Canonical pipeline

```
PerspectiveDraftView (project(state, actor))
  + legalGameplayActions(state)              -- decision.ts: LEGAL ACTION FIRST
  -> certified hero universe (eligibleHeroIds, or null = unrestricted for Ranked All Pick)
  -> V6 buildSuggestions (via the existing S2.2 suggestion-bridge seam, teamOpening: true)
  -> shortlist.ts: intersect V6's ranked output against the certified universe, bound to SHORTLIST_SIZE
  -> role-impact.ts: joint-assignment over (own picks + candidate(s)), reusing S4's own beliefs
  -> evidence.ts: structured EvidenceItem[] from SignalContribution + RoleBeliefEvidence + ruleset/eligibility provenance
  -> build.ts: postValidateAction (second, independent legality check against the SAME state)
  -> RecommendationSetV2
```

V6 is never asked to "rank everything, filter later" -- for Captain's Mode specifically, the
kernel's own `eligibleHeroIds` (not V6's global hero catalog) is the universe V6's output is
intersected against, because V6 has no concept of CM's certified hero list.

## basedOn -- deterministic identity

`stateIdentity` is `perspectiveStateHash(view)` (draft-protocol/identity-hash.ts), deliberately
NOT `authoritativeStateHash` -- the latter would fold hidden information into a value a client can
see. Because `perspectiveStateHash` already strips `sessionId` (its own
`FUNCTIONAL_IDENTITY_EXCLUDED_KEYS`), two sessions in a structurally identical hidden state hash
identically -- "hidden twins identical pre-reveal" falls directly out of a mechanism S1 already
built, not a separate property this slice maintains by hand. `heroEligibilityHash` is the loaded
CM snapshot's own `contentHash` (null for Ranked All Pick, which has no eligibility mechanism, and
for CM before a snapshot loads). `evidenceVersion` folds in whether V6 ran with empirical
calibration or the Fase 9.1 fallback range. `seed` is caller-supplied and only ever threads into
V6's own `diversitySeed` -- nothing else in the pipeline consumes randomness.

## Score vs confidence

`score` is V6's own `Suggestion.score` (single-action) or a plain sum of two independently-scored
V6 outputs (compound, see below) -- never a probability, never expressed as a percentage.
`confidence` is V6's own already-frozen categorical tier (`alta`/`media`/`baja`, driven by
`evidenceCoverage`) -- for a compound, the LOWER of the two involved confidences, never invented
higher than either constituent's own evidence supports.

## Role semantics

`role-impact.ts` feeds every hero (already-picked own-side heroes AND the candidate(s) under
evaluation) into ONE `computeJointRoleAssignment` call, using each hero's raw belief
(`computeRoleBelief`: hero/patch distribution + optional soft party preference, no per-hero
occupied-position pre-constraint -- the joint enumeration itself is what captures the mutual
exclusivity S4 built it for). A marginal that concentrates on one position is reported
`CONFIRMED_FORCED` even without an explicit confirmation, exactly when joint enumeration makes it
mathematically inevitable (e.g. 4 of 5 own-side heroes already narrow the 5th by elimination) --
this is the literal complement of `joint-assignment.ts`'s own `openPositions` epsilon, not a new
threshold. `computeRoleImpact` also accepts an optional `ownConfirmedPositions` map (a forward
hook for S4's own `CONFIRMED_EXPLICIT` tier -- no caller populates it yet, since no real
"declared/confirmed position" data source exists in the product today); a genuinely contradictory
input there degrades explicitly to `ROLE_ASSIGNMENT_IMPOSSIBLE`, never a silent repair.

## Party compound

When more than one of the actor's slots are open in the same Ranked All Pick round (rounds 1/2,
capacity 2 per side -- round 3 and Captain's Mode are always single-action), `shortlist.ts`
enumerates every distinct pair from the bounded shortlist (`SHORTLIST_SIZE = 8`, so ≤28 pairs) and
scores each as the **plain sum** of the two heroes' independently-computed V6 scores. This is a
deliberate simplification: V6 has no "score these two heroes as one simultaneous pick" primitive,
and inventing a synergy bonus weight here would be exactly the kind of unfrozen business threshold
the contract forbids fabricating. Role impact IS computed jointly for the pair (that primitive
already existed in S4) and reported on the `Recommendation` for the caller to see, but it never
feeds back into `score`. Hero uniqueness is structural (`i < j` over a deduplicated shortlist); the
two open slots are filled by higher-score-to-lower-slotIndex convention, documented as arbitrary-
but-stable (the kernel's own `SUBMIT_SEALED_SELECTION` treats both open slots as interchangeable).

## Evidence model

`EvidenceItem` never carries a bare, freestanding string as its only truth: every item traces to a
real value already computed elsewhere -- a V6 `SignalContribution` (source `v6-signal`), a
`RoleBeliefEvidence` entry (source `role-belief`), or ruleset/eligibility provenance (`rulesHash`,
the eligibility snapshot's `contentHash`). No LLM-authored text, no invented reason.

## Pro-Drafter is not a second recommender

`recommendation/**` never imports `drafter/team-opener.ts` or any Pro-Drafter module --
`architecture-guard.test.ts` asserts this mechanically (a static source-text check, same spirit as
`scripts/verify-simplicity.sh`'s own greps). Pro-Drafter's existing, flag-gated
(`ENABLE_PRO_DRAFTER`) route (`/api/v1/draft/pro-recommendations`) is untouched and stays on the
legacy `draft/reducer.ts` state model -- a wholly separate, non-canonical experiment, not a
competing source of truth for kernel-backed sessions.

## Bot policy vs. user recommendation

`postBotSelection` (`routes/protocol-sessions.ts`, S2.2/S2.6) is deliberately left untouched by
this slice. It is a **simulator bot policy** ("pick the top available V6 suggestion for this
side"), not a user-facing recommendation -- the same distinction the S5 contract itself draws
("no confundas simulator bot policy con user recommendation"). It already shares the same
canonical V6 primitive `RecommendationSet/v2` is built on (`suggestion-bridge.ts` +
`buildSuggestions`), so there is no second scoring algorithm underneath it -- only a different,
narrower policy on top of the same evidence. `RecommendationSet/v2` is the one recommendation
truth for actual product/user-facing consumers of a kernel-backed session.

## V2 -> V1 translator

`translate-v1.ts` projects, never rescores: a `Recommendation` only survives the projection when
it carries a non-null `legacy` field (populated by `build.ts` ONLY for single-action
recommendations, verbatim from the same V6 `Suggestion` the recommendation was built from). A
compound recommendation has no V1 shape to project into and is dropped, not flattened by an
invented rule. Exposed at `GET .../recommendations?format=legacy`.

## Legacy caller classification (R1 product paths)

| Caller | Class | Notes |
|---|---|---|
| `GET /api/session/protocol/:id/recommendations` (native) | A -- migrated to V2 | The one recommendation truth for this session family. |
| `GET .../recommendations?format=legacy` | B -- V2→V1 compatibility | Same query param, same session, honest projection, never a second computation. |
| `postBotSelection` (`bot-selection` endpoint) | Bot policy, not a recommendation consumer | Shares V6 via the same suggestion-bridge seam; see "Bot policy vs. user recommendation" above. Left untouched -- migrating it risked behavior drift for zero contract benefit, since it was never a second scoring path to begin with. |
| Legacy reducer/`SessionStore`/`/ws/draft`/`/ingest/draft-event`/Pro-Drafter preview/`apps/web/features/random-draft-simulator` | C -- explicitly deferred, legacy-only | Unchanged since S1-S4 (`r1-draft-product-wave/design.md`'s own "Legacy status" table) -- a different state model entirely (`draft/reducer.ts`), out of R1 protocol scope. |

For the kernel-backed (`draft-protocol`) session family specifically, there is exactly one
recommendation truth (`RecommendationSet/v2`) and its one honest V1 projection -- no second,
independently-computed recommendation exists anywhere in that family.

## S6 deferred fields

`RecommendationSetV2.deferred` carries `opponentResponse`, `steal`, `lookahead`, `counterfactual`,
each **always** the literal `"NOT_COMPUTED"` -- never `null`, never a fabricated number. The only
place that literal is assigned is `types.ts`'s `deferredFieldsNotComputed()`;
`architecture-guard.test.ts` asserts no other file in `recommendation/**` assigns those four field
names a value of its own.

## Determinism

No `Date.now()`, no unseeded `Math.random()`, no `crypto.randomUUID()` anywhere in
`recommendation/**` -- mechanically verified (`architecture-guard.test.ts`). The only intentional
variation is the caller-supplied `seed`, threaded to V6's own `diversitySeed`. Same
state/perspective/rules/eligibility/evidence-version/seed produces a byte-identical
`RecommendationSetV2` (`build.test.ts`'s determinism test compares `JSON.stringify` output
directly); metadata irrelevant to identity (V6's own `computedInMs`) never moves `basedOn`.

## Local verification (this slice)

`bun run test` (three roots): 1029 engine (+69 new tests added by this slice, all under
`apps/engine/src/recommendation/**` and the new recommendations route test) + 218 web + 398
scripts, 0 failures. `apps/engine` `tsc --noEmit`: clean. `apps/web` `tsc --noEmit`: same
pre-existing Bun-types failures as before this slice (unrelated files, `bun:test` module
resolution + `ImportMeta.dir`) -- NO REGRESSION, this slice never touches `apps/web`. `apps/web`
lint: 0 errors, 6 pre-existing warnings, unrelated to this slice. `scripts/verify-simplicity.sh`:
PASS. `bun run scripts/eval/gate.ts --enforce` (Fase 9.1 gate): PASS, no regression (this slice
never touches `apps/engine/src/signals/**` or any scoring weight).

## Independent adversarial review repair (bounded follow-up, same branch)

An independent architecture review of this slice found 8 real blockers before this reached a
second, wider review. All 8 are closed on this same branch, still without touching S1-S4 semantics,
`SCORING_WEIGHTS_V6`, or R0-protected files. Two waves:

**Engine-side (6 blockers)** -- all in `recommendation/**` + one additive `signals/mix.ts` option:

- **Hidden noninterference**: `postValidateAction`'s Ranked All Pick branch used to treat every
  currently-sealed hero (both sides) as "taken", including the opponent's hidden-but-unrevealed
  selection -- a real leak (two hidden twins could diverge in their full `RecommendationSetV2`
  purely from which hero the opponent had sealed, before either was ever revealed) and wrong
  against the kernel's own semantics (`rulesets/ranked-all-pick.ts`'s `heroAlreadyTaken` never
  checks the opposing side -- a same-hero collision is legal, resolved at round close). Fixed by
  reusing `isSealedSelectionLegal` verbatim instead of a second, divergent predicate. New test:
  two sessions with the SAME sessionId, DIFFERENT hidden hero sealed by the opponent (X vs Y) ->
  full `RecommendationSetV2` (not just `basedOn`) is byte-identical pre-reveal, diverges after.
- **Legal-universe-first for Captain's Mode**: `shortlist.ts` intersected V6's already-`TOP_N`-
  truncated global ranking against the certified eligible set -- a legal hero outside the global
  top 6 could never surface even as the single best legal option (`V6 top-N global -> post-
  filter`, exactly the anti-pattern the contract forbids). `mix.ts`'s `candidatePool` gains an
  optional `candidateHeroIds` applied BEFORE ranking; absent, every legacy caller is byte-
  identical (regression test asserts this).
- **Compound joint-feasibility hard gate**: a pair whose `computeRoleImpact` rejected as
  `ROLE_ASSIGNMENT_IMPOSSIBLE` was still constructed and returned, the impossibility surfaced only
  as a soft degradation. Now a hard gate: `buildCompoundRecommendations` `continue`s past an
  impossible pair instead of pushing it, so the next-best FEASIBLE pair (by the same canonical
  summed score, already sorted by `shortlist.ts`) takes its place. Adversarial test: a 199-score
  pair made impossible by a shared forced position never appears; the 197-score feasible pair
  ranks first.
- **Party controlled/external slots**: `decision.ts` treated every currently-open round slot on
  the actor's side as one this session could act for, even when a `PartyContext` controls only
  some of its own side's roster slots. Now caps `controlledSlots` to
  `partyContext.controlledSlots.length` (ascending slotIndex, arbitrary-but-stable -- `OpenSlot`
  has no real roster mapping to recover, only a count to respect); `partyContext === null` stays
  unrestricted (byte-identical to before). Tests: a 1-controlled-slot party in a 2-open-slot round
  gets `actionCount: 1`, never compound; a 2-controlled-slot party gets `actionCount: 2`.
- **`basedOn` functional identity**: `patch` and `PartyContext`/control structure could change the
  actual decision (which slots are ours, what V6 scores against) without moving any existing
  `basedOn` field -- `PerspectiveDraftView` carries neither. Added `patch: string` (verbatim) and
  `partyIdentity: string | null` (canonical hash of `partySize`/`side`/controlled-slot-indexes,
  deliberately excluding the non-functional `controllerId`). `decision` itself is not separately
  hashed: it is a pure function of state (`stateIdentity`) + party (`partyIdentity`) + actor
  (`perspectiveIdentity`), so those three fields already determine it.
- **Evidence identity**: `evidenceVersion` named only the scoring MECHANISM, never the concrete
  meta/curated-data evidence V6 actually used. No existing content-hash/version primitive covers
  `MetaSnapshot` or the curated JSON files (checked `signals/*.ts`, `db/*.ts`, `drafter/*.ts`,
  `draft-paths/*.ts` -- none exists), and `recommendation/**` never receives the raw `MetaSnapshot`
  anyway -- only the already-scored `SuggestionSet`. `evidence.ts`'s new `evidenceIdentityHash`
  hashes exactly the functional evidence that reached this decision (`raw`/`normalized`/
  `evidenceConfidence` per hero per signal, canonically sorted so `diversitySeed`-driven reordering
  can't move it), deliberately excluding every derived field (`score`/`weighted`/`reason`/
  `computedInMs`/...) -- those are redundant given the weights are frozen within one build, and
  `computedInMs` is exactly the runtime-timing noise the contract says must never move identity.

### Final evidence-identity repair (second independent review, same branch)

A follow-up review reproduced a real gap in the fix above: `evidenceIdentityHash`'s "score/rank
are redundant derivations of raw/normalized" assumption is false specifically for `build.ts`'s
own usage, because `build.ts` is that function's ONLY caller and it ALWAYS calls
`computeSuggestions(..., { teamOpening: true, ... })`. Every `SuggestionSet` this function ever
sees went through `mix.ts`'s `recommendTeamOpeners` branch, which consumes `HeroCapabilities`
(via `openingStrategy`) and curated/statistical ban relief -- neither ever produces a
`SignalContribution` at all, so they were invisible to the old hash. They surface ONLY as (a) the
order `suggestionSet.suggestions` comes back in (a repeat-strategy diversity penalty can reorder
candidates with byte-identical `raw`/`normalized`/`evidenceConfidence`) and (b) each hero's
`score` (`reconcileWeightedToScore` rescales `contributions[].weighted` to match team-opener's
ban-relief-adjusted score -- the score itself is team-opener's, not a pure function of
`raw`/`normalized`). Reproduced concretely: same 6 candidates, same empty state/matchups/
positions, two `HeroCapabilities` sets differing only in hero 3's entry -> V6 genuinely reorders
(`[1,2,3,4,5,6]` vs `[1,3,2,4,5,6]`) while every hero's own signal evidence stays byte-identical.
Fixed by adding `sequence` -- `{hero, score}` in the EXACT order `suggestionSet.suggestions`
provides, unsorted -- alongside the existing hero-sorted `candidates` block, without importing
`drafter/team-opener.ts` (still forbidden by `architecture-guard.test.ts`): `suggestionSet` is
`signals/mix.ts`'s own sanctioned output, the same boundary `candidates` already crossed.
`EVIDENCE_VERSION_BASE` bumped `v1` -> `v2` to name the mechanism change. See `evidence.ts`'s
header doc for the full reasoning, including why `weighted`/`rank`/`confidence`/`reason` are
still deliberately excluded (they remain genuine derivations even under `teamOpening: true`).

### Functional evidence identity completion (final repair)

The v2 `sequence` workaround above is superseded. Hashing a final `{hero, score}` sequence made
the identity circular: those are V6 outputs, not inputs. `evidenceIdentityHash` now accepts only
`FunctionalRecommendationEvidence`, assembled by `mix.ts` before ranking/selection and attached
non-enumerably to its internal `SuggestionSet`; the legacy `suggestions/v1` wire body is unchanged.

Input inventory and coverage:

- Protocol state, perspective, patch, CM eligibility, party control, and seed remain covered by
  `basedOn` identity fields. `partyPreferredPositions`, consumed by `role-impact.ts`, is included
  in the functional descriptor.
- Every pre-ranking candidate carries canonical signal identity, `raw`, `normalized`,
  `evidenceConfidence`, applicability, sample size, and source explanation. This covers V6 score,
  signal evidence, confidence, and signal-derived legacy text without hashing the final reason.
- Candidate-scoped `HeroPositions` covers position scoring, flex text, and role impact.
- Empty-board opening adds all consumed `HeroCapabilities` fields, per-candidate statistical
  matchups (`heroId/counterHeroId/games/wins`), curated counter provenance (`vs/level/why`), and
  only hero names actually rendered by the opening explanation. This covers strategy diversity,
  ban relief, and matchup/counter text while excluding unrelated catalog rows.
- `metaIsStale` is explicit, so confidence, `stale_meta`, and `degraded_meta` remain stale-safe
  even when raw signals and scores do not move.

All unordered collections are sorted by stable semantic keys before hashing. Runtime/transport
metadata (`computedInMs`, timestamps, session/request/transport identifiers) is absent. The hash
does not accept or read final rank, score/order, selected hero, compound winner, confidence,
degradation list, or final reason; its type-level API prevents the prior `SuggestionSet` shortcut.

**Frontend (2 blockers)** -- the real `/simulator` product surface, never migrated by S5 itself:

- **`/simulator`'s human Copilot now consumes `RecommendationSet/v2` natively**, never
  `format=legacy` (which would silently drop every compound recommendation) and never
  `/api/suggestions/preview` (retired from this simulator entirely, along with the client-side
  hypothetical-`DraftState` machinery that fed it -- `buildPendingPickPreview`/
  `bindPreviewSuggestions`/`rebasePreviewSuggestions`/`isPreviewReadyForRound`). One
  `fetchRecommendations(sessionId)` call per round covers both of a round's simultaneous open
  slots via the compound mechanism this slice already built.
- **`ENABLE_PRO_DRAFTER` has no effect on `/simulator`'s Copilot at all** -- `CopilotPanel.tsx`'s
  Pro-Drafter branch is gone (it was the only consumer of that component, so no other caller to
  preserve it for); a static architecture-guard test asserts neither the panel nor the session
  hook reference Pro-Drafter's recommendation symbols. Pro-Drafter's own route
  (`/api/v1/draft/pro-recommendations`) and `use-copilot-pro-drafter.ts` are untouched --
  legacy/experimental, not deleted, just no longer reachable from this simulator.

Known, deliberate limitation flagged rather than silently decided: `DraftIntentSelector`/
`archetypeIntent` stays interactive in `/simulator` but its effect does not yet reach V2 --
`RecommendationSetV2` has no `archetypeIntent` input today, and wiring one through is an
engine-contract extension outside this repair's 8-blocker scope.

Re-verified after the repair: `bun run test` 1047 engine + 220 web + 398 scripts, 0 failures;
`apps/engine tsc --noEmit` clean; `apps/web tsc --noEmit` same pre-existing Bun-types failures,
no regression; `apps/web lint` 0 errors, same pre-existing warnings; `verify-simplicity.sh` PASS;
`bun run scripts/eval/gate.ts --enforce` PASS, no regression.

## R1 S6 -- One-Ply Opponent Response + Steal + Counterfactual Lookahead

Materializes the 4 fields S5 left as `NOT_COMPUTED` (`RecommendationSetV2.deferred`):
`opponentResponse`, `steal`, `lookahead`, `counterfactual`. Branch `r1/opponent-lookahead`, base
`165d774a`. Six new flat files under `recommendation/` (`observation-point.ts`, `opponent-model.ts`,
`opponent-response.ts`, `steal.ts`, `counterfactual-identity.ts`, `lookahead.ts`) plus a
`legality.ts` split out of `build.ts` (moved, not rewritten, to avoid a `build.ts -> lookahead.ts
-> opponent-model.ts -> build.ts` import cycle). All flat in `recommendation/` on purpose:
`architecture-guard.test.ts`'s scan is non-recursive, so a subdirectory would silently escape the
determinism/Pro-Drafter guards -- keeping S6 flat keeps it covered by the same mechanical checks
S5 already relies on.

### Scope: `recommendations[0]` only, not an array

`RecommendationDeferredFields` was already frozen as 4 SINGULAR fields on the SET, not an array
keyed per recommendation. S6 keeps that shape: one opponent-perspective lookahead, computed for the
TOP-ranked recommendation only. Bounded by construction to at most 2 extra V6 calls per
`RecommendationSetV2` build (opponent "baseline", against the current state; opponent "after",
against the counterfactual state reached by hypothetically applying `recommendations[0]`'s own
action(s)), run concurrently via `Promise.all`.

### One-ply definition

For `recommendations[0]`: (1) apply its action(s) to the authoritative `DraftProtocolState` through
`applyProtocolCommand` (never a second reducer -- CM's command is resolved via the kernel's own
`legalGameplayActions` oracle, exactly like `decision.ts` does for our own side); (2) classify the
result (`observation-point.ts`'s `locateOpponentObservationPoint`): `COLLISION_PENDING` if a 3rd+
collision paused the kernel, `DRAFT_COMPLETE` if the draft ended, `NO_LEGAL_RESPONSE` if the
opponent has no legal HERO-TARGETING action within this one ply (CM steps sharing the same relative
actor twice in a row, or the opponent's only legal move being a hero-less `CM_BAN_SKIPPED`), else
`READY`; (3) when `READY`, score the opponent's own legal/plausible universe via the SAME injected
V6 entry point (never a second scoring engine), reusing `deriveLegalDecision`/`buildShortlist` for
the opponent side exactly as S5 already does for our own; (4) pick the top surviving shortlist
entry, re-validated against the true counterfactual state (`topPlausibleAction` scans in order,
never trusts the shortlist's own top entry blindly); (5) attach. Never a second ply: `lookahead`'s
`depth` field is the TypeScript literal `1`, not a number that could ever be 2.

### Counterfactual observation point

The exact point defined above -- the state reached by our own hypothetical action, classified by
whether the OPPONENT has a legal, hero-targeting decision within it. Deliberately does not "skip"
to a further step: CM steps 1-2 (both actor "first") correctly resolve to `NO_LEGAL_RESPONSE`
rather than guessing a second own action to reach step 3.

### Plausible vs probable

No calibrated opponent-behavior model exists in this codebase. Every S6 score is V6's own canonical
model score for the opponent's perspective, reused verbatim -- never converted into, rounded into,
or described as a probability. Enforced mechanically: `architecture-guard.test.ts` greps all of
`recommendation/**` (post comment-stripping) for `/probab/i` and fails the suite if it finds one.

### Information-set discipline (the one real design bug this slice found and fixed)

The first implementation used `project(state, opponentSide)` -- the opponent's own SELF-aware
`PerspectiveDraftView` -- to build the opponent's V6 input, exactly like `build.ts` does for our own
side. That is wrong for S6 specifically: `project(state, opponentSide)` correctly shows the
opponent their OWN currently-sealed-but-unrevealed pick as KNOWN to themselves, but S6 attaches this
model's OUTPUT to OUR OWN `RecommendationSetV2` -- so anything that varies with the opponent's still-
hidden pick leaks it to us through an observable side channel the instant it changes what V6
returns. Caught by the EXISTING S5 hidden-twin test (`build.test.ts`) once its
`JSON.stringify(setX) === JSON.stringify(setY)` assertion started covering the new `deferred`
fields too -- no new test had to be invented to catch a real regression.

Fix: `opponent-model.ts`'s `mutualVisibilityLegacyState` builds the opponent's V6 input directly
from the AUTHORITATIVE state, including ONLY what both sides can already verify right now -- bans
(never sealed in either ruleset) and CONFIRMED/REVEALED picks. A still-sealed pick on EITHER side
(including our own hypothetical action, if the round has not closed) is simply absent. For Captain's
Mode this is byte-identical to the self-aware view (the frozen contract already declares CM fully
revealed with no hidden mechanism at all); it only changes Ranked All Pick behavior, exactly where
hiding is real. `counterfactual-identity.ts`'s `stateIdentity`/`perspectiveIdentity` are computed
from `actor`'s OWN perspective (`project(counterfactualState, actor)`), never the opponent's --
this is the value attached to OUR OWN output, so it must vary only with what WE can observe
(including our own hypothetical action -- that is "stale recommendation" detection, not a leak),
never with the opponent's private state.

The task's own framing states this symmetrically ("tampoco uses hidden enemy information que
nosotros no vemos") -- S5's information-set discipline (never leak OUR hidden info into what the
opponent's model can see) already existed; S6 needed the mirror-image guarantee (never leak the
OPPONENT's hidden info into what WE can see) and initially missed it. `lookahead.test.ts`'s
"IMPORTANT TEST: OPPONENT INFORMATION SET" now covers both directions explicitly.

### AP sealed semantics

Because the opponent's model never uses their own hidden pick, a same-hero collision with a
still-sealed opponent pick remains reachable through it: V6 may rank a hero the opponent secretly
already holds, and the FINAL legality re-check (`topPlausibleAction`'s `postValidateAction`, calling
`isSealedSelectionLegal` against the TRUE counterfactual state) is what correctly allows or rejects
it -- never this model's own (deliberately incomplete) candidate pool. This is not a residual bug;
it is the same collision-stays-legal invariant `legality.ts`'s own Blocker 2 doc already establishes
for S5, now verified to hold through S6 too (`lookahead.test.ts` #5/#17).

### CM sequential semantics

Captain's Mode has no hidden information at all (frozen contract), so `mutualVisibilityLegacyState`
reduces to the self-aware view there -- no special-casing needed. The next-actor logic (steps
sharing the same relative actor never being skipped) falls entirely out of
`legalGameplayActions(counterfactualState)` -- S6 never re-derives the 24-step table.

### Steal semantics

`steal.ts`'s `evaluateSteal` compares, for the strongest (`opponentBaselineValue`-sorted, heroId
tie-broken) of our candidate's hero(es): its V6 score from the opponent's own perspective BEFORE our
action (against the CURRENT, unmodified state -- always well-defined, because our own candidate
hero was drawn from a legal shortlist for US, so it cannot already be banned/picked in that state)
versus AFTER (against the counterfactual state). Absent-from-baseline -> `NOT_APPLICABLE` (never a
threshold on "how good is good enough" -- presence in V6's own already-computed ranking IS the
signal). Still present after -> `STILL_CONTESTABLE` (covers both "untouched" and "still sealed-
hidden to them" -- V6 never excludes a hero it cannot see taken). Gone after -> `MATERIALIZED`,
with `displacedResponse` set to the SAME action object as the sibling `opponentResponse.action`
(never re-derived).

### Boundedness / performance

Two extra V6 calls maximum per `RecommendationSetV2` build, run concurrently. `topPlausibleAction`
scans an already-bounded shortlist (`SHORTLIST_SIZE = 8`, unchanged from S5). Measured against a
110-hero representative fixture (`lookahead.test.ts` #31): comfortably under the 500ms hard cutoff
alongside the existing 300ms/500ms V6 budget for our own side.

### Explicit S7+ deferrals

No opponent probability calibration (no model exists to calibrate). No deep/recursive lookahead
(`depth` is a literal `1`). No per-recommendation S6 (all 5 `recommendations[]` entries only ever
get `recommendations[0]`'s single lookahead). No compound OPPONENT response (the opponent's own
plausible action is always singular, even when their decision point is itself compound -- matches
the task's own "selecciona UNA bounded plausible response"). No UI surface for any S6 field --
`apps/web`'s `parseRecommendationSet` (`protocol-client.ts`) never reads `basedOn` or `deferred` at
all today, so S6 required zero web changes; a future UI surface for
`opponentResponse`/`steal`/`lookahead` is a real product-policy decision, deliberately left for a
later slice rather than forced here (task's own instruction: "Prioridad S6 = engine contract
correctness. No bloquear S6 por polish visual").

Re-verified after this slice: `bun run test` 1094 engine (+47) / 220 web (unchanged) / 398 scripts
(unchanged), 0 failures; `apps/engine tsc --noEmit` clean; `apps/web tsc --noEmit` same
pre-existing Bun-types failures, no regression; `apps/web lint` 0 errors, same pre-existing
warnings; `verify-simplicity.sh` PASS; `bun run scripts/eval/gate.ts --enforce` PASS (S6 never
touches `apps/engine/src/signals/**`, so this gate is structurally unaffected); `git diff --check`
clean.
