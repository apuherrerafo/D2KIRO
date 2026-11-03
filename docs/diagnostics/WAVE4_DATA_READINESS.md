# WAVE4_DATA_READINESS — AP Ranked Roles V1, pre-Wave-4 re-audit

- **Audit date:** 2026-09-20
- **Branch / HEAD audited:** `r1/product-certification` @ `0fa257cb61f98906ead921e4c68729b6a5c262d8`
- **Prior artifact:** `docs/DATA_FRESHNESS_REPORT.md` (Wave 0, audited at `ea537db`, 2026-09-19). **That file is
  not modified by this audit** — it is Wave 0's historical record and stays as written, including its own
  "Product Owner Resolution" section. This document records the state **now**, after Waves 1–3 landed.
- **Scope:** read-only re-audit of every dataset/signal Wave 4 (tasks 24–27) would consume, plus the Coach
  pipeline surface those tasks would wire into (which did not exist yet at Wave 0's audit time). No Wave 4
  code was written. No product data was refreshed or relabelled.
- **Network calls made:** four read-only `GET` requests to OpenDota's public, unauthenticated `/api/explorer`
  and `/api/constants/patch` endpoints, to verify (not assume) what columns OpenDota's own tables expose.
  Nothing was written to OpenDota; nothing in this repo's data was touched by these calls. Documented in
  full in §7.
- **Evidence rule:** every claim is backed by a repo file, a commit, a query of the local dev SQLite
  (`apps/engine/data/dota2coach.sqlite`, opened read-only), or one of the four OpenDota calls above.

---

## 1. RESULT

**PARTIALLY_READY.**

Wave 0's own "Product Owner Resolution" (bottom of `docs/DATA_FRESHNESS_REPORT.md`) already states, as a
binding decision: *"Wave 4 remains blocked on the data provenance / refresh decisions (E1–E4)."* Nothing in
this repo shows those four escalations were subsequently decided. Formally, the Wave-0 gate has not been
lifted — this audit does not lift it either; only the Product Owner can.

What this audit adds is finer grain than Wave 0 could have had (Wave 0 pre-dates Waves 1–3, so it could not
see the Coach pipeline Wave 4 would actually plug into). Re-auditing the current repo shows:

- **Every data-provenance finding from Wave 0 (F1–F8) still holds, unchanged, byte-for-byte.** No commit
  between `ea537db` and `HEAD` touches `apps/engine/src/signals/`, `apps/engine/src/meta/`,
  `apps/engine/src/db/`, or any curated JSON. Confirmed by `git diff --stat` (§3).
- **One capability is genuinely usable today, already shipped, and not blocked by anything in Wave 0's E1–E4
  list:** curated hard-counter evidence (`hero-counters.json`) already drives a live V6 signal
  (`counter.ts`'s `BAN_RELIEF` mechanism, TSK-188) that rewards a candidate whose curated hard counters are
  already banned. Safe Core (Task 24) would mostly be **surfacing and combining evidence that already
  exists and already runs in production**, not sourcing anything new.
- **One capability is architecturally blocked in a way Wave 0 could not have found**, because it depends on
  Wave 2 code that didn't exist yet: One-ply lookahead (Task 27). The Coach's perspective-safe
  recommendation path (`build-from-perspective.ts`, added in Wave 2) **always** returns
  `deferred: deferredFieldsNotComputed()` — by construction, not by a flag. See §11.
- **Side context remains BLOCKED for the same reason as Wave 0 found**, re-confirmed directly: no
  Radiant/Dire-differential data exists anywhere in the schema, the curated JSONs, or the signal code.
- **A live, read-only check against OpenDota's actual `/explorer` schema** (something Wave 0 explicitly
  deferred, its own §4 wrote "not done here") now gives a concrete, verified answer to the Patch Meta
  question in §1's original brief: OpenDota's match tables carry **no patch column at all** — patch
  identity is derivable only by joining `start_time` against `/constants/patch`'s release-date table, and
  building that join is a **new pipeline**, not a config change. See §7.

None of this changes Wave 0's conclusion. It sharpens it, and it identifies a genuinely-safe subset (§15).

---

## 2. Feature-level decision matrix

| # | Capability | Status | Why |
|---|---|---|---|
| A | Safe Core core logic (`detectSafeCoreWindow`, Task 24) | **READY_WITH_LIMITATIONS** | All four input signals (`counter`, hard-counter list, `patch_meta`, `position_fit`) exist and run today. The function itself is pure combination logic with a configurable threshold — no new data source needed. Limitation: its inputs inherit UNKNOWN patch provenance (D1) and curated-not-verified status (D3, D4) — the UX **must** say so, never "confirmed for 7.41f." |
| B | Counter evidence | **READY_WITH_LIMITATIONS** | Two cleanly separated layers exist in `counter.ts` today: curated (`hero-counters.json`, human-reviewed, no patch claim) and statistical (`hero_matchups` + `shrinkEstimate`, `minGames=10`, patch-unbound by schema). Both already vote in production V6. Must be labelled by evidence type, never merged into one undifferentiated "counters" claim. |
| C | Banned-hard-counter context | **READY_WITH_LIMITATIONS** — arguably closer to READY | `BAN_RELIEF` (TSK-188, `counter.ts:35-38,188-197`) already scores "N of your curated hard counters are banned" in production, using explicitly curated (not statistical) evidence. Task 24/25 mostly need to **surface** this existing computation as a labelled `opportunity` block, not invent new scoring. |
| D | Patch meta (`patch_meta` signal / `patchStats`) | **BLOCKED** for any "verified current-patch" claim · **READY_WITH_LIMITATIONS** as a disclosed, sync-age-only, unverified-patch label | Unchanged since Wave 0 (F1, F2, F3). New in this audit: verified live against OpenDota that no match table exposes a `patch` column (§7) — a genuine patch-bounded snapshot needs a new pipeline (Option C, §14). Also new: as of this audit's timestamp, the existing 24h-staleness flag is **currently true** (last `ok` sync 2026-09-18T01:11Z, audit run 2026-09-20) — see §3. |
| E | Position fit | **READY_WITH_LIMITATIONS** | Unchanged since Wave 0 (F4): curated, manual scrape, no committed refresh script, no patch verification. New, separate finding (not a provenance issue, a scoring-logic one, documented in the untracked `docs/diagnostics/ap-solo-mid-final-dota-judge.md`, 2026-09-19): `position_fit`'s current Mid formula is a raw absolute-match-count score with no purity term, which lets a popular-but-minority-Mid hero (Earth Spirit) saturate to the same score as a near-exclusive Mid (Ember Spirit). Orthogonal to patch freshness, but relevant to whether Safe Core / position-fit-derived claims should be trusted at face value. |
| F | Side context | **BLOCKED** | Re-confirmed directly: no `radiant`/`dire` win-rate differential exists in `db/schema.ts`, `hero-positions.json`, `hero-counters.json`, or any `signals/*.ts` file (the only `radiant`/`dire` tokens found are team-roster arrays like `state.picks.radiant`, not statistics — verified by direct grep + read, §9). |
| G | Opportunity block (Task 25 wiring) | **READY_WITH_LIMITATIONS**, contingent on A/C | Pure wiring of an already-computable signal into `RecommendationOutputV3.opportunity`. No new data dependency of its own. |
| H | One-ply / opponent-response (Task 27) | **BLOCKED** | New architectural finding, not a data-freshness one (see §11). `lookahead.ts`'s own 18 tests pass (verified, §11), but the Coach pipeline Wave 2/3 actually built (`build-from-perspective.ts`, consumed by `orchestrator.ts`) is structurally incapable of calling it — `deferred` is hardcoded to `deferredFieldsNotComputed()` on that path, by design, because the perspective-safe input type has no way to carry the authoritative state the kernel-simulation lookahead needs. |

---

## 3. Changes since Wave 0 (`ea537db` → `HEAD`, `0fa257c`)

`git diff --stat ea537db..HEAD -- apps/engine/src apps/engine/data` touches 64 files, all of them Wave 1–3
work: `coach/*`, `draft-protocol/adapters/simulator-authority.ts`, `drafter/decision-context.ts`,
`recommendation/build-from-perspective.ts` (new), `recommendation/construct.ts` (new),
`recommendation/perspective-context.ts` (new), `server/protocol-session.ts`, `server/routes/*`,
`simulator/*`. **Zero files under `apps/engine/src/signals/`, `apps/engine/src/meta/`,
`apps/engine/src/db/`, or `apps/engine/src/draft-paths/` appear in that diff.** The data layer Wave 0
audited is untouched.

Confirmed directly (not assumed from the old report):

| Item | Wave 0 value | Now | Changed? |
|---|---|---|---|
| `CURRENT_PATCH` (`server/routes/meta.ts:15`) | `"7.41e"` | `"7.41e"` | No |
| `RANKED_ALL_PICK_IDENTITY.verifiedThroughPatch` | `"7.41e"` (pre-Wave-1) | `"7.41f"` | Yes — this is Wave 1 Task 13, explicitly authorised by Wave 0's own PO Resolution point 3. Ruleset axis only; `rulesHash` unaffected (confirmed unchanged by the same resolution). |
| `apps/web/app/live-draft/live-config.ts` `CURRENT_PATCH` mirror | `"7.41e"` | `"7.41e"` | No — web and engine data-patch labels still agree. |
| `hero-counters.json` last commit | `4b9f660` (2026-08-29) | `4b9f660` | No |
| `hero-positions.json` last commit | `b56c24f` (2026-08-22) | `b56c24f` | No |
| `capabilities.json` last commit | `ff34906` (2026-07-29) | `ff34906` | No |
| `hero_matchups` schema | no `patch` column | no `patch` column | No |
| `meta_sync` last `ok` row | id 2, finished `2026-09-18T01:11:52Z`, 17,127 rows | **same row, still the latest `ok`** | No — see below |

**New since Wave 0 (not previously reported):**

1. **An orphaned `meta_sync` row.** `SELECT * FROM meta_sync ORDER BY id DESC` now shows a third row:
   `id 3, status "running", started_at 2026-09-19T20:45:06Z, finished_at NULL, rows_written 0`. It never
   completed and there is no reconciliation/timeout logic in `meta/sync.ts` that would close it. It does not
   affect `getMetaFreshness()` (which explicitly filters to `status = "ok"`, `meta/provider.ts:195`), so it
   is not a correctness bug — but it means a sync was started (most likely a dev-server boot auto-refresh,
   `bootstrap.ts`) and abandoned, and nobody would notice from the API surface. Hygiene note, not a Wave 4
   blocker.
2. **As of this audit's run, the data is currently flagged stale by the existing mechanism.** Last `ok` sync
   finished `2026-09-18T01:11:52Z`; today is `2026-09-20`. `FRESHNESS_WINDOW_MS = 24h`
   (`meta/provider.ts:15`) means `getMetaFreshness()` would return `isStale: true` right now. This is exactly
   the 24h sync-age signal Wave 0's F2 described (not a patch-provenance signal) — it is doing its job, and
   its job is not what `design.md §20` originally assumed it was.
3. **`counter.ts`'s `BAN_RELIEF` mechanism** (TSK-188) was not mentioned in Wave 0 (Wave 0 audited data
   provenance, not signal internals) but is directly relevant to Task 24/25: it is a working, shipped,
   curated-evidence hard-counter-ban bonus. See §6.
4. **`lookahead.ts` gained a "HIDDEN-INFORMATION GUARD"** (`revealsOpponentSealedPicks`, added alongside
   Wave 2) and **`build-from-perspective.ts` was added**, which never calls it. See §11.
5. **An untracked QA artifact, `docs/diagnostics/ap-solo-mid-final-dota-judge.md`** (2026-09-19, not part of
   this audit's remit to produce, pre-existing in the working tree per `git status`), documents a
   position_fit scoring defect unrelated to patch freshness. Noted in §8 because it bears on whether
   position-fit evidence should be presented as trustworthy in Wave 4's UI, but it is **not** a data
   provenance finding and this audit does not re-verify its 20 case-by-case verdicts.

---

## 4. Safe Core readiness

`detectSafeCoreWindow` (design.md §19, tasks.md Task 24) combines four inputs, **all four already
implemented and running in default V6 scoring today**:

| Input | Where it lives | Status |
|---|---|---|
| `counter` signal raw score | `signals/counter.ts` (`createCounterScorer`) | Active. Curated + statistical layers, see §6. |
| Hard-counter list for a hero | `hero-counters.json` (curated) | Active, unchanged since 2026-08-29. |
| Fraction of those hard counters banned | `counter.ts`'s existing `BAN_RELIEF` loop already computes exactly this | Active, TSK-188, shipped. |
| `patch_meta` signal raw score | `signals/patch-meta.ts`, `MIN_PATCH_GAMES = 500` | Active, but UNKNOWN patch provenance (D1) and currently sync-age-stale (§3). |
| `position_fit` signal raw score | `signals/position-fit.ts` | Active, curated, UNKNOWN patch provenance (D3), plus the orthogonal purity-vs-volume caveat (§8). |

**Task 24's own STOP condition** ("Dataset used by `hero-counters.json` has a different provenance than
recorded in DATA_FRESHNESS_REPORT → STOP") **is not triggered**: this audit independently re-verified
`hero-counters.json` is unchanged, curated, human-reviewed, no patch claim (§6) — identical to Wave 0's D4.

**Verdict: READY_WITH_LIMITATIONS.** The detector can be built without any new data. The evidence string it
produces must say "curated hard counters" / "patch-unverified meta signal," not "current 7.41f data" — that
distinction is exactly what Wave 0's PO Resolution points 5 and 6 already require project-wide.

---

## 5. Counter evidence readiness

`counter.ts` (read in full for this audit) cleanly separates two evidence types in code, not just in
documentation:

- **CURATED COUNTER EVIDENCE**: `hero-counters.json`, matched via `curated.get(candidate)` /
  `curated.get(rival)`. Bidirectional (`hard` = ±0.12, `medium` = ±0.06). Each entry carries a `why` string
  — hand-written mechanical reasoning (e.g. *"Berserker's Call atraviesa Counterspell..."*), not a
  statistic. No patch claim anywhere in the file or its loader comment (`signals/hero-counters.ts`,
  confirmed by direct read).
- **CURRENT STATISTICAL COUNTER EVIDENCE**: only for a rival the curated layer does **not** cover, via
  `relationship-index.ts` over `hero_matchups` (SQLite), shrunk toward the candidate's own baseline via
  `shrinkEstimate` (`minGames: 10` by default in the active scorer). `hero_matchups` has **no patch column**
  (`db/schema.ts:29-43`, confirmed unchanged) — so "current" here means "last synced 2026-09-18," not
  "verified for any specific patch." Sample size confirmed directly against the local dev DB: 15,982 rows,
  1,186,235 total games, max 700 games for any single pair.

**Verdict: READY_WITH_LIMITATIONS.** Both layers are real, both already run. Wave 4's UX obligation is to
never present them as one undifferentiated "counter data" claim — the curated layer is domain reasoning:
the statistical layer is unbound-patch aggregate frequency. `counter.ts`'s own code already keeps them
apart (`curatedHit` branch vs. statistical branch); Wave 4 only needs to preserve that distinction when it
labels evidence for the Player, not invent a new separation.

---

## 6. Banned-hard-counter-context readiness

This is **substantially already built**, not a Wave 4 net-new feature:

```
// counter.ts:35-38
const BAN_RELIEF: Record<CuratedCounter["level"], number> = { hard: 0.04, medium: 0.02 };
const BAN_RELIEF_CAP = 0.06;
```

For every curated hard/medium counter of the candidate that is currently in `bannedHeroes`, `counter.ts`
adds a positive relief term and produces a human-readable clause (`buildBanReliefClause`, e.g. *"2 de sus
counters están baneados: Slark y Anti-Mage"*). It votes from pick 1, independent of revealed enemy picks.
This is exactly Requirement 16 / PD-017's "Safe Core" concept, already partially live inside the `counter`
signal's raw score — Task 24/25's job is to **extract and surface** this as its own labelled `opportunity`
block, not to build the underlying evidence from scratch.

**Verdict:** the choice between:
- **READY_WITH_LIMITATIONS** — expose it labelled explicitly "curated evidence, not patch-verified" (matches
  Wave 0 PO Resolution points 5/6 exactly), or
- **BLOCKED pending statistical/current counter provenance** — refuse to surface it until `hero_matchups`
  can carry a real patch window,

is a product framing choice, not a technical gap, because the underlying computation already exists and
already ships in production regardless of what Wave 4 decides. This audit's recommendation (not a decision —
that is the PO's, per §14) is the first option, since the mechanism is already live and unlabelled today;
Wave 4 would only be making its provenance honest, not introducing new risk.

---

## 7. Patch-meta readiness

Unchanged conclusion from Wave 0 (UNKNOWN, F1/F2/F3), confirmed by re-reading `meta/provider.ts`,
`meta/sync.ts`, `signals/mix.ts`, and the local dev DB (§3). New in this audit — an actual, live,
independently-verified check of OpenDota's own schema, run **read-only**, no data written anywhere:

```
GET https://api.opendota.com/api/explorer?sql=SELECT column_name, data_type
    FROM information_schema.columns WHERE table_name = 'public_matches'
→ match_id, match_seq_num, radiant_win, start_time, duration, lobby_type,
  game_mode, avg_rank_tier, num_rank_tier, cluster, radiant_team, dire_team
  (12 columns total — NO patch column)

GET .../explorer?sql=... table_name IN ('matches','picks_bans','player_matches')
→ 135 columns across the three tables (full list captured in this audit's tool trace).
  `matches` (parsed/pro subset): includes leagueid, picks_bans, radiant_team_name,
  start_time, radiant_win, duration — NO patch column.
  `picks_bans`: match_id, is_pick, hero_id, team, ord — NO patch column.
  Neither table stores patch identity directly, anywhere.

GET .../api/constants/patch
→ [{"name":"6.70","date":"2010-12-24T00:00:00Z","id":0}, ... ] — an authoritative
  patch_id/name → release-date table exists and is easy to fetch.

GET .../explorer?sql=SELECT count(*) FROM matches WHERE start_time > now()-30d
→ 554 rows (last 30 days). This table (parsed/pro matches) is far too small on
  its own for hero-level per-bracket win rates.

GET .../explorer?sql=SELECT count(*),min(start_time),max(start_time) FROM
    public_matches WHERE start_time > now()-7d
→ timed out (>15s) in this environment without an index-friendly filter. Ad-hoc
  full-table explorer queries over public_matches carry a real query-cost
  constraint that any refresh pipeline would need to design around (batching,
  narrower predicates, or a different endpoint).
```

**Conclusion, directly answering the brief:** OpenDota does **not** expose a `patch` field on `/heroStats`
(already known from Wave 0) nor on any of its raw match tables (`public_matches`, `matches`, `picks_bans`,
`player_matches` — newly verified here). A genuinely patch-bounded hero snapshot is possible **in
principle** — join `start_time` against `/constants/patch`'s release-date boundaries, aggregate hero
picks/wins/rank-tier per resulting window — but this requires:

1. A new SQL-aggregation script (the `getExplorer(sql)` client method already exists in
   `meta/opendota-client.ts`, unit-tested, **but has zero production call sites** — confirmed by repo-wide
   grep; it is unused capability, not a wired pipeline).
2. A schema change to `hero_patch_stats` (or a new table) that can actually hold a verified window, since
   today's table has no way to distinguish "we stamped this label" from "we verified this window."
3. A decision about query cost / rate limits for `public_matches` (the one table with real match-level
   volume; the parsed `matches` table is too small, per the count above).

This is squarely "implementing a new substantial data pipeline" — per this gate's own instructions, that is
reported as an option (§14, Option C), not built here.

**Verdict:** **BLOCKED** for any claim of verified current-patch data. **READY_WITH_LIMITATIONS** as a
disclosed, sync-age-only signal exactly as Wave 0's PO Resolution already framed it (points 4–6): never
relabel `7.41e` data as `7.41f`, and treat `metaIsStale` for what it actually measures (sync recency, not
patch truth).

---

## 8. Position-fit readiness

Unchanged from Wave 0 (D3, F4): `hero-positions.json` is a manual Dota2ProTracker scrape (7000+ MMR
bracket), no committed refresh script (the procedure is written as prose in a code comment,
`signals/hero-positions.ts:9-30`, because the site returns 403 to a plain fetch and needs a real headless
browser), no collection-date metadata, "7.41e" claimed only in a comment. Re-confirmed directly in this
audit by reading that file's header.

**Separate, orthogonal finding** (not part of this gate's provenance scope, flagged for completeness since
Safe Core's §4 input list includes `position_fit`): the untracked `docs/diagnostics/ap-solo-mid-final-dota-judge.md`
(2026-09-19, already present in the working tree, not produced by this audit) documents that the active Mid
scoring formula is `raw = clamp01(matchesAtPosition2 / 3000)` — an absolute match-count score with no
purity/share term — and gives a concrete example (Earth Spirit, a Pos-4 roamer with high overall popularity,
saturates to the same 1.000 score as Ember Spirit, a near-exclusive Mid). This is a scoring-logic quality
issue, independent of whether the underlying data is patch-current. It does not block Wave 4 by itself, but
it means Wave 4 should not present `position_fit`'s raw score as a purity signal without qualification.

**Verdict for Wave 4 specifically:**
- Evidence is high-level role signal (curated, not patch-current) — **not** patch-current data.
- No refresh path exists that Wave 4 could invoke deterministically; regenerating it means re-running the
  manual browser-scrape procedure by hand.
- **READY_WITH_LIMITATIONS**: usable as "curated positional evidence, last collected ~2026-08-22, not
  independently patch-verified," with the purity caveat above noted if position_fit's raw score feeds any
  user-facing confidence language in Wave 4's Safe Core evidence string.

---

## 9. Side-context readiness

Re-confirmed directly, not inherited from Wave 0 (Wave 0 did not have a Task 26 to check against yet in as
much detail):

- `db/schema.ts`: no side/Radiant/Dire column on `heroPatchStats` or `heroMatchups`.
- `grep -rn "radiant|dire" apps/engine/src/signals/` and `apps/engine/src/meta/` (case-insensitive):
  every hit is either a team-roster field (`state.picks.radiant`, `state.picks.dire` — arrays of hero IDs
  already picked by that team, in `signals/mix.ts:427,767,923`) or an unrelated substring match (`"beside"`,
  `"alongside"` in `meta/provider.ts`). Confirmed by reading the exact matched lines. **Zero** win-rate or
  performance differential by side exists anywhere in the codebase.
- `hero-positions.json` and `hero-counters.json`: no side field.
- OpenDota's `public_matches` table (verified live, §7) does carry `radiant_win` + `radiant_team`/
  `dire_team` arrays — so a side-differential dataset is theoretically constructible from the same
  new-pipeline work described in §7 (Option C would need to also compute this) — but nothing in this repo
  does that today, and it was not built here (explicitly out of scope per this gate's instructions).

**Verdict: BLOCKED**, exactly as instructed as the acceptable default. Task 26 cannot proceed without new
data; Task 25/27 depending on it inherit the same block for the side-specific portion only.

---

## 10. Opportunity-block readiness

Pure wiring task (Task 25): populate `RecommendationOutputV3.opportunity` from whatever `detectSafeCoreWindow`
(§4) returns, omit the field entirely when `isSafeWindow === false`. No new data dependency beyond §4/§6.
**Verdict: READY_WITH_LIMITATIONS**, contingent on A/C being built with correct evidence labelling.

---

## 11. One-ply readiness and perspective-safety assessment

This is the most consequential finding of this re-audit, and it did not exist at Wave 0's audit time.

**What exists and works:** `apps/engine/src/recommendation/lookahead.ts` implements `computeOnePlyLookahead`.
Ran its test suite directly: **18 pass, 0 fail** (`bun test src/recommendation/lookahead.test.ts`). It already
contains its own hidden-information guard, added for "AP Ranked Roles V1 / Wave 2":

```ts
// HIDDEN-INFORMATION GUARD (AP Ranked Roles V1 / Wave 2). If our hypothetical action fills the
// round's last open slot, the kernel closes the round and REVEALS the selections the opponent still
// holds sealed -- information this side does not have. ... the honest answer is "not computed" ...
if (revealsOpponentSealedPicks(state, applied.state, opponentSide)) {
  return { ...deferredFieldsNotComputed(), degradations };
}
```

This guard is real and well-reasoned, but it is **not covered by a dedicated named test** — grepping
`lookahead.test.ts` for `revealsOpponentSealedPicks` returns nothing; the 18 passing tests exercise other
paths. Whether it is indirectly exercised was not traced further (out of this gate's scope — Task 27
explicitly says do not modify or audit `lookahead.ts`'s internals beyond checking its tests pass, which they
do).

**What blocks Task 27:** `computeOnePlyLookahead` is only ever called from
`apps/engine/src/recommendation/build.ts:209` — the **legacy** `buildRecommendationSetV2(authoritativeState)`
path. The Coach path Wave 2/3 actually built — `build-from-perspective.ts`, the **only** builder
`coach/orchestrator.ts` is wired to (confirmed: `orchestrator.ts` references
"`buildRecommendationSetFromPerspective`" by name in its own doc comment, and no file under `coach/` imports
`build.ts`) — hardcodes `deferred: deferredFieldsNotComputed()` in both of its return paths
(`build-from-perspective.ts:102,164`). Its own header comment states why, directly:

```ts
// - `deferred` is always NOT_COMPUTED: the one-ply lookahead needs the kernel to simulate our
//   action, which needs the authoritative state (and, when our action closes the round, a reveal we
//   have not seen). It is not computed on this path, and says so.
```

This is not a bug and not something Task 27 can "wire around" by importing `lookahead.ts` — the whole point
of `PerspectiveRecommendationContext` (per its own module doc, `perspective-context.ts`) is that **it
structurally cannot carry authoritative state, a hidden enemy selection, or Enemy Bot internals.**
`computeOnePlyLookahead` needs exactly the authoritative `DraftProtocolState` to run the kernel-simulation
step. There is no way to give it that without either:

- (a) routing the Coach path through `build.ts`'s legacy, `DraftState`-based construction instead of
  `build-from-perspective.ts` — which is the perspective-safety regression Wave 2 was explicitly built to
  prevent, or
- (b) designing a new, narrower one-ply variant that only consumes what's already legally visible (revealed
  enemies, visible availability, public role beliefs) — exactly what the brief's §7 anticipates as the only
  acceptable shape, and exactly what this gate says to report, not build.

**Verdict: BLOCKED**, for a different and more fundamental reason than tasks.md's own STOP condition
anticipated ("if lookahead's own tests fail"). The tests pass. The architecture the Coach now runs on has no
surface to wire it into. Task 27 as literally written ("wire the existing lookahead… do not modify it") is
not executable without one of the two paths above, and the brief for this gate explicitly forbids choosing
between them here.

---

## 12. Refresh executed

**None.** No repo data file, table, or generated artifact was modified. The four network calls in §7 were
read-only `GET`s against OpenDota's public, unauthenticated `/explorer` (SQL `SELECT` against
`information_schema.columns` and two `count(*)` queries) and `/constants/patch` endpoints — no OpenDota data
was written (impossible via GET anyway), no credentials were used, and no local file was created from the
responses beyond this report quoting them inline. The one existing deterministic pipeline (`runMetaSync`,
confirmed still present and unchanged) was not invoked — running it would rewrite `hero_patch_stats` under
the same stamped label described in F1 and would not answer any provenance question, exactly as Wave 0
concluded.

---

## 13. Source/API limitations discovered

1. OpenDota's `/heroStats` endpoint takes no patch/window parameter (Wave 0 finding, re-confirmed).
2. OpenDota's `public_matches`, `matches`, and `picks_bans` tables (verified live via `/explorer`) carry **no
   `patch` column** — patch identity is derivable only via `start_time` against `/constants/patch`'s
   release-date table, which is itself easy to fetch but requires a join/windowing step that does not exist
   in this repo today.
3. The parsed/pro `matches` table has very low volume (554 rows in the trailing 30 days at audit time) —
   insufficient alone for hero-level, per-bracket win rates; any patch-bounded pipeline would need
   `public_matches` (much larger) or a longer accumulation window.
4. An unfiltered aggregate query over `public_matches` (`count/min/max` over a 7-day `start_time` window)
   timed out after 15 seconds in this environment. A real refresh pipeline against `public_matches` would
   need narrower, more selective queries (or a different ingestion strategy) than the naive one tried here.
5. `getExplorer(sql)`, `getMatchDetail(matchId)`, and `getPatchConstants()` already exist on
   `OpenDotaClient` (`meta/opendota-client.ts`) and are unit-tested there, but have **zero call sites**
   anywhere else in the repo (`scripts/`, `src/meta/sync.ts`) — the low-level capability exists; no pipeline
   consumes it yet.

---

## 14. Product Owner decisions required

Wave 0's own E1–E4 (reproduced from `docs/DATA_FRESHNESS_REPORT.md §4` — still open, this audit did not
resolve them):

- **E1** — what `metaIsStale` should mean (sync-age only, vs. a new `dataPatch != rulesetPatch` mechanism,
  vs. rewriting `design.md §20`).
- **E2** — what "7.41e" means for `patchStats`/`hero_matchups` (keep stamping honestly / record upstream
  window per sync / verify against `/constants/patch`).
- **E3** — accept curated datasets (`hero-positions.json`, `hero-counters.json`, `capabilities.json`) as
  "curated, patch-unverified" permanently, or commission re-verification/regeneration.
- **E4** — Railway production `meta_sync`/`hero_patch_stats` state still cannot be audited from this repo;
  someone with production access must check it separately.

New, from this audit:

- **E5 (new) — One-ply's structural block (§11).** Choose between: (a) do not build Task 27 in any form for
  this product cycle; (b) commission a new, narrower "perspective-safe one-ply" design (a real feature-design
  effort, out of scope for this gate) that only uses revealed/public information; (c) accept the
  perspective-safety regression of routing the Coach path back through the legacy `build.ts` — **not
  recommended**, contradicts Wave 2's explicit design intent and PD-009/Req 12.
- **E6 (new) — Safe Core evidence labelling (§4/§6).** Decide the exact wording the Player sees for
  curated-vs-statistical counter evidence and unverified-patch meta/position data, so Task 24/25's `evidence`
  strings are specified before implementation rather than improvised then.
- **E7 (new, minor) — Orphaned `meta_sync` row (§3).** Whether to add sync-timeout reconciliation now or
  defer; not a Wave 4 blocker, but it means the freshness signal Wave 4 would cite is currently reporting
  "stale" and will keep doing so until someone runs `runMetaSync` again or the code adds a timeout.

---

## 15. Smallest safe Wave 4 scope available now

**Wave 4A — buildable today, no new data, honest labelling only:**
- Task 24 (`detectSafeCoreWindow`) — using existing `counter`/`patch_meta`/`position_fit` signals, evidence
  string explicitly distinguishes curated vs. statistical vs. unverified-patch inputs (resolves E6 first).
- Task 25 (wire `opportunity` block) — depends only on Task 24.
- The banned-hard-counter-context portion of Safe Core (§6) — already computed by production code
  (`BAN_RELIEF`); Wave 4A only needs to surface it labelled.

**Wave 4B — blocked, needs a Product Owner decision or new work before any task starts:**
- Task 26 (side context tiebreaker) — **BLOCKED**, no side-specific data exists at all (§9). Needs Option C
  from below or stays disabled.
- Task 27 (one-ply wiring) — **BLOCKED**, architectural (§11). Needs E5 decided.
- Any UI or evidence string in Wave 4A that would claim "current 7.41f data" for `patch_meta` or
  `position_fit` — **BLOCKED** regardless of Wave 4A/4B split; must say "curated" / "unverified patch
  window" / "last synced <date>," per Wave 0's PO Resolution points 4–6 (still binding).

---

## 16. Features that must remain disabled

- Side context as a tiebreaker (Task 26) — no qualifying data.
- One-ply / opponent-response / steal wiring into `RecommendationOutputV3` (Task 27) — architecturally
  unreachable from the Coach's perspective-safe path.
- Any claim, anywhere in Wave 4's UI copy, that `patchStats`, `hero_matchups`, `hero-positions.json`, or
  `hero-counters.json` reflect **verified** 7.41f data. They may be labelled "current product target
  7.41f, data snapshot unverified / curated," consistent with Axis A vs. Axis B (Wave 0 §1, unchanged).

## 17. Escalation options

**Patch Meta (§7, E1/E2):**
- **Option A** — Keep stamping `CURRENT_PATCH` as today; surface `basedOn.patch` honestly as a label, no
  staleness claim beyond sync-age. *Work: none. Consequence: Wave 4 can ship now, with weaker evidence
  language. Provenance quality: unchanged (UNKNOWN). Scope: no change.*
- **Option B** — Build a small `dataPatch != rulesetPatch` staleness mechanism (compare `CURRENT_PATCH` to
  `RANKED_ALL_PICK_IDENTITY.verifiedThroughPatch` and surface a distinct flag from sync-age staleness).
  *Work: small, isolated (a few functions + a field, no new I/O). Consequence: `design.md §20`'s original
  claim becomes true. Provenance quality: unchanged — this is a UX/flag fix, not a data fix. Scope: could be
  a Wave 4 task or a small Wave 3.5 patch.*
- **Option C** — Build a real patch-bounded snapshot pipeline: `/explorer` SQL over `public_matches`/`matches`
  windowed by `/constants/patch` release dates, new schema field(s) for verified window, new script under
  `scripts/`. *Work: substantial — new pipeline, new schema migration, query-cost design (§13.4), decision on
  `public_matches` vs `matches` tradeoff. Consequence: genuinely verified patch data becomes possible.
  Provenance quality: CURRENT (verifiable). Scope: this is its own project phase, not a Wave 4 task; matches
  the gate's instruction to "STOP and report as an option," not build.*

**Side Context (§9):**
- **Option A** — Keep disabled (current state). *Work: none.*
- **Option B** — N/A: no curated side-specific knowledge exists to fall back to (unlike counters/positions),
  so there is no "curated but labelled" middle option here.
- **Option C** — Build a side-differential dataset from `public_matches` (`radiant_win`, `radiant_team`/
  `dire_team`, `avg_rank_tier`) windowed the same way as Patch Meta Option C. *Work: substantial, and shares
  infrastructure with Patch Meta Option C — doing them together would be more efficient than separately.
  Consequence: Req 3.6 / PD-006's "sufficient evidence" bar becomes reachable. Scope: new project phase.*

**Hero Counters / Safe Core evidence labelling (§6, E6):**
- **Option A** — Disable Safe Core / banned-counter-context entirely until statistical, patch-bound counter
  data exists. *Work: none. Consequence: Wave 4 ships nothing new here — but note `BAN_RELIEF` already runs
  unlabelled in production `counter.raw` today regardless, so this option doesn't actually remove the
  underlying behavior, only the explicit surfacing of it.*
- **Option B** — Ship Task 24/25 using curated evidence, explicitly labelled "curated" wherever shown.
  *Work: the wiring task as scoped, plus finalizing evidence-string wording (E6). Consequence: matches what
  is already live; makes it visible and honest instead of buried in `counter.raw`. Recommended.*
- **Option C** — Commission a statistically-verified, patch-bound counter dataset before surfacing anything.
  *Work: same substantial pipeline as Patch Meta Option C, applied to hero-vs-hero pairs. Scope: new project
  phase.*

**One-ply (§11, E5):**
- **Option A** — Do not build Task 27 this cycle. *Work: none.*
- **Option B** — Design (separately, not in this gate) a genuinely perspective-safe one-ply that consumes
  only revealed enemies, visible availability, and public role beliefs — no kernel counterfactual simulation
  of a hidden reveal. *Work: a real design task with its own STOP/escalation discipline, likely comparable in
  size to Wave 2's own orchestration work. Consequence: Req-compliant one-ply becomes possible without
  touching `lookahead.ts`. Scope: its own wave, not a Task-27-sized wiring job.*
- **Option C** — Route the Coach path through legacy `build.ts` to reach the existing `lookahead.ts`.
  **Not recommended** — this is exactly the perspective-safety regression Wave 2 was built to prevent
  (PD-009, Req 12); flagged here only because the gate asked for 2–3 concrete options, not because it should
  be chosen.

---

## 18. Files created/changed by this audit

- **Created:** `docs/diagnostics/WAVE4_DATA_READINESS.md` (this file).
- **Not modified:** `docs/DATA_FRESHNESS_REPORT.md` (Wave 0's report — left exactly as written, per this
  gate's explicit instruction).
- **No other repo file was created, edited, or deleted.** A scratch script
  (`C:\Users\APU\AppData\Local\Temp\...\query_meta.ts`, outside the repo) was used to run three read-only
  SQLite `SELECT` queries against `apps/engine/data/dota2coach.sqlite` (opened with `{ readonly: true }`);
  it was not committed and touches nothing under the repo root.

## 19. git diff summary

No tracked files were changed by this audit. `git status` before and after this audit is identical except
for the addition of this new untracked file.

## 20. git status (at time of writing this report)

```
On branch r1/product-certification
Untracked files:
  docs/diagnostics/ap-solo-mid-dota-judge.json
  docs/diagnostics/ap-solo-mid-dota-judge.md
  docs/diagnostics/ap-solo-mid-final-dota-judge.json
  docs/diagnostics/ap-solo-mid-final-dota-judge.md
  docs/diagnostics/WAVE4_DATA_READINESS.md   <- new, this report
  scripts/hooks/__pycache__/
```

The four `ap-solo-mid-*` files and `scripts/hooks/__pycache__/` predate this audit (present at session
start, per the conversation's initial git-status snapshot) and were not created or modified by this work.

---

## Summary table (Product Owner quick reference)

| Capability | Status | Evidence | Limitation | PO decision needed |
|---|---|---|---|---|
| Safe Core (core logic) | READY_WITH_LIMITATIONS | counter + hard-counter list + patch_meta + position_fit, all live | Inputs are curated/unverified-patch | E6 (evidence wording) |
| Counters (curated) | READY_WITH_LIMITATIONS | `hero-counters.json`, human-reviewed | No patch claim | E3 |
| Counters (statistical) | READY_WITH_LIMITATIONS | `hero_matchups`, 15,982 rows, minGames=10 shrinkage | No patch column, ever | E1/E2 |
| Banned-counter context | READY_WITH_LIMITATIONS (already live) | `BAN_RELIEF` in `counter.ts`, TSK-188 | Curated only | E6 |
| Patch Meta | BLOCKED (verified claims) / READY_WITH_LIMITATIONS (disclosed label) | `hero_patch_stats`, 1,016 rows, stamped `7.41e` | No patch window ever recorded by OpenDota; currently sync-stale | E1/E2, Option C if pursued |
| Position Fit | READY_WITH_LIMITATIONS | `hero-positions.json`, 371,313 position-matches | Manual, unscripted, no patch verification; separate purity-scoring caveat | E3 |
| Side Context | BLOCKED | none exists | No data source at all | Option C if pursued |
| Opportunity block | READY_WITH_LIMITATIONS | wiring only | Contingent on Safe Core | — |
| One-ply | BLOCKED | `lookahead.ts` passes its own tests | Architecturally unreachable from Coach path | E5 |

**Recommendation (not a decision):** proceed with **Wave 4A only** (Tasks 24–25, curated/labelled Safe Core
and banned-counter context) after the Product Owner resolves E6 (evidence wording) and re-affirms Wave 0's
E1–E4 stance. Leave Task 26 and Task 27 out of this wave entirely — both need decisions (E5, side-context
Option C) that are product/architecture calls, not data-readiness technicalities this gate can resolve.
