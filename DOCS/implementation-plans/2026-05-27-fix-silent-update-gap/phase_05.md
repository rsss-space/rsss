# Phase 5: Wire SSE `feed-updated` and online-recovery to `trackRefresh`

**Goal:** Cover the remaining in-scope silent gaps: SSE-driven
catch-up after the server pushes a `feed-updated` event, and the
pull-sync that runs after the browser transitions from offline to
online.

**Architecture:** Two narrow call-site changes in `src/client/state.ts`:

1. The post-debounce `State.refreshAfterSync(state)` invocation
   inside the SSE `feed-updated` handler's debounced
   `scheduleRefresh` closure is wrapped in `trackRefresh(state,
   'sse-feed-updated', ...)`.
2. The `runSync(db).then(() => State.refreshAfterSync(state))`
   chain inside `handleOnline` is wrapped in `trackRefresh(state,
   'online-recovery', ...)`.

**Tech Stack:** TypeScript, `@preact/signals` (already imported).

**Scope:** Phase 5 of 5. Depends on Phase 2 (`trackRefresh`), Phase
3 (derived signal so the indicator is visible). Could ship in
parallel with Phase 4 — there are no cross-dependencies between
Phases 4 and 5 beyond their shared use of `trackRefresh`.

**Codebase verified:** 2026-05-27. Findings:

- The SSE `feed-updated` handler and its debounce sit at
  `state.ts:973-985`:
  ```ts
  let pendingRefresh:ReturnType<typeof setTimeout>|null = null
  const scheduleRefresh = () => {
      if (pendingRefresh !== null) return
      pendingRefresh = setTimeout(() => {
          pendingRefresh = null
          State.refreshAfterSync(state)
      }, SSE_REFRESH_DEBOUNCE_MS)
  }
  source.addEventListener('feed-updated', () => {
      debug('SSE feed-updated')
      scheduleRefresh()
  })
  ```
  The target of the wrap is the `State.refreshAfterSync(state)`
  call inside `setTimeout`. The design's reference to "state.ts:
  978-985" points to this region; the precise line of the
  `refreshAfterSync` call is inside the setTimeout callback.

- The online handler sits at `state.ts:610-634`, registered at
  `state.ts:651`:
  ```ts
  const handleOnline = () => {
      updateOnlineStatus()
      if (state.user.value) {
          State.loadFeedStatus(state).catch((err) => {
              debug('online loadFeedStatus error:', err)
          })
      }
      if (!isLocalFirstActive.value) return
      const did = state.user.value?.did
      const db = getLocalDb(did)
      if (db) {
          runSync(db).then(() => {
              State.refreshAfterSync(state)
          }).catch((err) => {
              if (State.handleSyncAuthError(state, err)) {
                  return
              }
              State.handleSyncCycleError(err)
          })
      }
  }
  ```
  The design's "state.ts:554, 561" reference is STALE — the
  actual handler is at lines 610-634. The two specific writes the
  design refers to (`runSync(db)` and `refreshAfterSync(state)`)
  are the chained calls in the if-block at the end.

**Coding style:** Same as previous phases.

**Skills the implementer should activate:**
- `ed3d-house-style:howto-code-in-typescript`
- `ed3d-house-style:writing-good-tests`

---

## Acceptance Criteria Coverage

### fix-silent-update-gap.AC1: Background-sync activity is observable

- **fix-silent-update-gap.AC1.3 Success:** When the SSE
  `feed-updated` debounced handler fires, the raw
  `refreshInProgress` signal is `true` for the duration of the
  subsequent `refreshAfterSync` call.
- **fix-silent-update-gap.AC1.4 Success:** When an `online`
  browser event triggers offline -> online recovery, the raw
  `refreshInProgress` signal is `true` for the duration of the
  recovery `runSync` and `refreshAfterSync` calls.

### fix-silent-update-gap.AC4: Failure surfaces as red

- **fix-silent-update-gap.AC4.1** (both branches): If the wrapped
  work rejects, `feedSyncStatus = 'error'` lands in the same
  batch as the release.

---

## Implementation Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Wrap SSE `feed-updated` debounced handler in `trackRefresh`

**Verifies:** fix-silent-update-gap.AC1.3

**Files:**
- Modify: `/Users/nick/code/rsss/src/client/state.ts` at the SSE
  `feed-updated` debounce body (currently around lines 973-985).

**Change:**

Replace the setTimeout body that calls
`State.refreshAfterSync(state)` with a `trackRefresh` wrap:

**Before:**
```ts
const scheduleRefresh = () => {
    if (pendingRefresh !== null) return
    pendingRefresh = setTimeout(() => {
        pendingRefresh = null
        State.refreshAfterSync(state)
    }, SSE_REFRESH_DEBOUNCE_MS)
}
```

**After:**
```ts
const scheduleRefresh = () => {
    if (pendingRefresh !== null) return
    pendingRefresh = setTimeout(() => {
        pendingRefresh = null
        trackRefresh(state, 'sse-feed-updated', async () => {
            await State.refreshAfterSync(state)
        }).catch((err) => {
            // trackRefresh already set feedSyncStatus = 'error'
            // and released. Log for parity with prior implicit
            // unhandled-rejection behavior.
            debug(
                'sse-feed-updated refreshAfterSync failed',
                err instanceof Error ? err.message : err,
            )
        })
    }, SSE_REFRESH_DEBOUNCE_MS)
}
```

Notes:
- `State.refreshAfterSync` was previously called without await
  (fire-and-forget). The new code awaits inside the
  `trackRefresh` callback so the acquire stays held until the
  refresh completes. Behavior change: the indicator is now
  honest about the duration.
- The previous code had no error handling — an unhandled
  rejection from `refreshAfterSync` would bubble up. The new
  code logs via `debug` and lets `trackRefresh` set the error
  status. This is an improvement.
- `SSE_REFRESH_DEBOUNCE_MS` is the existing constant; do not
  change it. The 300 ms `SHOW_DELAY_MS` from Phase 3 and this
  debounce interact: if `refreshAfterSync` finishes faster than
  `SHOW_DELAY_MS - SSE_REFRESH_DEBOUNCE_MS`, the indicator never
  shows. That is the desired no-flicker behavior.

**Verification:**
- Type-check: `npm run lint`
- Run full suite, especially `test/updating-pill-lifecycle.ts`
  which exercises the SSE -> indicator chain. Adjust the test
  if its assertions assume the prior fire-and-forget behavior.

**Commit:** `feat(client): wrap SSE feed-updated handler in trackRefresh`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Wrap `handleOnline`'s sync chain in `trackRefresh`

**Verifies:** fix-silent-update-gap.AC1.4

**Files:**
- Modify: `/Users/nick/code/rsss/src/client/state.ts` at the
  `handleOnline` function (currently around lines 610-634).

**Change:**

Replace the `runSync(db).then(() => refreshAfterSync(state))`
chain with a `trackRefresh` wrap:

**Before:**
```ts
const handleOnline = () => {
    updateOnlineStatus()
    if (state.user.value) {
        State.loadFeedStatus(state).catch((err) => {
            debug('online loadFeedStatus error:', err)
        })
    }
    if (!isLocalFirstActive.value) return
    const did = state.user.value?.did
    const db = getLocalDb(did)
    if (db) {
        runSync(db).then(() => {
            State.refreshAfterSync(state)
        }).catch((err) => {
            if (State.handleSyncAuthError(state, err)) {
                return
            }
            State.handleSyncCycleError(err)
        })
    }
}
```

**After:**
```ts
const handleOnline = () => {
    updateOnlineStatus()
    if (state.user.value) {
        State.loadFeedStatus(state).catch((err) => {
            debug('online loadFeedStatus error:', err)
        })
    }
    if (!isLocalFirstActive.value) return
    const did = state.user.value?.did
    const db = getLocalDb(did)
    if (db) {
        trackRefresh(state, 'online-recovery', async () => {
            await runSync(db)
            await State.refreshAfterSync(state)
        }).catch((err) => {
            // trackRefresh has set feedSyncStatus = 'error'
            // and released. Defer to existing
            // auth/error handlers for additional side effects
            // (sign-out, lapsed-billing, etc.).
            if (State.handleSyncAuthError(state, err)) {
                return
            }
            State.handleSyncCycleError(err)
        })
    }
}
```

Notes:
- The existing `handleSyncAuthError` and `handleSyncCycleError`
  hooks are preserved in the outer `.catch`. They may overwrite
  `feedSyncStatus` to a more specific value (e.g.,
  auth-expired), which is fine — `trackRefresh`'s `'error'`
  write is the floor, not the ceiling.
- The `State.loadFeedStatus` call earlier in the handler is NOT
  wrapped. It's a separate fetch that already swallows errors
  via `.catch(debug(...))`. It does not need to drive the
  refresh indicator because the design scopes `online-recovery`
  to the `runSync`/`refreshAfterSync` chain specifically.

**Verification:**
- Type-check: `npm run lint`
- Run full suite. There may not be existing tests that simulate
  the online event; Task 3 adds them.

**Commit:** `feat(client): wrap online-recovery sync in trackRefresh`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for SSE `feed-updated` + online-recovery acquire lifecycle

**Verifies:** fix-silent-update-gap.AC1.3, fix-silent-update-gap.AC1.4

**Files:**
- Create: `/Users/nick/code/rsss/test/background-sync-acquire.ts`
- Modify: `/Users/nick/code/rsss/test/run-all-tests.mjs` to
  register the new file.

**Test cases:**

**Group A: SSE `feed-updated` (AC1.3)**

Uses the `StubEventSource` pattern from
`test/updating-pill-lifecycle.ts:13-65`. The test sets up the
event stream, dispatches `feed-updated`, advances time past the
SSE debounce, and asserts on `refreshInProgress`.

1. **`feed-updated` fires -> debounce elapses -> refreshAfterSync
   runs under trackRefresh.** Stub `State.refreshAfterSync` to
   return a Promise that resolves after a controllable delay
   (e.g., `await new Promise(r => setTimeout(r, 30))`).
   `withStubbedEventSource(async () => { ... })` wrap. Open the
   event stream via `State.openEventStream(state)` (read
   state.ts to confirm the export). Fire `feed-updated` on the
   stub. Wait `SSE_REFRESH_DEBOUNCE_MS + 5` ms for the debounced
   timer to fire. Assert `refreshInProgress.value === true`.
   Wait for the stubbed `refreshAfterSync` to finish (the 30 ms
   above). Assert `refreshInProgress.value === false`.

2. **Multiple `feed-updated` events within debounce window
   coalesce.** Fire `feed-updated` three times in quick
   succession. Wait `SSE_REFRESH_DEBOUNCE_MS + 5` ms. Assert
   `refreshInProgress` toggled exactly once (track via an
   `effect`-based observer). Cleanup.

3. **`refreshAfterSync` rejects -> red.** Stub
   `State.refreshAfterSync` to reject. Fire `feed-updated`.
   Wait. Assert `refreshInProgress.value === false` and
   `feedSyncStatus.value === 'error'`.

**Group B: Online recovery (AC1.4)**

The online handler is registered as `window.addEventListener(
'online', handleOnline)`. Two options for triggering:

- **Option A:** Dispatch `new Event('online')` on `window` after
  ensuring the event stream + handler are set up.
- **Option B:** Extract `handleOnline` (or its inner sync arm)
  into a named export the test calls directly.

The existing pattern in `test/state-route.ts:59-111` modifies
`navigator.onLine` directly. For Phase 5's tests, Option A
(dispatching the event) is cleaner because the assertion is
about handler behavior, not about `navigator.onLine`.

If the `handleOnline` closure is local to a setup function and
not exposed, prefer **Option B**: extract `handleOnline` (or
the sync arm) to a module-private function that can be exposed
as `_handleOnlineForTest`. A minimal refactor — same logic,
different naming.

Pick Option B for testability. Add to `state.ts`:

```ts
// Inside the function that currently defines handleOnline,
// hoist the sync arm into a named function and export a
// test-only alias.
async function _onlineRecoverySync (
    state:AppState,
):Promise<void> {
    if (!isLocalFirstActive.value) return
    const did = state.user.value?.did
    const db = getLocalDb(did)
    if (!db) return
    await trackRefresh(state, 'online-recovery', async () => {
        await runSync(db)
        await State.refreshAfterSync(state)
    }).catch((err) => {
        if (State.handleSyncAuthError(state, err)) {
            return
        }
        State.handleSyncCycleError(err)
    })
}

// Wire handleOnline to call it:
const handleOnline = () => {
    updateOnlineStatus()
    if (state.user.value) {
        State.loadFeedStatus(state).catch((err) => {
            debug('online loadFeedStatus error:', err)
        })
    }
    void _onlineRecoverySync(state)
}

// Test-only export:
export const _onlineRecoverySyncForTest = _onlineRecoverySync
```

(Adjust Task 2's "After" block to match this refactor — same
behavior, structured for testability.)

**Test cases for Group B:**

4. **`_onlineRecoverySyncForTest` acquires + releases.** Stub
   `runSync` and `State.refreshAfterSync` to resolve. Populate
   `state.user.value` with a non-null DID; stub `getLocalDb` to
   return a non-null DB. Stub `isLocalFirstActive.value = true`.
   Reset refcount. Call `_onlineRecoverySyncForTest(state)`
   (don't await). After microtask, assert
   `refreshInProgress.value === true`. Await. Assert
   `refreshInProgress.value === false`. Assert
   `feedSyncStatus.value` unchanged.

5. **`runSync` rejects -> red.** Same setup, but stub `runSync`
   to reject. Call and await. Assert
   `refreshInProgress.value === false` AND
   `feedSyncStatus.value === 'error'`. (The `handleSyncAuthError`
   and `handleSyncCycleError` hooks may overwrite to a more
   specific value; assert they were called — track via spies —
   but the floor is `'error'` if neither claims the error.)

6. **`isLocalFirstActive === false` -> no acquire.** Setup with
   `isLocalFirstActive.value = false`. Call. Assert no acquire
   (refcount stays 0).

7. **No DB -> no acquire.** Setup with `getLocalDb` returning
   `null`. Call. Assert no acquire.

**Async-microtask waits:**
Use `await new Promise(r => setTimeout(r, 0))` for microtask
flushes after signal mutations or stub Promise resolutions.

**Verification:**
- Standalone: `npx esbuild ./test/background-sync-acquire.ts
  --bundle | npx tapout`
- Full suite: `npm test && npm run lint`

**Commit:** `test(client): SSE feed-updated and online-recovery acquire lifecycle`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

---

## Phase Completion Checklist

- [ ] SSE `feed-updated` debounce body wraps `refreshAfterSync`
  in `trackRefresh(state, 'sse-feed-updated', ...)`.
- [ ] `handleOnline`'s sync chain extracted into
  `_onlineRecoverySync` and wraps `runSync` +
  `refreshAfterSync` in `trackRefresh(state, 'online-recovery',
  ...)`.
- [ ] Existing `handleSyncAuthError` / `handleSyncCycleError`
  hooks still fire after a rejection.
- [ ] `_onlineRecoverySyncForTest` exported for testability.
- [ ] `test/background-sync-acquire.ts` registered + passing.
- [ ] `npm test && npm run lint` passes.
- [ ] Manual sanity:
  - In dev, with the network throttled or via dev-tools "offline
    -> online" toggle, the dot turns yellow during the
    online-recovery sync.
  - Receive a server-side `feed-updated` event (manually
    inserted via the SSE stream, or by triggering server-side
    polling): dot turns yellow during the resulting
    refreshAfterSync.
