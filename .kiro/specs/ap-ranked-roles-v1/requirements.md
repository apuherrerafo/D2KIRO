# Requirements Document

## Introduction

D2KIRO is a Dota 2 Draft Coach Assistant for the **Ranked Roles All Pick** game mode (current target patch: **7.41f**).
It accompanies the player through the full draft sequence — from the pre-draft ban phase
to the final pick — and continuously recommends the best decision for the current moment.

D2KIRO is an assistant, never an authority. The player always makes the final selection. Every
recommendation is advisory. The player may select any legally available hero regardless of what
D2KIRO recommends.

This document describes the **AP Ranked Roles V1 / MVP** behavior — the product target for this spec. Items labeled **[Future Intelligence]** are explicitly deferred. Implementation may be sequenced across multiple delivery waves; sequencing decisions are defined in tasks.md and do not change these product requirements.

---

## Glossary

- **Coach**: D2KIRO, the draft assistant.
- **Player**: The human using D2KIRO during a real or simulated draft.
- **Simulator**: The built-in tool that lets the Player practice a full Ranked Roles All Pick draft
  without opening Dota 2.
- **Side**: Radiant or Dire — the team faction. A first-class draft context.
- **Own Team**: The five-player team the Player belongs to and controls in the Simulator.
- **Enemy Team**: The opposing five-player team, controlled by the Enemy Bot in the Simulator.
- **Position (Pos 1–5)**: A player's in-game role (Carry, Mid, Offlane, Soft Support, Hard
  Support). Position is a strategic concept independent of pick order.
- **Pick Order**: The chronological slot in which a hero is selected during a round. Unrelated to
  Position.
- **Role Assignment**: In Ranked Roles, each player pre-selected a role queue before the match.
  Own Team role assignments are known to the Coach. The enemy Ranked Roles role queue is hidden
  from the Coach for the entire draft.
- **Hero Pool**: The set of heroes the Player has designated as their personal comfort heroes for
  their own position.
- **Flex Hero**: A hero whose primary position is ambiguous and cannot be inferred with confidence
  from name or role label alone.
- **Revealed Pick**: A hero selection that has been made visible to both sides after a round ends.
- **Hidden Pick**: A hero selection made during a round but not yet revealed.
- **Collision**: Two teams independently selecting the same hero in the same round.
- **Round**: One simultaneous selection cycle (Radiant picks + Dire picks happen in parallel,
  hidden from each other, then both sets are revealed simultaneously).
- **Ban Preference**: A hero preference stored by a player before entering matchmaking. Each
  player may store up to 4 hero preferences. A preference slot may be left empty. Unique ban
  results are prioritized over duplicate outcomes. A player with all four slots filled is
  guaranteed at least one of their heroes is banned. The exact internal resolution when multiple
  players prefer the same hero is not specified — that detail is encapsulated in the ban
  resolution policy. No interactive ban phase occurs during the draft.
- **Support-First Prior**: The strategic tendency to reveal supports before cores. It is a
  strategic prior that informs the Coach's default recommendation direction — never a restriction.
- **Win Condition**: The overall strategic direction inferred from the draft state (e.g.,
  push-heavy, teamfight, pickoff). Inferred by the Coach from observable draft state, never
  selected manually by the Player. Deep win condition modeling is Future Intelligence.
- **Coach Question**: The central question the Coach answers at every step: *"What is the best
  reveal decision for Own Team right now?"*

---

## Requirements

---

### Requirement 1: Ranked Roles All Pick Draft Structure

**User Story:** As a player, I want the Simulator to faithfully reproduce the Ranked Roles All
Pick draft sequence so that my practice sessions match what happens in a real ranked game.

#### Acceptance Criteria

1. THE Simulator SHALL model draft progression as three rounds with the following structure:
   - Round 1: 2 picks Radiant + 2 picks Dire (total 4 selections)
   - Round 2: 2 picks Radiant + 2 picks Dire (total 4 selections)
   - Round 3: 1 pick Radiant + 1 pick Dire (total 2 selections)

2. WHEN a round begins, THE Simulator SHALL require both teams to select their heroes
   simultaneously, hidden from the opposing side, before any reveals occur.

3. WHEN all teams have completed their selections for a round, THE Simulator SHALL reveal all
   selections for that round to both sides at the same time.

4. THE Simulator SHALL not reveal any team's selection to the opposing side before the round
   reveal moment.

5. WHEN two teams select the same hero in the same round (collision), THE Simulator SHALL apply
   a progressive resolution based on the count of collision events within that pick round:
   - Collision event #1 in a round: the disputed hero is banned; both affected teams must
     re-select a different hero. The replacement may be any other available hero.
   - Collision event #2 in the same round: if the replacement selections again conflict (on the
     same or a different hero), that hero is also banned; the affected teams must re-select again.
   - Collision event #3 in the same round: if a third conflict occurs, the team that registered
     the selection first retains the hero; the opposing team must re-pick with additional time
     provided.
   The collision counter resets at the start of each new pick round.

6. THE Simulator SHALL enforce that no hero can appear more than once in the combined draft across
   both teams after collision resolution. Any hero banned during collision resolution is
   permanently unavailable for the remainder of the draft, identical to a pre-draft ban. The
   collision event counter is per pick round, not per hero.

---

### Requirement 2: Pre-Draft Ban Phase

**User Story:** As a player, I want to configure my ban preferences before the draft starts and
see the resulting banned heroes before picks begin, following the real Dota 2 Ranked Roles ban
mechanic, so that the draft I practice on matches what I encounter in ranked games.

#### Acceptance Criteria

1. BEFORE the draft begins, THE Simulator SHALL allow the Player to configure up to 4 ban
   preference slots for Own Team. Any slot may be left empty.

2. THE Simulator SHALL generate coherent ban preferences for the other nine simulated players
   using a policy that is deterministic by seed: given the same Player ban preferences and the
   same session seed, the Simulator SHALL produce the same ban result. Different seeds SHALL
   produce variation in the simulated player preferences.

3. THE Simulator SHALL resolve bans using the following observable guarantees: unique ban outcomes
   are prioritized; a player with all four preference slots filled is guaranteed at least one of
   their heroes is banned. The exact internal tie-break algorithm Valve uses when multiple players
   prefer the same hero is not specified — the Simulator SHALL encapsulate ban resolution behind
   a deterministic, testable policy that reproduces these guarantees.

4. WHEN ban resolution produces a result, THE Simulator SHALL present the final variable-length
   set of banned heroes to the Player before picks begin. No fixed ban count is assumed.

5. THE Coach SHALL receive only the final resolved ban set — not any intermediate state of the
   ban resolution process.

6. THE Simulator SHALL not allow a hero that was banned to be picked in any subsequent round.

---

### Requirement 3: Side Selection and First-Class Side Context

**User Story:** As a player, I want to select whether my team is Radiant or Dire before the draft
begins so that the Coach and Simulator always operate with the correct side context.

#### Acceptance Criteria

1. BEFORE the draft begins, THE Coach SHALL prompt the Player to select Radiant or Dire as their
   team side.

2. WHEN the Player selects a side, THE Simulator SHALL assign Own Team to that side and Enemy Team
   to the opposing side for the entire draft.

3. THE Coach SHALL use side context in all recommendations throughout the draft.

4. THE Coach SHALL fully support Radiant and Dire as equally valid starting conditions — no
   behavior shall be exclusive to or biased toward either side.

5. IF the Player has not selected a side, THE Coach SHALL not begin the draft.

6. THE Coach SHALL treat side context as available input for all recommendations throughout the
   draft. IF sufficient and reliable evidence exists that a hero performs differently on Radiant
   versus Dire (beyond general win rate), THE Coach MAY use side as a contextual modifier or
   tiebreaker. Side SHALL NOT be used as a dominant recommendation criterion by default.

---

### Requirement 4: Role Assignment Visibility

**User Story:** As a player, I want the Coach to know my team's role assignments while correctly
treating enemy role assignments as unknown, so that recommendations reflect what I actually know
about the game state.

#### Acceptance Criteria

1. THE Coach SHALL treat Own Team role assignments (Pos 1–5) as known information from the start
   of the draft.

2. THE Coach SHALL treat the Ranked Roles role queue of Enemy Team players as hidden and unknown
   for the entire duration of the draft.

3. THE Coach SHALL NOT use the Simulator's internal Ranked Roles role queue assignment for enemy
   heroes. Instead, the Coach SHALL infer probable positions from legally observable evidence:
   hero position data, positional frequency in the current patch, other Enemy Team heroes already
   revealed, Enemy Team positional slots still plausibly unoccupied, and the structure of the
   current Enemy draft.

4. WHEN a revealed enemy hero is a Flex Hero, THE Coach SHALL represent probable positions
   qualitatively (e.g., Likely Pos3 / Possible Pos2) rather than defaulting to a single assumed
   role or waiting for Player assignment to reason about that hero.

5. THE Coach SHALL never base any recommendation on the hidden Ranked Roles role queue of enemy
   players — only on legally observable draft information.

---

### Requirement 5: Player Controls All Five Own-Team Selections

**User Story:** As a player, I want to manually control all five hero selections for my own team
in the Simulator so that I can practice any draft scenario I choose.

#### Acceptance Criteria

1. THE Simulator SHALL require the Player to select all five heroes for Own Team across the three
   rounds.

2. THE Simulator SHALL present five named position slots (Carry, Mid, Offlane, Soft Support, Hard
   Support) as visual reference, but SHALL NOT restrict when in the pick order each position's
   hero must be selected.

3. WHEN it is Own Team's turn within a round, THE Simulator SHALL accept any available (un-banned,
   un-picked) hero chosen by the Player regardless of which slot or position that hero will fill.
   Within the same round, Own Team may not select the same hero twice for two different Own Team
   slots. A hero that the Enemy Bot has selected internally but not yet revealed is NOT excluded
   from Own Team's selection — if both sides select the same hero, a collision is detected at
   round resolution.

4. THE Simulator SHALL NOT auto-select or pre-fill any Own Team slot without explicit Player input.

5. THE Simulator SHALL NOT prevent the Player from selecting a hero that the Coach did not
   recommend.

---

### Requirement 6: Enemy Bot Behavior

**User Story:** As a player, I want the enemy team in the Simulator to pick heroes in a coherent,
realistic manner so that practice sessions are meaningful.

#### Acceptance Criteria

1. THE Simulator SHALL control all five Enemy Team hero selections automatically via an Enemy Bot.

2. WHEN the Enemy Bot selects heroes, THE Enemy Bot SHALL respect Dota 2 position semantics:
   it SHALL avoid creating compositions that are obviously invalid (e.g., five cores, zero
   supports).

3. THE Enemy Bot SHALL select heroes from the pool that is visible to the Enemy Bot: confirmed
   bans and heroes revealed in previous rounds are excluded. A hero that Own Team has selected
   internally during the current blind round is NOT excluded from the Enemy Bot's selection — if
   both sides select the same hero, a collision is detected at round resolution.

4. THE Enemy Bot SHALL vary its selections across sessions. WHEN the same initial draft state and
   the same session seed are provided, THE Enemy Bot SHALL produce the same hero selection sequence
   (deterministic reproduction). WHEN different seeds are used, THE Enemy Bot SHALL produce
   meaningfully different draft scenarios. Variation SHALL never justify role-invalid or
   meta-absurd picks.

5. THE Enemy Bot SHALL NOT reveal enemy selections to the Player before the round reveal moment,
   preserving hidden-pick fidelity.

6. THE Enemy Bot SHALL use real Dota 2 roles from hero position data — never inferred from hero
   name or label alone.

---

### Requirement 7: Draft Timers

**User Story:** As a player, I want the Simulator to enforce pick timers that match real Dota 2
Ranked Roles timing so that I practice under realistic time pressure.

#### Acceptance Criteria

1. THE Simulator SHALL enforce per-round timers with the following durations: Round 1: 25 seconds.
   Round 2: 25 seconds. Round 3: 20 seconds.

2. WHEN the base timer expires and an Own Team player has not yet confirmed a selection, THE
   Simulator SHALL begin applying a gold penalty of 2 gold per second for each player with an
   unconfirmed selection. Players retain the ability to select and confirm their hero while the
   penalty is active.

3. THE Simulator SHALL display the timer countdown visibly during each round.

4. THE Simulator SHALL allow the Player to confirm all own selections before the round ends
   even if the timer has not expired.

5. THE Simulator SHALL display the gold penalty counter visibly when the penalty is active for
   any Own Team player.

---

### Requirement 8: Continuous Coach Recommendations

**User Story:** As a player, I want the Coach to give me an updated recommendation after every
relevant draft event so that I am never left without guidance during the draft.

#### Acceptance Criteria

1. THE Coach SHALL produce a recommendation at the beginning of the draft, before any picks are
   made.

2. WHEN any Own Team hero selection is confirmed, THE Coach SHALL recalculate and update its
   recommendation.

3. WHEN a round reveal occurs and new Enemy Team heroes become visible, THE Coach SHALL
   recalculate and update its recommendation.

4. THE Coach SHALL never withhold recommendations until a specific position's turn to pick
   arrives — recommendations are available for the whole team's strategic situation at any moment.

5. WHILE at least one Own Team selection is still pending, THE Coach SHALL provide at least one
   actionable recommendation. The recommendation may take any form permitted by Requirement 9 and
   PD-016: a hero shortlist, a positional role, a reveal/defer guidance, or an exceptional
   opportunity signal. The Coach SHALL NOT force hero-level specificity when the draft state does
   not yet justify it.

---

### Requirement 9: The Coach Question: What Is the Best Reveal Decision Now?

**User Story:** As a player, I want the Coach's primary recommendation to answer "what is the best
reveal decision right now?" so that I get actionable guidance for the specific decision the game
mode demands.

#### Acceptance Criteria

1. THE Coach SHALL frame its primary output around the question: *"What is the best reveal
   decision for Own Team right now?"*

2. THE Coach SHALL support the following valid output forms: a specific hero recommendation, a
   positional role recommendation (e.g., "reveal your support now"), a recommendation to secure a
   specific core early, a recommendation to defer revealing a role or position (e.g., "keep Mid
   unrevealed for now"), or an exceptional opportunity signal. Note: the Coach may recommend
   deferring the reveal of a role or delaying the selection of a personal hero — but no hero can
   be reserved or locked without being picked. The appropriate form depends on the draft state.

3. WHEN the Coach produces any type of reveal recommendation, THE Coach SHALL include a brief
   rationale connected to the current draft state (counters, synergies, meta, or positional need).

4. THE Coach SHALL update the framing of the recommendation to reflect the specific round and the
   remaining Own Team slots still to be filled.

5. THE Coach SHALL never present the recommendation as an obligation — the Player retains full
   decision authority.

---

### Requirement 10: Support-First Prior

**User Story:** As a player, I want the Coach to favor recommending supports early in the draft as
a strategic prior, while still allowing me to open with any hero I choose, so that I get realistic
strategic guidance without being restricted.

#### Acceptance Criteria

1. THE Coach SHALL treat the tendency to reveal supports before cores as a strategic prior that
   informs the Coach's default recommendation direction, not as a rule that blocks other
   recommendations.

2. WHEN recommending heroes for early rounds and no strong counter-pick or synergy reason favors
   a core pick, THE Coach SHOULD favor support hero options in the shortlist and primary action.

3. WHEN a specific core hero presents a clearly superior opportunity (counter-pick, power spike,
   dominant win condition), THE Coach SHALL surface that opportunity regardless of the current
   round or the support-first prior.

4. THE Coach SHALL NOT prevent the Player from selecting a core hero in Round 1.

5. THE Coach SHALL NOT present a warning or penalty to the Player for selecting a hero that
   conflicts with the support-first prior.

---

### Requirement 11: Hero Pool Personal Recommendations

**User Story:** As a player, I want the Coach to prioritize heroes from my personal pool in
recommendations so that I am guided toward heroes I can actually play, while still being informed
of exceptional outside-pool options.

#### Acceptance Criteria

1. WHEN the Player has configured a Hero Pool, THE Coach SHALL weight heroes from that pool
   higher in the primary recommendation ranking. The Hero Pool configured by the Player applies to
   the Player's own position. For Own Team slots belonging to other positions, the Coach uses the
   general meta-coherent hero universe for those positions.

2. THE Coach SHALL present primary recommendations from the Hero Pool separately from exceptional
   outside-pool options.

3. WHEN no hero in the Hero Pool provides a satisfactory answer to the current draft situation,
   THE Coach SHALL surface an explicit "Best outside your pool" recommendation, clearly labeled as
   such.

4. THE Coach SHALL NOT restrict the Player from selecting any hero, regardless of whether it is
   in the Hero Pool.

5. WHEN the Player has not configured a Hero Pool, THE Coach SHALL provide recommendations
   without pool filtering.

6. THE Hero Pool SHALL NOT be treated as the only valid source of heroes — it is a preference
   filter, never a hard gate.

7. WHILE the Player has not yet selected their own hero, THE Coach SHALL display a compact
   secondary view showing the top options from the Player's personal pool for their own position
   (e.g., "YOUR MID NOW: Puck › Ember › Storm"), updated after each draft event. This view is
   separate from and does not replace the team-level recommendation.

---

### Requirement 12: Hidden Enemy Information Isolation

**User Story:** As a player, I want the Coach to be completely blind to enemy selections that have
not yet been revealed, so that I am not accidentally advantaged by information that would not be
available in a real game.

#### Acceptance Criteria

1. THE Coach SHALL base all recommendations exclusively on heroes that have been officially
   revealed through a round reveal event.

2. THE Coach SHALL NOT use any internally-known enemy selection that has not yet been revealed to
   influence recommendations.

3. WHEN a round ends and enemy picks are revealed, THEN only from that moment forward, THE Coach
   SHALL incorporate those revealed heroes into its recommendation logic.

4. THE Simulator SHALL maintain a strict separation between what is revealed state and what is
   hidden state, and SHALL NOT expose hidden state to the Coach.

---

### Requirement 13: Flex Hero Handling

**User Story:** As a player, I want the Coach to acknowledge when an enemy hero's role is
ambiguous and not force a false certainty about their position, so that recommendations remain
honest about what is unknown.

#### Acceptance Criteria

1. WHEN a revealed enemy hero is a Flex Hero (capable of multiple positions), THE Coach SHALL
   represent probable positions qualitatively (e.g., Likely Pos3 / Possible Pos2) using hero
   position data and draft context, rather than defaulting to a single inferred role or leaving
   enemy positions entirely uncharacterized.

2. WHEN making recommendations against a Flex enemy hero, THE Coach SHALL reason over the likely
   range of positions, weighted by hero position data and observable draft evidence. If one
   interpretation becomes clearly dominant from the draft state, the Coach MAY increase confidence
   in that interpretation.

3. WHEN the Player explicitly assigns a position to a revealed enemy hero, THE Coach SHALL use
   that assignment in subsequent recommendations.

4. THE Coach SHALL allow the Player to update or remove an enemy hero position assignment at any
   point during the draft.

5. IF an own Flex Hero is selected, THE Coach SHALL allow the Player to assign that hero's
   position, and SHALL use that assignment in recommendations for remaining slots.

6. WHEN an Own Team hero selection is a Flex Hero and the Player has not assigned a position, THE
   Simulator SHALL display that slot as FLEX (e.g., FLEX 3/4) rather than auto-assigning a
   position. THE Coach SHALL reason over both valid positions for that hero until the Player
   resolves the assignment. The Player may assign or change the position at any point while the
   draft permits.

7. WHEN an Own Team hero is a Flex Hero and its position has not been assigned by the Player, THE
   Coach SHALL keep both possible positions open in its reasoning and SHALL NOT auto-resolve the
   Flex to a single position. The Player may explicitly assign a position via a lightweight
   control, after which the Coach uses that assignment.

---

### Requirement 14: Win Condition Inference (Advisory)

**User Story:** As a player, I want the Coach to use draft context to make composition-coherent
recommendations, without asking me to select a win condition or strategy type.

#### Acceptance Criteria

1. THE Coach SHALL use the current draft state (own picks, revealed enemy picks, meta context) to
   make recommendations coherent with the emerging composition. Basic directional inference (e.g.,
   the draft is taking shape toward teamfight or early pressure) MAY inform recommendations where
   the evidence is clear.

2. WHERE a directional inference is available, THE Coach MAY use it to increase coherence of
   recommendations. Absence of a clear win condition inference SHALL NOT prevent recommendations
   from being generated.

3. THE Coach SHALL NOT present win condition as a selector or input field for the Player to fill.

4. WHEN the draft is too early or the state is too ambiguous to support a directional inference,
   THE Coach SHALL not force a win condition label and SHALL indicate that the draft is still open.

5. IF a directional inference is available and reliable, THE Coach MAY display it as lightweight
   contextual information — it is never a required output.

   **[Future Intelligence — Deep Win Condition Modeling]:** Full structural inference of win
   condition (teamfight, push, pickoff, scaling, protect-one, etc.), dynamic tracking of
   composition needs, and complete composition-coherence modeling are deferred to a future wave.
   MVP inference is limited to what can be derived reliably from current scoring signals.

---

### Requirement 15: Recommendation UX: Assertive, Compact, Actionable

**User Story:** As a player, I want the Coach's primary recommendation to consist of a primary
action recommendation followed by a short list of concrete hero options, so that I can make a
fast decision under time pressure.

#### Acceptance Criteria

1. THE Coach SHALL display a primary action recommendation (e.g., "Open with Pos5" or "Secure
   this carry now") as the most prominent element, followed by a short list of hero options
   relevant to that action. Each hero option SHALL show 2–3 signal badges (e.g., SAFE,
   TEAMFIGHT, COUNTERS BANNED, GOOD WITH X, YOUR POOL). The shortlist SHALL be cognitively
   manageable — enough options to give real choice without overwhelming.

2. WHEN an exceptional strategic opportunity exists (e.g., a carry's hard counters are banned),
   THE Coach SHALL display an OPPORTUNITY block as a distinct, separate section from the primary
   recommendation — not as part of the shortlist. This block SHALL only appear when there is real
   evidence supporting the opportunity.

3. THE Coach SHALL show signal badges that indicate why the top hero is recommended (e.g., hard
   counter, top meta, team synergy, role need).

4. WHEN confidence in the top recommendation is low, THE Coach SHALL visually distinguish that
   recommendation to indicate lower certainty.

5. THE Coach SHALL present the recommendation in a layout that remains usable within the time
   pressure of a real draft round.

6. THE Coach SHALL NOT present a single hero as the only option unless only one valid option
   exists in the available pool. The shortlist model is the default UX form.

---

### Requirement 16: Safe Core (Contextual Safe-Pick Detection)

**User Story:** As a player, I want the Coach to identify when it is strategically sound to reveal
a core hero early, even before the draft has established the usual support foundation, so that I
can capitalize on favorable conditions when they arise.

#### Acceptance Criteria

1. THE Coach SHALL identify and surface a Safe Core opportunity WHEN contextual evidence suggests
   a core hero can be revealed earlier than the support-first prior would normally suggest.
   Relevant factors include: important hard counters being already banned, remaining hard counters
   still available, the hero's resilience to unfavorable matchups, its ability to remain viable
   without specific support combinations, the difficulty of the enemy building a focused counter
   from the current draft state, and current patch strength. The Coach SHALL NOT require all
   factors to be favorable — the assessment is holistic and contextual.

2. THE Coach SHALL surface the Safe Core opportunity as a distinct signal (e.g., "You can secure
   this carry now — key counters are banned"), separate from the primary recommendation, at any
   point in the draft where the contextual evidence justifies it.

3. THE Coach SHALL NOT restrict the Player to selecting the Safe Core — it is informational only.

   **[Future Intelligence]:** Full composition-need modeling and safe-pick scoring across all
   positions is deferred to a future wave.

---

### Requirement 17: Meta, Counters, and Synergy as Recommendation Inputs

**User Story:** As a player, I want the Coach's recommendations to incorporate current patch meta
data, counter relationships, and team synergy so that I get context-aware draft guidance.

#### Acceptance Criteria

1. THE Coach SHALL incorporate current patch meta win rates as an input to recommendation scoring.

2. THE Coach SHALL incorporate hero counter relationships as an input, weighted by the heroes
   already revealed by the enemy team.

3. THE Coach SHALL incorporate team synergy signals for Own Team's already-revealed heroes as an
   input.

4. THE Coach SHALL combine meta, counter, and synergy inputs coherently — no single signal SHALL
   dominate to the point of overriding all others in all situations.

5. THE Coach SHALL use hero position data (not thematic or archetype role labels) when evaluating
   positional fit.

   **[Future Intelligence — Side-Specific Deep Statistics]:** Side-specific win rate modeling
   (Radiant vs. Dire differential) is deferred to a future wave.

---

### Requirement 18: Draft State Visibility

**User Story:** As a player, I want to see the complete current draft state at all times during the
Simulator so that I have full situational awareness when making decisions.

#### Acceptance Criteria

1. THE Simulator SHALL display all revealed Own Team picks. WHEN a pick has a confirmed position,
   display that position. WHEN a pick is a Flex Hero with unresolved position, display it as FLEX
   with its possible positions (e.g., FLEX 3/4) rather than forcing a single assignment.

2. THE Simulator SHALL display all revealed Enemy Team picks.

3. THE Simulator SHALL display all confirmed bans.

4. THE Simulator SHALL indicate which round is currently active and how many selections remain for
   each team in that round.

5. THE Simulator SHALL clearly distinguish between revealed information and unrevealed slots (shown
   as empty or hidden).

6. THE Simulator SHALL display the current side context (Radiant or Dire) persistently throughout
   the draft.

---

### Requirement 19: Position Does Not Constrain Pick Timing

**User Story:** As a player, I want to select any hero for any position at any pick slot within a
round, so that I can reproduce real Dota draft strategies where a Mid or Carry can be selected in
Round 1.

#### Acceptance Criteria

1. THE Simulator SHALL allow Own Team to pick heroes for any position (Pos 1–5) in any round
   (1, 2, or 3), without enforcing an ordering by position.

2. THE Coach SHALL accept and process any position being filled at any pick slot.

3. THE Coach SHALL not warn the Player about "out of order" position picks.

4. WHEN the Player selects a hero for Pos 1 (Carry) in Round 1, THE Simulator SHALL accept that
   selection normally.

5. THE Simulator SHALL not require the Player to fill support positions before core positions.

---

### Requirement 20: Hero Availability Enforcement

**User Story:** As a player, I want the draft to correctly track which heroes are available so that
I can only select heroes that are actually pickable in the current game state.

#### Acceptance Criteria

1. THE Simulator SHALL maintain a real-time available hero pool for each team that excludes:
   (a) confirmed bans, (b) heroes revealed as picked by either team in a completed round. Hidden
   picks from the current round's opposing side do NOT make a hero unavailable.

2. WHEN a round ends and selections are revealed, THE Simulator SHALL remove all newly revealed
   picks from the available pool for both teams. DURING a blind round, a hero selected internally
   by one team remains in the available pool of the other team — neither team can see the other's
   in-progress selection.

3. WHEN a ban is confirmed, THE Simulator SHALL immediately remove that hero from the available
   pool.

4. THE Coach SHALL only recommend heroes from the current available pool (confirmed bans and
   revealed picks excluded).

5. THE Simulator SHALL prevent the Player from selecting a hero that is confirmed-banned, or was
   revealed as picked in a previous round. Heroes selected by the Enemy Bot in the current blind
   round SHALL remain selectable by Own Team until the round reveals.

6. THE Coach SHALL only recommend heroes from the pool that is visible to the Player — excluding
   confirmed bans and revealed picks. The Coach SHALL NOT exclude heroes from its recommendation
   pool based on unrevealed Enemy Bot selections.

7. WHEN both teams independently select the same hero during a blind round, THE Simulator SHALL
   detect the collision at round resolution and apply the progressive collision mechanic
   (Requirement 1, criterion 5). The collision itself is evidence that hidden picks do not prevent
   same-hero selection attempts.

---

### Requirement 21: Player Personal Position

**User Story:** As a player, I want to declare my personal position before the draft begins so
that D2KIRO knows which of the five Own Team slots represents me and can load my personal Hero
Pool and show my personal options throughout the draft.

#### Acceptance Criteria

1. BEFORE the draft begins, THE Simulator SHALL ask the Player to select their personal position
   from: Carry (Pos 1), Mid (Pos 2), Offlane (Pos 3), Soft Support (Pos 4), Hard Support (Pos 5).

2. THE Coach SHALL use the declared personal position to identify which Own Team slot belongs to
   the Player and to load the appropriate Hero Pool for that position.

3. THE Simulator SHALL display personal-position-specific contextual views (e.g., "YOUR MID NOW",
   "YOUR CARRY NOW") using the declared position throughout the draft.

4. THE declared personal position SHALL NOT constrain when in the draft the Player selects their
   own hero — the Player may fill their personal slot in any pick round (PD-001, PD-020).

5. IF the Player does not declare a personal position, THE Simulator SHALL still function, but
   personal Hero Pool loading and the personal hero view SHALL be unavailable until a position is
   declared.

---

## Deferred — Future Intelligence

The following capabilities are explicitly deferred and must not be included in the MVP:

| Capability | Reason for Deferral |
|---|---|
| Deep win condition inference (beyond advisory) | Requires composition modeling and training data |
| Full composition needs modeling | Dependent on post-draft or mid-draft ML inference |
| Bracket-granular recommendations | Requires player bracket data integration |
| ML / Bayesian inference beyond current scoring | Architecture change, future wave |
| Side-specific deep win-rate statistics | Requires richer data pipeline |
| Post-draft gameplan (itemization, timings) | Separate feature scope |
| Live integration (GSI / OCR) | Hardware integration layer, not in scope |
| Player proficiency models (auto-learned) | Requires longitudinal data collection |
| Automatic personal learning / feedback loop | Separate product feature |
