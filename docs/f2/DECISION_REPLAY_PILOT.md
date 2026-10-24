# F2 — Decision Replay: audit and pilot

Branch `f2/strategic-intelligence`, created from `checkpoint/f1-v1` (`04a1e7c`). F1, its tag and its branch are untouched.

## 1. What the current exam persists (audit)

| Artifact | Keeps | Does not keep |
| --- | --- | --- |
| `ENGINE_P1_EXAM_F1_FINAL.json` | identity (code, data, `comparableKey`), config, **aggregates** of 622 states, 18 judge-packet situations (hero names, top-3, risks), 12 changed-decision pairs, M1 cases | the 622 states themselves |
| `ENGINE_P1_EXAM_F1_FINAL.md` | the same, in prose | the same |
| in memory only (`ExamState[]`, `session.ts`) | every state: bans, own picks, revealed rivals, V3 list, Board columns, V4 cards, scoring fields | lost when the process ends |

Gaps for a same-moment comparison:

1. **No state snapshots.** The 622 states exist only while the exam runs. The report cannot be re-asked.
2. **Own picks carry no assigned position** in `ExamState` (the position lives in the session store, not in the state).
3. **No Hero Pool** is stored (only the account label drove it) and no hidden-enemy-slot count.
4. **Re-driving from the seed is not a valid replay.** `postAutoDrive` makes the Enemy Bot (and the Ally Bot) choose through the engine's own scoring (`chooseEnemyBotHero`, `computeSuggestions`). Change the scorer and the enemy picks differ, so the later states differ. A seed is a recipe for F1 only.
5. The exam's reproducibility (byte-identical reports) holds for **the same code**. It says nothing about comparing two versions.

## 2. The minimum Decision Replay (`scripts/p1-exam/replay.ts`)

A **moment** stores the state, not the path:

- `visible` (what a version may see): round, side, bans, own picks **with assigned positions**, revealed rivals, number of hidden enemy slots, actionable positions, the Player's position.
- `pool`: the Hero Pool by value (synthetic account A/B, never a real Steam id).
- `reconstruction`: the commands that rebuild the kernel state through the real routes, without any bot: resolved bans, the Player's seals (with `assignedPosition`), the enemy's recorded seals.
- `visibleFingerprint = sha256(canonical(visible, pool))`.

Replay: create the session, record the bans, apply the commands (enemy first, as the simulator does), recompute `visible`, **refuse to compare if the fingerprint differs from the captured one**, then ask the same three surfaces the exam reads (Team Coach Board, V4 cards, V3 list) and fingerprint the answer (heroes, order, reasons, risks; no timings).

**No information from future picks.** `commandsFor` never issues a command from a later round than the moment (test, verified red by removing the bound). The current round's enemy seals are already sealed when the Player decides, so they are needed to rebuild the state; they are stored under `reconstruction`, not under `visible`, and the engine only ever sees the perspective view (hidden slots stay hidden).

Known boundary: moments after a collision (the bans changed) are skipped, not repaired.

## 3. Pilot result (F1 on itself)

6 simulator drafts (`AUDIT001`–`AUDIT003`, both sides, 3 policies, Player positions 1–5) gave 27 moments; **17 kept**, spread by round (R1 6 · R2 6 · R3 5), both sides, all five positions. One draft was cut by a collision (skipped, reported).

| Check | Result |
| --- | --- |
| State rebuilt = captured state (fingerprint) | **17/17** |
| F1 vs F1, two separate processes: same recommendations and reasons | **17/17 identical**; the two result files are byte-identical (`9c5568d1…`) |
| Hidden enemy hero leaked into `visible` | 0 |
| Commands from later rounds in a recipe | 0 |
| Sensitivity control: same moments, **different data snapshot** (`S1`) | 16/17 differ (board ranking 16, V4 cards 12); states still reproduce 17/17 |
| Tamper control: one assigned position changed in the recipe | state **not** reproduced, moment not compared |

So the harness (a) rebuilds the same decision for any version, (b) says "identical" only when it is, (c) detects a real change in what the engine is given, and (d) refuses a recipe that does not rebuild the state.

Files: `eval/replay/pilot-v1.moments.json` (sha256 `53c1671a…`), `eval/replay/pilot-v1.f1-reference.json` (F1's answers). Tests: `scripts/p1-exam/replay.test.ts` (inline fixtures only).

## 4. What is still missing to compare F1 vs F1+F2 exactly

1. **A bigger moment set.** 17 is a smoke test. The F2 experiment needs the states of the 120 AUDIT drafts (≈ 622 moments). Capturing is a cheap run (no peeled-field scoring), but it drives drafts again, so it needs your go-ahead.
2. **A version switch.** Replay runs the code of the checkout. Comparing two versions today means two worktrees (F1 tag, F2 branch) and `--compare` over the two result files. That is enough for E1; the four-version lab is not built.
3. **Metrics on replay results** (gap-fill rate, exposure, changed-decision rate) are not in `replay.ts` yet; E1 defines them.
4. **Judge packet fixes** from `docs/diagnostics/F1_CLOSURE.md` §3 (print the Board column's cards; print every CRITICAL_GAP card) before any new blind evaluation, with a salted key commitment from the start.
