# F2-E1 — result: **FAIL** (numeric), blind evaluation pending

Experiment: add `"structural_damage"` to `CRITICAL_GAP_KINDS` (one constant). Rules were committed before the capture and before the change (`eval/replay/f2-e1.rules.json`, sha256 `d5dbc085…`). No threshold was changed after seeing results.

## 1. Frozen set

`eval/replay/f2-set-v1.manifest.json`. **561 valid moments** from the 120 AUDIT drafts (exam: 622 decision states). 61 states from 18 drafts are out: after a collision that changed the bans the recipe cannot be replayed, so those states are skipped, not repaired (this under-represents drafts with a pick collision). By round 240 / 218 / 103; both sides; Player positions 1–5 balanced.

| Check | Result |
| --- | --- |
| Engine under test equals `checkpoint/f1-v1` (nothing under `apps/` differs) | yes |
| State rebuilt = state captured (fingerprint, 561 moments) | 561/561 |
| **F1 vs F1**, two processes | **561/561 identical**, result files byte-identical |
| Hidden enemy hero inside the visible state / commands from later rounds | 0 / 0 |
| Control: only the E1 constant reverted on the F2 branch | reproduces F1 561/561 → the differences below come from that one constant |

## 2. P0 — prevalence (measured on F1 alone, before any change)

Eligible moments (closing window, every own pick curated): **192**. Structural-damage gap open: **89**. Prevalence **46.35 %** (≥ 5 %) → **PASS**. By picks left: 1 pick 31/92 (33.7 %), 2 picks 58/100 (58.0 %).

## 3. F1 vs F1+E1 on the same 561 moments

Allowed-to-change set A = 89 (of which A2 = 10 already had another critical gap). Must-not-change set B = 472.

| Prediction | Denominator | F1 | E1 | Verdict |
| --- | --- | --- | --- | --- |
| **P1** gap coverage in the top-3 (Board column of the recommended position) | A = 89 | 68 (76.40 %) | 82 (92.13 %) | **+15.73 pp < +20 → FAIL** |
| **P2** changes outside A | B = 472 | – | 0 | PASS |
| **P3** hard-counter exposure of the top-3, summed over A | A = 89 | 192 | 173 (−19) | PASS |
| **P4** illegal heroes / CRITICAL_GAP without proof / missing | 561 | – | 0 / 0 / 0 | clean |
| **P4** uncurated hero entering a top-3 | 561 | – | **2** (Kez, both Pos 1) | **FAIL** |
| **P5** initiation (critical in 23 moments) | 23 | 91.30 % | 91.30 % | PASS |
| **P5** catch (1 moment) · damage mix (8 moments) | 1 · 8 | 100 % · 100 % | 100 % · 100 % | INCONCLUSIVE (fewer than 10) |
| M1 adverse statistical counters in the top-3 (3 thresholds, unchanged rules) | A | 0 / 0 / 0 | 0 / 0 / 0 | reported only |

**Verdict by the frozen rules: FAIL** (P1 and P4). Nothing is retuned.

Why P1 failed, stated plainly: F1 already filled the gap in 76.4 % of the cases, so the maximum possible gain was 23.6 points and a +20 target needed 96.4 % (86 of 89). The target was written before the baseline was known. E1 got 82. That is a flaw in how the target was set, not a reason to move it; it is why the next experiment is pre-registered again, not rescued.

## 4. What changed

- **Improvements.** 14 of the 21 moments where F1's top-3 had no structural hero now have one; 0 moments lost one; 68 stayed filled; 7 still unfilled (all with 4–16 credible structural heroes available at that position, none was raised enough). In 35 of 89 moments the #1 changed, and in 34 of them the new #1 fills the gap. The recommended position never changed (0/89).
- **Churn.** The top-3 changed in 72 of 89 applicable moments (81 %), but only 14 gained coverage: **58 moments changed their top-3 without improving the measured gap**. 16 more changed only their reasons or risks. Cards flagged `CRITICAL_GAP`: 7 moments under F1, 79 under E1.
- **Regressions.** None of the pre-registered kind (no exposure increase, no other gap hurt, nothing outside A). The cost is the churn above and the uncurated promotions.
- **The Kez finding (P4).** In `follow-coach:AUDIT028:radiant#3` (team Crystal Maiden, Nyx Assassin, Dawnbreaker) and `follow-coach:AUDIT055:radiant#3` (Oracle, Snapfire, Timbersaw), Kez enters the Pos 1 top-3. Kez has no curated capabilities, so it carries no `team_synergy` and is not penalised when E1 raises the weight of the gap for everyone who does not fill it. The mechanism rewards missing data. It exists at F1 too (Kez appeared on 35 cards) but E1 makes it matter in a new place.

## 5. Strategically debatable cases (not judged here)

- Heroes entering the top-3 most often: Dragon Knight ×11, Arc Warden ×8, Terrorblade ×7, Juggernaut ×4, Snapfire ×4, Tinker ×4. Leaving most often: Necrophos ×6, Void Spirit ×5, Earth Spirit ×5, Templar Assassin ×5, Morphling ×4. Trading mobile or utility mids for pushers fits "objectives" on paper; whether it is the right call for each team is the judge's question, not a coverage number.
- "Fills the gap" means `structuralDamage` is `medium` or `high` in a 3-level hand-curated field. A hero counted as a filler may not actually take towers.
- In 7 of the 89 moments no filler reached the top-3 even with one available: the mechanism is a weight, not a rule, and at Pos 4/5 position fit dominates.

## 6. Blind evaluation of the modified decisions

`eval/replay/f2-e1.judge-packet.md`: 16 of the 72 moments whose top-3 changed (the two Kez moments are pinned; the rest by a seeded order). A/B anonymous, no risk annotations (a `CRITICAL_GAP` line would reveal the version), no mention of structures. The key is private, outside the repository, **not opened**; the packet carries a salted commitment. **Pending: the judge has not answered.** A numeric FAIL is not overturned by the judge, and a judge's preference would not turn higher coverage into proven strategy; it would only decide whether a corrected experiment is worth pre-registering.

## 7. Recommendation

**Discard E1 as it stands: do not carry it into the F2 line.** Keep the commit `39f011e` and these files as a documented, reproducible negative result; do not publish it without review.

What the experiment bought: the replay harness works end to end; the one-line mechanism does what it says (14 gains, 0 losses, zero change outside scope, exposure down); and it exposed a design risk worth fixing first — **uncurated heroes gain from stricter gap rules**.

Next, one experiment at a time, each pre-registered with the baseline in hand:

1. Curate Ringmaster, Kez and Largo (a curation decision, yours), or treat unknown capabilities as neutral in `team_synergy`. This addresses P4 at its root and is the precondition for any gap rule.
2. Only then a corrected structural-gap experiment with a target set from the measured headroom (23.6 points) and a churn bound, using this same frozen set.
