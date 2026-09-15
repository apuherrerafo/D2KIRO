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
