# F2 — requirements: strategic intelligence (tempo, objectives, win conditions)

Status: **draft for approval**. Nothing here is implemented. Baseline: `checkpoint/f1-v1` (F1 TECHNICAL REFERENCE, NO STRATEGIC CERTIFICATION). Comparison unit: the **same pick moment** (`docs/checkpoints/README.md`, `docs/f2/DECISION_REPLAY_PILOT.md`).

## 1. The problem F2 attacks

F1 recommends heroes that are legal, role-feasible, honest about their evidence and (in the closing window) aware of initiation, catch and damage mix. The judge review found what F1 does **not** do: its cards say "works as [role]", not "why this hero helps win this draft now". F2 adds the missing reading of the draft as a plan:

- **Tempo** — does this team win early, or does it need the game to go long?
- **Objectives** — can this draft turn an advantage into towers and Roshan?
- **Win condition** — what is the one way this team wins, and does the pick serve it?

## 2. What the data can and cannot say today

`capabilities.json` (hand-curated, 124 heroes; Ringmaster, Kez and Largo are uncurated) gives, per hero: `damageType`, `hasInitiation`, `hasCatch`, `hasWaveclear`, and levels `low|medium|high` for `structuralDamage`, `teamfight`, `scaling`. The engine already turns them into team gaps (`draft-paths/gaps.ts`), 4 draft archetypes (`push/teamfight/pickoff/scaling`, `archetype_fit`) and a stage-aware closing rule (TSK-253).

- **Objectives** has real ingredients: `structuralDamage`, `hasWaveclear`.
- **Win condition** has a vocabulary: the 4 archetypes.
- **Tempo has no direct field.** There is no early-power attribute. `scaling: low` is only a proxy for "front-loaded". A reliable tempo reading needs a curated field (a decision for the curator, not for code). Until then tempo claims must be marked as inferred.

## 3. Falsifiable hypotheses

Each states what would prove it wrong. Thresholds marked *(proposed)* are fixed **before** the first run and recorded in the experiment file.

| ID | Hypothesis | Measured on the same moments | Falsified if |
| --- | --- | --- | --- |
| **H-OBJ** | A team that reaches its last 2 picks unable to take structures (`structural_damage` gap open) is better served if the top-3 includes a hero that fills it, the way TSK-253 did for initiation. | *ObjectiveGapFill@3*: share of closing-window moments with the gap open where the top-3 contains a curated hero that fills it | F2 does not raise ObjectiveGapFill@3 by at least +20 points *(proposed)* over F1, or the extra fillers carry more hard-counter exposure |
| **H-TEMPO** | When the team's picks are all `scaling: high` with no initiation/teamfight, the advice should protect the early game; when they are all front-loaded, it should protect the late game. | share of such moments whose top-3 contains a hero that closes the imbalance | needs the curated tempo field first; **not testable yet** |
| **H-WIN** | Naming the team's current win condition (one of the 4 archetypes, from its own picks) and showing which candidate serves it makes the card decision-useful. | blind judge A/B on changed explanations: "which card helps me decide?" | judge prefers F1 or reports no difference on ≥ 60 % of pairs *(proposed)* |

## 4. Metrics (all computed from replay results, none new to the engine)

- **ObjectiveGapFill@3**, **InitiationGapFill@3** (the existing I6b as control).
- **ChangedDecisionRate**: moments whose recommended position or top-3 differ from F1, split into *allowed to change* and *must not change*.
- **ExposureDelta**: hard-counter exposure of the top-3 among changed moments (`exposed_to_counter` cards, F2 minus F1).
- **Hard invariants** (carried from F1, must stay 0): illegal hero, role infeasible, position-precedence divergence, counter without warning, incoherent basis, CRITICAL_GAP without proof.
- **UncuratedPromotion**: an uncurated hero (Ringmaster, Kez, Largo) entering a top-3 *because of* a capability it cannot be shown to have. Must be 0.
- **Judge**: blind A/B on changed moments only, salted key commitment from the start, packet showing the Board column's cards and every CRITICAL_GAP card.

## 5. First experiment (one change only): F2-E1, structural damage becomes a critical gap in the closing window

**The change.** One constant: add `"structural_damage"` to `CRITICAL_GAP_KINDS` (`apps/engine/src/draft-paths/gaps.ts`). Same machinery as TSK-253: inside the closing window (≤ 2 own picks left, all own picks curated) an open structural-damage gap becomes critical, so `team_synergy` weights it, and a card that does not fill it carries `CRITICAL_GAP` with its proof. No weight changes, no new signal, no new file, no `apps/web` change.

**Why this one.** It targets *objectives*, the part of F2 with real data; it is one line; it reuses a mechanism already validated on initiation/catch; and its effect is confined to a state set we can name in advance.

**What may and may not change.**

- *Must not change* (strict, byte-identical against F1): every moment that is not in the closing window, or whose own picks include an uncurated hero, or whose structural-damage gap is closed **and** whose critical set is otherwise unchanged. This is the zero-regression lock.
- *Allowed to change*: closing-window moments with the structural gap open. Note that `criticalPressure = critical.length / picksLeft`, so a moment that already had an initiation gap and also has a structural gap can change through higher pressure; that set is reported separately.

**Pre-registered predictions** *(thresholds proposed, fixed before the run)*:

1. **P0 — prevalence first.** In the closing window, the gap is open in ≥ 5 % of moments. Below that, the experiment is not worth a code change; stop. (Pilot: 2 of 8 closing-window moments. Too few to conclude; the 622-moment set decides.)
2. **P1** — ObjectiveGapFill@3 rises by ≥ 20 points over F1 on the allowed-to-change set.
3. **P2** — zero changes outside the allowed set.
4. **P3** — ExposureDelta ≤ 0 on changed moments.
5. **P4** — hard invariants 0, UncuratedPromotion 0.

**Procedure.**

1. Capture the replay set from the 120 AUDIT drafts under F1 (needs your go-ahead; it drives drafts once).
2. Measure P0 on F1 alone; no code yet.
3. If P0 holds, make the one-line change on this branch, add the regression lock test with concrete numbers (red first), and replay the same set.
4. Compare with `--compare` and report P1–P4 as numbers.
5. Only then, a blind A/B packet for the changed moments.

## 6. Out of scope for E1 (queued, one at a time)

E2 tempo reading (blocked on the curated field) · E3 win-condition label on cards (needs an additive V4 field and the `apps/web` mirror) · any weight change (V7) · the four-version lab · full autonomous drafts as a secondary test.

## 7. Risks

- **Tiny effect.** The gap may be rare; P0 exists to find out before coding.
- **Curated levels are coarse** (3 levels, hand-set). A "fills the gap" claim is only as good as `capabilities.json`; the same file is the judge and the defendant. The blind A/B is what breaks that circle.
- **Uncurated heroes** can neither be flagged nor credited; they must not be promoted by absence of a flag.
- **The pilot is small and F1-shaped.** The simulator's enemy is scripted and its states are realistic, not human.
- **No CI** on these branches and the Companion tests time out: every push needs the gate log (see `DEV_GATES.md`).
- **Contract freeze.** Anything beyond E1 that adds a field to V4 must be additive and mirrored in `apps/web` in the same change.

## 8. Approval criteria

F2-E1 is approved for integration when, on the full replay set: P0–P4 hold with the numbers recorded; the regression lock test is red-then-green; engine, scripts, `tsc` (both), web lint and web tests pass except the documented Companion tests, each reported by name; the manifest of the experiment (commit, snapshot hash, replay-set hash, thresholds) is published before the result; and a human judge has seen the blind A/B. Any failed prediction is reported as failed, not re-tuned after the fact.
