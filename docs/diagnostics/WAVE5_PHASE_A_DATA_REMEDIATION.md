# WAVE5_PHASE_A_DATA_REMEDIATION — Certification Remediation, Phase A

**State: `BLOCKED_ON_SOURCE_DATA`.** A1 and A3 are done and verified. A2 cannot be completed: the raw per-position counts below the 200-match floor were never retained and the only source (Dota2ProTracker) answers 403 to an automated browser. The Dota re-judge must not run yet.

Nothing was committed, pushed or merged. V6 weights, RB-1–RB-4 behavior, `metaIsStale`, UI messaging, readiness contracts and capabilities fallback were not touched.

## What is and is not established

| Gate | Result |
| --- | --- |
| A1 — frozen empirical snapshot with honest provenance | **Done.** `eval/snapshots/W5-EMP-001.{sqlite,provenance.json}`, verified. |
| A2 — positional data rebuilt from retained raw counts | **Blocked.** Mechanism, importer and tests exist; the raw data does not. |
| A3 — immutable evidence bound to code + data | **Done.** Identity embedded in every new packet; isolated worktree used. |
| Regression (all three test roots) | **Green** in the isolated worktree. |
| Reproducibility | **Proven.** The frozen-snapshot packet equals the previous post-fix packet byte for byte. |

## A1 — empirical snapshot `W5-EMP-001`

Frozen from the live dev DB (source sha256 `4ed064a3…e532`, last written 2026-09-19 15:50 local — before every earlier Wave 5 packet, so it is the same content those packets used). Only the meta tables were copied; no accounts, pools or teams (personal data). Physical row order is preserved and asserted, because `loadMeta` reads without `ORDER BY` and the logical fingerprint sorts canonically and would not notice a reorder.

| Field | Value |
| --- | --- |
| file sha256 | `c02078b82b152770151b81d27d857d30e188fbf545a5c813f3123eff13577853` |
| logical fingerprint | `meta1:32ea4d5fc841cb53c9483179c1374491221b22a550678f342c5c79081d189e73` |
| provenance sha256 | `e00376cdd577c618d3caf709cfbb573cc7ef8688473965d74fd4e58a307b1d51` |
| rows | 127 heroes · 1016 patch stats · 15,982 matchups (127 heroes) |
| source | OpenDota `/heroes`, `/heroStats`, `/heroes/{id}/matchups`; no patch, rank or window parameter sent |
| retrieval window | 2026-09-18T01:11:38Z → 2026-09-19T20:49:59Z |
| patch claim | label `7.41e`, **verified: false** — applied by our ingestion, OpenDota reports no patch |
| ruleset target | `7.41f` — product target, kept separate from the data claim |
| observation window | **null** — unknown, not assumed equal to any patch |

Facts the provenance now states instead of hiding:

- Sync run #3 is recorded as `running` and never finished. 119 heroes' matchups come from that run (2026-09-19), 8 heroes' from run #2 (2026-09-18). Each hero's block is internally consistent, but the blocks were retrieved a day apart.
- The `immortal` bracket has zero picks for all 127 heroes.
- `hero_matchups` has no patch or bracket column, so it can never be attributed to a patch.

The `7.41e` rows were **not** relabelled. The live ingestion code still stamps the label; persisting provenance at ingestion time is deferred (it needs a migration and belongs with Phase B).

## A2 — positions

Raw sub-floor counts were discarded at collection and are not recoverable. I probed the source once (headless Edge: 403 challenge; visible Edge: navigation aborted) and stopped there — going further would mean evading bot protection.

What could be established rigorously from the legacy file (`WAVE5_POSITION_DATA_AUDIT.md`): each unlisted position is < 200, so a listed position's true share lies in `[m/(S+k·199), m/S]`. Dominance can never be overturned; share admissions (≥ 25%) can only be overturned, never added. The corrected candidate universe is therefore a **subset** of the current one.

| Position | Currently admitted | Guaranteed | Unproven |
| --- | --- | --- | --- |
| Pos1 | 38 | 35 | 3 |
| Pos2 | 23 | 22 | 1 |
| Pos3 | 34 | 32 | 2 |
| Pos4 | 29 | 24 | 5 |
| Pos5 | 35 | 33 | 2 |

The 13 unproven admissions are exactly the 13 heroes the forensic review named. True shares: Razor Pos1 19.2–30.4% · Riki Pos1 21.2–46.7% · Chaos Knight Pos1 21.2–40.5% · Necrophos Pos2 24.9–26.6% · Earthshaker Pos3 23.4–25.7% · Marci Pos3 24.4–27.3% · Venomancer Pos4 22.4–38.7% · Pugna Pos4 24.3–43.5% · Enchantress Pos4 21.7–30.3% · Gyrocopter Pos4 20.7–38.6% · Silencer Pos4 21.3–27.8% · Dark Willow Pos5 22.9–26.1% · Hoodwink Pos5 24.5–26.7%. **No hero was forced in or out.**

Chen has no retained position evidence: **UNAVAILABLE** (`position_fit` `raw: null`); no position is invented.

Engine change (`hero-positions.ts`): denominator and admission floor are now separate steps. A new `hero-position-observations/v1` file retains every observed row; `heroTotalMatches` (sum of all observations) is the denominator for `positionShare()`; the floor is applied afterwards. The legacy array format still loads unchanged, so current behavior is identical. Tests prove the same evidence admits a secondary position under the old denominator and rejects it under the complete one.

To unblock: run `bun scripts/positions/scrape-d2pt.ts --out=<dir>` on a machine where a person can clear the Cloudflare check in the visible browser (**unverified against the live DOM**), then `scripts/positions/import-observations.ts`, then repeat the certification sequence below. Alternatively the owner can decide a policy for unprovable admissions — that is a product decision I did not make.

## A3 — evidence identity and isolation

The working tree mixed Wave 5 work with Wave 1/2 diagnostics. Nothing was stashed, reset or deleted. `scripts/wave5/certification-worktree.ts` made a **detached git worktree at HEAD** and copied in only the classified Wave 5 + Phase A files (68); 10 dirty paths were excluded with a written reason each, and an unclassified path aborts. Worktree files were checked byte-identical to the main tree's.

Certified state, from `WAVE5_DOTA_JUDGE_PHASEA_REPRO` and `WAVE5_AUTOMATED_EVIDENCE_PHASEA` (both report the same key):

| Item | Value |
| --- | --- |
| git HEAD | `6c9e5fffe8531a3f6d034af285fef911be2d09a4` |
| isolation | linked worktree, 57 paths differ from HEAD |
| dirty-diff hash | `6d6d3d94d4df22d39be4d86ec4ef52bc6e13175f0fe33aa47dfc55e154cb03d1` |
| code-state hash | `7c71a2dd8ae75379964a6da8573d1e7c7f5f26902548d4b4e5dd1d09bd8cd884` |
| comparable key | `eb597d4c92ca32f1876eabb876226f4c33de5c8d5850fa8b6a1dab9a4b9cc71e` |
| positions file sha256 | `bc93884e1c733e05668c3627196c0901d9dca7ad0b15a337278bb35277047244` (v1, floor-truncated, denominator NOT corrected) |
| hero-counters / capabilities | `0c2be735…3f4b` / `8ac9d228…f120` |
| generated data | percentiles `9e871e50…`, signal-profile `452627a2…`, tolerance `ea3193f6…` |

Each packet also carries its timestamp and reproduction commands. Historical packets were not overwritten; the generators now refuse to. `bun scripts/wave5/evidence-identity.ts --compare=A.json,B.json` names which facet (code, snapshot, positions, mode…) differs. The earlier packets have no identity, so they cannot be bound retroactively; equivalence is shown by reproduction instead.

## Regression and comparisons

- Tests in the isolated worktree: engine **1488 pass**, web **277 pass**, scripts **443 pass**, 0 failures. Engine `tsc` clean. `verify-simplicity.sh` PASS.
- Soak `WAVE5_AUTOMATED_EVIDENCE_PHASEA`: PASS — 600/600 drafts, 3,094 states, twins 345/345, separation 416/416, 0 bad statuses, p95 62.8 ms. Every count equals the earlier evidence file (`QA_CALIBRATION.md` quotes 3,112 states, which is stale).
- **Empirical-snapshot-only change:** frozen-snapshot packet vs previous post-fix packet = **0 changes in 24 decision points**, same drafts. The freeze altered nothing.
- **Position-data-only change:** cannot be measured — the corrected data does not exist.
- **RB-1–RB-4:** no regression (identical output, all related tests green).
- **Sensitivity envelope** (synthetic widest denominators, labelled as not the corrected data): 12 of 24 points move; 10 of 22 like-for-like (S07's draft diverges through the Enemy Bot). 6 personal-ranking and 4 shortlist changes. So the outcome **does depend** on the true denominators.
- **"Zero off-role":** 0 pairs are provably off-role, but 7 of 202 graded hero/position pairs (all personal-ranking: Chaos Knight ×4, Riki, Marci, Silencer) rest on admissions the data cannot prove. The claim was computed with the same predicate that filters the list, so it cannot be certified until the raw counts exist.

## Unresolved limitations

1. Raw sub-floor position counts (the blocker above).
2. Patch attribution of all empirical data is label-only and unverified; the observation window is unknown.
3. Snapshot mixes two retrievals (interrupted sync #3); the `immortal` bracket is empty.
4. `position_fit`, `position-prior`, KNN and the pipeline still renormalize over listed positions — the same inflation, in V6 scoring I was told not to touch.
5. The soak's positional-validity checks use the same dataset, so they cannot detect a defect in it (now stated in its header).
6. `hero-positions.ts` header step 5 ("filter by MIN_POSITION_MATCHES before saving") is superseded by the v2 pipeline; left as-is so certified hashes stay valid. Docs-only follow-up.
7. The scraper is unverified against the live site. The snapshot is not committed (`.gitignore` exception added so it can be).

## Reproduce

```
bun scripts/eval/freeze-empirical-snapshot.ts --verify=W5-EMP-001
bun scripts/wave5/certification-worktree.ts --dir=<outside repo>
# inside it:
bun scripts/wave5-dota-judge-packet.ts --suffix=_X --pin-from=WAVE5_DOTA_JUDGE.json --certification-id=<id>
bun scripts/wave5-certification.ts --suffix=_X --certification-id=<id>
bun scripts/positions/audit-bounds.ts --snapshot=eval/snapshots/W5-EMP-001.sqlite --packet=<packet.json> --out=<name>
# cleanup (unlinks node_modules junctions first):
bun scripts/wave5/certification-worktree.ts --remove=<dir>
```
