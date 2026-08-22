# Implementation Plan: Engine Performance Optimizations

## Overview

Eight targeted optimizations across the D2KIRO engine and React frontend: a SQLite index, cache coherence fixes, a module-level hero-positions constant, an LRU query cache, WebSocket reconnect resilience, a static meta seed fallback, token-level rate limiting, and React memoization. All changes are additive — no user-visible behavior changes.

Implementation language: **TypeScript** (Bun runtime for engine, Next.js 14 for web).

---

## Tasks

- [x] 1. SQLite index migration for hero_matchups(vs_hero_id)
  - [x] 1.1 Create migration file `apps/engine/src/db/migrations/0004_vs_hero_idx.sql`
    - Write `CREATE INDEX IF NOT EXISTS idx_hero_matchups_vs_hero_id ON hero_matchups(vs_hero_id);`
    - Update `apps/engine/src/db/migrations/meta/_journal.json` to register the new migration entry following the existing pattern
    - _Requirements: 1.1, 1.2, 1.4_

  - [-]* 1.2 Write integration test for migration and index usage
    - Apply migration against an in-memory SQLite DB; assert index entry exists in `sqlite_master`
    - Apply migration on a DB pre-populated with `hero_matchups` rows; assert row count unchanged
    - Run `EXPLAIN QUERY PLAN` for a `vs_hero_id` equality filter; assert the plan references `idx_hero_matchups_vs_hero_id`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. MetaSnapshot cache coherence
  - [x] 2.1 Add `invalidateMetaSnapshotCache()` call in `handleSettingsPut` in `apps/engine/src/server/app.ts`
    - After `upsertSetting` returns, check if `body.key === "personal_baseline_winrate"` and call `invalidateMetaSnapshotCache()` when true
    - _Requirements: 2.3_

  - [x] 2.2 Audit and harden `runMetaSync` in `apps/engine/src/meta/sync.ts`
    - Verify the catch block calls `invalidateMetaSnapshotCache` before returning; add `try/finally` if any exception path could bypass it
    - Confirm `getCachedMetaSnapshot` in `apps/engine/src/meta/provider.ts` only assigns to `cachedSnapshot` after `buildMetaSnapshot` resolves (not on throw)
    - _Requirements: 2.1, 2.5_

  - [-]* 2.3 Write unit tests for cache coherence
    - `PUT /api/settings` with key `"personal_baseline_winrate"` → spy confirms `invalidateMetaSnapshotCache` was called
    - `PUT /api/settings` with any other key → spy confirms `invalidateMetaSnapshotCache` was NOT called
    - Simulate `buildMetaSnapshot` throwing → assert `cachedSnapshot` remains `null` after the call
    - _Requirements: 2.3, 2.4, 2.5_

  - [-]* 2.4 Write property test for cache reference identity (Property 1)
    - **Property 1: Cache reference identity**
    - Generate N ∈ [1, 50] sequential calls to `getCachedMetaSnapshot` with no intervening invalidation; assert all returned values are the same object reference (`===`)
    - **Validates: Requirements 2.4**

- [x] 3. Hero positions loaded once at module initialisation
  - [x] 3.1 Move `loadHeroPositions()` to a module-level constant in `apps/engine/src/signals/mix.ts`
    - Declare `const MODULE_HERO_POSITIONS: HeroPositions = loadHeroPositions();` at module scope
    - Update `buildSuggestions` to use `options.heroPositions ?? MODULE_HERO_POSITIONS` instead of calling `loadHeroPositions()` inline
    - Keep `BuildSuggestionsOptions.heroPositions` override intact (test seam S10)
    - _Requirements: 3.1, 3.2, 3.3_

  - [~]* 3.2 Write unit test for single-load behaviour
    - Spy on `loadHeroPositions`; import `mix.ts`; call `buildSuggestions` N times without override; assert spy was called exactly once (at module load)
    - _Requirements: 3.1, 3.2_

  - [~]* 3.3 Write property test for hero positions override (Property 2)
    - **Property 2: Hero positions override is respected**
    - Generate arbitrary `HeroPositions` maps injected as `options.heroPositions`; assert `createPositionFitScorer` is called with the injected map and not with `MODULE_HERO_POSITIONS`
    - **Validates: Requirements 3.3**

  - [~]* 3.4 Write property test for parseHeroPositions filtering (Property 3)
    - **Property 3: parseHeroPositions filters to valid entries only**
    - Generate arrays mixing valid and invalid hero position entries; assert output map keys match exactly the valid-entry hero IDs; assert all-invalid input returns an empty map
    - **Validates: Requirements 3.4**

- [x] 4. LRU query cache for hero matchup winrates
  - [x] 4.1 Create `apps/engine/src/db/lru-cache.ts`
    - Implement `LRUCache<K, V>` interface with `get`, `set`, `has`, `clear`, and `size`
    - Implement `createLRUCache<K, V>(capacity: number)` using a `Map` (insertion-order LRU: delete + re-insert on access, evict first key on overflow)
    - _Requirements: 4.1, 4.3_

  - [x] 4.2 Integrate LRU into `apps/engine/src/meta/provider.ts`
    - Instantiate `matchupLRU = createLRUCache<string, number>(512)` at module scope
    - Update `invalidateMetaSnapshotCache` to call `matchupLRU.clear()` in addition to nulling `cachedSnapshot`
    - Export `getMatchupLRU()` and `setMatchupLRU(cache)` for test injection
    - Wire matchup lookups inside `buildMetaSnapshot` (or its helpers) to go through `matchupLRU` using key `"${heroId}:${vsHeroId}"` — query SQLite on miss, populate LRU, return cached value on hit
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6_

  - [-]* 4.3 Write unit tests for LRU cache
    - Insert 513 entries with capacity 512 → assert `size === 512` and the oldest entry is evicted
    - Call `invalidateMetaSnapshotCache()` → assert `matchupLRU.size === 0`
    - Inject a pre-populated LRU via `setMatchupLRU`; perform lookup → assert DB mock not called
    - Perform lookup on empty LRU → assert DB mock called once, result stored in LRU, second lookup hits cache
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [~]* 4.4 Write property test for LRU eviction (Property 4)
    - **Property 4: LRU evicts least-recently-used at capacity**
    - Generate sequences of insertions and accesses reaching 512-entry capacity followed by one new insertion; assert the entry accessed least recently is the one evicted
    - **Validates: Requirements 4.3**

  - [~]* 4.5 Write property test for LRU cache hit (Property 5)
    - **Property 5: LRU cache hit returns stored value without DB query**
    - For any `(heroId, vsHeroId)` pair inserted into the LRU with a winrate value, assert a subsequent retrieval returns that value and the DB mock is not called
    - **Validates: Requirements 4.4**

  - [~]* 4.6 Write property test for LRU cache miss populates cache (Property 6)
    - **Property 6: LRU cache miss populates cache for subsequent hit**
    - For any `(heroId, vsHeroId)` pair absent from the LRU, assert the DB is queried once, the result is stored, and a second lookup returns the same value without querying the DB
    - **Validates: Requirements 4.5**

- [~] 5. Checkpoint — engine data layer
  - Ensure all tests pass for tasks 1–4 before proceeding. Ask the user if questions arise.

- [x] 6. MetaSnapshot cache coherence: WebSocket reconnect resilience
  - [x] 6.1 Add `SnapshotUnavailableError` sentinel class and restructure `hello` handler in `apps/engine/src/server/app.ts`
    - Define `class SnapshotUnavailableError extends Error` at the top of `app.ts` (or a shared errors module)
    - Inside `computeSuggestionsForState`, wrap `getCachedMetaSnapshot` in a try/catch that rethrows as `SnapshotUnavailableError`
    - Restructure the `hello` branch: send `snapshot` message first (before suggestion computation); wrap suggestion computation in try/catch; on `SnapshotUnavailableError` send `error` message `{ code: "snapshot_unavailable" }` and keep connection open; on any other rejection send degraded `suggestions` message with `degraded: ["partial_signals"], suggestions: []`
    - _Requirements: 5.1, 5.2, 5.4, 5.5_

  - [~]* 6.2 Write unit tests for WebSocket reconnect resilience
    - Simulate `getCachedMetaSnapshot` throwing → assert `error` message with `code: "snapshot_unavailable"` is sent and WebSocket is not closed
    - Simulate `computeSuggestionsForState` rejecting (non-snapshot error) → assert `suggestions` message with `degraded: ["partial_signals"]` is sent
    - Assert `snapshot` message is sent before any suggestion or error message (message ordering)
    - _Requirements: 5.1, 5.2, 5.4, 5.5_

- [x] 7. Static meta fallback seed for empty hero_patch_stats
  - [x] 7.1 Create `apps/engine/src/meta/seed-hero-stats.json` and `apps/engine/src/meta/seed.ts`
    - `seed-hero-stats.json`: a `RawHeroStatsRow[]` array representing the last known good patch state (populate with realistic hero stats matching the current patch)
    - `seed.ts`: export `getValidatedSeed(): RawHeroStatsRow[]` — lazy-initialise from the JSON file, filter using `isValidRawHeroStatsRow` from `validation.ts`, log a warning if all rows fail validation, and return the filtered array (or `[]` on any import error)
    - _Requirements: 6.1, 6.4_

  - [x] 7.2 Integrate seed fallback into `buildMetaSnapshot` in `apps/engine/src/meta/provider.ts`
    - After reading `hero_patch_stats` rows: if `patchStatRows.length > 0` use DB rows exclusively; if `patchStatRows.length === 0` call `getValidatedSeed()` and build `patchStats` from seed data using `mapHeroStatsRow` / `buildPatchStatsFromRaw`
    - If seed is empty or missing, continue with empty `patchStats` map (log error, do not throw)
    - _Requirements: 6.2, 6.3_

  - [~]* 7.3 Write unit tests for seed fallback
    - `buildMetaSnapshot` with zero `hero_patch_stats` rows → assert `patchStats` is populated from seed data
    - `buildMetaSnapshot` with 1+ DB rows → assert seed is never consulted and `patchStats` matches DB rows
    - Inject invalid seed via `setValidatedSeed` (or equivalent test seam) → assert warning is logged and `patchStats` is empty map
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [~]* 7.4 Write property test for DB rows precedence over seed (Property 7)
    - **Property 7: DB rows take precedence over seed data**
    - Generate non-empty `heroPatchStats` row arrays; assert `buildMetaSnapshot` output `patchStats` is derived exclusively from those rows with no seed contribution
    - **Validates: Requirements 6.3**

- [x] 8. Token-level rate limiting on /ingest/draft-event
  - [x] 8.1 Add `TokenRateLimiter` interface and `createTokenRateLimiter` factory to `apps/engine/src/server/edge.ts`
    - Export `TokenRateLimiter` interface with `allow(token: string, now?: number): boolean`
    - Implement `createTokenRateLimiter()`: sliding window, 200 events/token/second, using `Map<string, number[]>` of timestamps; filter stale timestamps on each call
    - _Requirements: 7.1, 7.5, 7.6_

  - [x] 8.2 Wire `TokenRateLimiter` into `AppDeps` and `handleDraftEvent` in `apps/engine/src/server/app.ts`
    - Add `tokenRateLimiter?: TokenRateLimiter` to the `AppDeps` interface (optional, injectable for tests)
    - In `handleDraftEvent`, insert token rate-limit check after capture-token validation and before session rate-limit check: call `tokenRateLimiter?.allow(captureToken)`, return `Response.json({ error: "rate_limit_exceeded", scope: "token" }, { status: 429 })` on rejection
    - Update the existing session-limit rejection to return `Response.json({ error: "rate_limit_exceeded", scope: "session" }, { status: 429 })` for consistency
    - Emit structured log entry (timestamp, scope, sessionId, sourceIp) on any rate-limit rejection using `JSON.stringify` to stdout
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [-]* 8.3 Write unit tests for token rate limiting
    - 200 requests within 1s for the same token → all return 202
    - 201st request within 1s → 429 `{ error: "rate_limit_exceeded", scope: "token" }`
    - Session limit exhausted before token limit → 429 with `scope: "session"`
    - Structured log entry on rejection contains all required fields (timestamp, scope, sessionId, sourceIp)
    - After 1s window (mock clock via injected `now`) → next 200 requests allowed
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [~]* 8.4 Write property test for token rate limiter window reset (Property 8)
    - **Property 8: Token rate limiter resets after window expiry**
    - For any capture token, exhaust the 200-event budget within a 1s window, advance mock clock by ≥ 1000ms, assert the next 200 events are all allowed
    - **Validates: Requirements 7.5**

  - [~]* 8.5 Write property test for cross-session token aggregation (Property 9)
    - **Property 9: Token rate limit applies across session IDs**
    - Generate a capture token and N session IDs; distribute events across sessions until the combined count reaches 200; assert the 201st event is rejected regardless of which session ID it uses
    - **Validates: Requirements 7.1**

- [~] 9. Checkpoint — engine server layer
  - Ensure all tests pass for tasks 6–8 before proceeding. Ask the user if questions arise.

- [x] 10. React memoization of DraftBoard and SuggestionCard
  - [x] 10.1 Wrap `SuggestionCard` with `React.memo` in `apps/web/components/suggestion-card/SuggestionCard.tsx`
    - Change the export from a plain function/const to `export const SuggestionCard = memo(function SuggestionCard(...) { ... })`
    - Add `import { memo } from "react"` if not already present
    - _Requirements: 8.1, 8.3_

  - [x] 10.2 Wrap `DraftBoard` with `React.memo` in `apps/web/components/draft-board/DraftBoard.tsx`
    - Change the export to `export const DraftBoard = memo(function DraftBoard(...) { ... })`
    - Add `import { memo } from "react"` if not already present
    - _Requirements: 8.2, 8.5_

  - [x] 10.3 Stabilize `handleQuickPick` and `buildReason` derivation in `ActiveDraftState` inside `apps/web/features/draft/DraftView.tsx` (or the relevant component file)
    - Wrap `handleQuickPick` with `useCallback`, keyed on `[sessionId, draftState.localSide, draftState.lastSeq]`
    - Add a `useMemo` for any per-render `buildReason`-equivalent derivation (explanation strings from `suggestions`), keyed on `[suggestions]`
    - _Requirements: 8.4_

  - [~]* 10.4 Write unit tests for React memoization
    - Render `SuggestionCard` twice with identical prop references; assert render function called exactly once (use a render-count wrapper)
    - Render `DraftBoard` twice with identical `draftState` and `heroCatalog` references; assert no second render
    - Provide a new `SuggestionSet` where one suggestion object changes; assert only that one `SuggestionCard` re-renders
    - Change `heroCatalog` reference; assert all components receiving it re-render
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

  - [~]* 10.5 Write property test for React.memo skipping re-render on reference-equal props (Property 10)
    - **Property 10: React.memo skips re-render on reference-equal props**
    - Generate prop sets where all props are reference-equal to the previous render; assert render function call count does not increase for `SuggestionCard` or `DraftBoard`
    - **Validates: Requirements 8.1, 8.2**

  - [~]* 10.6 Write property test for per-suggestion re-render isolation (Property 11)
    - **Property 11: Memoized SuggestionCards only re-render when their specific suggestion changes**
    - Generate `SuggestionSet` pairs where a subset K of suggestions differ and subset M are reference-equal; assert exactly K `SuggestionCard` instances re-render and M do not
    - **Validates: Requirements 8.3**

- [x] 11. Final checkpoint — Ensure all tests pass
  - Run the full engine test suite (`bun test` in `apps/engine`) and the web test suite (`vitest --run` in `apps/web`). Ensure all tests pass. Ask the user if questions arise.
  - Cerrado 2026-08-22 (TSK-066, ver docs/agents/tasks/TSK-066.md): la corrida real usó `bun test` en ambas apps (no Vitest -- el proyecto usa `bun:test` en todo el repo, incluido `apps/web`). `bun test` 240/240 (engine, +2 fixes reales encontrados en el cierre: `provider.test.ts` desactualizado frente al fallback de seed, y `tokenRateLimiter` nunca conectado en `index.ts`) + 87/87 (web). `tsc --noEmit` limpio, `next build` limpio. Commiteado en `bb9d017`/`3cb3724`, pusheado a `master` en `94dad26`.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Each task references specific requirements for traceability.
- Checkpoints at tasks 5 and 9 enforce incremental validation across the data and server layers before moving to the React layer.
- Property tests use `fast-check` (no additional runtime deps for engine; add `fast-check` as a dev dependency if not already present).
- Unit tests for engine changes use the Bun test runner (`bun test`).
- Unit tests for React changes use Vitest.
- The LRU cache (task 4) depends on the migration (task 1) existing before it is useful in production, but the implementation can proceed in parallel.
- WebSocket resilience (task 6) depends on cache coherence (tasks 2, 7) being stable so snapshot state is reliable.
- React tasks (task 10) are fully independent and can run in parallel with all engine tasks.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2", "3.1", "4.1", "7.1", "8.1", "10.1", "10.2"] },
    { "id": 1, "tasks": ["4.2", "6.1", "7.2", "8.2", "10.3"] },
    { "id": 2, "tasks": ["1.2", "2.3", "2.4", "3.2", "3.3", "3.4", "4.3", "4.4", "4.5", "4.6", "6.2", "7.3", "7.4", "8.3", "8.4", "8.5", "10.4", "10.5", "10.6"] }
  ]
}
```
