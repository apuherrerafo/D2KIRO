# WAVE5_PRODUCT_CERTIFICATION — AP Ranked Roles V1

**Release-candidate status: `READY_FOR_DOTA_JUDGE`.** Technical/product certification of what was built **passes**. **The MVP is NOT declared
PASS**: it still needs the independent Dota-quality review, the two human tasks (35, 36), and the Product Owner decisions still pending in
§7 (U2, U4, U6, and the third U5 text). U3 and U1 were decided by the Product Owner (see §7 and §7A); the release-hardening pass is §7A.

- **Git base:** `r1/product-certification` @ `6c9e5fffe8531a3f6d034af285fef911be2d09a4` (`feat(coach): add curated safe core opportunities`), working tree **uncommitted**, nothing pushed/merged.
- **Environment:** Windows 11, i7-12700K ×20, 31.7 GiB, Bun 1.4.2, headless Chromium, production web build, real engine (`index.e2e.ts`).
- **Scope certified (frozen MVP):** Ranked Roles AP Simulator, Radiant/Dire, required personal position Pos1–5, ≤ 4 ban preferences, blind 2+2/2+2/1+1, five Player-controlled allied seats, coherent Enemy Bot, timers/gold penalty, collisions, perspective-safe Coach, continuous recompute, team Primary Action + shortlist, `TU [ROLE] AHORA`, personal Hero Pool, Own-Flex assignment, enemy role uncertainty, curated Safe Core, compound → single-step fallback.
- **Intentionally deferred (not failures):** Task 26 side context · Task 27 one-ply · verified current-patch statistical counters · deep composition model · rank/bracket intelligence · new V6 weights. Nothing of these was touched.
- **Not certified here:** whether the advice is *good Dota* — `docs/diagnostics/WAVE5_DOTA_JUDGE.{md,json}` is the packet for an independent expert. The implementer did not judge.

---

## 1. Tasks 28–38 (range confirmed from `tasks.md`)

| Task | Result | Evidence / deviation |
|---|---|---|
| **28** Radiant E2E | ✅ | `e2e/wave5-certification.spec.ts` **J1**: PRE_DRAFT → bans → R1 → R2 → R3 → COMPLETE with Pos2 + Hero Pool: opening Coach, `TU MID AHORA`, first allied pick (a Flex hero) → recompute *before* allied #2, enemy reveal → recompute, a legal hero that ignores the advice, Own-Flex assignment, Team/Personal pool swap, timer counts down each round. **Path deviation:** tasks.md says `apps/web/e2e/`; the repo's Playwright `testDir` is `./e2e`. |
| **29** Dire E2E | ✅ | **J2** (Dire, Pos5, support pool) + **J3** symmetry (same output shape, triggers, one stable perspective per journey, every command is a Dire seal, no pool badge on the team list on either side). **Wording deviation:** `basedOn.perspectiveIdentity` is an opaque hash (`rulesHash({ruleset, viewerSide})`), it never literally contains "dire"; J3 asserts it differs between the sides and is stable within each. |
| **30** Collisions | ✅ | **C1** (collision #1: hero banned, only the colliding seat reopens, round does not advance until both re-select, non-colliding pick locks) · **C3-bot / C3-player** (event #3 → `WAITING_FOR_COLLISION_AUTHORITY`; the side the store accepted first keeps the hero; loser re-selects; round then advances). Real HTTP through the `/engine` proxy with the existing forced-Enemy-Bot seam. Wave 1's browser collision scenario still runs in `test:wave1:smoke`. |
| **31** Hidden-info suite | ✅ | Audit below; **2 missing cases added**, all 10 present and green (§3). |
| **32** Hero Pool E2E | ⚠️ partial | Pool config → `TU MID AHORA` with `Tu pool` marks → updates each round → pool swap leaves the team surface identical (browser, and 420/420 on real data). Team-level `hero_pool_fit` never applies (a pool would otherwise change the team set — it does not). **The "Best outside your pool" assertion cannot be certified: the feature is not implemented (U3).** |
| **33** Flex E2E | ✅ (own) / n/a (enemy assign) | Own: `FLEX 3/2` shown, assigned through the UI, single position after, incompatible assignment ignored (`202`, belief unchanged), non-own hero refused (`403`). Enemy: shown as uncertainty (`Likely PosX / Possible PosY`), never `CONFIRMED`; the product deliberately has **no enemy-assignment control** (MVP list = "enemy public role uncertainty"), so tasks.md's "Player assigns enemy position" does not apply. **Found + fixed a real bug here (§6).** |
| **34** Seed determinism | ✅ | Existing ban/bot determinism tests kept; added "three seeds each differ from the baseline and each replays identically" (`enemy-bot.test.ts`); **600/600 full drafts replay byte-identically** (§4). |
| **35** Manual QA with PO | ⏳ human | Not performed by design. |
| **36** Dota domain review | ⏳ human | Packet prepared (§8); not self-graded. |
| **37** Threshold QA | ⚠️ record only | `docs/QA_CALIBRATION.md` documents observed behaviour; **no threshold was set** (wave rules). Unresolved items U2–U4. |
| **38** Performance | ✅ | §5. **Deviation:** measured on the real perspective-safe Coach *route* (as instructed), not `buildRecommendationSetV2` via `batch-harness`. |

---

## 2. Automated gates (all at the working tree above)

| Gate | Result |
|---|---|
| `test:wave4a:smoke` / `wave3` (engine+web unit slices) | 218 pass / 0 fail · 218 pass / 0 fail |
| `test:wave2:smoke` | preflight 339/0; browser 4/4 (**see §7-I1: one intermittent failure observed once, not reproduced in a further 144 executions — `WAVE2_INTERMITTENT_REPRO.md`**) |
| `test:wave1:smoke` | preflight 388/0; browser 7/7; soak 20/20 |
| **`test:wave5:smoke`** (new) | preflight 684/0; browser **7/7**; real-data evidence **PASS** |
| Wave 5 browser spec repeated | 28/28 over 4 repeats in one server session, plus 3 separate full 7/7 runs (incl. the smoke) — **0 flakes** (it was red only while the B1 bug and my own test assumptions were being fixed) |
| Full ENGINE | **1445 pass / 0 fail** (baseline 1433; +12) |
| Full WEB | **262 pass / 0 fail** (unchanged count) |
| Full SCRIPTS | **422 pass / 0 fail** (baseline 418; +4) |
| `tsc --noEmit` engine / web | clean / clean |
| `apps/web` lint | 0 errors, 5 warnings (identical to baseline) |
| `verify-simplicity.sh` | ✅ |
| Architecture + perspective-graph guards (coach, recommendation, web simulator, kernel adversarial) | 68 pass / 0 fail |
| `git diff --check` | clean (only git's LF/CRLF notices, `core.autocrlf=true`) |

---

## 3. Hidden-information certification (Task 31)

**design.md §7 / §15 — the ten mandatory cases:**

| # | Case | Covered by |
|---|---|---|
| §7-1 | `project(radiant)` with Dire sealed → `HIDDEN`, no `heroId` | `perspective.test.ts` "la selección sellada del rival aparece como HIDDEN" |
| §7-2 | symmetric from Dire | `ap-availability-symmetry.test.ts` (both `[hider, seeker]` pairs) |
| §7-3 | recommendations/counter signals never see a hidden pick | `perspective-boundary.test.ts` §3-4 + **release matrix** below |
| §7-4 | `project(null)` → all sealed `HIDDEN` | `perspective.test.ts` "un viewer sin lado" |
| §7-5 | `hidden()` returns a new object each call | **added** `perspective.test.ts` (distinct refs + deep-frozen). *Verified red* with a singleton `hidden()`. |
| §15-1 | Dire's sealed Puck: `HIDDEN`, not in `bannedHeroes` | `ap-availability-symmetry.test.ts` |
| §15-2 | `isSealedSelectionLegal(radiant,Puck)` true | `ap-availability-symmetry.test.ts` |
| §15-3 | same side re-sealing Puck → false | `ap-availability-symmetry.test.ts` |
| §15-4 | after collision, Puck illegal | `ap-availability-symmetry.test.ts` |
| §15-5 | a hero the enemy sealed can still be recommended | **added** `perspective-boundary.test.ts` §5b (fixture #1 hero sealed by the enemy stays in the shortlist; output equals a world where the enemy sealed another hero) |

**Release-level twin proofs — three independent layers, all identical before reveal, all divergent after:**

1. **Engine matrix** (`coach/wave5.certification.test.ts`): worlds differing in hidden identities, **Simulator seed**, the enemy's **private positions**, and **sealing order** (Player-first vs enemy-first, HIDDEN-seat count held equal because it is visible) are byte-identical on *every* surface — primary action, shortlist + badges, PersonalHeroView (with Hero Pool), role beliefs, Safe Core (active in these worlds), availability, confidence, provenance, the V2 set — at round start, after own pick #1, after assigning a Flex hero, in round 2 with a revealed enemy Flex hero, and from Dire. *Verified red:* injecting a deliberate leak into `project()` fails 3/3 tests.
2. **Browser/HTTP** (`H.`): two live sessions over the real proxy — byte-identical Coach + V2 set; hidden ids never serialised; after the reveal they diverge and the enemy beliefs name the revealed heroes.
3. **Real data** (`scripts/wave5-certification.ts`): **335/335 twin comparisons identical** (30 base drafts × 2 sides × rounds; 96 player-first cases; different seed ⇒ different Enemy Bot private positions, bans pinned equal); **sensitivity 192/192** — one reveal later the same harness sees the worlds diverge, so the check is not vacuous. 37 base rounds skipped where a collision made twins incomparable (stated, not hidden).

## 4. Soak, determinism, isolation, fallback, Safe Core (real data — `WAVE5_AUTOMATED_EVIDENCE.md`)

Real V6 over the real snapshot (SQLite readonly, zero network), real curated files, real store/routes/bot/Coach; every draft with a personal position (1–5 rotated) and a 5-hero pool. Seeds `AUDIT001…100` × Radiant/Dire × 3 Player policies (`follow-coach`, `varied`, `deviate` = always ignore the advice).

| Measure | Result |
|---|---|
| Drafts complete | **600 / 600** (3,112 Coach states) |
| Empty Coach output without an explicit degradation while a legal option existed | **0** |
| Shortlist proposing a banned/taken hero · duplicate hero (same/cross side) · banned hero on a team | **0 · 0 · 0** |
| Enemy Bot seat holding a hero without evidence for its private position | **0** |
| Non-2xx HTTP status during valid operation | **0** |
| Same-seed byte-identical replay | **600 / 600** |
| **Team/Personal isolation** (pool A vs pool B vs no account, identical visible draft) | team surface identical **420 / 420**; personal view differs in 64% (so the isolation test is not vacuous); 0 pool badges on the team list |
| **Compound fallback** — the 19 drafts that aborted before Wave 4A | **19 / 19 now complete**; 27 Coach states answered with the single-step fallback, all non-empty; genuinely empty legal universe stays an explicit error (`compound-fallback` 5a/5b) |
| **Safe Core** natural incidence | 3 windows / 3,112 states (0.1%); the **2 Wave 4A windows reproduced exactly**; every window CURATED-only, exactly 2 hard counters, ≥ 1 banned; the run fails on any violation. Positive/negative/one-hard-counter/mixed wording/hidden-world/Hero Pool/side invariance remain proven in `safe-core.coach.test.ts` + the matrix (Safe Core active inside the twins). |
| Enemy roles presented as `CONFIRMED` | **0 of 3,112** (only a Player declaration may confirm) |

## 5. Performance (Task 38)

- **Budget:** `SPEC.md` §4 — *Motor de sugerencias ≤ 300 ms (corte duro 500 ms)* and *`computedInMs` bajo 300 ms en el p95* (lines 442, 481); restated in `invariantes.md`. **Sourced, not invented.**
- **Measured:** the real route `getRecommendations(?format=v3, account)` — projection → team V6 → Coach → personal-position V6 with the account pool → V3. In-process, snapshot preloaded, **no network / no external sync** (excluded by construction; the hot path never calls it). Development machine, not Railway.

| Population | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| all (final run) | 3,112 | 7.61 ms | **35.82 ms** | 44.47 ms | 70.46 ms |
| cold (first 25 calls) | 25 | 6.85 | 23.79 | 37.97 | 37.97 |
| warm | 3,087 | 7.62 | 35.82 | 44.73 | 70.46 |

Three complete runs: p95 35.8–43.1 ms, max 63.5–70.5 ms; **0 samples above 300 ms, 0 above 500 ms**. First call in the process 38–64 ms. Outliers are not hidden (max shown). Production budget must still be confirmed on the deployed instance.

## 6. Bugs found and narrow fixes

| # | Bug | Evidence | Fix |
|---|---|---|---|
| **B1** | **Own-Flex assignment silently did nothing in the real product.** `coach-client.ts` posts to `/engine/api/session/protocol/:id/position-assignment`, which was **missing from the `/engine` proxy allowlist** → `404` in Railway and in the browser (the same failure class as TSK-214). Unit/engine tests could not see it; only the browser journey did. | Browser: `POST … 404` (red), then `202`. | One allowlist entry in `apps/web/next.config.ts` + a lock in `next.config.test.ts` (also pins `recommendations`). *Verified red first.* Behaviour was already specified (Task 22/23) — no product decision needed. |

No other product code changed. (Test-only additions: hidden-info audit tests, Wave 5 engine suite, browser spec, scripts.)

## 7. Findings NOT fixed — open items (Product Owner / follow-up)

| ID | Finding | Why not fixed |
|---|---|---|
| **U3** | **Requirement 11.3 / PD-010 / Tasks 21 & 32 — "Best outside your pool" is not implemented** (`outsidePoolRecommendation` is type-only; nothing builds or renders it). | New feature + new threshold; Global STOP #1 (contradiction with requirements) — **escalated**. Not in the frozen MVP list, but an approved requirement: accept as documented limitation or schedule V1.1. **→ DECIDED: deferred to V1.1 (see §7A).** |
| **U1** | The Coach gives **no hero ranking when the Player's own picks are role-infeasible** (e.g. two Pos1-only carries): 11 states/0.4%, only when the Player ignores the Coach (0 in follow/varied). Independently verified as correct; the answer is explicit (`baja`, "No hay ranking de héroes disponible…"), the draft completes. | Approved Wave 4A behaviour; a best-effort list would change semantics. **→ DECIDED: accepted MVP limitation (see §7A).** |
| **U5** | **Raw engine text shown to the Player:** `V6 degraded flag: stale_meta` (every stale screen); `confirmaciones de posición contradictorias: []` (≈19% of states, empty-list artefact); `el shortlist no sobrevivió la post-validación…`. Recorded by the browser suite as `ux-finding`, not asserted away. | Player-facing wording depends on what each reason means — copy decision. **→ (a) and (b) fixed, (c) pending (see §7A).** |
| **UX-1** | **Own-Flex controls are hard to find and ambiguous:** they sit at the very bottom of the Coach panel as tiny underlined text; the row reads `Tu equipo: Kunkka — FLEX 3/2 Pos3 Pos2` before and `Kunkka — Pos2 Pos2 Quitar` after (the position appears twice). | Redesign territory (STOP); screenshots in `test-results/wave5-ux/` (not versioned). **→ Narrow presentation fix applied (see §7A).** |
| **U2/U4/U6** | Flex applied to 74% of states (no min-share cutoff) · badges on ~every card (`POSITION_FIT` 100%, `COUNTER` 91%) · support-first in 100% of R1 openings while `REVEAL_HERO`/`DEFER_POSITION` never occur. | Domain/threshold decisions → `QA_CALIBRATION.md`. |
| **I1** | **One intermittent failure of a Wave 2 browser scenario** (`A. Radiant`, Round 3 heading never appeared) in one `test:wave2:smoke`, right after a cold build; **not reproducible**: 1 rerun + a 10× repeat + 2 further full smokes all green. My only product change (a proxy allowlist entry) is not on that path. Artifacts were overwritten by the next run, so the cause is unconfirmed. **Hypothesis:** V6 has a documented wall-clock 500 ms hard cutoff (`mix.ts:140/970`); a machine stall on a cold start returns partial signals, the Enemy Bot picks differently and a fixed hero plan collides. | Cannot prove; flagged so it is watched. **→ Reproducibility check run (§7A / `WAVE2_INTERMITTENT_REPRO.md`): 0 failures in 144 executions (26 cold builds); NOT reproduced. The hypothesis is neither confirmed nor refuted; recorded as an unresolved low-frequency observation.** |
| **D1** | **Determinism caveat that follows from the same design:** "same seed ⇒ same Enemy Bot picks" holds only while V6 finishes under the 500 ms cutoff. 600/600 replays were identical (max Coach latency 70 ms), but a stalled machine can legally differ. | Documented, intentional engine behaviour. |

## 7A. Release hardening pass (after the technical certification was accepted) — Product Owner decisions and narrow fixes

**Product Owner decisions**

| ID | Decision | Consequence |
|---|---|---|
| **U3** | **INTENTIONAL MVP SCOPE EXCEPTION — "Best outside your pool" is DEFERRED TO V1.1.** The approved product has no calibrated criterion for when an outside-pool hero is sufficiently better to deserve a special callout, and none was invented. | Requirement 11.3 / PD-010 / Task 21 & the outside-pool assertion of Task 32 are **not implemented in the MVP** and are **not certified**. `outsidePoolRecommendation` stays type-only (nothing builds or renders it). `requirements.md` was not rewritten. Until V1.1 the personal ranking simply lists pool heroes marked `Tu pool` next to non-pool heroes. |
| **U1** | **ACCEPTED MVP LIMITATION** — when the Player's own picks are role-infeasible (e.g. two Pos1-only carries) the Coach gives no hero ranking. Accepted **because**: the draft stays operational; the state is explained (role-level action, confidence `baja`, "No hay ranking de héroes disponible para este estado"); no illegal recommendation is fabricated; the Player can keep making legal selections. | No new recommendation strategy for impossible role structures was invented in this pass. Observed only when the Player ignores the Coach (11 states / 0.4%; 0 in follow/varied). |

**Findings U2 / U4 / U5 / U6 — exact definitions** (from `docs/QA_CALIBRATION.md` §4 and §7 above):

- **U2** — *"Flex" is applied very broadly*: any hero with ≥ 2 curated positions counts as Flex (no minimum-share/entropy cutoff exists); an own Flex hero is on screen in 74.3% of decision states (enemy 60.3%). **Pending Product Owner** — choosing a cutoff is the deferred Task-37 threshold and needs domain review.
- **U4** — *Shortlist size 3/4/5 visual review and badge informativeness*: `COACH_SHORTLIST_SIZE = 5` (5 heroes in 95.4% of states); badges are near-universal (`POSITION_FIT` on 100% of 15,374 cards, `COUNTER` 91.2%, `FLEX` 54.0%, `SYNERGY` 45.7%). The 3/4/5 visual review Task 37 asks for was not done. **Pending Product Owner** — needs a human at the screen.
- **U5** — *Engine-authored degradation text printed verbatim to the Player*: (a) `V6 degraded flag: stale_meta` (every stale-data screen), (b) `confirmaciones de posición contradictorias: []` (≈19% of states, empty-list artefact), (c) `el shortlist no sobrevivió la post-validación final contra el estado`. **(a) and (b) were fixed in this pass (below); (c) is still pending** — it appears only when no legal hero survives final validation, was not part of the requested fixes, and is left for the Product Owner.
- **U6** — *Support-first fires in 100% of Round-1 openings; `REVEAL_HERO`, `DEFER_POSITION` and a primary `OPPORTUNITY` never occur* (600/600 openings name Pos5 57.0% / Pos4 43.0%). **Pending Product Owner / Dota Judge (Q1/Q2)** — domain judgement, not a numeric fix.
- **Release-blocking under already-approved behaviour?** None of U2/U4/U6 is a concrete bug: each describes observed behaviour of already-approved rules (Flex definition, `COACH_SHORTLIST_SIZE`, the support-first prior). U5(a)/(b) were player-facing copy defects and are fixed; U5(c) is copy that appears only in the empty-universe state (explicit, not silent).

**Narrow UX fixes (presentation only — no recommendation intelligence, V6 weight, assignment behaviour or role-belief semantics changed)**

| Fix | Before | After |
|---|---|---|
| **stale_meta copy** | `V6 degraded flag: stale_meta` | `Datos de meta desactualizados`. The other legacy V6 flags (`partial_signals`, `unconfirmed_state`, `unknown_format`, `no_signal_available`) get equivalent plain-Spanish lines; an unknown `V6 degraded flag:` detail falls back to `Recomendación con datos limitados`. Staleness is still shown — never hidden. Mapping lives in `apps/web/features/random-draft-simulator/degradation-copy.ts`, keyed on the engine `reason`. |
| **Contradiction notice** | `confirmaciones de posición contradictorias: []` | Zero contradictions → **no notice rendered**. Real contradictions → `Hay posiciones confirmadas que se contradicen entre sí` (no raw list). The engine still reports the degradation; only what the Player reads changed. |
| **Own Flex control** | `Tu equipo: Kunkka — FLEX 3/2` `[Pos3] [Pos2]` → after: `Kunkka — Pos2` `[Pos2] [Quitar]` (position twice, tiny underlined text) | `Tu equipo: Kunkka · FLEX 3/2` `[Asignar Pos3] [Asignar Pos2]` → after: `Tu equipo: Kunkka · Asignado a Pos2` `[Quitar asignación]`. Buttons use the existing compact bordered style (hover/focus/disabled states). Enemy rows unchanged. |

The browser suite (`e2e/wave5-certification.spec.ts`) now **fails** if `V6 degraded`, `stale_meta` or `contradictorias` is ever visible to the Player (previously recorded as a `ux-finding`); only the U5(c) text remains an annotated known item.

**I1 (intermittent Wave 2 failure)** — reproducibility check in `docs/diagnostics/WAVE2_INTERMITTENT_REPRO.md`: 26 cold builds + a 20× warm A/B session = 144 scenario executions, **0 failures — not reproduced**. Failure-evidence capture (seed, stage, HTTP timeline, Coach outputs, degradation reasons, engine `computedInMs`, trace/screenshot) is now in place for any recurrence. The V6-cutoff hypothesis is **not** established (max engine `computedInMs` seen: 69 ms; no `partial_signals`).

## 8. Dota Judge packet

`docs/diagnostics/WAVE5_DOTA_JUDGE.md` (+ `.json`, 236 KB): **13 scenarios**, each = a decision point *and* the next one (to judge reaction), the Player's choice in between, and blank `judgeAnswers` for Q1–Q10 (primary action, role, shortlist, personal ranking/pool, Flex honesty, Safe Core, missed counters/synergies, overconfidence, reaction, usefulness). Selection is by deterministic coverage criteria (first matching seed), not by how good the advice looks. Coverage: Radiant + Dire; personal **Pos1–5 all present**; early (S01, S02, S09, S12) / mid (S03, S04, S06–S08, S11, S13) / late (S05, S10); support-first openings; core-position-named (S06); Flex reveal (S07) and visible enemy Flex (S08); Hero Pool (personal ranking with `Tu pool`); **2 natural Safe Core windows (S10, S11)**; Player-deviation with reaction (S07, S12); the single-step fallback (S13). Contains **no seed, no hidden enemy hero, no Enemy Bot position, no registration order, no hidden appendix** (a leak guard fails generation otherwise). Shows only what the Player sees (e.g. "Rol por definir" cards carry no position). Provenance limitations (7.41e stale snapshot, curated non-patch-verified data, simulated bans, features not in MVP) are stated in it. The old solo-mid judge files were not used.

## 9. Known limitations accepted for the MVP (unchanged)

Statistical meta labelled 7.41e, sync-stale, no verified patch window · position/counter files curated and not patch-verified · simulated bans and a scripted Enemy Bot · no side intelligence · no one-ply · no composition/bracket model · single dev-machine latency.

## 10. Files

**Product (1 line):** `apps/web/next.config.ts`. **Tests:** `apps/web/next.config.test.ts`, `apps/engine/src/coach/wave5.certification.test.ts` (new), `…/coach/perspective-boundary.test.ts`, `…/draft-protocol/perspective.test.ts`, `…/simulator/enemy-bot.test.ts`, `e2e/wave5-certification.spec.ts` (new), `scripts/wave5/pure.test.ts` (new). **Tooling:** `scripts/wave5/{driver,pure}.ts`, `scripts/wave5-{certification,dota-judge-packet,smoke}.ts`, `package.json` (`test:wave5:smoke`, `wave5:evidence`, `wave5:judge-packet`). **Docs:** `docs/QA_CALIBRATION.md`, `docs/diagnostics/WAVE5_{PRODUCT_CERTIFICATION,AUTOMATED_ACCEPTANCE,AUTOMATED_EVIDENCE,DOTA_JUDGE}.*`.

## 11. Still needs a human

1. Task 35 — Product Owner plays 5–10 drafts ("this feels like Ranked Roles All Pick").
2. Task 36 — independent Dota expert fills the judge packet.
3. **Minimal visual check:** the Coach panel next to the round panel — primary action ▸ `TU … AHORA` ▸ team options hierarchy; the Own-Flex row (UX-1); the two raw-text notices (U5); Safe Core block visually secondary (its wording is verified, no natural window occurs in the 50-hero browser fixture).
4. Product Owner decisions still pending: U2, U4, U6, U5(c). (U3, U1 decided; U5(a)(b) and UX-1 fixed — §7A.)
