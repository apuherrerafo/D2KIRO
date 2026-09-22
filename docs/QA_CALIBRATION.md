# QA_CALIBRATION — AP Ranked Roles V1, Wave 5 (Task 37)

**Nature: a RECORD of observed behaviour, not a calibration.** Wave 5 is a certification wave. Task 37 asks for thresholds to be
"calibrated"; that would require setting product thresholds, and the wave rules forbid inventing them casually. So this document
(1) records what the shipped code does today and what real-data runs observed, (2) states which threshold constants already exist and
who approved them, and (3) lists every threshold or behaviour that still needs a **Product Owner decision** as *unresolved* — none was
set, changed, or tuned here. No product code was changed for this document.

- Evidence source: `docs/diagnostics/WAVE5_AUTOMATED_EVIDENCE.md` (regenerate with `bun run wave5:evidence`; counts are deterministic,
  latencies vary). 600 complete Simulator drafts, 3,112 Coach decision states, real V6 over the real snapshot, real curated data.
- Population caveat (applies to every number below): Simulator bans, a scripted Enemy Bot, three scripted Player policies
  (`follow-coach`, `varied`, `deviate`), one sync-stale mono-patch snapshot. Rates describe **this simulator**, not live play.

---

## 1. Thresholds named in `tasks.md` — current state

| Deferred threshold (tasks.md Task 37) | State in the code today | Approved by | Status |
|---|---|---|---|
| **Safe Core threshold** | `MIN_CURATED_HARD_COUNTER_COVERAGE = 2` distinct curated hard counters, all unavailable to the opponent, ≥ 1 actually banned, no curated hard/medium counter already revealed, `sourceType = CURATED` only (`coach/safe-core.ts`). Derived from the first Wave 4A incidence run; **no target percentage was set**. | Product Owner (Wave 4A) | **Approved — not touched.** Manual scenarios A/B/C hold (`bun run test:wave4a:smoke`). Natural incidence, this run: 3 windows in 3,112 states (0.1%); 2 in the 2,099-state Wave 4A population (unchanged); `deviate` adds 1. |
| **Flex entropy cutoff** | **None exists.** "Flex" is the repo's own definition: the curated catalog registers the hero in **≥ 2 positions**, with no minimum share (`curatedFlexPositions`, `coach/hero-card.ts`; `deriveFlexDistribution` for beliefs). | — | **Unresolved (U2).** |
| **"Best outside your pool" score gap** | **The feature is not implemented** — see U3. `outsidePoolRecommendation` exists only as an optional field in the output type (declared in Wave 2, "full logic in Wave 3"); nothing populates it and no component renders it. | — | **Unresolved (U3) — spec gap, not a threshold.** |
| **Shortlist size** | `COACH_SHORTLIST_SIZE = 5` (task 18's stated initial default, configurable per call). | Wave 2 (task 18) | Observed: 5 heroes in 95.4% of states, 4 in 4.2% (small legal universes), 0 in 0.4% (U1). **The visual review at 3/4/5 that Task 37 asks for was not done — it needs a human (U4).** |
| **Pool-break threshold** | n/a — belongs to the un-implemented outside-pool section (U3). | — | Unresolved with U3. |

---

## 2. Observed recommendation patterns (3,112 states)

### 2.1 Primary action
| Observation | Value |
|---|---|
| Strategy kinds ever produced | `REVEAL_POSITION` 3,068 · `REVEAL_FLEX` 44 · **`REVEAL_HERO`, `DEFER_POSITION`, `OPPORTUNITY` (as a primary action): 0** |
| **Support-first frequency (Round-1 opening, before any own pick)** | **600 of 600 openings (100%)** name a support position: Pos5 in 57.0%, Pos4 in 43.0%. |
| Later rounds | Round 2: `REVEAL_POSITION` 1,206, `REVEAL_FLEX` 14. Round 3: `REVEAL_POSITION` 577, `REVEAL_FLEX` 30. |
| `REVEAL_FLEX` only on trajectories where the Player had already ignored the advice | 44 states, **all in `deviate` drafts; 0 in ~2,100 `follow-coach`/`varied` states.** |

The support-first prior is intended (PD support-first); what is unobserved is *any* case where the Coach advises revealing a core or a
specific hero. Whether "always support first" is right, and why the hero-level / defer strategies never fire, is a domain question for
the Dota Judge and the Product Owner (U6). Nothing was tuned.

### 2.2 Shortlist cards
- Role status: `CONFIRMED_FORCED` 51.5% · `LIKELY` 44.5% · `UNRESOLVED` 4.0% (the UI prints "Rol por definir" for the last).
- **Badges are near-universal**: `POSITION_FIT` on 100.0% of 15,374 cards, `COUNTER` 91.2%, `FLEX` 54.0%, `SYNERGY` 45.7%. A badge that
  is on every card carries little information (U4).

### 2.3 Flex
- An **own** Flex belief (≥ 2 plausible positions) is on screen in **74.3%** of decision states; an **enemy** one in **60.3%**.
  Because the definition has no minimum share, a hero with a marginal secondary position is Flex like a genuinely versatile one (U2).
- Enemy roles are **never** presented as confirmed: 0 of 3,112 states (`CONFIRMED` is reserved for a Player declaration). Enemy beliefs
  stay `LIKELY`; recomputing 5× does not harden them (engine suite `wave5.certification.test.ts`).

### 2.4 Hero Pool / personal view
- `TU … AHORA` present in 100% of states (every draft had a personal position and a 5-hero pool).
- With two different pools on the same visible draft: **team surface identical in 420/420 states**; the personal view differed in 64.3%.
- `outsidePoolRecommendation`: never produced (not implemented, U3).

### 2.5 Degradations the engine reported
| Reason | States | Note |
|---|---|---|
| `stale_meta` | 3,112 | Forced true in this run (snapshot is 2 days old). |
| `ROLE_ASSIGNMENT_IMPOSSIBLE` | 598 (19.2%) | Some candidate pairs have no joint role assignment; shown to the Player as `confirmaciones de posición contradictorias: []` (U5). |
| `COMPOUND_FALLBACK_SINGLE_STEP` | 27 (0.9%) | The Wave 4A single-step fallback. Every such state had a non-empty shortlist and the draft completed. |
| `NO_LEGAL_HERO_UNIVERSE` | 11 (0.4%) | See U1. |

### 2.6 Safe Core
0.1% of states (3 windows / 3 drafts): 2 in `follow-coach` (the two Wave 4A windows, reproduced exactly) and 1 in `deviate`. Each had exactly 2
curated hard counters, source `CURATED`, on a resolved core (Storm Spirit, Leshrac, Tinker -- all mid-lane heroes); composition: two "1 banned · 1 own pick" (mixed wording) and
one "2 banned". Rounds 2, 2 and 3 — never Round 1. The run fails if any window ever violates the approved rule (source ≠ CURATED,
< 2 hard counters, or 0 banned); none did.

### 2.7 Latency (real Coach route, in-process, snapshot in memory, no network)
Three full runs during Wave 5 (3,112 samples each, development machine): p50 7.6–9.7 ms · p95 35.8–43.1 ms · p99 44.5–49.2 ms · max 63.5–70.5 ms —
far under the 300 ms p95 budget (`SPEC.md` §4). The numbers vary run to run; `WAVE5_AUTOMATED_EVIDENCE.md` §7 holds the latest run.

---

## 3. Known data limitations (unchanged by Wave 5)

- Statistical meta: snapshot labelled `7.41e`, sync-stale, **no verified patch window** (OpenDota exposes no patch column; `WAVE4_DATA_READINESS.md` §7). The ruleset axis is `7.41f`; the two are never conflated.
- `hero-positions.json`: curated Dota2ProTracker scrape (~2026-08-22), not patch-verified; `hero-counters.json`: hand-curated, no patch claim. Safe Core inherits both and says "curated".
- No side (Radiant/Dire) intelligence (Task 26), no one-ply (Task 27), no verified statistical counters, no composition/win-condition model, no rank/bracket model — intentionally out of the MVP.
- No real ban-rate data: Simulator bans come from pick volume as a proxy.

---

## 4. UNRESOLVED — needs a Product Owner decision (nothing below was set or changed in Wave 5)

| # | Item | Why it is a decision, not a bug fix |
|---|---|---|
| **U1** | **The Coach has no hero ranking when the Player's own picks are role-infeasible.** 11 states (0.4%), all in `deviate` drafts (`follow-coach`/`varied`: 0): e.g. the Player drafted two Pos1-only carries (Luna + Sven). Independently verified: in 11/11 the own picks admit no distinct-position assignment, so the engine is right. The answer is explicit, never silent (role-level action, confidence `baja`, honest rationale "No hay ranking de héroes disponible para este estado"), the personal view stays, and the draft completes. This is the Wave 4A-approved behaviour (compound-fallback tests 5a/5b). | Offering a best-effort low-confidence list instead changes product semantics (what a role-infeasible team should be told). |
| **U2** | **"Flex" is applied very broadly** (any hero with a second curated position: 74% of states show an own Flex hero). No entropy / minimum-share cutoff exists. | Choosing a cutoff is exactly the deferred Task-37 threshold. Needs domain review of which heroes should count as Flex. |
| **U3** | **Requirement 11.3 / PD-010 / Tasks 21 & 32 — the explicit "Best outside your pool" recommendation is not implemented** (type-only). Task 32's acceptance ("`outsidePoolRecommendation` appears with a hero outside the pool") **cannot be certified.** Today the personal ranking lists pool heroes marked "Tu pool" next to non-pool heroes, which informs the Player implicitly but is not the explicit, labeled section PD-010 describes. | New feature + a new "satisfactory answer" threshold. It is not in the frozen MVP list, but it *is* an approved requirement — the Product Owner must either accept it as a documented MVP limitation or schedule it (V1.1). Global STOP condition 1 (contradiction with requirements/product-decisions) is escalated here, not silently waived. |
| **U4** | **Shortlist size 3/4/5 visual review and badge informativeness.** | Needs a human at the screen (Task 35 territory); badges that appear on ~every card may deserve a rule change. |
| **U5** | **Engine-authored degradation text is printed verbatim to the Player**: `V6 degraded flag: stale_meta` (every stale-data screen), `confirmaciones de posición contradictorias: []` (≈19% of states, with an empty-list artefact), `el shortlist no sobrevivió la post-validación final contra el estado`. | Correct Player-facing wording depends on what each reason means to a Player — a copy/product decision. Not changed. |
| **U6** | **Support-first fires in 100% of Round-1 openings; `REVEAL_HERO`, `DEFER_POSITION` and a primary `OPPORTUNITY` never occur.** | Domain judgement (the Dota Judge's Q1/Q2), not a numeric fix. |
