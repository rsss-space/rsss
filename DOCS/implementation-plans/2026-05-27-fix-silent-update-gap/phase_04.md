# Phase 4: Wire `State.addFeed` and `scheduleResolveConvergence` to `trackRefresh`

**Goal:** Cover the originally-reported silent gap: the period
between the user clicking "Add feed" and items becoming available.
Two call sites are wired:

1. `State.addFeed` (state.ts:1913-1945) — acquires immediately,
   releases when either the SSE `feed-updates-available` event
   arrives carrying the newly-added feed id, OR a hard 35 s
   timeout fires, OR the work throws.
2. The inner `runSync(db) -> refreshAfterSync(state)` chain inside
   `scheduleResolveConvergence`'s timer callback (state.ts:174-202)
   — wrapped in `trackRefresh(state, 'resolve-convergence', ...)`.

**Architecture:** A new module-private coordination map
`_pendingAddFeedAcquires: Map<feedId, ReleaseRecord>` tracks the
in-flight add-feed acquires. The existing SSE
`feed-updates-available` handler at state.ts:1014-1062 is
augmented to drain matching entries on event arrival. A hard-
timeout fallback ensures no acquire leaks if the SSE event never
arrives.

**Tech Stack:** TypeScript, `@preact/signals` (already imported).

**Scope:** Phase 4 of 5. Depends on Phase 2 (`trackRefresh`) and
Phase 3 (the visible indicator).

**Codebase verified:** 2026-05-27. Findings:

- `State.addFeed` at `state.ts:1913-1945`. Current shape:
  ```ts
  State.addFeed = async function (state, url) {
      try {
          const adapter = await getAdapter(state.user.value?.did)
          await adapter.addFeed(url)
          await State.loadFeeds(state)
          await State.loadCounts(state)
          scheduleResolveConvergence(state, url)
      } catch (err) {
          if (err instanceof Error && 'response' in err
              && (err as { response:Response }).response.status === 409) {
              await State.loadFeeds(state)
              return
          }
          throw err
      }
  }
  ```
  No existing acquire/release of `refreshInProgress`.
- `scheduleResolveConvergence` at `state.ts:174-202`. Inner chain:
  ```ts
  const timer = setTimeout(() => {
      resolveConvergenceTimers.delete(feedId)
      if (!isFeedStillResolving(state, feedId)) return
      const did = state.user.value?.did
      const db = did ? getLocalDb(did) : null
      if (!db) return
      runSync(db)
          .then(() => State.refreshAfterSync(state))
          .catch((err) => debug('resolve-convergence runSync failed', ...))
  }, RESOLVE_WINDOW_MS + CLIENT_GRACE_MS)
  ```
- SSE `feed-updates-available` handler at `state.ts:1014-1062`.
  The handler parses `parsed.feedUpdateCounts` (a
  `Record<string, number>`) and computes a Set of known feed ids
  before applying counts. Phase 4 hooks into this loop to drain
  the pending acquires map.
- `RESOLVE_WINDOW_MS = 30_000`, `CLIENT_GRACE_MS = 5_000` at
  `state.ts:120-121`. Their sum (35 s) is the design's hard-
  timeout fallback for addFeed.
- The feed id discovered post-`loadFeeds`: feed ids are numeric
  (`number`) per `resolveConvergenceTimers: Map<number, timeout>`
  at `state.ts:132-135`. After `loadFeeds`, the feed appears in
  `state.feeds.value` and the row's `.id` is accessible.

**Coding style:** Same as previous phases.

**Skills the implementer should activate:**
- `ed3d-house-style:howto-code-in-typescript`
- `ed3d-house-style:writing-good-tests`

---

## Acceptance Criteria Coverage

### fix-silent-update-gap.AC1: Background-sync activity is observable in the header dot

- **fix-silent-update-gap.AC1.1 Success:** When the user adds a new
  feed via `State.addFeed`, the raw `refreshInProgress` signal
  becomes `true` synchronously (before the POST returns).
- **fix-silent-update-gap.AC1.2 Success:** After the SSE
  `feed-updates-available` event arrives carrying the newly-added
  feed's id, the raw `refreshInProgress` signal returns to
  `false`.
- **fix-silent-update-gap.AC1.5 Edge:** Add-feed acquire force-
  releases after `RESOLVE_WINDOW_MS + CLIENT_GRACE_MS` (35 s) even
  if the SSE release condition never fires, so the signal never
  leaks `true`.

### fix-silent-update-gap.AC4: Failure surfaces as red

- **fix-silent-update-gap.AC4.1 Failure (addFeed branch):** When
  the work inside `addFeed`'s `trackRefresh` rejects (POST fails
  with non-409), `feedSyncStatus` becomes `'error'` in the same
  batch as the release.

---

## Implementation Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Add pending-add-feed coordination + hard-timeout machinery

**Verifies:** fix-silent-update-gap.AC1.1, fix-silent-update-gap.AC1.2,
fix-silent-update-gap.AC1.5 (infrastructure only; full assertion in
Task 4).

**Files:**
- Modify: `/Users/nick/code/rsss/src/client/state.ts` — add new
  module-private state and helpers near the existing refcount
  helpers (Phase 1) and adjacent to `resolveConvergenceTimers`
  (state.ts:132-135).

**Implementation:**

Add the following module-private declarations:

```ts
/**
 * Coordination state for add-feed acquires that release on either
 * SSE `feed-updates-available` (carrying the added feedId) OR a
 * hard 35-second timeout, whichever fires first. Keyed by feedId.
 *
 * Module-private; tests use `_resetPendingAddFeedAcquiresForTest`.
 */
type AddFeedAcquireRecord = {
    /**
     * Resolves the pending Promise returned by
     * `waitForAddFeedRelease`. Idempotent (subsequent calls are
     * no-ops).
     */
    settle:() => void
    /** Timer handle for the hard-timeout fallback. */
    timer:ReturnType<typeof setTimeout>
}
const _pendingAddFeedAcquires =
    new Map<number, AddFeedAcquireRecord>()

/**
 * Test-only: clear all pending add-feed acquires and their
 * timers without firing the settle callbacks.
 */
export function _resetPendingAddFeedAcquiresForTest ():void {
    for (const record of _pendingAddFeedAcquires.values()) {
        clearTimeout(record.timer)
    }
    _pendingAddFeedAcquires.clear()
}

/**
 * Test-only override for the hard-timeout duration used by
 * `waitForAddFeedRelease`. Allows tests to exercise the timeout
 * path without waiting a real 35 seconds. Pass `undefined` to
 * restore the production value
 * (RESOLVE_WINDOW_MS + CLIENT_GRACE_MS).
 */
let _addFeedHardTimeoutMs:number =
    RESOLVE_WINDOW_MS + CLIENT_GRACE_MS
export function _setAddFeedHardTimeoutForTest (
    ms:number|undefined,
):void {
    _addFeedHardTimeoutMs = ms ?? (RESOLVE_WINDOW_MS + CLIENT_GRACE_MS)
}

/**
 * Returns a Promise that resolves when one of:
 * - SSE `feed-updates-available` fires for the given feedId
 *   (drained by the augmented handler in Task 2).
 * - The hard-timeout (35 s in production) elapses.
 *
 * Side-effect: registers a record in `_pendingAddFeedAcquires`.
 * The record's `settle` callback is invoked exactly once. Both
 * the SSE drain path and the timeout fire-path call `settle`.
 */
function waitForAddFeedRelease (feedId:number):Promise<void> {
    return new Promise<void>((resolve) => {
        let settled = false
        const settle = ():void => {
            if (settled) return
            settled = true
            clearTimeout(record.timer)
            _pendingAddFeedAcquires.delete(feedId)
            resolve()
        }
        const timer = setTimeout(settle, _addFeedHardTimeoutMs)
        const record:AddFeedAcquireRecord = { settle, timer }
        _pendingAddFeedAcquires.set(feedId, record)
    })
}

/**
 * Drain any pending add-feed acquires whose feedId appears in
 * `feedIds`. Called from the SSE `feed-updates-available`
 * handler. Each drained acquire settles its waiting Promise,
 * which releases the `trackRefresh` wrapper in `State.addFeed`.
 */
function drainAddFeedAcquires (feedIds:Iterable<number>):void {
    for (const feedId of feedIds) {
        const record = _pendingAddFeedAcquires.get(feedId)
        if (record !== undefined) {
            record.settle()
        }
    }
}
```

Placement notes:

- These declarations reference `RESOLVE_WINDOW_MS` and
  `CLIENT_GRACE_MS` which are defined at `state.ts:120-121`.
  Declare AFTER those constants.
- `drainAddFeedAcquires` is module-private; only Task 2's SSE
  handler patch calls it.
- `_pendingAddFeedAcquires`, `_resetPendingAddFeedAcquiresForTest`,
  `_setAddFeedHardTimeoutForTest` are module-private except for
  the test-only exports.

**Verification:**
- Type-check: `npm run lint`
- No tests yet; existing suite still passes.

**Commit:** `feat(client): add-feed acquire coordination + hard-timeout`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Augment SSE `feed-updates-available` handler to drain acquires

**Verifies:** fix-silent-update-gap.AC1.2

**Files:**
- Modify: `/Users/nick/code/rsss/src/client/state.ts` at the SSE
  handler (currently at state.ts:1014-1062).

**Change:**

Inside the handler, after the existing `batch()` block that
applies counts (or alternatively, immediately before, since
draining is independent of count writes), add a call to
`drainAddFeedAcquires`. Use the same Set of feed ids the handler
already iterates.

The current handler computes `filteredEntries` from
`Object.entries(parsed.feedUpdateCounts).filter(...)`. Add after
the `batch()` block (so the drain happens AFTER counts are
visible to consumers):

```ts
// Drain any add-feed acquires waiting for these feed ids. Note
// that the SSE event signals server-side resolve completion, so
// items are ready for the next refreshAfterSync to surface.
drainAddFeedAcquires(
    filteredEntries.map(([feedId]) => Number(feedId)),
)
```

Place this immediately after the `batch(() => { ... })` block but
before the `return` at the end of the `if (parsed.feedUpdateCounts
...)` branch. The legacy `feedIds` branch (lines ~1055-1061) does
not need this hook because:
1. The legacy path calls `State.loadFeedStatus` asynchronously and
   that path is unaware of pending acquires.
2. The hard-timeout in `waitForAddFeedRelease` covers the legacy
   path's release.

If the legacy `feedIds:string[]` array is also present, optionally
drain from it too:
```ts
if (Array.isArray(parsed.feedIds)) {
    drainAddFeedAcquires(
        parsed.feedIds.map((id) => Number(id)).filter(
            (id) => Number.isFinite(id),
        ),
    )
    State.loadFeedStatus(state).catch((err) => {
        debug('legacy feedIds reconcile error:', err)
    })
}
```

The implementer should read the handler in current state before
editing to confirm exact placement and to preserve any logging.

**Verification:**
- Type-check: `npm run lint`
- Existing SSE tests pass (`test/updating-pill-lifecycle.ts`).

**Commit:** `feat(client): drain add-feed acquires on SSE feed-updates-available`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Wrap `State.addFeed` and `scheduleResolveConvergence` with `trackRefresh`

**Verifies:** fix-silent-update-gap.AC1.1, fix-silent-update-gap.AC1.2,
fix-silent-update-gap.AC1.5, fix-silent-update-gap.AC4.1 (addFeed
branch).

**Files:**
- Modify: `/Users/nick/code/rsss/src/client/state.ts` at:
  - `State.addFeed` (state.ts:1913-1945)
  - `scheduleResolveConvergence` timer body (state.ts:174-202)

**Change 1: `State.addFeed`**

Wrap the main flow in `trackRefresh(state, 'add-feed', async () =>
{ ... })` while preserving the 409 short-circuit (the 409 path is
"feed already exists" — a benign case that should NOT trigger the
`'error'` status). Adjustment:

```ts
State.addFeed = async function (
    state:AppState,
    url:string,
):Promise<void> {
    // Detect 409 ("feed already exists") before entering trackRefresh
    // so the benign case never flashes the indicator.
    try {
        const adapter = await getAdapter(state.user.value?.did)
        await trackRefresh(state, 'add-feed', async () => {
            try {
                await adapter.addFeed(url)
            } catch (err) {
                if (
                    err instanceof Error &&
                    'response' in err &&
                    (err as { response:Response }).response
                        .status === 409
                ) {
                    // Treat as success for the indicator;
                    // re-load and exit without error.
                    debug('Feed already exists, reloading...')
                    await State.loadFeeds(state)
                    return
                }
                throw err
            }
            await State.loadFeeds(state)
            await State.loadCounts(state)
            scheduleResolveConvergence(state, url)
            // Discover the newly-added feed id and wait for the
            // SSE release condition (or hard timeout).
            const newRow = state.feeds.value.find(
                (f) => f.url === url,
            )
            if (newRow !== undefined) {
                await waitForAddFeedRelease(newRow.id)
            }
            // If newRow is undefined (e.g., loadFeeds didn't
            // return the new row for some reason), do NOT wait;
            // fall through and let trackRefresh release.
        })
    } catch (err) {
        // trackRefresh already handled the indicator transition
        // to 'error'; re-throw so callers can surface it.
        throw err
    }
}
```

Notes:

- The 409 short-circuit lives INSIDE the trackRefresh callback so
  the indicator briefly shows yellow during the POST (if it takes
  long enough to cross the show-delay), then clears normally on
  the inner `return`. This is correct: the user did initiate work
  ("add this feed"), and it completed successfully — just no new
  data.
- `waitForAddFeedRelease` blocks the trackRefresh callback until
  the SSE event fires OR the hard timeout (35 s) elapses. Either
  way, `trackRefresh` then releases the acquire.
- For AC1.1: `trackRefresh` calls `acquireRefresh(state)`
  synchronously before awaiting `fn()`. The signal becomes
  `true` before the POST returns. ✓
- For AC1.2: When the SSE event arrives, `drainAddFeedAcquires`
  settles the waiting Promise. `trackRefresh` reaches its
  `try/finally` release. Signal returns to `false`. ✓
- For AC1.5: If SSE never fires, the hard-timeout inside
  `waitForAddFeedRelease` resolves the Promise after
  `_addFeedHardTimeoutMs` (35 s prod). `trackRefresh` releases.
  Signal returns to `false`. ✓
- For AC4.1 (addFeed branch): If `adapter.addFeed(url)` throws a
  non-409 error, the inner `throw err` propagates out of the
  trackRefresh callback, which sets `feedSyncStatus = 'error'`
  in the same batch as the release.
- The outer `try/catch` is now redundant (only re-throws). Keep
  it for clarity if you want, or simplify by removing it. The
  implementer's call.

**Change 2: `scheduleResolveConvergence` timer body**

The inner `runSync(db).then(() => refreshAfterSync(state))` chain
needs to become a `trackRefresh`. The timer is async itself
(setTimeout callback). The `.then/.catch` pattern can be
preserved by passing an async function to `trackRefresh`:

Replace this block (currently lines ~190-202):
```ts
const did = state.user.value?.did
const db = did ? getLocalDb(did) : null
if (!db) return
runSync(db)
    .then(() => {
        return State.refreshAfterSync(state)
    })
    .catch((err) => {
        debug(
            'resolve-convergence runSync failed',
            err instanceof Error ? err.message : err
        )
    })
```

With:
```ts
const did = state.user.value?.did
const db = did ? getLocalDb(did) : null
if (!db) return
trackRefresh(state, 'resolve-convergence', async () => {
    await runSync(db)
    await State.refreshAfterSync(state)
}).catch((err) => {
    // trackRefresh has already set feedSyncStatus = 'error'
    // and released. We log here for parity with the prior
    // `.catch(debug(...))` behavior.
    debug(
        'resolve-convergence runSync failed',
        err instanceof Error ? err.message : err,
    )
})
```

Notes:
- The outer `.catch(debug(...))` is preserved to maintain log
  parity. `trackRefresh` has already done the
  indicator-to-error transition.
- The convergence timer fires INSIDE a setTimeout. The
  `trackRefresh` promise's catch is enough — no unhandled
  rejections.

**Verification:**
- Type-check: `npm run lint`
- Run full suite: `npm test && npm run lint`

**Commit:** `feat(client): wire addFeed and scheduleResolveConvergence to trackRefresh`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->

<!-- START_TASK_4 -->
### Task 4: Tests for `State.addFeed` acquire/release lifecycle

**Verifies:** fix-silent-update-gap.AC1.1, fix-silent-update-gap.AC1.2,
fix-silent-update-gap.AC1.5

**Files:**
- Create: `/Users/nick/code/rsss/test/add-feed-acquire.ts`
- Modify: `/Users/nick/code/rsss/test/run-all-tests.mjs` to
  register.

**Test infrastructure pattern:**

Use the `StubEventSource` pattern from
`test/updating-pill-lifecycle.ts:13-65` (already in the codebase)
to inject SSE events. Stub the adapter (the object returned by
`getAdapter`) so `adapter.addFeed(url)` resolves with a
controllable Promise.

**Test cases:**

1. **AC1.1: acquire is synchronous (signal `true` before POST
   resolves).** Stub `adapter.addFeed` to return a Promise that
   never resolves (e.g., `new Promise(() => {})`) so the test can
   observe the in-flight state. Reset refcount. Call
   `State.addFeed(state, url)` WITHOUT awaiting. Immediately
   check `state.refreshInProgress.value === true`. Clean up by
   forcing release via `_resetRefreshRefCountForTest(state)` and
   `_resetPendingAddFeedAcquiresForTest()`.

2. **AC1.2: SSE event releases the acquire.** Stub
   `adapter.addFeed` to resolve quickly. Mock
   `State.loadFeeds`/`State.loadCounts` to populate
   `state.feeds.value` with a row matching `url` and `id = 42`.
   Call `State.addFeed(state, url)` (don't await yet). Await a
   microtask. Assert `refreshInProgress.value === true` and that
   `_pendingAddFeedAcquires` contains `42`. Fire SSE
   `feed-updates-available` with
   `{ feedUpdateCounts: { '42': 3 } }`. Await the addFeed
   Promise. Assert `refreshInProgress.value === false`.

3. **AC1.5: hard-timeout force-release.** Call
   `_setAddFeedHardTimeoutForTest(50)` to shrink timeout to 50 ms.
   Stub `adapter.addFeed` to resolve quickly. Populate feed row.
   Call `State.addFeed` (don't await). After microtask:
   `refreshInProgress.value === true`. Do NOT fire SSE. Wait 100 ms
   (50 ms timeout + 50 ms slack). Await addFeed. Assert
   `refreshInProgress.value === false`. Assert
   `_pendingAddFeedAcquires.size === 0`. Restore via
   `_setAddFeedHardTimeoutForTest(undefined)`.

4. **409 short-circuit does NOT raise error.** Stub
   `adapter.addFeed` to throw an HTTPError with `response.status =
   409`. Call `State.addFeed`. Await. Assert no throw. Assert
   `refreshInProgress.value === false`. Assert
   `feedSyncStatus.value` is NOT `'error'` (it is whatever it was
   before — e.g., `'inactive'`).

5. **AC4.1 (addFeed branch): non-409 error -> red.** Stub
   `adapter.addFeed` to throw a non-409 error. Call
   `State.addFeed`. Await with try/catch (expect throw). Assert
   `refreshInProgress.value === false` AND
   `feedSyncStatus.value === 'error'`. Subscribe to
   `displayedFeedSyncStatus` via `effect` and assert observed
   sequence has no intermediate value between `'syncing'` and
   `'error'`.

6. **AC5.2: end-state transition yellow -> blue+"X updates" has
   no intermediate `'inactive'` / `'synced'` frame.** Stub
   `adapter.addFeed` to resolve. Mock `loadFeeds`/`loadCounts`
   to populate `state.feeds.value` with a row matching `url`
   and `id = 42`. Prime `state.feedSyncStatus.value =
   'inactive'`. Subscribe to `displayedFeedSyncStatus` via
   `effect`, recording every distinct value observed (de-dup
   consecutive same-value emissions in the recorder, since
   signals may emit identical values during batch settlement).
   Call `State.addFeed(state, url)` (don't await). Wait
   `SHOW_DELAY_MS + 50` ms (from `displayed-refresh-in-progress`)
   so the displayed signal latches `true`. While still in
   flight, fire SSE `feed-updates-available` with payload
   `{ feedUpdateCounts: { '42': 3 } }`. Await the addFeed
   Promise. Wait `MIN_VISIBLE_MS + 50` ms more so the displayed
   signal clears. Assert:
   - The FINAL observed value is `'updates'`.
   - The de-duplicated observed sequence is exactly
     `['inactive', 'syncing', 'updates']` (or `['syncing',
     'updates']` if the test setup started with displayed
     already at `'syncing'`). No `'inactive'` or `'synced'`
     value appears AFTER the first `'syncing'` emission.

   **Why this test exists:** AC5.2 says "End-state unchanged on
   success." The SSE handler's batch at state.ts:1014-1062
   writes `feedUpdateCounts` AND `feedSyncStatus = 'updates'`
   in one batch; the `drainAddFeedAcquires` call (added in
   Task 2 of this phase) fires AFTER that batch settles. The
   refcount release inside `trackRefresh`'s `try/finally` then
   runs in ITS own batch. The min-visible window held by
   `displayedRefreshInProgress` adds further delay before the
   displayed signal clears. The net observable transition for
   the UI is `'syncing' -> 'updates'` with no `'inactive'` or
   `'synced'` between. If a future change re-orders the SSE
   handler so the drain happens INSIDE the count-update batch
   AND the trackRefresh release also lands inside that batch,
   the order of writes within the batch could matter for the
   computed signal's transient value during batch settlement.
   This test guards against that ordering regression.

**Async-microtask waits:**
Use `await new Promise(r => setTimeout(r, 0))` for
microtask flushes after signal mutations or stub Promise
resolutions, mirroring `test/updating-pill-lifecycle.ts:67-72`
(the `settle()` helper there).

**Verification:**
- Standalone: `npx esbuild ./test/add-feed-acquire.ts --bundle |
  npx tapout`
- Full suite: `npm test && npm run lint`

**Commit:** `test(client): add-feed acquire/release lifecycle`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Tests for `scheduleResolveConvergence` `trackRefresh` wrap

**Verifies:** fix-silent-update-gap.AC1.1 (partial - convergence
arm), fix-silent-update-gap.AC4.1 (resolve-convergence branch).

**Files:**
- Create: `/Users/nick/code/rsss/test/resolve-convergence-trackrefresh.ts`
- Modify: `/Users/nick/code/rsss/test/run-all-tests.mjs`.

**Test cases:**

The convergence timer fires after `RESOLVE_WINDOW_MS +
CLIENT_GRACE_MS` (35 s). Tests cannot wait that long. The
implementer has two options:

- **Option A: Test `scheduleResolveConvergence`'s timer-body
  function in isolation.** Extract or expose the body so tests
  can invoke it directly. This may require a small refactor:
  pull the timer body into a named `runResolveConvergence(state,
  feedId)` function and have `scheduleResolveConvergence`'s
  timer call it. Tests then call `runResolveConvergence`
  directly.
- **Option B: Add a test-only constant override for
  `RESOLVE_WINDOW_MS` and `CLIENT_GRACE_MS`** — not viable
  because they are `export const`. Skip.
- **Option C: Mock `setTimeout` globally.** Heavy.

Pick Option A. The refactor is small and improves testability.

**Step 1: Refactor `scheduleResolveConvergence`** to extract:
```ts
async function runResolveConvergence (
    state:AppState,
    feedId:number,
):Promise<void> {
    if (!isFeedStillResolving(state, feedId)) return
    const did = state.user.value?.did
    const db = did ? getLocalDb(did) : null
    if (!db) return
    return trackRefresh(state, 'resolve-convergence', async () => {
        await runSync(db)
        await State.refreshAfterSync(state)
    }).catch((err) => {
        debug(
            'resolve-convergence runSync failed',
            err instanceof Error ? err.message : err,
        )
    })
}

// Test-only export for direct invocation:
export const _runResolveConvergenceForTest = runResolveConvergence
```

Then `scheduleResolveConvergence`'s timer body becomes:
```ts
const timer = setTimeout(() => {
    resolveConvergenceTimers.delete(feedId)
    void runResolveConvergence(state, feedId)
}, RESOLVE_WINDOW_MS + CLIENT_GRACE_MS)
```

(Update Task 3's Change 2 to reflect this refactor — both
changes happen in the same file and same conceptual step;
implementer should resolve the conflict by adopting this
structure.)

**Step 2: Tests in
`test/resolve-convergence-trackrefresh.ts`:**

1. **Success path acquires and releases.** Stub `runSync` and
   `refreshAfterSync` so both resolve. Populate
   `state.feeds.value` so `isFeedStillResolving` returns `true`
   (the feed row must have `resolving: true` or whatever the
   predicate checks — read `isFeedStillResolving` in state.ts to
   confirm). Stub `getLocalDb` to return a non-null DB handle.
   Call `_runResolveConvergenceForTest(state, feedId)`. Assert
   `refreshInProgress.value === true` synchronously (or within a
   microtask). Await. Assert `refreshInProgress.value === false`
   and `feedSyncStatus.value` is unchanged (still whatever it
   was before).

2. **Failure path -> red.** Stub `runSync` to reject. Same setup.
   Call `_runResolveConvergenceForTest`. Await. Assert
   `refreshInProgress.value === false` AND `feedSyncStatus.value
   === 'error'`. Subscribe to `displayedFeedSyncStatus` via
   `effect` and verify no intermediate state.

3. **`isFeedStillResolving === false` -> no acquire.** Set the
   feed row state so `isFeedStillResolving` returns `false`.
   Call `_runResolveConvergenceForTest`. Assert
   `refreshInProgress.value === false` (no acquire fired).

4. **No DB -> no acquire.** Stub `getLocalDb` to return `null`.
   Call `_runResolveConvergenceForTest`. Assert no acquire.

**Verification:**
- Standalone: `npx esbuild ./test/resolve-convergence-trackrefresh.ts
  --bundle | npx tapout`
- Full suite: `npm test && npm run lint`

**Commit:** `test(client): resolve-convergence trackRefresh wrap`
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

---

## Phase Completion Checklist

- [ ] `_pendingAddFeedAcquires` map and helpers
  (`waitForAddFeedRelease`, `drainAddFeedAcquires`) added to
  `state.ts`.
- [ ] Test-only exports `_resetPendingAddFeedAcquiresForTest` and
  `_setAddFeedHardTimeoutForTest` exposed.
- [ ] SSE `feed-updates-available` handler at state.ts:1014-1062
  calls `drainAddFeedAcquires` after the count-update batch.
- [ ] `State.addFeed` wraps its work in `trackRefresh(state,
  'add-feed', ...)` with a `waitForAddFeedRelease(newRow.id)`
  await inside.
- [ ] `scheduleResolveConvergence` timer body delegates to
  `runResolveConvergence`, which uses `trackRefresh(state,
  'resolve-convergence', ...)`.
- [ ] 409 path inside addFeed treated as success (no error
  indicator).
- [ ] `test/add-feed-acquire.ts` registered + passing.
- [ ] `test/resolve-convergence-trackrefresh.ts` registered +
  passing.
- [ ] `npm test && npm run lint` passes.
- [ ] Manual sanity: in dev, click "Add feed" with a real URL.
  Dot turns yellow within ~300 ms of the click, stays yellow
  until items become available (SSE arrival OR ~35 s timeout),
  then transitions to blue + "X updates" if the resolve produced
  items, or back to its previous state if not. No flicker.
