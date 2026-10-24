# F2 — development gates in this worktree

## Hooks: what was wrong and what runs now

`core.hooksPath` is `.husky/_` in the shared `.git/config`. `.husky/_` is generated and untracked, so a new `git worktree add` has the setting but not the directory, and **git silently runs no hook**. That is how the F1 checkpoint was pushed without the pre-push gate.

In this worktree `.husky/_` was copied from a working one. Verified: `git hook list pre-commit` and `pre-push` resolve; `git hook run pre-commit` runs (`lint-staged` message). The directory is untracked: **check it exists before every push** (`ls .husky/_`), and for a new worktree copy it first.

| Hook | Actually runs |
| --- | --- |
| pre-commit | `bunx lint-staged` — ESLint (`apps/web`), `tsc` (`apps/engine`), `bun test scripts` when relevant files are staged |
| pre-push | `bun run test` (engine, web, scripts, separately) · `tsc --noEmit` engine · `tsc --noEmit` web |

**Rule for F2:** no push without knowing which of those ran. A push log is kept (`tee`) and the result of each step is reported, never summarized as "gate passed".

## Pre-existing Companion timeouts (documented separately, not F2's)

`apps/web/server/companion/companion-installer.test.ts` — tests that drive **real PowerShell**:

- `Companion runtime (real PowerShell, fake D2KIRO server)`: relays GSI, ban events, draft window, heartbeat redirect.
- `D2KIRO Visual runtime supervision (real PowerShell, stub helper, fake release)`: download+SHA, SHA mismatch, helper restart, cleanup.

They time out (≈ 60 s each). Seen on the F1 line: 6 failures on one run, 8 on another, same tests family, same code: **intermittent, environmental, unrelated to the engine or to F2**. They make `bun run test` (and therefore pre-push) exit 1 on this machine. They are **not** declared PASS anywhere. Until they are fixed in their own ticket, a push needs an explicit per-push authorization for `--no-verify`, with the other gates (engine, scripts, `tsc` ×2, web lint) run and reported by hand.
