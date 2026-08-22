# Requirements Document

## Introduction

This document describes the performance optimizations for the D2KIRO engine (`apps/engine`). Eight issues were identified across the suggestion pipeline, the SQLite data layer, the WebSocket session layer, the meta synchronization layer, and the React frontend. The optimizations are grouped by severity and module, and each requirement targets a measurable, verifiable improvement without changing observable behavior seen by the user.

## Glossary

- **Engine**: The Bun process in `apps/engine/src/` that runs the suggestion pipeline, WebSocket server, and HTTP routes.
- **Suggestion_Pipeline**: The call path starting in `buildSuggestions` (mix.ts) that scores every candidate hero through five signal scorers and returns a `SuggestionSet`.
- **Signal_Scorer**: One of the five modules — `counter`, `patch_meta`, `position_fit`, `team_synergy`, `hero_pool_fit` — each implementing the `SignalScorer` interface.
- **MetaSnapshot**: The in-memory snapshot assembled by `buildMetaSnapshot` (provider.ts) and cached by `getCachedMetaSnapshot`.
- **Session_Store**: The `SessionStore` class (session.ts) that keeps per-session `DraftState` in memory.
- **Hero_Matchups_Table**: The `hero_matchups` SQLite table with primary key `(hero_id, vs_hero_id)`.
- **Meta_Sync**: The background process in `sync.ts` / `provider.ts` that fetches data from OpenDota and writes it to SQLite.
- **WebSocket_Session**: A single WebSocket connection that subscribes to a `sessionId` channel and receives `draft_state`, `suggestions`, `snapshot`, and `capture_status` messages.
- **Hero_Positions**: The in-memory data derived from `hero-positions.json`, loaded by `loadHeroPositions` and used by `createPositionFitScorer`.
- **Rate_Limiter**: The `SessionRateLimiter` created by `createSessionRateLimiter` (edge.ts), enforcing 20 events/second per session.
- **Draft_Board**: The React subtree in `DraftView.tsx` composed of `DraftBoard`, `SuggestionCard`, `ComparisonNote`, and `PartyPoolPanel` components.
- **LRU_Cache**: A Least-Recently-Used cache with a fixed capacity that evicts the oldest entry when full.

---

## Requirements

### Requirement 1: SQLite Index on hero_matchups(vs_hero_id)

**User Story:** As an engine developer, I want matchup lookups by `vs_hero_id` to use an index, so that counter-scoring completes within the 500 ms pipeline budget regardless of the number of enemies already picked.

#### Acceptance Criteria

1. THE Engine SHALL include a SQLite migration that creates an index on `hero_matchups(vs_hero_id)`.
2. WHEN the migration runs on a database that already contains the `hero_matchups` table, THE Engine SHALL create the index successfully and preserve all existing rows without modification.
3. WHEN `getMatchupsForHero` (queries.ts) is executed after migration, THE Engine SHALL satisfy the query using the new index rather than a full table scan, as confirmed by `EXPLAIN QUERY PLAN` returning a row that references `hero_matchups(vs_hero_id)`.
4. THE Engine SHALL maintain the existing primary key `(hero_id, vs_hero_id)` unchanged after the migration runs.

---

### Requirement 2: MetaSnapshot In-Memory Cache Coherence

**User Story:** As an engine developer, I want the `MetaSnapshot` cache to be invalidated on every write path that modifies the underlying tables, so that signal scores never reflect stale data after a sync or pool replacement.

#### Acceptance Criteria

1. WHEN `runMetaSync` completes — whether with status `"ok"`, status `"failed"`, or by throwing an exception (including network errors and data corruption) — THE Engine SHALL call `invalidateMetaSnapshotCache` before control returns to the caller.
2. WHEN `replaceHeroPool` writes new pool entries to SQLite, THE Engine SHALL call `invalidateMetaSnapshotCache` immediately after the transaction commits.
3. WHEN `upsertSetting` is called with key `"personal_baseline_winrate"`, THE Engine SHALL call `invalidateMetaSnapshotCache` immediately after the write.
4. WHILE the `cachedSnapshot` field is non-null and no invalidating write has occurred, THE Engine SHALL return the exact same `MetaSnapshot` object reference from `getCachedMetaSnapshot` for every call, even under memory pressure.
5. IF `buildMetaSnapshot` throws during cache population, THEN THE Engine SHALL leave `cachedSnapshot` as `null` so that the next call retries the build rather than returning a partially constructed snapshot.

---

### Requirement 3: Hero Positions Loaded Once at Module Initialisation

**User Story:** As an engine developer, I want `hero-positions.json` to be parsed exactly once per process lifetime, so that the position-fit scorer does not re-parse the JSON file on every `buildSuggestions` invocation.

#### Acceptance Criteria

1. THE Engine SHALL load and parse `hero-positions.json` into a module-level constant at process startup, before any call to `buildSuggestions` occurs.
2. WHEN `buildSuggestions` is called and no `heroPositions` override is provided in `BuildSuggestionsOptions`, THE Engine SHALL use the module-level constant without re-invoking `loadHeroPositions`.
3. WHERE a `heroPositions` override is provided in `BuildSuggestionsOptions`, THE Engine SHALL use the injected value instead of the module-level constant, preserving the existing test seam (S10 per testing-seams.md).
4. WHEN `parseHeroPositions` receives a JSON payload containing invalid hero entries — whether due to structural corruption or well-formed but non-conformant data — THE Engine SHALL return the valid subset of hero entries and skip invalid entries. IF no valid entries can be extracted, THEN THE Engine SHALL return an empty map.

---

### Requirement 4: LRU Query Cache for Hero Matchup Winrates

**User Story:** As an engine developer, I want repeated matchup lookups for the same `(hero_id, vs_hero_id)` pair within a single `buildSuggestions` call to be served from an in-memory cache, so that redundant SQLite reads are eliminated from the hot path.

#### Acceptance Criteria

1. THE Engine SHALL maintain an LRU cache with a maximum capacity of 512 entries, keyed on `(hero_id, vs_hero_id)` pairs, holding the precomputed winrate value.
2. WHEN the `MetaSnapshot` cache is invalidated, THE Engine SHALL also clear the LRU matchup cache so that stale winrate values are never served after a meta sync.
3. WHEN the LRU cache reaches its capacity limit of 512 entries and a new key is inserted, THE Engine SHALL evict the least-recently-used entry.
4. WHEN a matchup key is present in the LRU cache, THE Engine SHALL return the cached winrate without querying SQLite.
5. WHEN a matchup key is absent from the LRU cache, THE Engine SHALL query SQLite, store the result under that key, and return the value.
6. THE LRU_Cache SHALL be injectable for tests so that cache-hit and cache-miss paths can each be exercised independently.

---

### Requirement 5: WebSocket Reconnect Snapshot Resilience

**User Story:** As a user reconnecting mid-draft, I want the engine to send a complete snapshot even if one signal scorer throws during suggestion computation, so that the draft board is always restored on reconnect.

#### Acceptance Criteria

1. WHEN a `hello` message is received on a WebSocket connection, THE Engine SHALL always send a `snapshot` message for the current `DraftState` before attempting to compute suggestions, even if snapshot generation itself encounters an error.
2. WHEN `computeSuggestionsForState` throws or rejects during reconnect handling, THE Engine SHALL send a `suggestions` message with `degraded: ["partial_signals"]` and `suggestions: []` rather than retrying the computation, using cached suggestions, or leaving the client without a response.
3. WHEN a single Signal_Scorer throws during `buildSuggestions`, THE Engine SHALL record `raw: null` for that signal and continue scoring the remaining candidates with the surviving scorers, consistent with the existing `safeScore` wrapper.
4. IF `getCachedMetaSnapshot` throws during reconnect snapshot generation, THEN THE Engine SHALL send an `error` message with code `"snapshot_unavailable"` and NOT close the WebSocket connection.
5. WHILE the `DraftState` for a session is available in Session_Store, THE Engine SHALL include it in the `snapshot` payload regardless of whether suggestion computation succeeds or fails.

---

### Requirement 6: Static Meta Fallback Seed for Empty hero_patch_stats

**User Story:** As a user who starts a draft before the first OpenDota sync completes, I want the engine to serve usable patch-meta signal scores from a bundled seed file, so that the suggestion pipeline does not degrade to `raw: null` for `patch_meta` on every candidate.

#### Acceptance Criteria

1. THE Engine SHALL include a seed file at `apps/engine/src/meta/seed-hero-stats.json` containing hero patch stats representing the last known good state at the time of the most recent repo commit.
2. WHEN `buildMetaSnapshot` reads zero rows from `hero_patch_stats`, THE Engine SHALL populate `patchStats` in the returned `MetaSnapshot` using the seed file data instead of returning an empty map. IF the seed file is missing or corrupted at runtime, THEN THE Engine SHALL log an error and continue with an empty `patchStats` map. This fallback applies only during `buildMetaSnapshot` execution and does not affect any other code paths.
3. WHEN `buildMetaSnapshot` reads one or more rows from `hero_patch_stats`, THE Engine SHALL use the database rows regardless of their validation status and ignore the seed file.
4. THE Engine SHALL validate the seed file at process startup using the same validation rules applied to OpenDota responses in `validation.ts`, and SHALL log a warning and continue with an empty `patchStats` map if the seed file fails validation.
5. WHEN `runMetaSync` completes successfully and updates `hero_patch_stats`, THE Engine SHALL invalidate `cachedSnapshot` so that subsequent calls to `getCachedMetaSnapshot` build a fresh snapshot from the database rows, superseding the seed data.

---

### Requirement 7: Token-Level and IP-Level Rate Limiting on /ingest/draft-event

**User Story:** As an engine operator, I want rate limiting applied at both the session level and the capture-token level, so that a single misbehaving client cannot exhaust engine resources even if it rotates session IDs.

#### Acceptance Criteria

1. THE Engine SHALL enforce a maximum of 200 events per second per capture token across all session IDs sharing that token.
2. WHEN a request to `POST /ingest/draft-event` exceeds the per-token rate limit, THE Engine SHALL return HTTP 429 with a JSON body `{ "error": "rate_limit_exceeded", "scope": "token" }`.
3. WHEN a request to `POST /ingest/draft-event` exceeds the per-session rate limit of 20 events/second (existing §5 rule), THE Engine SHALL return HTTP 429 with a JSON body `{ "error": "rate_limit_exceeded", "scope": "session" }`.
4. WHEN a request is rejected due to rate limiting, THE Engine SHALL log one structured log entry containing: timestamp, rejection scope (`"token"` or `"session"`), session ID (if present), and request source IP.
5. WHEN the per-token limiter window (1 second) expires without being exhausted, THE Engine SHALL reset the token bucket for that token so that legitimate traffic resumes without manual intervention.
6. THE Token_Rate_Limiter SHALL be injectable into `createApp` for tests, following the same pattern as the existing `SessionRateLimiter`.

---

### Requirement 8: React Memoization of Draft Board Components

**User Story:** As a user viewing the live draft board, I want suggestion cards and the draft board grid to skip re-renders when their props have not changed, so that the UI stays responsive during rapid pick/ban sequences.

#### Acceptance Criteria

1. THE Engine SHALL wrap `SuggestionCard` with `React.memo` so that a `SuggestionCard` instance does not re-render when `suggestion`, `heroMeta`, `isPrimary`, and `onPick` are reference-equal to the previous render.
2. THE Engine SHALL wrap `DraftBoard` with `React.memo` so that the board grid does not re-render when `draftState` and `heroCatalog` are reference-equal to the previous render.
3. WHEN `DraftView` receives a new `SuggestionSet` from the WebSocket that changes only the `suggestions` field, THE Engine SHALL re-render `SuggestionCard` components with changed `suggestion` props and skip re-renders for `SuggestionCard` components whose props are unchanged.
4. THE Engine SHALL wrap the `buildReason` result computation inside `ActiveDraftState` with `useMemo`, keyed on `suggestions`, so that the explanation strings are not recomputed on every render unrelated to a suggestion change.
5. WHEN `heroCatalog` is updated by `useHeroCatalog` and its reference changes, THE Engine SHALL re-render all components that receive `heroCatalog` as a prop, regardless of any memoization applied to those components, to ensure hero names and images remain correct.
