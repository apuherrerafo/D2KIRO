# F2-E1 follow-up: why Kez was promoted, what the other 58 changes were, and whether E1b is worth building

Nothing here changes scoring, thresholds or `capabilities.json`. The verdict of E1 stays **FAIL** (see `F2_E1_RESULT.md`). Numbers come from the frozen set (`eval/replay/f2-set-v1.*`) and from `eval/replay/f2-e1.kez-probe.json` / `f2-e1.churn.json`, both reproducible with the tools in `scripts/p1-exam/`. The probe applies E1 by toggling `CRITICAL_GAP_KINDS` at runtime, so it runs on the clean F1 code with no engine edit.

## 1. Why an uncurated hero enters the top-3 (exact mechanism)

Kez has no entry in `capabilities.json`, so `team_synergy` returns `raw: null` for him ("no capabilities for this hero"). That is deliberate and documented: unknown is not lacking.

What the mixer then does (`apps/engine/src/signals/mix.ts`, `mixCandidateByState`): for a signal that votes in the state, a candidate with `raw: null` gets `weighted = w' × stateMean`, where `stateMean` is the mean of `normalized` over the candidates **that do have data** (`stateMeansFor`). `raw` stays `null` in the breakdown; only the score receives the imputed value. Nothing else about Kez changes.

The two P4 moments, Pos 1, `w'(team_synergy) = 0.1477`:

| | F1 | E1 |
| --- | --- | --- |
| `team_synergy` normalized of known candidates (29 with data) | non-fillers 0, fillers 14.3 | non-fillers 0, fillers 57.1 |
| candidates above the mean | 17 of 29 | 17 of 29 |
| state mean μ (AUDIT028 / AUDIT055) | 8.37 / 8.16 | **33.50 / 32.65** |
| Kez's imputed contribution `w'·μ` | 1.24 / 1.21 | **4.95 / 4.82** |
| a known non-filler's contribution | 0 | 0 |
| Kez's final score (AUDIT028 / AUDIT055) | 73.21 / 72.78 | **76.92 / 76.39** |
| the hero he displaces from the top-3 (score in F1) | 75.76 (Lifestealer) / 74.12 (Morphling) | – |

Plain reading:

1. E1 does **not** penalise anyone: known non-fillers score 0 on `team_synergy` in F1 and in E1.
2. E1 makes the critical gap weigh more, so fillers jump from 14.3 to 57.1. More than half of the credible Pos 1 field are structural fillers (`medium` or `high` counts), so the **mean** jumps four times.
3. Kez is imputed that mean: 1.24 points in F1 became 4.95 in E1. The gap between his score and the #3 hero was 2.6 and 1.3 points; he gained 3.7 and crossed it.
4. So the unknown hero is treated as "an average member of a population that has just become polarised", which is worth more than a known non-filler. The same arithmetic applies to Ringmaster and Largo.

Not a bug in E1's one line; it is how the existing neutral imputation interacts with a rule that polarises a signal. It also existed in F1 (Kez was on 35 cards), only too small to cross a rank.

**What this says about fixes (not assuming "penalise the unknown"):**

| Option | Effect | Cost / risk |
| --- | --- | --- |
| Curate the three heroes (see `CURATION_PROPOSALS.md`) | removes the null; Kez would be scored as a non-filler (structural `low`), 0 like the others | needs owner values; changes `capabilities.json` and therefore requires re-measuring F1 on the frozen set ("F1c") |
| Cap the imputed mean for a polarised signal (the engine already caps `counter` at 50) | bounds the advantage | changes scoring; needs its own pre-registered experiment; a cap only hides the symptom if the signal keeps polarising |
| Penalise unknown automatically | – | contradicts the documented semantic (unknown ≠ lacking) and would suppress heroes exactly when we know least; **not recommended** |

Recommendation: curate first. It is a data fix, it addresses the cause, and it is reversible.

## 2. The 58 top-3 changes that did not improve structural coverage

Of 89 applicable moments, 72 changed their top-3; 14 gained coverage; **58 did not**. Classified by rule (`scripts/p1-exam/f2-e1-churn.ts`, labels only, no strategy judgement):

| Class | Moments | Meaning | Reading |
| --- | --- | --- | --- |
| REORDER_ONLY | 12 | same three heroes, different order | **innocuous** for the shown set |
| FILLER_FOR_NONFILLER | 35 | F1 already had a structural hero; E1 swaps a non-filler for another structural hero; no open gap lost, exposure not up | **consistent with the mechanism, beyond the metric**: coverage needs one filler, E1 asks for more. Defensible only if the judge likes the swaps; otherwise it is over-correction |
| POSSIBLE_REGRESSION | 8 | no open gap lost, but hard-counter exposure of the top-3 **rose** (+1 in seven moments, +2 in one) | **possible regression**; none loses a gap |
| UNCURATED_ENTRY | 1 | Kez enters without the structural gap being the reason | **P4 risk** |
| STILL_UNFILLED | 2 | top-3 changed, neither version covers the gap (one is the second Kez case) | churn with no benefit |

Details worth knowing:

- The 8 possible regressions are `Earth Spirit → Dragon Knight`, `Mars → Dragon Knight`, `Anti-Mage → Juggernaut`, `Void Spirit → Arc Warden`, `Phantom Assassin → Sven`, and three double swaps involving Void Spirit/Ember Spirit/Outworld Destroyer/Earthshaker leaving for Dragon Knight/Arc Warden/Tinker/Sniper. The aggregate P3 passed (192 → 173) because the 35 filler swaps lowered exposure (−1 or −2 in 14 of them) and masked these.
- In FILLER_FOR_NONFILLER the heroes entering are Terrorblade ×5, Arc Warden ×4, Dragon Knight ×4, Juggernaut ×3; the ones leaving are Templar Assassin ×4, Necrophos ×4, Centaur Warrunner ×3, Morphling ×3. Replacing a teamfight initiator (Centaur Warrunner) by a pusher is the kind of trade only the blind judge can call.
- Why the churn exists: the scorer ranks candidates one by one. It cannot know that the top-3 already holds a structural hero, so every filler keeps getting the bonus. A rule that is correct per candidate is excessive per set.

Overall: of 72 changes, **14 intended**, **12 harmless**, **35 consistent but unnecessary**, **8 possibly worse**, **3 not attributable to the objective**.

## 3. Does E1b deserve to be built?

Decision rule, to be applied after the blind judgement (not before):

- **If the judge prefers E1's lists clearly** (say ≥ 10 of 16, counting only A/B decisions, no harmful hero reported): E1b is worth a pre-registered attempt, because the direction is right and only the execution is blunt.
- **If the judge prefers F1 or sees no difference**: stop. More structural coverage did not help a human Dota judge, and the experiment closes as a negative result for this lever.
- **Mixed**: build nothing; read the judge's reasons on the 8 exposure cases and the Kez cases first.

If it proceeds, the findings above fix three constraints for the design (not the design itself, which waits for the judge):

1. **Precondition: the three heroes curated** (or the imputation question answered), otherwise P4 fails again for the same reason.
2. **Set-aware or bounded**: the correction must not keep paying fillers once one is in the top-3. The 58 no-gain changes are the cost to beat; a design that moves only the 21 moments F1 left unfilled is the natural benchmark.
3. **A realistic target**: F1 already covers 76.4 %; the reachable gain is 23.6 points, so a target of +20 is almost all of it. Set it from the measured headroom, plus a churn bound and a per-hero exposure guard.

## 4. Reserved states for independent validation

The frozen set used seeds `AUDIT001`–`AUDIT060` (120 drafts, both sides). **Seeds `AUDIT061`–`AUDIT120` are reserved**: they have never been run, captured or inspected. They are the held-out set for E1b and must not be captured before E1b's criteria are written and committed. Capture will use the same tooling under the then-frozen F1 (or F1c) code, with the same collision limitation reported up front. Nothing from the E1 frozen set may be used to tune E1b's thresholds beyond what this document already states.

## 5. Criteria that must be committed before E1b is run

(To be filled and committed only after the blind judgement.) Required fields: the exact change; the baseline version (F1 or F1c); the denominators and the minimum applicable moments; the headroom-based target; a churn bound (changed top-3 / applicable moments); an exposure guard per moment, not only in aggregate; the uncurated-promotion guard; the held-out seeds; and the blind packet with a salted commitment. No threshold is changed after results.
