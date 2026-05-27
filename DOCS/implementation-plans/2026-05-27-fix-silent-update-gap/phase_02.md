# Phase 2: `trackRefresh` helper and `feedSyncStatus` failure path

**Goal:** Add the single helper that callers (Phases 4 and 5) use to
wrap an async background-sync operation with refcount
acquire/release plus a failure-to-error transition for
`feedSyncStatus`.

**Architecture:** Export `trackRefresh(state, name, fn)` from
`src/client/state.ts`. The helper acquires the refcount immediately,
runs `fn()`, and releases on settle via `try/finally`. On rejection,
it sets `feedSyncStatus.value = 'error'` in the same `batch()` as the
release so the UI computed `displayedFeedSyncStatus` transitions
directly from `'syncing'` to `'error'` without an intermediate
state. Define and export the union type `RefreshOpName` for the
`name` argument.

**Tech Stack:** TypeScript, `@preact/signals` (`batch`).

**Scope:** Phase 2 of 5.

**Codebase verified:** 2026-05-27. Findings:

- `feedSyncStatus` is declared at `state.ts:412-414` with the type
  `signal<'inactive'|'updates'|'syncing'|'error'|'synced'>('inactive')`.
  Note: the type *does* include `'syncing'`, but `'syncing'` is never
  written to `feedSyncStatus` directly — `'syncing'` only appears
  as a return value of the `displayedFeedSyncStatus` computed when
  `refreshInProgress` is true. The design's Glossary entry
  characterizing `feedSyncStatus` as
  `'inactive'|'updates'|'synced'|'error'` is correct in spirit:
  `trackRefresh` writes `'error'` here, never `'syncing'`.
- `feedSyncError:Signal<string|null>` exists adjacent to
  `feedSyncStatus` and is set to a string in existing error paths.
  `trackRefresh` should NOT touch `feedSyncError`; that is a Phase
  4/5 caller decision (each caller may have its own error message
  semantics). Phase 2 only sets `feedSyncStatus = 'error'`.
- `displayedFeedSyncStatus` at `state.ts:427-433` returns
  `'syncing'` whenever `refreshInProgress.value === true`, and
  falls back to `feedSyncStatus.value` otherwise. The "yellow ->
  red without intermediate" guarantee requires that the release
  (which flips `refreshInProgress` to false) and the
  `feedSyncStatus = 'error'` write happen in the same `batch()` —
  otherwise the computed would briefly see
  `refreshInProgress=false` + `feedSyncStatus=<prior value>`
  before the `'error'` write lands.

**Coding style:** Same as Phase 1.

**Skills the implementer should activate:**
- `ed3d-house-style:howto-code-in-typescript`
- `ed3d-house-style:writing-good-tests`

---

## Acceptance Criteria Coverage

### fix-silent-update-gap.AC3: Refcount safety

- **fix-silent-update-gap.AC3.1 Success:** Two concurrent
  `trackRefresh` calls both acquire; the raw signal stays `true`
  until both settle.

### fix-silent-update-gap.AC4: Failure surfaces as red, not silent yellow->clear

- **fix-silent-update-gap.AC4.1 Failure:** If the `fn` passed to
  `trackRefresh` rejects, `feedSyncStatus` is set to `'error'` in
  the same `batch()` as the release, so
  `displayedFeedSyncStatus` transitions from `'syncing'` to
  `'error'` without an intermediate state.
- **fix-silent-update-gap.AC4.2 Success:** If the `fn` passed to
  `trackRefresh` resolves, `feedSyncStatus` is not modified by the
  helper.

---

## Implementation Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Add `RefreshOpName` union and `trackRefresh` helper to `state.ts`

**Files:**
- Modify: `/Users/nick/code/rsss/src/client/state.ts` — add the type
  export and the helper function. Place adjacent to the refcount
  helpers from Phase 1 (so the refcount-aware code stays
  co-located). Place ABOVE any callers (Phase 4 and 5 will reference
  `trackRefresh` from elsewhere in the same module).

**Implementation:**

Add immediately after the Phase 1 refcount helpers (and after the
`AppState` interface is declared):

```ts
/**
 * Stable name for an in-flight background refresh operation.
 * Used for debugging and for tying SSE / timer events to the
 * specific acquire that should release.
 */
export type RefreshOpName =
    | 'add-feed'
    | 'resolve-convergence'
    | 'sse-feed-updated'
    | 'online-recovery'

/**
 * Wrap an async background-sync operation with refresh-indicator
 * lifecycle.
 *
 * - Acquires the refcount synchronously before `fn` runs.
 * - Releases on settle (resolve OR reject) via try/finally.
 * - On rejection, sets `state.feedSyncStatus.value = 'error'` in the
 *   same `batch()` as the release, so the UI transitions from
 *   yellow ("updating…") directly to red ("error") without an
 *   intermediate "synced"/"inactive" frame.
 * - On resolve, `feedSyncStatus` is not touched by the helper —
 *   the caller (or downstream SSE handler) decides the post-success
 *   status.
 *
 * The `name` is for debugging only; it is logged at acquire and on
 * rejection but does not affect behavior.
 *
 * Concurrent `trackRefresh` calls each independently acquire and
 * release; the underlying refcount keeps the signal `true` until
 * every acquire has been released.
 */
export async function trackRefresh<T> (
    state:AppState,
    name:RefreshOpName,
    fn:() => Promise<T>,
):Promise<T> {
    acquireRefresh(state)
    debug('trackRefresh acquire', name)
    try {
        const result = await fn()
        releaseRefresh(state)
        return result
    } catch (err) {
        batch(() => {
            releaseRefresh(state)
            state.feedSyncStatus.value = 'error'
        })
        debug(
            'trackRefresh rejected',
            name,
            err instanceof Error ? err.message : err,
        )
        throw err
    }
}
```

Notes:

- `debug` is the existing module-private debug function used
  elsewhere in `state.ts` (e.g., the SSE handlers call `debug('SSE
  feed-updates-available', …)`). Reuse it; do not introduce a new
  logger. If the symbol's name is different in the actual file
  (verify via grep), substitute the correct one.
- The signature takes `state` as the first arg, diverging from the
  design's `trackRefresh<T>(name, fn)` two-arg contract. This is a
  deliberate adaptation: `state.ts`'s existing helpers
  (`scheduleResolveConvergence(state, url)`,
  `State.refreshAfterSync(state)`, `State.loadFeeds(state)`) all
  pass `state` explicitly. Matching that convention keeps the
  refcount per-AppState and keeps the helper testable without
  module-level mutable state. Phases 4 and 5 call
  `trackRefresh(state, 'add-feed', async () => { ... })`.
- The success path (`releaseRefresh(state)` alone) does not need a
  surrounding `batch()` because it writes only one signal. The
  helper itself wraps its single write in a `batch()` already.
- The failure path uses `batch()` to coalesce the release-write
  (`refreshInProgress -> false`) and the
  `feedSyncStatus -> 'error'` write into a single observed update.
  Without this, the computed `displayedFeedSyncStatus` could
  briefly observe `refreshInProgress=false` +
  `feedSyncStatus=<prior>` and yield e.g. `'synced'` for one tick
  before the `'error'` lands.
- `trackRefresh` re-throws on rejection so callers can do their
  own error handling (e.g., addFeed's existing 409 path). The
  helper is responsible only for the indicator transition; the
  caller is responsible for surfacing the error to the user, if
  desired.

**Verification:**
- Type-check: `npm run lint`
- Build: `npm test` — no test changes yet; existing tests must
  continue to pass. The helper has no callers at this point in
  the codebase.

**Commit:** `feat(client): add trackRefresh helper`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Unit tests for `trackRefresh` resolve and reject paths

**Verifies:** fix-silent-update-gap.AC3.1, fix-silent-update-gap.AC4.1,
fix-silent-update-gap.AC4.2

**Files:**
- Create: `/Users/nick/code/rsss/test/track-refresh.ts`
- Modify: `/Users/nick/code/rsss/test/run-all-tests.mjs` — register
  the new test (follow the same `esbuild ... | tapout` pattern used
  for the Phase 1 test).

**Test cases:**

1. **Resolve path holds signal `true` for the duration and releases
   on settle (fix-silent-update-gap.AC4.2).** Build a minimal
   AppState stub with `refreshInProgress` and `feedSyncStatus`
   signals. Prime `feedSyncStatus.value = 'synced'`. Call
   `trackRefresh(state, 'add-feed', async () => { ... })` where the
   wrapped `fn` returns a Promise that resolves after a brief delay
   (e.g., `await new Promise(r => setTimeout(r, 5))`). While the
   helper is awaiting, assert `state.refreshInProgress.value ===
   true`. After the awaited `trackRefresh` returns, assert
   `state.refreshInProgress.value === false` and
   `state.feedSyncStatus.value === 'synced'` (untouched).

2. **Reject path: fix-silent-update-gap.AC4.1 — release + `'error'`
   in same batch.** Prime `feedSyncStatus.value = 'synced'`. Subscribe
   to `displayedFeedSyncStatus` with a `computed` or `effect` that
   records each value it observes. Call `trackRefresh(state,
   'add-feed', async () => { throw new Error('boom') })`. Await with
   try/catch; assert the original error rethrows. Assert the observed
   sequence of `displayedFeedSyncStatus` values is `['syncing',
   'error']` with NO intermediate `'synced'` or `'inactive'`. (Use
   `effect(() => observed.push(state.displayedFeedSyncStatus.value))`
   and remember to dispose the effect.) Also assert
   `state.refreshInProgress.value === false` and
   `state.feedSyncStatus.value === 'error'` after.

3. **Reject path: `feedSyncStatus` is overwritten regardless of
   prior value.** Prime `feedSyncStatus.value = 'updates'`. Same
   reject flow. Assert post-state is `'error'`.

4. **Resolve path: `feedSyncStatus` is NOT touched
   (fix-silent-update-gap.AC4.2 corollary).** Prime
   `feedSyncStatus.value = 'updates'`. Call `trackRefresh` with a
   resolving `fn`. Assert post-state is still `'updates'` (the
   helper did not write `'error'` or anything else).

5. **fix-silent-update-gap.AC3.1: concurrent `trackRefresh` calls
   keep signal `true` until both settle.** Build two deferred
   promises (manual `resolve` handles). Call
   `trackRefresh(state, 'add-feed', () => p1)` without awaiting.
   Call `trackRefresh(state, 'sse-feed-updated', () => p2)`
   without awaiting. Await a microtask
   (`await new Promise(r => setTimeout(r, 0))`) so both have
   reached their `await fn()`. Assert `refreshInProgress.value ===
   true`. Resolve `p1`. Await another microtask. Assert
   `refreshInProgress.value === true` still. Resolve `p2`. Await
   another microtask. Assert `refreshInProgress.value === false`.

6. **Mixed concurrent: one resolves, one rejects.** Call two
   concurrent `trackRefresh`s. Reject the first; resolve the
   second. After both settle, assert
   `refreshInProgress.value === false` and
   `feedSyncStatus.value === 'error'` (the rejection wins because
   it's the only writer; the resolver doesn't touch
   `feedSyncStatus`).

**Test scaffolding (mirrors Phase 1's pattern):**

```ts
import { test } from '@substrate-system/tapzero'
import { signal, effect, computed } from '@preact/signals'
import {
    trackRefresh,
    _resetRefreshRefCountForTest,
} from '../src/client/state.js'
import type { AppState } from '../src/client/state.js'

function makeMinimalState ():AppState {
    const refreshInProgress = signal<boolean>(false)
    const feedSyncStatus = signal<
        'inactive'|'updates'|'syncing'|'error'|'synced'
    >('inactive')
    const displayedFeedSyncStatus = computed<
        'inactive'|'updates'|'syncing'|'error'|'synced'
    >(() => (
        refreshInProgress.value ?
            'syncing' :
            feedSyncStatus.value
    ))
    return {
        refreshInProgress,
        feedSyncStatus,
        displayedFeedSyncStatus,
    } as AppState
}
```

The stub includes a locally-built `displayedFeedSyncStatus` that
mirrors the real computed's logic so the "no intermediate" assertion
can be exercised without importing the heavyweight real AppState.

**Verification:**
- Run standalone: `npx esbuild ./test/track-refresh.ts --bundle |
  npx tapout`
- Run full suite: `npm test && npm run lint`

**Commit:** `test(client): trackRefresh resolve and reject paths`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

---

## Phase Completion Checklist

- [ ] `RefreshOpName` exported from `state.ts` with the four
  literal values.
- [ ] `trackRefresh(state, name, fn)` exported from `state.ts`.
- [ ] `test/track-refresh.ts` registered in `test/run-all-tests.mjs`
  and passing.
- [ ] All AC4.1 assertions pass: observed
  `displayedFeedSyncStatus` sequence on rejection is exactly
  `['syncing', 'error']`.
- [ ] `npm test && npm run lint` passes.
- [ ] No callers of `trackRefresh` exist yet outside the test file
  (Phases 4 and 5 will add them).
