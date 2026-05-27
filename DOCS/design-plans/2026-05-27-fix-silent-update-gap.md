# Fix Silent Update Gap Design

## Summary

The design closes a silent-update gap in the rsss feed reader header:
between the moment a user adds a feed (or a server SSE push triggers a
background catch-up) and the moment items become available, the header
status dot shows nothing even though real work is in flight. The fix
extends the existing `refreshInProgress:Signal<boolean>` in
`src/client/state.ts` to become refcount-backed via module-private
`acquireRefresh()` / `releaseRefresh()` helpers, so that concurrent
operations — an add-feed resolve overlapping an SSE-driven
`refreshAfterSync`, for example — each hold the signal `true`
independently without clobbering each other.

On top of that raw signal, a new dedicated module
`src/client/displayed-refresh-in-progress.ts` exports a derived
`displayedRefreshInProgress:ReadonlySignal<boolean>` that debounces
the raw signal with a 300 ms show-delay (`SHOW_DELAY_MS`) and a 500 ms
minimum-visible floor (`MIN_VISIBLE_MS`), so fast operations never
cause a yellow flicker. The computed `displayedFeedSyncStatus`
(state.ts:427), which already drives the header dot's
yellow/"updating…" state, is updated to read the derived signal
instead of the raw one — requiring no UI-component changes. All new
background call sites (`addFeed`, `scheduleResolveConvergence`, the
SSE `feed-updated` debounced handler, and the online-recovery handler)
adopt the exported `trackRefresh(name, fn)` helper, which acquires on
entry, releases on settle, and — if the wrapped work rejects — sets
`feedSyncStatus = 'error'` in the same `batch()` as the release so the
dot transitions directly from yellow to red.

## Definition of Done

1. **Yellow + "updating…" covers the silent gap** during pull-sync /
   SSE-driven catch-up, including the resolve window after a user adds a
   new feed. The header status dot turns yellow and the adjacent text
   reads "updating…" (replacing the count) while the silent server work
   is in flight.

2. **Debounced ~300–500ms** — the indicator only appears if the silent
   gap actually lasts long enough to feel silent. Pull-syncs / resolves
   that finish faster than the debounce threshold do not cause the dot
   to flicker yellow.

3. **One unified "updating" state** — no count. Concurrent operations
   (e.g., multiple add-feed actions in rapid succession, an SSE
   catch-up overlapping a pull-sync) collapse into a single yellow dot
   that stays on until everything settles.

4. **Failure → red** — if an in-flight pull-sync or resolve errors out,
   the dot transitions from yellow to the existing red error state,
   surfacing the failure rather than silently clearing.

5. **End-state unchanged on success** — after yellow clears
   successfully, the existing flow runs: dot goes blue + "X updates",
   user clicks the "Refresh" / pending-updates card to bring items into
   the reading list. No items auto-appear from the resolve.

6. **Reuses existing visual language** — extends
   `displayedFeedSyncStatus`'s trigger conditions to cover
   pull-sync/SSE catch-up. No new colors, no new components, no new
   text strings beyond the existing "updating" label.

## Acceptance Criteria

### fix-silent-update-gap.AC1: Background-sync activity is observable in the header dot

- **fix-silent-update-gap.AC1.1 Success:** When the user adds a new
  feed via `State.addFeed`, the raw `refreshInProgress` signal becomes
  `true` synchronously (before the POST returns).
- **fix-silent-update-gap.AC1.2 Success:** After the SSE
  `feed-updates-available` event arrives carrying the newly-added
  feed's id, the raw `refreshInProgress` signal returns to `false`.
- **fix-silent-update-gap.AC1.3 Success:** When the SSE `feed-updated`
  debounced handler fires, the raw `refreshInProgress` signal is
  `true` for the duration of the subsequent `refreshAfterSync` call.
- **fix-silent-update-gap.AC1.4 Success:** When an `online` browser
  event triggers offline→online recovery, the raw `refreshInProgress`
  signal is `true` for the duration of the recovery `runSync` and
  `refreshAfterSync` calls.
- **fix-silent-update-gap.AC1.5 Edge:** Add-feed acquire force-releases
  after `RESOLVE_WINDOW_MS + CLIENT_GRACE_MS` (35s) even if the SSE
  release condition never fires, so the signal never leaks `true`.

### fix-silent-update-gap.AC2: Debounce and minimum-visible behavior of `displayedRefreshInProgress`

- **fix-silent-update-gap.AC2.1 Success:** If the raw signal stays
  `true` continuously for at least `SHOW_DELAY_MS` (300ms),
  `displayedRefreshInProgress` becomes `true`.
- **fix-silent-update-gap.AC2.2 Success:** If the raw signal flips
  `true → false` before `SHOW_DELAY_MS` elapses,
  `displayedRefreshInProgress` never becomes `true` (no flicker on
  fast operations).
- **fix-silent-update-gap.AC2.3 Success:** Once
  `displayedRefreshInProgress` becomes `true`, it stays `true` for at
  least `MIN_VISIBLE_MS` (500ms) even if the raw signal clears
  sooner.
- **fix-silent-update-gap.AC2.4 Success:** If the raw signal
  re-acquires while inside the min-visible window,
  `displayedRefreshInProgress` stays continuously `true` (no gap)
  until the raw signal eventually clears and the min-visible window
  elapses.

### fix-silent-update-gap.AC3: Refcount safety

- **fix-silent-update-gap.AC3.1 Success:** Two concurrent
  `trackRefresh` calls both acquire; the raw signal stays `true`
  until both settle.
- **fix-silent-update-gap.AC3.2 Edge:** Calling `releaseRefresh()`
  more times than `acquireRefresh()` does not move the internal
  counter below zero and does not toggle the signal back to `true` on
  the next acquire.

### fix-silent-update-gap.AC4: Failure surfaces as red, not silent yellow→clear

- **fix-silent-update-gap.AC4.1 Failure:** If the `fn` passed to
  `trackRefresh` rejects, `feedSyncStatus` is set to `'error'` in the
  same `batch()` as the release, so `displayedFeedSyncStatus`
  transitions from `'syncing'` to `'error'` without an intermediate
  state.
- **fix-silent-update-gap.AC4.2 Success:** If the `fn` passed to
  `trackRefresh` resolves, `feedSyncStatus` is not modified by the
  helper.

### fix-silent-update-gap.AC5: Visual contract preserved

- **fix-silent-update-gap.AC5.1 Success:** `displayedFeedSyncStatus`
  returns `'syncing'` whenever `displayedRefreshInProgress.value ===
  true`, matching the existing UI binding semantics.
- **fix-silent-update-gap.AC5.2 Success:** When
  `displayedRefreshInProgress` is `false` and no in-flight error has
  been raised, the dot reflects the existing `feedSyncStatus` value
  (`'inactive'` / `'updates'` / `'synced'`). End-state for a
  successful add-feed is unchanged: blue + "X updates" + Click to
  refresh card.

## Glossary

- **`refreshInProgress`**: A `Signal<boolean>` in `src/client/state.ts`
  that, when `true`, causes `displayedFeedSyncStatus` to return
  `'syncing'`, turning the header dot yellow with "updating…" text.
  Previously set only around user-initiated manual refresh; this design
  extends it to cover background sync activity.
- **`displayedRefreshInProgress`**: A new derived
  `ReadonlySignal<boolean>` in
  `src/client/displayed-refresh-in-progress.ts` that wraps the raw
  `refreshInProgress` with a 300 ms show-delay and a 500 ms
  minimum-visible duration, preventing yellow flicker for fast
  operations.
- **`trackRefresh(name, fn)`**: A helper exported from
  `src/client/state.ts` that acquires the `refreshInProgress`
  refcount, runs an async operation `fn`, and releases on settle; on
  rejection it sets `feedSyncStatus = 'error'` in the same `batch()`
  as the release.
- **`displayedFeedSyncStatus`**: A computed signal at state.ts:427
  that aggregates `refreshInProgress` (or after this change,
  `displayedRefreshInProgress`) with `feedSyncStatus` to produce the
  value the header dot component reads (`'syncing'` / `'inactive'` /
  `'updates'` / `'synced'` / `'error'`).
- **`feedSyncStatus`**: A raw signal in `src/client/state.ts` holding
  the non-in-flight status of the feed sync cycle (`'inactive'` /
  `'updates'` / `'synced'` / `'error'`); distinct from
  `refreshInProgress`, which represents whether a sync operation is
  actively in flight.
- **pull-sync**: A full client-initiated sync cycle (`runSync(db)` in
  `src/client/sync.ts`) that fetches server state into the local
  OPFS-SQLite database; distinct from a user-visible "refresh" that
  brings new items into the reading list.
- **`refreshAfterSync`**: A client function called after a pull-sync
  or SSE-triggered catch-up that checks for new feed items and
  updates the reading list signals; it is the boundary between
  "silent server work" and "visible item delivery."
- **`scheduleResolveConvergence`**: A function in
  `src/client/state.ts` that schedules a deferred `runSync` +
  `refreshAfterSync` cycle after a new feed is added, giving the
  server time to fully resolve the feed before the client re-reads
  it.
- **`feed-updates-available` SSE event**: A server-sent event emitted
  when the server has finished resolving a newly-added feed and new
  items are ready for the client to fetch; the add-feed acquire in
  Phase 4 uses receipt of this event (carrying the added feed's id)
  as its release condition.
- **`feed-updated` SSE event**: A server-sent event that signals one
  or more existing feeds have new items; the debounced client handler
  triggers a `refreshAfterSync` call, which Phase 5 wraps in
  `trackRefresh`.
- **refcount**: An integer counter (module-private to
  `src/client/state.ts`) that tracks how many concurrent operations
  have acquired `refreshInProgress`; the signal is `true` when the
  count is greater than zero, preventing concurrent releases from
  prematurely clearing it.
- **`RESOLVE_WINDOW_MS` + `CLIENT_GRACE_MS`**: Constants (totaling
  35 s) from state.ts:120–121 that bound the server resolve window
  plus client network lag; used as the hard-timeout fallback for the
  add-feed acquire to prevent leaks if the SSE event never arrives.
- **`ReadonlySignal`**: A `@preact/signals` type that exposes `.value`
  for reading but no setter, enforcing that only the owning module
  may write to the underlying signal.
- **`@preact/signals` `batch()`**: A function that defers all signal
  notifications until its callback returns, ensuring multiple signal
  writes in one logical operation are observed as a single atomic
  update by any computed signals or UI components subscribed to them.
- **paint cache**: A capped `localStorage` snapshot of feeds, items,
  counts, and `selectedFeedId` (keys `rsss.paintCache.v1.<did>`)
  written by `src/client/paint-cache.ts`; used at boot to render
  content before the OPFS-SQLite database is ready. Referenced as
  context for the standalone-module-with-`_resetForTest()` pattern
  this design follows.
- **OPFS-SQLite**: The browser Origin Private File System SQLite
  database used as the client's authoritative local store; pull-sync
  writes into it and `refreshAfterSync` reads from it to update UI
  signals.

## Architecture

Extend the existing `refreshInProgress:Signal<boolean>` in
`src/client/state.ts` to cover background sync activity in addition to
manual refresh. The signal remains a single public boolean. Internally,
its mutations are gated by a private refcount so that concurrent
operations don't clobber each other's state. The yellow dot +
"updating…" text already wired through `displayedFeedSyncStatus`
(state.ts:427) needs no UI-binding change.

A new derived signal `displayedRefreshInProgress` in
`src/client/displayed-refresh-in-progress.ts` wraps `refreshInProgress`
with a 300ms show-delay (debounce) and a 500ms minimum visible
duration. `displayedFeedSyncStatus` switches to reading the derived
signal instead of the raw one. The thresholds are exported constants
(`SHOW_DELAY_MS`, `MIN_VISIBLE_MS`) so tests import them and any future
tuning is a one-line edit.

New background-sync call sites use a small `trackRefresh(name, fn)`
helper that acquires the refcount, runs the async work, and releases on
settle. On rejection, the helper sets `feedSyncStatus = 'error'` in the
same `batch()` as the release so the dot transitions from yellow to red
without a flicker through any intermediate state. Existing manual
refresh paths can adopt the helper incrementally; this design does not
require them to.

**Component boundaries:**

- `src/client/state.ts` owns `refreshInProgress` (now refcount-backed),
  `acquireRefresh()` / `releaseRefresh()` (module-private),
  `trackRefresh(name, fn)`, and `feedSyncStatus`.
- `src/client/displayed-refresh-in-progress.ts` owns the derived
  signal, the `SHOW_DELAY_MS` / `MIN_VISIBLE_MS` constants, and a
  `_resetForTest()` helper.
- `displayedFeedSyncStatus` (state.ts:427) is updated to read the
  derived signal.

**Contract — `trackRefresh`:**

```ts
type RefreshOpName =
    | 'add-feed'
    | 'resolve-convergence'
    | 'sse-feed-updated'
    | 'online-recovery'

function trackRefresh<T>(
    name:RefreshOpName,
    fn:()=>Promise<T>,
):Promise<T>
```

**Contract — derived signal module:**

```ts
export const SHOW_DELAY_MS:number    // 300
export const MIN_VISIBLE_MS:number   // 500
export const displayedRefreshInProgress:ReadonlySignal<boolean>
export function _resetForTest():void
```

## Existing Patterns

Codebase investigation identified the following patterns this design
follows:

- **Refcount/de-dup of concurrent async work:** `inFlightSyncs:WeakMap`
  in `src/client/sync.ts:27` already de-duplicates concurrent
  `runSync(db)` calls per DB instance. The new refcount inside
  `refreshInProgress` applies the same idea at the signal layer.
- **Signal-with-test-helper module:** Matches the `paint-cache.ts`
  pattern from the 023-fix-initial-load design — a small standalone
  client module exporting signals plus a `_resetForTest()` helper. See
  state.ts comment about `_resetPaintCacheWriteHandleForTest()`.
- **`batch()` for multi-signal updates:** Mandated by CLAUDE.md.
  Existing `refreshInProgress` set/clear sites (state.ts:2000, 1000,
  1107, 2008, 2035, 2049, 2061) all use `batch()` today. The new
  acquire/release helpers maintain this.
- **Stable per-operation Map keyed by stable id:**
  `resolveConvergenceTimers:Map<feedId, timeout>` (state.ts:132). The
  new design's refcount is simpler (single integer, not a Map), but
  the convention of giving each operation a name is preserved via the
  `RefreshOpName` type for debugging.
- **Computed signal layered over raw state:** `displayedFeedSyncStatus`
  itself (state.ts:427) is already a computed signal; the new
  `displayedRefreshInProgress` is the same pattern one level lower.

No divergence from existing patterns. No new architectural primitives
introduced.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Refcount-backed `refreshInProgress`

**Goal:** Convert `refreshInProgress` to be backed by a private
refcount without changing its external contract or visual behavior.

**Components:**
- `src/client/state.ts` — add module-private `acquireRefresh()` /
  `releaseRefresh()` helpers backed by a private counter. Convert all
  six existing set/clear sites (lines 1000, 1107, 2000, 2008, 2035,
  2049, 2061 per investigation) to call them. The boolean signal's
  value is computed as `count > 0`.
- Defensive guard: `releaseRefresh()` never lets the counter go
  negative; extra releases are no-ops.

**Dependencies:** None. This is a self-contained refactor.

**Done when:** Manual refresh flow behaves identically to today
(verified by existing tests passing). New unit tests verify
acquire/release balance, concurrent acquires keep the signal true,
extra releases don't underflow.

**Acceptance criteria covered:** `fix-silent-update-gap.AC3.1`,
`fix-silent-update-gap.AC3.2`.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: `trackRefresh` helper and `feedSyncStatus` failure path

**Goal:** Provide a single helper that wraps async background work
with acquire/release plus failure-to-error transition.

**Components:**
- `src/client/state.ts` — export
  `trackRefresh<T>(name:RefreshOpName, fn:()=>Promise<T>):Promise<T>`.
  Acquires on entry, releases on settle (try/finally). On rejection,
  sets `feedSyncStatus = 'error'` in the same `batch()` as the
  release.
- Define and export `RefreshOpName` union type.

**Dependencies:** Phase 1.

**Done when:** Helper works for success and rejection cases, sets
`feedSyncStatus` on rejection, leaves it untouched on success. Unit
tests verify both paths.

**Acceptance criteria covered:** `fix-silent-update-gap.AC3.1`,
`fix-silent-update-gap.AC4.1`, `fix-silent-update-gap.AC4.2`.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Debounced derived signal

**Goal:** Introduce `displayedRefreshInProgress` with show-delay and
min-visible-duration semantics; route the UI through it.

**Components:**
- New file `src/client/displayed-refresh-in-progress.ts` exporting
  `displayedRefreshInProgress:ReadonlySignal<boolean>`,
  `SHOW_DELAY_MS = 300`, `MIN_VISIBLE_MS = 500`, and
  `_resetForTest():void`.
- `src/client/state.ts` — update `displayedFeedSyncStatus`
  (state.ts:427) to read the new derived signal instead of
  `refreshInProgress`.

**Dependencies:** Phase 1.

**Done when:** Fake-timer unit tests cover: raw on-off under 300ms →
displayed never shows; raw stays on past 300ms → displayed shows; raw
clears after 100ms display → displayed stays on for full 500ms; raw
re-acquires inside min-visible window → displayed stays continuously
on.

**Acceptance criteria covered:** `fix-silent-update-gap.AC2.1`,
`fix-silent-update-gap.AC2.2`, `fix-silent-update-gap.AC2.3`,
`fix-silent-update-gap.AC2.4`.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Wire add-feed and resolve-convergence to `trackRefresh`

**Goal:** Cover the original reported gap — silent period after the
user clicks "add feed" until items become available.

**Components:**
- `src/client/state.ts` — `State.addFeed` (state.ts:1913): wrap the
  whole flow (POST, loadFeeds, loadCounts, plus a release condition
  tied to the eventual SSE `feed-updates-available` event for the
  added feed id OR the convergence timer settling OR an error).
  Implementation detail: the SSE `feed-updates-available` handler
  (state.ts:1014–1062) emits a Set of feed ids; the add-feed acquire
  must complete its release when that Set contains the newly-added
  feed id, with a hard timeout fallback so the acquire cannot leak.
- `src/client/state.ts` — `scheduleResolveConvergence` timer callback
  (state.ts:174–202): wrap the inner `runSync(db)` →
  `refreshAfterSync(state)` chain in `trackRefresh('resolve-convergence',
  …)`.

**Dependencies:** Phase 2 (helper), Phase 3 (so the indicator is
visible).

**Done when:** Adding a feed against a mocked adapter sets
`refreshInProgress.value === true` immediately, and
`displayedRefreshInProgress.value === true` within
`SHOW_DELAY_MS` if the resolve takes longer than that. The signal
clears once the SSE `feed-updates-available` event arrives carrying
the new feed's id, or on error.

**Acceptance criteria covered:** `fix-silent-update-gap.AC1.1`,
`fix-silent-update-gap.AC1.2`, `fix-silent-update-gap.AC4.1`.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Wire SSE `feed-updated` and online-recovery to `trackRefresh`

**Goal:** Cover the remaining in-scope silent gaps: SSE-driven
catch-up after the server pushes a feed-updated event, and pull-sync
after offline→online transitions.

**Components:**
- `src/client/state.ts` — SSE `feed-updated` debounced handler
  (state.ts:978–985): wrap the post-debounce `refreshAfterSync(state)`
  call in `trackRefresh('sse-feed-updated', …)`.
- `src/client/state.ts` — online-event handler (state.ts:554, 561):
  wrap the `runSync(db)` and `refreshAfterSync` calls in
  `trackRefresh('online-recovery', …)`.

**Dependencies:** Phase 2 (helper), Phase 3 (derived signal),
Phase 4 (parallel — could ship together with Phase 4, but listed as a
separate phase for staging).

**Done when:** Simulated SSE `feed-updated` event triggers
`refreshInProgress` to acquire and release around the
`refreshAfterSync` call. Simulated `online` event likewise. Unit tests
cover both.

**Acceptance criteria covered:** `fix-silent-update-gap.AC1.3`,
`fix-silent-update-gap.AC1.4`.
<!-- END_PHASE_5 -->

## Additional Considerations

**Out of scope (explicitly):**

- Bootstrap `pullSync` (bootstrap.ts:149) — already has its own
  first-time UI from the 023-fix-initial-load design.
- Post-auth `loadUser` pull-sync (state.ts:625) — bootstrap-adjacent.
- Per-feed `refreshFeed` / `retryResolveFeed` (state.ts:2400, 2442) —
  user-initiated and not silent.
- Server-side background polling — runs on the server with no client
  signal today, and is server-internal work the user did not
  initiate.

**Concurrency with manual refresh:** If the user clicks Refresh while
an add-feed is resolving, both call sites acquire the refcount; the
indicator stays yellow until both settle. No special coordination
needed — refcount handles it.

**Hard timeout on add-feed acquire:** The add-feed release condition
depends on receiving an SSE event carrying the new feed's id. If the
SSE connection drops or the server never emits the event, the acquire
would leak. Use the existing `RESOLVE_WINDOW_MS + CLIENT_GRACE_MS`
(35s, state.ts:120–121) as a hard upper bound: after 35s, force
release and let `feedSyncStatus` reflect whatever the resolve produced
(success/error).

**Thresholds tunable centrally:** `SHOW_DELAY_MS` and `MIN_VISIBLE_MS`
exported as constants from `displayed-refresh-in-progress.ts`. If
post-launch feedback shows 300ms is too short or 500ms is too long,
single-file edit.

**No server changes:** No DO SQLite changes, no new HTTP endpoints,
no new env vars. Pure client-side signal plumbing routed into an
existing visual element.
