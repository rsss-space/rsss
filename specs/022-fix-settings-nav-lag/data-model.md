# Phase 1: Data Model — Instant Settings → Home Navigation

**Branch**: `022-fix-settings-nav-lag` | **Date**: 2026-05-21

This feature does not change any persisted schema. It introduces two
small in-memory bookkeeping fields and one helper module. They live
on the **client**; no DO SQLite, local OPFS SQLite, or `/api/sync`
payload changes.

## Entities

### `IdleHandle` (new, module-private in `util/schedule-idle.ts`)

Opaque token returned by `scheduleIdle()` so the caller can cancel a
pending callback. Either an `IdleCallbackHandle` (Chromium/Firefox)
or a `setTimeout` handle (Safari). Never crosses module boundaries
unwrapped.

| Field | Type | Notes |
|---|---|---|
| `kind` | `'idle' \| 'timeout'` | Discriminates which platform API holds the handle. |
| `id` | `number` | The native handle. |

**Lifecycle**:

- Created by `scheduleIdle(fn, opts)`. `opts.timeout` defaults to
  `200` ms; this is the upper bound on when `fn` runs even if the
  main thread never goes idle.
- Destroyed by `cancelIdle(handle)`. Idempotent — cancelling an
  already-fired or already-cancelled handle is a no-op.
- Discarded when `fn` runs (the caller is expected to clear its
  reference inside `fn`).

### Cache-status scheduling state (new, file-local in `state.ts`)

A single variable in the closure that owns the `effect()`. Holds the
currently-pending recompute, if any.

| Field | Type | Notes |
|---|---|---|
| `pendingHandle` | `IdleHandle \| null` | `null` when no recompute is queued. |

**State transitions**:

```text
       signal change
          │
          ▼
   ┌─────────────┐  cancelIdle(prev) ┌─────────────┐
   │ pending=null├──────────────────►│ pending=h1  │
   └─────────────┘                   └─────┬───────┘
          ▲                                │
          │ callback fires; pending=null   │ signal change
          │                                ▼
          │                          cancelIdle(h1)
          │                                │
          │                                ▼
          │                          ┌─────────────┐
          └──────────────────────────┤ pending=h2  │
                                     └─────────────┘
```

Invariant: at most one outstanding idle callback exists. Multiple
rapid signal writes collapse into one recompute.

### `RouteGeneration` (new, module-local in `routes/settings.ts`)

Monotonic counter incremented on each mount of `<SettingsRoute>`.
The mount captures the current value into a `useRef`; mount-time
async loaders compare against the live counter to decide whether to
apply their results.

| Field | Type | Notes |
|---|---|---|
| `globalRouteGeneration` | `number` (module-level) | Bumped by the mount-time `useEffect`. Never reset. |
| `myGeneration` | `number` (per-mount `useRef`) | The value at mount time. Compared against `globalRouteGeneration` inside `.then()` callbacks. |

**State transitions**:

```text
mount #1: globalRouteGeneration: 0 → 1
          myGeneration captured: 1
          loadFeedPolicies → .then(): myGeneration(1) === global(1) → apply

mount #2: globalRouteGeneration: 1 → 2
          myGeneration captured: 2
          loadFeedPolicies (#1 still in flight) resolves → .then():
              myGeneration(1) !== global(2) → no-op
          loadFeedPolicies (#2) resolves → .then():
              myGeneration(2) === global(2) → apply
```

Invariant: a `.then()` callback only writes to a global signal when
the user is still on the route that issued the request.

### `shouldApply` (new, optional parameter on the four Settings loaders)

`type ShouldApply = () => boolean` — a thin predicate the loader
checks before writing to its signal. Default: `() => true` (preserves
behaviour for all non-Settings call sites).

The four loaders that gain this parameter:

| Loader | Signal(s) written | Defined in |
|---|---|---|
| `State.loadBillingStatus` | `billingStatus` | `state.ts:1270` |
| `State.loadPaymentMethods` | `paymentMethods`, `defaultMethodId`, `paymentMethodsLoading`, `paymentMethodsError` | `state.ts:1293` |
| `loadFeedPolicies` | `feedPolicies` | `db/feed-cache-policy.ts` |
| `loadStorageUsage` | `feedStorageBytes`, `totalStorageBytes` | `db/storage-usage.ts` |

**Compatibility**: All existing call sites that omit `shouldApply`
get the default `() => true` and behave identically.

## Helpers

### `scheduleIdle(fn, opts?)` (new, `util/schedule-idle.ts`)

```text
scheduleIdle(
    fn:() => void,
    opts?:{ timeout?:number }
):IdleHandle
```

- Wraps `window.requestIdleCallback` if available (Chromium, Firefox).
- Falls back to `setTimeout(fn, 0)` (Safari). `timeout` is ignored on
  the fallback path — `setTimeout(fn, 0)` is already strictly after
  the next paint.
- `timeout` defaults to `200` ms.

### `cancelIdle(handle)` (new, `util/schedule-idle.ts`)

```text
cancelIdle(handle:IdleHandle|null):void
```

- Idempotent. `null` is a no-op.
- Routes to `cancelIdleCallback` or `clearTimeout` based on `kind`.

### `scheduleIdleRecompute(state)` (new, file-local in `state.ts`)

```text
function scheduleIdleRecompute (state:AppState):void {
    if (pendingHandle !== null) cancelIdle(pendingHandle)
    pendingHandle = scheduleIdle(() => {
        pendingHandle = null
        recomputeCacheStatus(state).catch(() => {})
    }, { timeout: 200 })
}
```

Used inside the rewritten `effect()`. Encapsulates the
cancel-and-replace pattern so the `effect()` body stays small.

## Things deliberately not modelled

- No new persisted entity.
- No new signal in `state.ts` (no `cacheStatusDeferred:Signal<...>`
  or similar). The deferral is internal mechanics; consumers of
  `cacheStatus` (header indicator, `<CacheSettings>`) keep reading
  the same `cacheStatus:Signal<...>` from `cache-status-state.ts`.
- No new schema column. Settings policies and storage usage are still
  read from the same OPFS tables.
- No change to the `viewItemsCache` shape established in feature 021.
