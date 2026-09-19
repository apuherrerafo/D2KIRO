# DATA_FRESHNESS_REPORT — AP Ranked Roles V1, Wave 0 / Task 1

- **Audit date:** 2026-09-19
- **Branch / HEAD audited:** `r1/product-certification` @ `ea537db`
- **Scope:** every dataset that can reach V6 recommendation scoring, plus generated/snapshot artifacts that
  claim a patch. Read-only audit — **no refresh was performed, no code was changed.**
- **Evidence rule:** every claim below is backed by repo evidence (file, commit, or a read-only query of the
  local dev SQLite). Nothing is inferred from a filename or from the product target patch.
- **Product target (spec):** 7.41f. **Nothing in this repo independently verifies any dataset as 7.41f.**

## 0. Headline findings (read this first)

| # | Finding | Evidence | Consequence |
|---|---------|----------|-------------|
| F1 | **The patch label on live meta data is stamped by us, not reported by the source.** `hero_patch_stats.patch` = the constant `CURRENT_PATCH = "7.41e"` (`apps/engine/src/server/routes/meta.ts:15`, mirrored by hand in `apps/web/app/live-draft/live-config.ts:11`). The OpenDota calls (`/heroStats`, `/heroes/{id}/matchups`) carry no patch or time-window parameter (`meta/opendota-client.ts:104-110`). The eval snapshot manifest says so itself: `patchLabelSource: "apps/engine/src/server/routes/meta.ts::CURRENT_PATCH"`. | code + `eval/snapshots/S1.manifest.json` | "7.41e" on `patchStats` is a **label, not a verified data window**. Status = UNKNOWN, not CURRENT and not provably STALE. |
| F2 | **`metaIsStale` does not compare patches — it is a 24 h sync-age check.** `getMetaFreshness` returns `isStale = (now − last ok sync) > 24 h` (`meta/provider.ts:15,183-198`). `metaIsStale` is an input of `BuildSuggestionsOptions` (`signals/mix.ts:73`), **not a field of `MetaSnapshot`** (`signals/types.ts:58-66`). | code | `design.md §20` says "`metaIsStale: true` in MetaSnapshot, already supported by V6" for the "data 7.41e / ruleset 7.41f" state. **That is not how the mechanism behaves today.** A fresh sync of 7.41e-labelled data reports `metaIsStale = false` even when the ruleset target is 7.41f. See §4, **ESCALATION E1**. |
| F3 | **`hero_matchups` has no patch column and no window at all** (`db/schema.ts:29-43`: heroId, vsHeroId, games, wins, updatedAt). | schema | Matchup data can never be tied to a patch. UNKNOWN by construction. |
| F4 | **`hero-positions.json` cannot be independently verified or reproduced.** Source is a manual headless-browser scrape of Dota2ProTracker (7000+ MMR); "7.41e" appears only in a code comment; no script is committed ("ningún script quedó committeado"), no metadata twin, no collection date. | `signals/hero-positions.ts:4-30`; `git log`: one commit, `b56c24f`, 2026-08-22 | UNKNOWN. Refresh is manual and non-scripted → not currently refreshable in a deterministic way. |
| F5 | **`hero-counters.json` is domain-knowledge curation, not measured data**, and carries no patch claim. | SPEC §14 Q2; commit `4b9f660` (2026-08-29) | Cannot be "current" or "stale" for a patch — it makes no patch claim. UNKNOWN, human-reviewed. |
| F6 | **The `7.41e` label on the calibration artifact is also an override.** The pro corpus is `patch = "60"` / `"7.41"`; `percentiles.json` carries `corpusPatchOverride: "7.41e"` taken from the meta snapshot's dominant (stamped) label. It is opt-in only (`MODULE_CALIBRATION`, TSK-213) and **not active** in default V6 scoring. | `data/generated/percentiles.json`, `signals/calibration.ts:75-76`, `scripts/stats/build-percentiles.ts:139` | Not a live risk today; would inherit F1 if activated. |
| F7 | **The spec's file paths are wrong.** Task 1 lists `apps/engine/data/hero-positions.json` and `apps/engine/data/hero-counters.json`. They live in `apps/engine/src/signals/`. `apps/engine/data/` is gitignored and holds only the local dev DB. | `git ls-files` | Cosmetic for the spec, but Wave 4 tasks that cite these paths need correcting. |
| F8 | **The production (Railway) database was not and cannot be audited from this repo.** The only SQLite inspected is the local, gitignored dev DB. | `apps/engine/.gitignore:7` | Production `hero_patch_stats` freshness is **unverified** by this audit. |

## 1. Two axes, kept separate

| Axis | Definition | Current repo value | Evidence | Note |
|------|-----------|--------------------|-----------|------|
| **A — Ruleset mechanics** (`rulesetVerifiedThroughPatch`) | Patch through which Ranked All Pick rules (rounds, timers, collision) are verified | **`7.41e` in code** (`RANKED_ALL_PICK_IDENTITY.verifiedThroughPatch`, `draft-protocol/rulesets/ranked-all-pick.ts:48`) | code | The approved spec asserts verification through 7.41f as product truth; this audit **cannot independently re-verify game mechanics** from the repo. Moving the value to `7.41f` is Wave 1 Task 13 — **not done here**. |
| **B — Data snapshot** (`dataVerifiedThroughPatch`) | Patch actually represented by the scoring data | **No dataset is verified through any patch.** Best available statement: "labelled 7.41e, unverified" | §2 | Must stay independent of Axis A. |

**Constraint carried into Wave 1 (Task 13):** bumping `verifiedThroughPatch` to `7.41f` must **not** change `CURRENT_PATCH`.
`patchMetaReady` (`signals/mix.ts:299-311`) requires `state.patch` to match a `hero_patch_stats.patch` label. Today both are the
same stamped "7.41e", so they match trivially. Setting a session patch to "7.41f" without new rows makes `patch_meta` stop voting
(a safe, accidental guard) — but relabelling existing rows as "7.41f" would be the false-provenance failure this gate exists to prevent.

## 2. Dataset provenance table

Status vocabulary: **CURRENT** = independently verified for 7.41f · **STALE** = independently verified as older than 7.41f ·
**UNKNOWN** = provenance/window cannot be independently verified · **NOT PATCH-SENSITIVE** = makes no patch claim and its content is
not tied to balance changes.
No dataset qualifies as CURRENT or STALE; that absence is itself the finding.

### 2.1 Consumed by V6 recommendation scoring (Wave 4 dependencies)

#### D1 — `patchStats` → `hero_patch_stats` (signal `patch_meta`)
| Field | Value |
|---|---|
| source | OpenDota `GET /heroStats` (no patch/window parameter) |
| location | SQLite table `hero_patch_stats` (`apps/engine/data/dota2coach.sqlite`, gitignored); loaded by `meta/provider.ts` into `MetaSnapshot.patchStats`; fallback `meta/seed-hero-stats.json` (see D8) |
| pipeline | `runMetaSync` → `syncPatchStats` (`meta/sync.ts:162-190`); triggered by `POST /api/meta/sync` and a global auto-refresh at boot (`bootstrap.ts`, `meta/global-refresh.ts`); patch label = `CURRENT_PATCH` |
| rulesetVerifiedThroughPatch | n/a (Axis A applies to rules, not data) |
| dataVerifiedThroughPatch | **none verified** — labelled `7.41e` |
| dataWindow | **UNKNOWN** — the sync stores no upstream window; OpenDota's aggregation window is not recorded anywhere in the repo |
| lastRefresh | local dev DB: `meta_sync` id 2, `finished_at 2026-09-18T01:11:52Z`, `status=ok`, 17 127 rows; earlier id 1 `2026-09-17T05:11Z` ok. Frozen eval snapshot S1: `2026-09-09T03:58Z` |
| sample size | 1 016 rows = 127 heroes × 8 brackets, one label (`7.41e`); 38 159 690 total picks; `immortal` bracket has 0 picks for all 127 heroes |
| refreshMethod | Automated & deterministic (existing pipeline). **Not executed** in this wave. |
| status | **UNKNOWN** (label-only; cannot be claimed as 7.41e-verified, let alone 7.41f) |
| notes | F1. The refresh only deletes rows whose `patch` equals the label being written (`sync.ts:185`): if `CURRENT_PATCH` is ever changed to `7.41f`, the old `7.41e` rows **persist next to the new ones** unless removed — a naive relabel-and-resync yields a mixed table. `patchMetaReady` needs ≥ 20 heroes with ≥ `MIN_PATCH_GAMES` in the state's patch; that gate is what actually protects against a label mismatch. |

#### D2 — `hero_matchups` (signal `counter`, statistical layer)
| Field | Value |
|---|---|
| source | OpenDota `GET /heroes/{id}/matchups`, one request per hero, 1 600 ms pacing |
| location | SQLite `hero_matchups` → `MetaSnapshot.matchups` |
| pipeline | `syncMatchups` (`meta/sync.ts:192-230`), same `runMetaSync` |
| dataVerifiedThroughPatch | **none** — the table has **no patch column** (F3) |
| dataWindow | **UNKNOWN** (upstream window not recorded) |
| lastRefresh | local dev DB: `2026-09-18T01:11:52Z` (ok). S1 snapshot: `2026-09-09` |
| sample size | 15 984 rows, 127 heroes, 1 191 650 total games, max 706 games per pair (consistent with SPEC §15.1 sparsity: most pairs are below `COUNTER_MIN_GAMES`) |
| refreshMethod | Automated (existing pipeline); ~3.4 min for a full run; 429s retried 1 s/4 s/16 s. **Not executed.** |
| status | **UNKNOWN** |
| notes | Cannot be labelled by patch even in principle without a schema change or a documented upstream window. Any Wave 4 claim of "current-patch matchups" is unsupported. |

#### D3 — `hero-positions.json` (signal `position_fit`, Solo-Mid admission)
| Field | Value |
|---|---|
| source | Dota2ProTracker, bracket 7000+ MMR, manual headless-browser scrape (per code comment) |
| location | `apps/engine/src/signals/hero-positions.json` (tracked); loaded once at module init (`MODULE_HERO_POSITIONS`, `recommendation/build.ts:358`) |
| pipeline | **None committed.** Procedure exists only as prose in `signals/hero-positions.ts:9-30`; site is behind Cloudflare (plain fetch → 403) |
| dataVerifiedThroughPatch | claimed `7.41e` in a comment; **not verifiable** |
| dataWindow | **UNKNOWN**; no collection date in the file. Upper bound: committed 2026-08-22 (`b56c24f`) |
| lastRefresh | ≤ 2026-08-22 (commit date; actual scrape date unrecorded) |
| sample size | 126 heroes, 371 313 total position-matches, each listed position ≥ 200 matches (`MIN_POSITION_MATCHES`); positions under 200 were dropped at collection, so per-hero totals are lower bounds |
| refreshMethod | **Manual, not scripted** — not currently refreshable deterministically |
| status | **UNKNOWN** |
| notes | F4. Chen has no listed position (known, documented). Adding a metadata twin (`data/metadata/…`) is the repo's own ADR-003 rule for generated data; this file is curated, so it has none. |

#### D4 — `hero-counters.json` (signal `counter`, curated layer)
| Field | Value |
|---|---|
| source | Deep-research domain knowledge, human-reviewed before merge (SPEC §14 Q2; "no se scrapea Dotabuff") |
| location | `apps/engine/src/signals/hero-counters.json` (tracked); `MODULE_HERO_COUNTERS` |
| pipeline | Hand curation; no generator |
| dataVerifiedThroughPatch | **none claimed** |
| dataWindow | n/a (not measured data) |
| lastRefresh | 2026-08-29 (commit `4b9f660`) |
| sample size | 127 heroes / 528 counter entries (`hard`/`medium`) |
| refreshMethod | Manual curation |
| status | **UNKNOWN** — deliberately *not* "NOT PATCH-SENSITIVE": hero-vs-hero counter relationships can change with balance patches, and nothing records which patch the curation reflects |
| notes | F5. Wave 4 Task 24 (tasks.md L781) STOPs if the counters dataset's provenance differs from this report; the recorded provenance is "curated knowledge, no patch claim". |

#### D5 — `capabilities.json` (signal `archetype_fit`, draft-paths)
| Field | Value |
|---|---|
| source | Hand-curated hero capability ratings (damage type, initiation, teamfight, scaling, structural damage) |
| location | `apps/engine/src/draft-paths/capabilities.json` (tracked) |
| pipeline | Hand curation (TSK-036, 2026-07-29 → expanded 55 → 124 heroes) |
| dataVerifiedThroughPatch | none claimed |
| dataWindow | n/a |
| lastRefresh | 2026-07-29 (last commit `ff34906`) |
| sample size | 124 heroes |
| refreshMethod | Manual curation |
| status | **UNKNOWN** (no patch claim; ratings can drift with balance changes). Only votes when an archetype intent is set. |

#### D6 — Percentile calibration `data/generated/percentiles.json`
| Field | Value |
|---|---|
| source | `apps/engine/data/dota2coach.sqlite` + `apps/engine/data/pro-drafts.sqlite`, train folds of `eval/baselines/split.json` |
| location | `data/generated/percentiles.json` + provenance twin `data/metadata/percentiles.json` |
| pipeline | `scripts/stats/build-percentiles.ts` (offline, readonly SQLite) |
| dataVerifiedThroughPatch | metadata says `"7.41e"`, but it is `corpusPatchOverride` = the stamped meta label (F6); real corpus patch is `60` |
| dataWindow | `sampleWindow: null` |
| lastRefresh | `generatedAt 2026-08-29T23:05:58Z` |
| sample size | `n` per signal: position_fit 66 615, counter 47 466, patch_meta 67 200, team_synergy 43 200 |
| refreshMethod | Scripted, deterministic — **but `pro-drafts.sqlite` is not present in this checkout**, so it cannot be regenerated here |
| status | **UNKNOWN**; **not active by default** (opt-in `MODULE_CALIBRATION`; TSK-213 found empirical calibration cost NDCG@5) |
| notes | Not a Wave 4 blocker unless calibration is re-enabled. |

### 2.2 Loaded by the engine but not part of default V6 scoring

#### D7 — `pro-draft-corpus.json` + `hero-line-profiles.json` (Pro-Drafter, dark behind `ENABLE_PRO_DRAFTER`)
| Field | Value |
|---|---|
| source | OpenDota pro matches (corpus, `scripts/pro/*`, OpenDota patch granularity); hand-authored heuristics (line profiles) |
| location | `apps/engine/src/knn/pro-draft-corpus.json`, `apps/engine/src/lane/hero-line-profiles.json` |
| dataVerifiedThroughPatch | corpus: `"7.41"` on all 502 drafts (patch letter **not recorded**); line profiles: none |
| lastRefresh | corpus last commit `12066fa` 2026-08-24; profiles `59dafc1` 2026-08-24 |
| sample size | 502 drafts; 15 hero line profiles |
| status | **UNKNOWN** for 7.41f (corpus cannot distinguish 7.41e/f); **not consumed by V6 scoring** |
| notes | Out of Wave 4's data path unless Pro-Drafter is switched on. |

#### D8 — `seed-hero-stats.json` (fallback for `patchStats`)
| Field | Value |
|---|---|
| source | Hand-written placeholder |
| evidence it is synthetic | 18 heroes only; every pick count is a multiple of 100 (verified); labelled `"seed"` in `meta/provider.ts:71` |
| status | **UNKNOWN / synthetic** |
| notes | Used only when `hero_patch_stats` is empty. Its label `"seed"` can never match `state.patch`, so `patch_meta` cannot vote from it. Not a freshness risk, but must never be presented as meta. |

### 2.3 Eval / test artifacts (informational; not consumed by scoring)
| Artifact | Patch claim | Status / note |
|---|---|---|
| `eval/snapshots/S1.sqlite` + manifest | `dominantPatch "7.41e"` via `CURRENT_PATCH`; frozen 2026-09-09 | Intentionally point-in-time. Row counts equal the local dev DB (15 984 / 1 016 / 127). Label provenance = F1. |
| `data/generated/signal-profile.json` (+ metadata) | `patch "60"` | Eval-only. |
| `data/generated/tolerance.json` | none | Eval noise floor. |
| `apps/engine/data/dev-mvp-cm-eligibility.json` | `"7.41e"`, but `buildId: "e2e-fixture-build"` | **Test fixture**, gitignored; not real eligibility data. Real builder: `scripts/cm-eligibility/build-snapshot.ts` (patch passed via flag → also stamped). |

## 3. Refresh performed?

**No.** Task 1 is defined as "read-only audit + documentation", and the standing instruction was not to refresh merely because
data is stale. The one deterministic pipeline that exists (`runMetaSync`) was inspected but not run: it would rewrite
`hero_patch_stats` under a **stamped** label (F1) and add no verifiable provenance, so running it would change data without
answering the question this gate asks.

Refreshability summary:

| Dataset | Can be refreshed now? |
|---|---|
| D1 patchStats, D2 matchups | Yes — existing automated pipeline works (last ok 2026-09-18); needs network; refresh does **not** create patch provenance |
| D3 hero-positions | Only manually (browser scrape, no script) |
| D4 hero-counters, D5 capabilities | Only by human curation |
| D6 percentiles | Not in this checkout (`pro-drafts.sqlite` absent) |
| D7 corpus | Manual ingest scripts exist (`scripts/pro/*`); not evaluated |

## 4. Escalations (Task 1 STOP conditions triggered)

Task 1 says: *"Any dataset has a provenance that cannot be independently verified → STOP, escalate to Product Owner."* That
condition is met for **D1–D5**. Global STOP #6 (*"a dependency does not behave as design.md describes"*) is met by F2.
The audit deliverable is complete; the following need a Product Owner decision **before Wave 4**:

- **E1 — Staleness signal (F2).** `design.md §20` assumes an existing `metaIsStale` that fires when data is 7.41e and the ruleset
  is 7.41f. Actual behaviour: a 24 h sync-age flag, passed per call, with no patch comparison and no field on `MetaSnapshot`. Options
  for the PO (not implemented here): (a) accept "data label = 7.41e, surfaced as `basedOn.patch`" without a stale flag;
  (b) commission a small mechanism that derives staleness from `dataPatch != rulesetPatch`; (c) rewrite the §20 requirement.
- **E2 — What "7.41e" means for D1/D2 (F1, F3).** Decide whether to (a) keep stamping and state honestly "labelled, not verified";
  (b) record the upstream window per sync (needs a schema/metadata change — outside Wave 0); or (c) verify against
  OpenDota `/constants/patch` (read-only network call, not done here because this audit was scoped to repo evidence).
- **E3 — Curated datasets (D3–D5).** Accept them as "curated, patch-unverified" or commission a re-verification/regeneration
  (D3 needs a committed, reproducible scraper before it can be called refreshable).
- **E4 — Production.** Someone with Railway access must confirm production `meta_sync` / `hero_patch_stats` state; this audit could not (F8).

## 5. Wave readiness

- **Wave 1 (Simulator Fidelity Core):** **Not blocked by data.** It touches ruleset/kernel/simulator, not scoring data. Constraint:
  Task 13 must leave `CURRENT_PATCH` alone (§1).
- **Wave 2–3:** `tasks.md` contains no Wave 0 gate reference for these waves (only Wave 4, L752/781/823, and Global STOP #7); not
  blocked by this report. Global STOP #7 still applies to any task that discovers provenance differing from this report.
- **Wave 4 (Contextual Intelligence): BLOCKED until the Product Owner reviews and approves this report** (per tasks.md). Explicit
  data-provenance gates in Wave 4: **Task 24** (Safe Core) carries a STOP if the `hero-counters.json` dataset's provenance differs from
  this report (tasks.md L781, D4); **Task 26** (side tiebreaker) requires "patchStats provenance verified" (tasks.md L823, D1 — currently
  UNKNOWN, so this precondition is not met). Tasks 25 and 27 depend on those two. With E1–E3 unresolved, any
  Wave 4 claim of "current-patch intelligence" would be unsupported.

## Product Owner Resolution

*Recorded at the start of Wave 1 (2026-09-19). Binding. Wave 0 findings F1–F8 above are accepted as factual repo truth; the
result of Wave 0 is `PASS_WITH_STALE_DATA`.*

1. **Wave 1 (Simulator Fidelity Core) MAY proceed.** Wave 2 has not been authorised by this resolution.
2. **Ruleset mechanics version and data snapshot version remain independent axes** (§1). Neither is derived from the other.
3. **`RANKED_ALL_PICK_IDENTITY.verifiedThroughPatch` MAY be moved from `7.41e` to `7.41f`** — where Wave 1 Task 13 requires it. It is
   the ruleset-mechanics axis only. (Applied in Wave 1; `rulesHash` is computed from `{id, version, manifest}` and does not include
   this field, so the hash is unchanged.)
4. **`CURRENT_PATCH` is NOT changed** to make datasets look like 7.41f. Wave 0 established the meta label is stamped locally and does
   not prove a 7.41f data window (F1).
5. **No dataset is relabelled 7.41f without provenance evidence** — not `patchStats`, hero positions, hero counters, matchup data, nor
   any other dataset.
6. **`metaIsStale` means sync-age freshness, not patch provenance** (F2). The statement in `design.md` that it already represents
   "ruleset 7.41f / data 7.41e" is factually incorrect. Wave 1 does not rely on it for patch provenance and does not redesign data
   provenance.
7. **Wave 4 remains blocked** on the data provenance / refresh decisions (E1–E4 in §4).
8. **The actual dataset paths found in Wave 0 are authoritative** (e.g. `apps/engine/src/signals/hero-positions.json`,
   `apps/engine/src/signals/hero-counters.json`, `apps/engine/src/draft-paths/capabilities.json`), not the conceptual paths in the
   original spec.
