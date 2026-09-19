# Product Decisions — AP Ranked Roles v1

This document records the binding product decisions for D2KIRO's Ranked Roles All Pick feature.
Each decision is explicit, numbered, and non-ambiguous. Decisions in this file take precedence
over any implicit assumption in design or implementation work.

"D2KIRO" refers to the Draft Coach Assistant. "Player" refers to the human user.
"Simulator" refers to the built-in Ranked Roles draft practice tool.

---

## PD-001 — Position ≠ Pick Order

**Decision:** Being assigned to Pos 1 / Pos 2 / Pos 3 / Pos 4 / Pos 5 does NOT determine when in
the draft sequence a hero must be selected. A Mid (Pos 2) may be picked in Round 1, Round 2, or
Round 3. A Hard Support (Pos 5) may be picked in Round 3. Pick order is a strategic choice of the
player, not a mechanical constraint of the role.

**Implication:** No system behavior shall prevent or warn against picking a hero "too early" or
"too late" relative to its position. The Simulator accepts any position being filled at any pick
slot. The Coach does not penalize position-order decisions.

---

## PD-002 — Simulator: Player Controls All Five Own-Team Selections

**Decision:** In the Simulator, the Player manually controls all five hero selections for Own Team.
There is no auto-pilot or bot co-pilot for the Player's own team. The five position slots (Carry,
Mid, Offlane, Soft Support, Hard Support) exist as visual and organizational reference, but do not
auto-fill.

**Implication:** The Simulator waits for explicit Player input for each Own Team pick slot. No
slot is auto-filled, randomized, or suggested in a way that bypasses Player confirmation.

---

## PD-003 — D2KIRO Is an Assistant, Never an Authority

**Decision:** D2KIRO is a recommender, not a gatekeeper. The Player may select any legally
available hero at any time, including heroes D2KIRO did not recommend. No selection is blocked by
D2KIRO's recommendation logic.

**Implication:** All recommendation outputs are advisory. D2KIRO does not veto, warn, or require
confirmation for selections that differ from its recommendation.

---

## PD-004 — Support-First Is a Prior, Not a Rule

**Decision:** In pubs and ranked games, opening with supports is a common strategic tendency.
D2KIRO treats this as a strategic prior: in the absence of a contextual reason favoring a core
pick, the Coach normally favors recommending support reveals in early rounds. It is not a
restriction. Picking a core hero in Round 1 is always valid. No message, warning, or visual
indicator shall penalize an early core selection.

**Implication:** The support-first prior influences the Coach's default recommendation direction
in early rounds. It does not block or discourage any hero selection. A sufficiently strong
contextual reason (counter-pick opportunity, safe core window, critical synergy) overrides it.

---

## PD-005 — Enemy Role Inference Is Legal; Enemy Role Queue Is Hidden

**Decision:** D2KIRO does not have access to the Ranked Roles role queue assignment of enemy
players — that information is hidden and must never reach the Coach. However, the Coach is
permitted and expected to infer probable positions for revealed enemy heroes from legally observable
evidence: hero position data, positional frequency in the current patch, other Enemy Team heroes
already revealed, Enemy Team positional slots still plausibly unoccupied, and the structure of the
current Enemy draft.
Inference is qualitative and probabilistic — a Flex Hero may be represented as "Likely Pos3 /
Possible Pos2" rather than forced into a single role prematurely. If subsequent draft evidence
makes one interpretation clearly dominant, the Coach may increase its confidence in that
interpretation. The Player may also explicitly assign or correct a position at any time.

**Implication:** The Coach maintains a probabilistic read of enemy positions based on observable
evidence, updating as each round reveals new information. It never forces resolution of a Flex
enemy hero to a single position without sufficient evidence or explicit Player assignment. The
hidden Ranked Roles role queue of enemy players must never influence Coach recommendations.

---

## PD-006 — Side Is Part of Draft Context from the Start

**Decision:** Radiant and Dire are first-class draft contexts. The Player selects their side
before the draft begins, and that selection is maintained and used throughout the entire draft
session. Side context is available for recommendations. Both sides are fully supported — no
behavior is exclusive to or biased toward Radiant.

**Implication:** Draft cannot begin without a side selection. Side is always present as context.
It acts as a contextual modifier or tiebreaker only when there is sufficient evidence to support a
side-specific assessment — not by default. Radiant is never hardcoded as the default side.

---

## PD-007 — Win Condition Is Inferred, Not Selected Manually

**Decision:** D2KIRO uses the current draft state to make composition-coherent recommendations.
There is no selector, dropdown, or input field that asks the Player to choose a win condition or
strategy type. Basic directional inference from the draft state may inform recommendations where
the evidence is clear, but deep win condition modeling is Future Intelligence.

**Implication:** No UI element prompts the Player for "What is your win condition?" Win condition
context may be displayed as lightweight informational output accompanying a recommendation when
inference is reliable, but it is read-only output, never an input. MVP inference is advisory and
limited. Deep win condition modeling is Future Intelligence. The absence of deep inference does not
prevent D2KIRO from providing recommendations.

---

## PD-008 — Recommendations Update Continuously

**Decision:** D2KIRO recalculates and updates its recommendation after every draft event that
changes the known draft state: each Own Team hero confirmation, and each round reveal that exposes
enemy heroes. Recommendations are never static for the duration of a round. There is no
"calculation lock" between relevant events.

**Implication:** Every state-changing event triggers a recommendation refresh. The displayed
recommendation always reflects the most current known draft state.

---

## PD-009 — Hidden Enemy Information Must Never Affect Recommendations

**Decision:** D2KIRO's recommendation engine is blind to enemy hero selections that have not yet
been officially revealed through a round-end reveal event. Even if the Simulator internally knows
which hero the Enemy Bot has selected, that information is strictly isolated from the Coach until
the reveal moment. Recommendations based on unrevealed enemy selections are a correctness violation.

**Implication:** The Simulator maintains a strict partition between revealed state (visible to Coach
and Player) and hidden state (not visible to either). No pipeline, shortcut, or test convenience
shall bridge this partition.

---

## PD-010 — Hero Pool Constrains Primary Recommendations; Exceptional Outside-Pool Suggestions Are Allowed and Must Be Explicit

**Decision:** D2KIRO weights recommendations toward the Player's Hero Pool in the primary
recommendation ranking. However, when no pool hero provides a satisfactory strategic answer to the
current draft situation, D2KIRO may surface an additional recommendation labeled explicitly as
"Best outside your pool." This is a secondary, labeled section — not a replacement for the primary
recommendation. The Player may always select any hero, pool or not.

**Implication:** Hero Pool is a preference filter that increases the weight of known comfort heroes.
It is never a hard gate. The "Best outside your pool" label must be visually distinct and clearly
attributed as being outside the pool. The Hero Pool applies specifically to the Player's own
position slot. For the other four Own Team slots, recommendations are drawn from the
meta-coherent hero universe for each position, not from the Player's personal pool.

---

## PD-011 — The Next Recommendation May Change After Every Allied Decision

**Decision:** D2KIRO does not pre-decide a two-hero sequence ("you should pick X then Y"). After
each Own Team selection, the optimal next recommendation is recalculated fresh from the new draft
state. A recommendation made before a pick is made may be completely different after that pick
is confirmed, even if the confirmed pick was the recommended hero.

**Implication:** D2KIRO has no "locked ahead" recommendation state. Every recommendation is
contingent on the draft state at the moment it is generated.

---

## PD-012 — Own Team Role Assignments Are Known; Enemy Role Queue Is Hidden

**Decision:** In Ranked Roles, players pre-select a role queue before the match. D2KIRO treats
Own Team role assignments (which of the five positions each player is queued for) as known from
the start of the draft. The Ranked Roles role queue of enemy players is permanently hidden from
the Coach for the entire draft. This is distinct from positional inference: the Coach may and
should infer probable positions for revealed enemy heroes from legally observable evidence (hero
position data, draft structure, revealed heroes, open slots). Inferring from observable evidence
is different from knowing the hidden role queue.

**Implication:** Own Team positional recommendations may leverage queued role assignments. No
recommendation shall be based on the enemy Ranked Roles role queue. Positional inference from
observable Enemy draft evidence is valid and expected — Own Team composition may inform what
response is strategically desirable, but does not determine what position an enemy hero occupies.
Enemy positions are only established with certainty through sufficient draft evidence or explicit
Player assignment.

---

## PD-013 — Simulator Fidelity Has Priority Over Convenient Testing Shortcuts

**Decision:** The Simulator reproduces the real Ranked Roles All Pick draft mechanics faithfully,
including the hidden-pick model, the round structure, the ban system, and the collision mechanic.
Simplifications that reduce fidelity (e.g., simultaneous-pick become sequential, hidden picks
become visible earlier) are not permitted as implementation conveniences. If a mechanic is too
complex to implement faithfully in the first wave, it should be deferred explicitly rather than
approximated silently.

**Implication:** Any deviation from real Dota 2 Ranked Roles mechanics requires explicit Product
Owner approval (PD-014). Undocumented simplifications are not permitted.

---

## PD-014 — Any Simplification That Changes Real Dota Semantics Requires Explicit Product Owner Approval

**Decision:** When implementing any mechanic that deviates from real Dota 2 behavior (e.g., timer
behavior, ban collision logic, round structure), the deviation must be explicitly documented and
approved by the Product Owner before implementation. Silent approximations are not allowed.

**Implication:** If during design or implementation a genuine fidelity tradeoff is identified, a
product decision entry (PD-0XX) must be drafted and approved before proceeding.

---

## PD-015 — The Central Coach Question Is: "What Is the Best Reveal Decision Now?"

**Decision:** The primary output of D2KIRO at every moment is the answer to a single question:
*"What is the best reveal decision for Own Team right now?"* This question may resolve into
different types of output depending on the draft context: recommending a specific hero to reveal,
recommending a positional role to reveal (e.g., "open with your support"), signaling that a core
can be secured early (Safe Core window), recommending to defer revealing a position or delay
selecting the personal hero (e.g., "keep Mid unrevealed for now") — not reserving or locking any
hero without picking it, or surfacing an exceptional opportunity that overrides the default
recommendation direction. All other recommendation outputs (rationale badges, safe core,
outside-pool, confidence indicators) support this central question. The recommendation is about
the team's strategic situation, not only about the Player's personal hero slot.

**Implication:** D2KIRO provides team-level recommendations throughout the draft, not just a
recommendation for the Player's personal position. The recommendation is available from the very
first pick opportunity. PD-016 defines the valid output forms in detail.

---

## PD-016 — Role Recommendation and Hero Recommendation Are Both Valid Outputs

**Decision:** D2KIRO may recommend a specific hero ("pick Lina"), a role/position ("reveal your
support now"), or both as valid recommendation outputs depending on the draft context. Neither
form is more authoritative than the other; the appropriate form depends on what is most actionable
given the current draft state.

**Implication:** The recommendation display supports both forms. A role-level recommendation is
not a downgrade from a hero-level recommendation — it is an appropriate strategic output when
hero-level specificity is not yet warranted.

---

## PD-017 — A Specific Hero Opportunity May Override Normal Role-Order Priors

**Decision:** When a specific hero presents a clearly superior strategic opportunity — a hard
counter-pick, a dominant meta pick, a critical synergy — that opportunity overrides the normal
advisory priors (including support-first). D2KIRO surfaces exceptional opportunities regardless
of what the current round's "expected" role priority would suggest. A Safe Core identification is
a specific instance of this principle — when a core hero's contextual safety is strong enough,
revealing it early is a valid strategic opportunity that overrides the support-first prior.

**Implication:** Recommendation scoring must be able to elevate a single hero above role-order
defaults when the strategic signal is strong enough. The threshold for "strong enough" is a design
decision, not a product decision, and must not be hardcoded in this document.

---

## PD-018 — Flex Roles Are Resolved by Evidence or Explicit Assignment

**Decision:** Ambiguous enemy hero positions remain unresolved until one of two conditions is met:
(a) sufficient draft evidence makes one role interpretation clearly dominant — at which point the
Coach may increase its confidence in that interpretation without requiring explicit Player input —
or (b) the Player explicitly assigns a role to that hero. D2KIRO does not force resolution of
ambiguity by defaulting to the most common role for a Flex Hero, but it also does not leave enemy
Flex positions entirely uncharacterized. Qualitative probabilistic representation (e.g.,
"Likely Pos3 / Possible Pos2") is the appropriate form while ambiguity persists.

**Implication:** Recommendations involving Flex enemy heroes must reason over the probable range
of positions using hero position data and draft evidence — not assume a single default position,
and not refuse to reason at all. Player assignment is one valid resolution path, but evidence-based
confidence increase is also valid. The Player may revise an assignment at any point.

---

## PD-019 — Radiant and Dire Must Both Be First-Class Supported Sides

**Decision:** No behavior, recommendation, or UI state shall be implemented only for Radiant or
only for Dire. Both sides must be fully supported with identical capability. Side context is used
to contextualize the draft correctly, not to limit what D2KIRO can do.

**Implication:** Testing and QA must include draft scenarios from both sides. Any found asymmetry
between Radiant and Dire behavior is a defect.

---

## PD-020 — The Player's Personal Position Does Not Constrain When Their Hero May Be Selected

**Decision:** The Player's personal role queue (e.g., "I am queued as Pos 1") does not determine
which pick slot the Player must use to select their hero. The Player may fill their personal slot
at any point in the draft sequence across all three rounds.

**Implication:** The Simulator does not flag or prevent the Player from selecting a personal hero
in Round 1 even if their position is typically picked late, and does not reserve a specific pick
slot for the Player's personal position.

---

## PD-021 — Ban Phase Follows Current Valve Mechanic: Pre-Match Preference System

**Decision:** The ban phase is not a traditional Captain's Mode alternating ban system, and no
interactive ban nomination occurs during the draft. Before entering matchmaking, each player may
store up to 4 hero preference slots. A slot may be left empty. Unique ban outcomes are
prioritized. A player with all four preference slots filled is guaranteed at least one of their
heroes is banned. The result of ban resolution is a variable-length set of banned heroes — no
fixed count is assumed. The exact internal tie-break algorithm Valve uses when multiple players
prefer the same hero is not publicly specified; the Simulator SHALL encapsulate ban resolution
behind a deterministic, testable policy that reproduces the observable guarantees above. No
interactive nomination phase, no turn-based ban structure.

**Implication:** The Simulator presents the pre-match preference inputs per player, resolves bans
according to the unique-result priority mechanic, and then begins picks. The ban phase is not
interactive during the draft session.

---

## PD-022 — Hero Collision in Picks Is Resolved Per Valve's Progressive Mechanic

**Decision:** When two teams independently select the same hero in the same round (a collision),
the resolution follows Valve's current progressive mechanic based on the count of collision events
within that pick round:
- Collision event #1 in a round: the disputed hero is banned; both affected teams must re-select.
  The replacement may be any other available hero (including heroes neither team had previously
  attempted).
- Collision event #2 in the same round: if the replacement selections conflict again (on the same
  or a different hero), that hero is also banned; both affected teams re-select again.
- Collision event #3 in the same round: if a third conflict occurs, the team that registered first
  retains the hero; the opposing team re-picks with additional time.
The collision counter resets at the start of each new pick round. Neither team is assumed to "own"
any hero before collision resolution.

**Implication:** The Simulator must implement the full three-instance progressive collision
detection and resolution flow. A hero that is subject to collision resolution is not finalized
until the collision is resolved. Any hero banned as a result of collision resolution is permanently
unavailable for the remainder of the draft, identical to a pre-draft ban. The collision counter
tracks events within a pick round, not occurrences of a specific heroId.

---

## PD-023 — D2KIRO Recommends for the Team, Not Only for the Player's Personal Slot

**Decision:** D2KIRO is a team-draft assistant. Its recommendations address the whole team's
strategic situation, covering all five Own Team positions. Recommendations for all slots are
produced and updated continuously — D2KIRO does not wait for "the Player's personal turn" to
generate suggestions.

**Implication:** At any moment in the draft, D2KIRO has a recommendation relevant to the team's
next strategic decision, which may or may not be the Player's personal slot. The UX must reflect
this team-level advisory scope.

---

## PD-024 — Positional Fit Must Be Based on Evidence of Actual Play, Not Thematic Labels

**Decision:** Positional fit — whether a hero can credibly fill a specific lane/role in the draft
— must be based on evidence that represents actual Dota 2 positions as they exist in the relevant
patch and bracket. Generic thematic role labels that describe a hero's narrative archetype (e.g.,
"Carry", "Disabler", "Nuker") do not constitute evidence of Pos1/Pos2/Pos3/Pos4/Pos5 and must not
be treated as such.

**Implication:** Any positional reasoning performed by D2KIRO must trace back to data that
accurately represents how heroes are actually played in each position. Using thematic or archetype
labels as a positional proxy produces incorrect recommendations and is not permitted.

---

## PD-025 — Current Product Target Patch Is 7.41f; Patch Data Must Be Versionable

**Decision:** The AP Ranked Roles V1 spec targets patch **7.41f** as the current product patch.
All recommendation scoring and meta data must reflect this patch. However, no architecture shall
hardcode 7.41f as the only valid patch — the system must support patch versioning so that future
patches can be adopted without rebuilding the recommendation engine.

**Implication:** Patch identity is an explicit input to the scoring pipeline, not an implicit
constant. When a new patch is released, updating the product target requires a patch data update,
not a structural change to the system.

---

## Summary Table

| ID | Decision |
|---|---|
| PD-001 | Position ≠ Pick Order — position does not determine when a hero is selected |
| PD-002 | Player controls all five own-team selections in the Simulator |
| PD-003 | D2KIRO is an assistant, never an authority — no selections are blocked |
| PD-004 | Support-first is a strategic prior, not a rule — no restrictions on early core picks |
| PD-005 | Enemy role queue is hidden; Coach infers probable positions from observable Enemy draft evidence |
| PD-006 | Side is part of draft context from the start — both sides fully supported |
| PD-007 | Win condition is inferred by Coach from draft state, never selected manually by Player |
| PD-008 | Recommendations update continuously after every relevant draft event |
| PD-009 | Hidden enemy information must never affect recommendations |
| PD-010 | Hero Pool constrains primary recommendations for Player's own slot; exceptional outside-pool suggestions are allowed and labeled |
| PD-011 | The next recommendation may change after every allied decision — no rigid two-pick sequences |
| PD-012 | Own Team role assignments are known; enemy Ranked Roles role queue is hidden — inference from observable evidence is valid |
| PD-013 | Simulator fidelity has priority over convenient testing shortcuts |
| PD-014 | Any simplification of real Dota semantics requires explicit Product Owner approval |
| PD-015 | The central Coach question is: "What is the best reveal decision now?" — output form depends on draft context |
| PD-016 | Role recommendation and hero recommendation are both valid Coach outputs |
| PD-017 | A specific hero opportunity may override normal role-order priors; Safe Core is a specific instance |
| PD-018 | Flex roles resolved by evidence (confidence increase) or explicit Player assignment — qualitative representation while ambiguous |
| PD-019 | Radiant and Dire must both be first-class supported sides |
| PD-020 | Player's personal position does not constrain when their hero may be selected |
| PD-021 | Ban phase follows current Valve mechanic: pre-match preference system, no interactive phase during draft |
| PD-022 | Hero collision resolved per Valve's progressive mechanic: three collision events per pick round |
| PD-023 | D2KIRO recommends for the team, not only for the Player's personal slot |
| PD-024 | Positional fit must be based on evidence of actual play, not thematic archetype labels |
| PD-025 | Current product target patch is 7.41f; patch data must be versionable |
