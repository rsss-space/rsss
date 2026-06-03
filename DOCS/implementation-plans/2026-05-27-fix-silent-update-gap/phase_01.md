# Phase 1: Refcount-backed `refreshInProgress`

**Goal:** Convert `refreshInProgress` from a directly-mutated
`Signal<boolean>` to a refcount-backed signal whose value is `count > 0`,
without changing its external read contract or visible behavior.

**Architecture:** Add a module-private refcount keyed per-`AppState` via a
`WeakMap<AppState, number>`. Expose two module-private helpers
`acquireRefresh(state)` / `releaseRefresh(state)` that increment/decrement
the counter inside `batch()` and mirror the boolean signal. Convert all
seven existing `refreshInProgress.value = true|false` sites to call the
helpers.

**Tech Stack:** TypeScript (browser, ES2022 via Vite),
`@preact/signals` (`signal`, `batch`), `@substrate-system/tapzero`.

**Scope:** Phase 1 of 5 from
`DOCS/design-plans/2026-05-27-fix-silent-update-gap.md`.

**Codebase verified:** 2026-05-27. All assumptions from the design
checked against current `src/client/state.ts`:

- `refreshInProgress` declared at `src/client/state.ts:411` as
  `refreshInProgress: signal<boolean>(false)` (member of the AppState
  factory's object literal).
- AppState interface declares `refreshInProgress:Signal<boolean>` at
  `src/client/state.ts:349`.
- Seven write sites (design said "six"; the actual count is **seven**):
  - `state.ts:1000` — SSE `refresh-complete` handler, sets `false`
  - `state.ts:1107` — SSE `open` reconnect handler, sets `false`
  - `state.ts:2000` — `State.refreshFeeds` entry, sets `true`
  - `state.ts:2008` — `State.refreshFeeds` long safety timeout, sets `false`
  - `state.ts:2035` — `State.refreshFeeds` zero-feed safety timeout, sets `false`
  - `state.ts:2049` — `State.refreshFeeds` 401 catch, sets `false`
  - `state.ts:2061` — `State.refreshFeeds` general catch, sets `false`
- All seven sites are already wrapped in `batch(() => { ... })`.
- The only read site outside `state.ts` is the computed
  `displayedFeedSyncStatus` at `state.ts:430` and (transitively) the
  component `src/client/components/feed-status.ts`. Phase 1 must not
  change either.

**Coding style:** 4-space indentation, 80-column max, no spaces between
identifier and type annotation (`name:Type`). Tests use
`@substrate-system/tapzero` (tap-style `test('desc', async (t) => {...})`).
See `/Users/nick/code/rsss/CLAUDE.md` and `/Users/nick/.claude/CLAUDE.md`.

**Skills the implementer should activate before coding:**
- `ed3d-house-style:howto-code-in-typescript`
- `ed3d-house-style:writing-good-tests`
- `ed3d-house-style:coding-effectively`

---

## Acceptance Criteria Coverage

This phase implements and tests:

### fix-silent-update-gap.AC3: Refcount safety

- **fix-silent-update-gap.AC3.1 Success:** Two concurrent `trackRefresh`
  calls both acquire; the raw signal stays `true` until both settle.
  (Phase 1 verifies the underlying refcount via direct
  `acquireRefresh` / `releaseRefresh` calls; the `trackRefresh` helper
  itself ships in Phase 2.)
- **fix-silent-update-gap.AC3.2 Edge:** Calling `releaseRefresh()` more
  times than `acquireRefresh()` does not move the internal counter
  below zero and does not toggle the signal back to `true` on the next
  acquire.

This phase **does not** change visible behavior of the existing manual
refresh flow. The existing test suite must continue to pass unchanged.

---

## Implementation Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Add module-private refcount infrastructure to `state.ts`

**Files:**
- Modify: `/Users/nick/code/rsss/src/client/state.ts` — add new
  declarations near the top of the module (after existing imports and
  near the other module-private state such as `resolveConvergenceTimers`
  at line 132). Do NOT change `refreshInProgress`'s declaration at
  line 411 yet.

**Implementation:**

Add the following near the existing module-private declarations
(between line 121 `CLIENT_GRACE_MS` and line 132's
`resolveConvergenceTimers`, or immediately after
`resolveConvergenceTimers` — pick the location that keeps
related module-private bookkeeping together):

```ts
// Module-private refcount for refreshInProgress.
// Keyed per-AppState so test instances do not pollute each other.
const _refreshRefCounts = new WeakMap<AppState, number>()

/**
 * Increment the refcount for the given AppState. If the counter
 * transitions from 0 -> 1, set `state.refreshInProgress.value = true`
 * inside a `batch()`.
 *
 * Module-private (not exported). External callers ship in Phase 2
 * via `trackRefresh`.
 */
function acquireRefresh (state:AppState):void {
    const current = _refreshRefCounts.get(state) ?? 0
    const next = current + 1
    _refreshRefCounts.set(state, next)
    if (current === 0) {
        batch(() => {
            state.refreshInProgress.value = true
        })
    }
}

/**
 * Decrement the refcount for the given AppState. Bounded at zero:
 * extra releases are no-ops, never make the counter negative, and
 * never re-toggle the signal back to `true` on a subsequent acquire.
 * If the counter transitions from 1 -> 0, set
 * `state.refreshInProgress.value = false` inside a `batch()`.
 *
 * Module-private (not exported). External callers ship in Phase 2.
 */
function releaseRefresh (state:AppState):void {
    const current = _refreshRefCounts.get(state) ?? 0
    if (current <= 0) return
    const next = current - 1
    _refreshRefCounts.set(state, next)
    if (next === 0) {
        batch(() => {
            state.refreshInProgress.value = false
        })
    }
}

/**
 * Test-only: reset the refcount for the given AppState to zero
 * without touching the signal. Used so test cases that exercise
 * acquire/release directly do not leak state across tests.
 */
export function _resetRefreshRefCountForTest (state:AppState):void {
    _refreshRefCounts.delete(state)
}
```

Notes:
- `AppState` is the interface declared earlier in `state.ts:349`-ish.
  These helpers are declared after the interface definition is
  available; if the order matters, place them after the AppState
  interface declaration but before the factory function that builds
  the state object.
- `batch` and `signal` are already imported from `@preact/signals` at
  the top of `state.ts`. Reuse them.
- The helpers are module-private (no `export`) except
  `_resetRefreshRefCountForTest`, which follows the existing pattern
  of test-only exports (compare
  `_resetPaintCacheWriteHandleForTest` at `state.ts:764`).

**Why a WeakMap (not a single `let _refreshRefCount = 0`):** Tests in
`test/` create multiple `AppState` instances via `createTestAppState()`
and similar helpers. A module-level scalar would conflate counts
across instances and produce flaky tests. WeakMap keyed on `state`
isolates counts per-instance and lets `AppState` instances be garbage
collected normally.

**Verification:**
- Type-check: `npm run lint`
- Compile (no test yet): the helpers are unreferenced; verify with
  `tsc --noEmit` if available, otherwise rely on the bundle step in
  the next task.

**Commit:** `refactor(client): add refcount helpers for refreshInProgress`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Convert all seven `refreshInProgress.value = ...` sites to use the helpers

**Verifies:** fix-silent-update-gap.AC3.1, fix-silent-update-gap.AC3.2
(through preservation of existing behavior; explicit tests follow in
Task 3).

**Files:**
- Modify: `/Users/nick/code/rsss/src/client/state.ts` at each of the
  seven sites listed below. Replace `state.refreshInProgress.value =
  true` with `acquireRefresh(state)` and
  `state.refreshInProgress.value = false` with
  `releaseRefresh(state)`. Leave all other lines in each surrounding
  `batch()` block untouched.

**Per-site changes:**

1. `state.ts:1000` (SSE `refresh-complete` handler) — replace
   `state.refreshInProgress.value = false` with `releaseRefresh(state)`.
   Surrounding batch remains:
   ```ts
   batch(() => {
       releaseRefresh(state)
       state.feedsLoading.value = false
   })
   ```

2. `state.ts:1107` (SSE `open` reconnect handler) — same
   substitution. The surrounding `batch()` keeps the
   `feedsLoading.value = false` write.

3. `state.ts:2000` (`State.refreshFeeds` entry) — replace
   `state.refreshInProgress.value = true` with
   `acquireRefresh(state)`. Surrounding batch remains:
   ```ts
   batch(() => {
       acquireRefresh(state)
       state.feedSyncError.value = null
   })
   ```

4. `state.ts:2008` (`State.refreshFeeds` long safety timeout) —
   replace with `releaseRefresh(state)`.

5. `state.ts:2035` (`State.refreshFeeds` zero-feed safety timeout) —
   replace with `releaseRefresh(state)`.

6. `state.ts:2049` (`State.refreshFeeds` 401 catch) — replace with
   `releaseRefresh(state)`. The surrounding batch keeps the other
   writes (`state.user.value = null`, `authError`, `feedSyncStatus`,
   `feedSyncError`, `feedsLoading`).

7. `state.ts:2061` (`State.refreshFeeds` general catch) — replace
   with `releaseRefresh(state)`. The surrounding batch keeps the
   other writes (`feedSyncStatus`, `feedSyncError`,
   `feedUpdateCounts`, `feedsLoading`).

**Important:** `acquireRefresh` / `releaseRefresh` already wrap their
signal mutation in a `batch()` internally, but here they are being
called INSIDE an existing `batch()` block. `@preact/signals` supports
nested `batch()` calls — the inner batch is a no-op and the outer
batch defers notifications until its own callback returns. No double
notification will occur. Reference: the existing codebase uses this
pattern in `src/client/sync.ts` for `inFlightSyncs`.

**Verification:**
- Type-check / lint: `npm run lint`
- Build: `npm test` — existing tests under `test/` must pass
  unchanged. Pay particular attention to:
  - `test/state-refresh-audit.ts` (static audit of refresh call sites)
  - `test/updating-pill-lifecycle.ts` (verifies the existing
    manual-refresh -> `refreshInProgress` -> `displayedFeedSyncStatus`
    chain)
  - `test/feed-status.ts`
- If `state-refresh-audit.ts` greps for `refreshInProgress.value =`
  string-literally and the conversion removes those lines, update the
  audit to grep for `acquireRefresh(`/`releaseRefresh(` patterns
  instead. Adjust the audit's expectations to keep coverage intact.
  Verify by reading the file first; do NOT pre-emptively edit it
  without seeing what it asserts.

**Commit:** `refactor(client): route refreshInProgress writes through refcount helpers`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Unit tests for refcount semantics

**Verifies:** fix-silent-update-gap.AC3.1, fix-silent-update-gap.AC3.2

**Files:**
- Create: `/Users/nick/code/rsss/test/refresh-refcount.ts` (unit test).
- Add: `/Users/nick/code/rsss/test/run-all-tests.mjs` — ensure the new
  test file is registered in the runner list. Read the runner first to
  see the exact registration shape (typically an entry like
  `'esbuild ./test/refresh-refcount.ts --bundle | tapout'`) and follow
  the surrounding pattern.

**What the tests must verify** (the task-implementor writes the actual
test code at execution time, referencing the existing
`test/paint-cache.ts` and `test/updating-pill-lifecycle.ts` patterns):

The test file imports a thin test-only API from `state.ts`. Phase 1
must export the private helpers in a way that's accessible to tests
without leaking them into general client code. Two options:

- **Option A (recommended):** Export an additional pair
  `_acquireRefreshForTest(state)` and `_releaseRefreshForTest(state)`
  that simply call the module-private `acquireRefresh` /
  `releaseRefresh`. Mark with `_*ForTest` per the existing convention
  (`_resetPaintCacheWriteHandleForTest`).
- **Option B:** Re-export `acquireRefresh` / `releaseRefresh` directly.
  Less safe; non-test consumers might begin to depend on them.

Pick Option A. Add the exports adjacent to the helpers from Task 1:

```ts
export function _acquireRefreshForTest (state:AppState):void {
    acquireRefresh(state)
}
export function _releaseRefreshForTest (state:AppState):void {
    releaseRefresh(state)
}
```

Then the test file uses `_acquireRefreshForTest` /
`_releaseRefreshForTest` / `_resetRefreshRefCountForTest`.

**Test cases the file must include:**

1. **Single acquire toggles signal true; single release toggles
   false.** Create a test AppState (use the existing
   `createTestAppState()` helper if available; check
   `test/paint-cache-bootstrap.ts:22-34` for the pattern, or build a
   minimal `{ refreshInProgress: signal<boolean>(false) } as AppState`
   if the existing helper is too heavy). Reset refcount via
   `_resetRefreshRefCountForTest(state)`. Assert
   `state.refreshInProgress.value === false`. Call
   `_acquireRefreshForTest(state)`. Assert
   `state.refreshInProgress.value === true`. Call
   `_releaseRefreshForTest(state)`. Assert
   `state.refreshInProgress.value === false`.

2. **fix-silent-update-gap.AC3.1: Two concurrent acquires keep the
   signal true until both release.** Acquire twice in succession (the
   "concurrency" is logical — the refcount is synchronous and pure).
   After first acquire, signal `true`. After second acquire, signal
   still `true`. After first release, signal still `true`. After
   second release, signal `false`.

3. **fix-silent-update-gap.AC3.2: Extra release is a no-op (no
   underflow).** Acquire once, release once (signal back to false).
   Release a second time. Counter must not go negative. Call acquire
   again. Signal must transition from `false -> true` (proving the
   counter started at 0, not at -1). If the counter were -1, the
   third acquire would leave it at 0 and the signal would stay false.

4. **Multiple acquires then drained:** Acquire 5 times. Signal `true`.
   Release 5 times. Signal `false`. Release a 6th time. No throw, no
   change.

5. **Per-AppState isolation:** Build two distinct AppState instances.
   Acquire on instance A. Assert A's signal `true` and B's signal
   `false`. Release on A. Both signals `false`.

**Test scaffolding:**

```ts
// Test header pattern (see test/paint-cache.ts for the canonical form):
import { test } from '@substrate-system/tapzero'
import { signal } from '@preact/signals'
import {
    _acquireRefreshForTest,
    _releaseRefreshForTest,
    _resetRefreshRefCountForTest,
} from '../src/client/state.js'
import type { AppState } from '../src/client/state.js'

function makeMinimalState ():AppState {
    // Minimal stub: only the fields these tests read.
    return {
        refreshInProgress: signal<boolean>(false),
    } as AppState
}

test('refcount: single acquire/release toggles signal', (t) => {
    const state = makeMinimalState()
    _resetRefreshRefCountForTest(state)
    // ...assertions...
})
```

**Why a minimal state stub:** Pulling in `createTestAppState()` from
`test/paint-cache-bootstrap.ts` may transitively require OPFS-SQLite
or other heavy dependencies. For pure refcount tests, a structural
stub with just the `refreshInProgress` signal is sufficient and
faster. Confirm by reading `createTestAppState` first; if it is light
enough, prefer it for consistency. Use judgement.

**Verification:**
- Run the new test file standalone first:
  `npx esbuild ./test/refresh-refcount.ts --bundle | npx tapout`
- Run full suite: `npm test && npm run lint`
- Expected: all tests pass, including the existing
  `test/state-refresh-audit.ts` (which may need the audit-list update
  from Task 2).

**Commit:** `test(client): refcount semantics for refreshInProgress`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

---

## Phase Completion Checklist

Before marking Phase 1 complete:

- [ ] All seven `refreshInProgress.value = ...` sites in
  `src/client/state.ts` route through `acquireRefresh` /
  `releaseRefresh`. No direct writes to `refreshInProgress.value`
  remain in the file (grep for `refreshInProgress.value =` to confirm).
- [ ] `test/refresh-refcount.ts` exists, is registered in
  `test/run-all-tests.mjs`, and passes.
- [ ] `test/state-refresh-audit.ts` passes (with audit list updated
  if Task 2's grep substitution required it).
- [ ] `npm test && npm run lint` passes locally.
- [ ] Manual refresh flow behaves identically to today (no UI changes,
  no flicker, no missing "updating…" state during manual refresh). If
  the test suite covers this, automated verification suffices;
  otherwise spot-check by running the dev server and clicking the
  Refresh button.
- [ ] No new public exports from `state.ts` except the three
  `_*ForTest` helpers. `acquireRefresh` and `releaseRefresh` remain
  module-private.
