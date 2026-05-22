# Internal Contract — Settings Navigation Render Path

**Branch**: `022-fix-settings-nav-lag` | **Date**: 2026-05-21

This is a **client-internal** contract. There is no HTTP, no wire
format, and no schema. It captures the invariants the implementation
must uphold so the spec's FRs and SCs survive future edits.

## Surface

### 1. `scheduleIdle` / `cancelIdle`

Module: `src/client/util/schedule-idle.ts`.

```ts
export type IdleHandle = { kind:'idle'|'timeout'; id:number }

export interface ScheduleIdleOptions {
    timeout?:number   // upper bound on delay (ms). Default 200.
}

export function scheduleIdle (
    fn:() => void,
    opts?:ScheduleIdleOptions
):IdleHandle

export function cancelIdle (handle:IdleHandle|null):void
```

**Guarantees**:

- `fn` runs **after** the next browser paint. (Never inside the
  same task that called `scheduleIdle`.)
- `fn` runs at most once per returned handle.
- `cancelIdle(handle)` before `fn` runs prevents the call.
  Idempotent for `null`, fired, or already-cancelled handles.
- On platforms with `requestIdleCallback`, `timeout` upper-bounds
  the delay. On the Safari fallback (`setTimeout(fn, 0)`),
  `timeout` is ignored — the next-task delay is already
  post-paint.
- The helper does **not** retain a reference to `fn` after either
  firing or being cancelled.

**Non-goals**: not a general task queue, not coalescing across
modules, no error handling — `fn` exceptions propagate to the
runtime.

### 2. Cache-status recompute scheduling

Module: `src/client/state.ts` (inside `State()`).

**Before** (today):

```ts
effect(() => {
    const _deps = [
        state.user.value, state.selectedFeedId.value,
        billingStatus.value, isLocalFirstActive.value,
        storeContent.value, defaultCacheMode.value,
        feedPolicies.value
    ]
    if (_deps.length === 0) return
    recomputeCacheStatus(state).catch(() => {})
})
```

**After**:

```ts
let pendingHandle:IdleHandle|null = null

effect(() => {
    const _deps = [
        state.user.value, state.selectedFeedId.value,
        billingStatus.value, isLocalFirstActive.value,
        storeContent.value, defaultCacheMode.value,
        feedPolicies.value
    ]
    if (_deps.length === 0) return
    if (pendingHandle !== null) cancelIdle(pendingHandle)
    pendingHandle = scheduleIdle(() => {
        pendingHandle = null
        recomputeCacheStatus(state).catch(() => {})
    }, { timeout: 200 })
})
```

**Guarantees**:

- The body of the `effect()` does **not** perform any SQLite work,
  HTML parsing, or other work whose cost scales with data volume.
  Its only synchronous work is the dependency reads, the
  `cancelIdle` of any prior handle, and a `scheduleIdle` call.
- Multiple signal changes within a single task collapse into one
  `recomputeCacheStatus` call.
- The `recomputeToken` guard inside `recomputeCacheStatus`
  (`cache-status-state.ts:75-79`) continues to discard stale
  results; we do not need to additionally guard the apply step
  here.
- `pendingHandle` is the single source of truth for "is a recompute
  queued". It is always cleared back to `null` either when the
  callback runs or when `cancelIdle` reclaims it (the next
  scheduling call assigns the new handle immediately).

**Non-goals**:

- Does **not** debounce on a fixed timer. Coalescing happens only
  for changes that arrive before idle.
- Does **not** change `recomputeCacheStatus`'s body. The expensive
  work still happens — just outside the paint critical path.
- Does **not** cancel an in-flight `computeCacheStatus`. Cancellation
  is at the scheduling level only; the apply-time `recomputeToken`
  check covers in-flight stalentess.

### 3. Settings stale-write guard

Module: `src/client/routes/settings.ts`.

The `<SettingsRoute>` component captures a per-mount `routeGeneration`
token and passes a `shouldApply` predicate to each of its four
mount-time loaders.

```ts
let globalRouteGeneration = 0

export const SettingsRoute = function (props) {
    const myGen = useRef(0)
    useEffect(() => {
        myGen.current = ++globalRouteGeneration
        const onSettings = () => (
            myGen.current === globalRouteGeneration
        )
        if (state.isAuthenticated.value) {
            State.loadBillingStatus({ shouldApply: onSettings })
            State.loadPaymentMethods({ shouldApply: onSettings })
        }
        loadFeedPolicies(db, ids, { shouldApply: onSettings })
        loadStorageUsage(db, ids, { shouldApply: onSettings })
    }, [])
}
```

**Guarantees**:

- Once `<SettingsRoute>` is unmounted, no `.then()` callback
  scheduled by that mount writes to any of the signals listed in
  `data-model.md`.
- A second mount of `<SettingsRoute>` (e.g. user navigates away
  and back) is unaffected by the first mount's in-flight promises:
  it captures its own `myGen.current` and ignores the old
  generation's responses.
- The four loaders accept an optional `{ shouldApply:() =>
  boolean }`. Omitting it is identical to the current behaviour.
  This means every non-Settings caller of those loaders is
  unaffected.

**Non-goals**:

- Does **not** cancel the underlying HTTP fetch or SQLite query —
  the response still arrives; it is simply discarded.
- Does **not** rewrite the loaders into pure functions that return
  rows. The signal-writing shape is preserved as a minimum-change
  fix.

## Observable invariants (testable)

| ID | Invariant | Where tested |
|---|---|---|
| INV-1 | The body of the `effect()` at `state.ts:654` runs in O(1) main-thread time independent of item count. | `test/settings-nav-instant.ts` — stub `scheduleIdle`, set `feedPolicies.value`, assert `recomputeCacheStatus` is not yet called. |
| INV-2 | Rapid consecutive signal writes cause at most one `recomputeCacheStatus` call (once the stubbed idle queue is drained). | `test/cache-status-coalesce.ts`. |
| INV-3 | A `loadFeedPolicies` promise that resolves after `state.route.value` left `/settings` does not mutate `feedPolicies.value`. | `test/settings-stale-async-writes.ts` (apply same to `loadBillingStatus`, `loadPaymentMethods`, `loadStorageUsage`). |
| INV-4 | `viewItemsCache` (021) is intact: after `/` → `/settings` → `/`, the cache hit path in `loadItems` paints items without setting `itemsLoading=true`. | Existing 021 tests still pass; no new test required. |
| INV-5 | The `recomputeToken` guard still prevents stale `cacheStatus` writes. | Existing tests for `cache-status-state.ts`. |
| INV-6 | Browser Back/Forward triggers the same code path as link clicks. | Verified at runtime via `quickstart.md`; covered by route-event's contract. |

## Failure modes intentionally not handled

- `requestIdleCallback` callback fires while the tab is hidden:
  acceptable. The work runs eventually; the snapshot is correct
  whenever the user returns.
- The idle callback throws: the `.catch(() => {})` outside the
  callback handles `recomputeCacheStatus` errors; the helper itself
  doesn't swallow them, so `fn` exceptions surface to the runtime
  for debugging.
- A signal change that arrives **during** a `recomputeCacheStatus`
  run does not interrupt it. The `recomputeToken` guard discards
  its result, and the next `scheduleIdle` callback runs a fresh
  recompute with current signal values.
