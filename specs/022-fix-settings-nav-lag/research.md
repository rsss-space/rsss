# Phase 0: Research — Instant Settings → Home Navigation

**Branch**: `022-fix-settings-nav-lag` | **Date**: 2026-05-21

## Research questions

The spec marked no NEEDS CLARIFICATION items. The Technical Context
section of the plan still has open design choices that need to be
resolved before Phase 1. Each is captured as a Decision / Rationale /
Alternatives block below.

---

## Decision 1: Where the lag actually comes from

**Question**: The 021 fix already covered the "synchronous click
handler that `await`s a SQLite worker round-trip" case. The lag on
`/settings` → `/` is reported as multi-second, much larger than a
worker round-trip. What is the actual cause?

**Decision**: The lag is the `effect()` block at
`src/client/state.ts:654-667`. It subscribes to seven signals
including `feedPolicies`, `storeContent`, `defaultCacheMode`,
`billingStatus`, and `selectedFeedId`, and calls
`recomputeCacheStatus(state)` synchronously when any of them change.
`recomputeCacheStatus` awaits `computeCacheStatus(db, { feedId })`
(`src/client/db/cache-status.ts:47-130`) which:

1. Runs `SELECT id, feed_id, content, description, full_content FROM
   items` with **no `LIMIT`**.
2. Iterates every row on the main thread, parsing every row's
   `content` and `description` HTML with a regex
   (`extractImageUrls`).
3. Chunks the extracted URLs into `SELECT url FROM cached_images
   WHERE url IN (?, ?, …)` batches of up to 500.
4. Iterates the rows a second time to build the `itemsToCache` list.

For accounts with thousands of items, the SQLite `postMessage`
returning the full items table plus the two main-thread iterations
is multi-second work that blocks paint.

The signals it depends on are exactly the ones the Settings route
mutates while the user is on `/settings`:

- `feedPolicies` ← `loadFeedPolicies(db, ids)` in `routes/settings.ts:83`
- `storeContent`, `defaultCacheMode` ← user-driven via the cache
  controls in `routes/settings.ts:418-441` and `:287-326`
- `billingStatus` ← `State.loadBillingStatus()` in
  `routes/settings.ts:71`

And, critically, on first arrival at `/`:

- `selectedFeedId` flips from a possibly-non-null value to `null` in
  the FeedReader mount-time `useEffect` at
  `routes/feed-reader.ts:71-87`.

Any of these can fire the effect at the worst possible moment — the
moment Preact is reconciling `<SettingsRoute>` out and `<FeedReader>`
in.

**Evidence**:

- `effect(...)` block at `state.ts:654-667` reads all the signals
  named above and calls `recomputeCacheStatus(state).catch(() => {})`.
  No scheduling primitive wraps the call; it runs in the same
  microtask as the signal write.
- `computeCacheStatus(db, scope)` at `cache-status.ts:47-130`
  contains the two-pass row iteration described above.
- `recomputeCacheStatus` at `cache-status-state.ts:51-84` already
  contains a `recomputeToken` monotonic counter, but it only
  guards the **apply** step (line 79: `if (token !== recomputeToken)
  return`). The expensive query and iteration still run.
- The Settings unmount path itself is clean: `<PaymentMethodModal>`
  is always rendered but its cleanup is local React/Preact state
  only (`payment-method-modal.ts:87-107`).

**Rationale**: Once the effect is identified as the culprit, FR-001
requires either (a) eliminating the effect from the paint critical
path or (b) making it unobservable to the user. (a) is what this fix
implements — the effect is deferred to `requestIdleCallback`, after
paint has happened.

**Alternatives considered**:

- *"It's the FeedReader mount."* — Ruled out. The mount-time
  `useEffect` only calls `State.loadItems(state)`, which is now
  cache-hit fast post-021.
- *"It's the PaymentMethodModal unmount."* — Ruled out. The modal's
  cleanup is local state only; Stripe is loaded lazily on user click,
  not on mount.
- *"It's the Sidebar mounting all the `<tool-tip>` web components."*
  — Possible contributor but not the dominant cost. Removing the
  cache-status recompute alone is enough to get the paint inside the
  100ms budget on the reporter's account; web-component upgrade is
  sub-100ms even at typical feed counts.

---

## Decision 2: Schedule the recompute via `requestIdleCallback`

**Question**: How do we run `recomputeCacheStatus` without blocking
the paint that should follow the route change?

**Decision**: Schedule it via `requestIdleCallback` with a 1-frame
timeout (so it still runs promptly when the main thread isn't
busy). Maintain a single `pendingHandle`; cancel and re-schedule on
each signal change so rapid bursts collapse into one call.

```text
let pendingHandle:IdleHandle|null = null

effect(() => {
    // touch each signal so the effect subscribes to changes
    const _deps = [
        state.user.value,
        state.selectedFeedId.value,
        billingStatus.value,
        isLocalFirstActive.value,
        storeContent.value,
        defaultCacheMode.value,
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

The `recomputeToken` guard inside `recomputeCacheStatus` continues
to ensure that a slow run does not overwrite a faster, more recent
one — so we only need to gate **scheduling**, not **applying**.

**Rationale**:

- Browsers run `requestIdleCallback` callbacks **after** the current
  paint, which is exactly when we want this work to start.
- The `{ timeout: 200 }` argument bounds the delay so the snapshot
  cannot lag user input indefinitely on a permanently busy main
  thread.
- Coalescing means that, e.g., a Settings session that flips three
  cache-mode radios in a row produces one recompute, not three.

**Alternatives considered**:

- *`queueMicrotask`* — Rejected. Microtasks run before the next
  paint; deferring with a microtask would not unblock paint.
- *`requestAnimationFrame`* — Rejected. rAF runs **before** the next
  paint, not after; same problem as microtask, plus it pre-empts
  paint.
- *`setTimeout(fn, 0)`* — Acceptable as a Safari fallback but
  has no priority semantics; `requestIdleCallback` is preferred where
  available.
- *Debounce* — Rejected. A fixed debounce delays the snapshot even
  when the main thread is idle, and the trailing-edge call still
  runs on the main thread.
- *Move `computeCacheStatus` into a dedicated Worker* — Out of scope
  for this fix. The SQLite query already runs in a worker; the
  main-thread cost is the iteration over the returned rows. Worker
  offload is a future feature; idle scheduling is enough for FR-001.

---

## Decision 3: Stale-write guard on Settings async loads

**Question**: FR-006 says "In-flight asynchronous work owned by the
Settings route MUST NOT … prevent the home view from rendering, or
write into the home view once the user has navigated away." Decision
2 covers the cost of the recompute itself — does FR-006 still need a
separate guard?

**Decision**: Yes. The four mount-time async loads in
`routes/settings.ts` write into module-level signals
(`billingStatus`, `paymentMethods`, `feedPolicies`,
`feedStorageBytes`) with no route awareness. Even with Decision 2
in place, a late `loadFeedPolicies` resolve that lands after
navigation would still cause `feedPolicies.value` to change, which
would still re-fire the effect and schedule another recompute on the
**new** view. Capture a per-mount `routeGeneration` token in a
`useRef`; the `.then()` callbacks short-circuit if `state.route.value`
is no longer `/settings` at apply time.

```text
useEffect(() => {
    const generation = ++globalRouteGeneration
    // ...load funcs:
    loadFeedPolicies(db, ids).then((res) => {
        if (generation !== globalRouteGeneration) return
        applyPolicies(res)
    })
})
```

Implementation note: the four functions already perform their writes
internally (they call `feedPolicies.value = …` themselves, not via a
return value). Two viable shapes:

1. Pass a `shouldApply:() => boolean` callback into each loader and
   have the loader gate its own write. Pro: cleanest. Con: the
   loaders are reused by other call sites.
2. Wrap the call in a `.then()` that no-ops the write by checking
   the route before invoking. Pro: no change to the loader
   signatures. Con: requires loaders to expose a "fetch but don't
   write" variant.

Choose shape #1 with a default of `() => true` so other call sites
are unaffected. The new parameter is opt-in.

**Rationale**: Defence in depth. Decision 2 makes the cost of a
single stale write painless (the recompute happens at idle), but
FR-006 is about more than cost — it is about the *invariant* that
Settings work doesn't write into the new view's state. A late
`feedPolicies` write would also affect the per-feed `<CacheSettings>`
controls in `<FeedReader>` (`feed-reader.ts:160-166`), which is
visible state, not just derived state.

**Alternatives considered**:

- *AbortController on the underlying fetch.* Rejected. `fetch()` is
  cancellable but the local DB calls (`loadFeedPolicies`,
  `loadStorageUsage`) go through the SQLite worker which does not
  honour an AbortSignal today. The apply-time guard is uniform across
  both kinds of read.
- *Refactor the loaders to return rows instead of writing signals
  themselves.* Cleaner long-term but a much larger change than this
  feature warrants. The opt-in `shouldApply` callback is the
  minimum-change fix.

---

## Decision 4: The `viewItemsCache` from 021 covers settings → home

**Question**: FR-003 and FR-004 require that the items list appears
immediately from local data and is never blanked or replaced by a
"Loading…" placeholder. Does the existing `viewItemsCache` already
cover this case, or does it need extending?

**Decision**: It already covers it. `viewItemsCache` is created on
`AppState` in `state.ts:424` and cleared in only two places:
`State.loadInitialView` (`state.ts:735`) and
`State.reconcileAfterRefresh` (`state.ts:780`). Neither is invoked
by navigating between `/settings` and `/`. The cache persists across
the round trip, so on arrival at `/` the existing `loadItems` path
hits the cache and paints without setting `itemsLoading=true` (see
`applyItemsResult` in `state.ts:814-837` and the cache-miss gate in
`loadItems`).

**Rationale**: The 021 design is doing its job. The visible regression
on `/settings` → `/` is **not** about the items list; it is about the
overall paint of `<FeedReader>` being held up behind the cache-status
recompute. Once Decision 2 is in place, the items list paints
instantly because it was already going to do so — the issue was that
the surrounding `<FeedReader>` paint was blocked.

**Alternatives considered**:

- *Extend `viewItemsCache` to also cache "everything FeedReader
  needs".* Rejected as the wrong tool. The bug is not about cache
  miss; it is about a synchronous effect blocking paint.

---

## Decision 5: Coverage of FR-007 (browser Back/Forward)

**Question**: The spec requires the same instant-update behaviour for
Back/Forward. Does the design need anything extra for that case?

**Decision**: No. `route-event`'s `singlePage` driver handles
`popstate` and pushes the same `setRoute` callback that runs on a
link click (see `node_modules/route-event/dist/index.js:18-22`). The
`state.route.value` signal write therefore fires identically for both
paths, and the same effect-deferral applies. The only thing
Back/Forward does differently is invoke `window.scrollTo(scrollX,
scrollY)` in the `onRoute` callback (`state.ts:431-433`), which is
unrelated to render timing.

**Rationale**: The fix is route-source-agnostic; no special-casing
is required for `popstate`.

**Alternatives considered**: none.

---

## Decision 6: Verifying the fix doesn't regress 021

**Question**: FR-008 requires the fix not to regress Starred ⇄ All
Items (021). What's the smallest evidence that confirms it?

**Decision**: Re-run the existing 021 test suite (`test/view-switch-*`
files). The 022 change touches `state.ts:654-667` and
`routes/settings.ts`, neither of which is on the path that 021
exercises (`State.showAll`, `State.showStarred`, `loadItems`
fast-path, `applyItemsResult`). The 021 tests run unchanged and must
still pass.

**Rationale**: Smallest correct check. The two features are
orthogonal in code path, and the test suite is the canonical
contract.

**Alternatives considered**:

- *Add a 022 test that asserts 021's behaviour too.* Rejected as
  redundant; the 021 tests are already the canonical assertion.

---

## Out-of-scope decisions

The following were briefly evaluated and explicitly **not** taken on
in this feature:

- Moving `computeCacheStatus`'s iteration into its own Web Worker.
  Future feature; idle scheduling is enough for FR-001.
- Persisting the cache-status snapshot to OPFS so it survives reloads.
  The spec defines "session"; a reload is a new session and a
  loading placeholder for the header health indicator is acceptable.
- Adding a `routeGeneration` token to other routes (Updates, Login,
  Signup, etc.). They don't currently kick off mount-time async
  writes to globally-read signals; if/when they do, the same pattern
  applies.
- Removing `<PaymentMethodModal>` from the always-rendered Settings
  tree. The modal is cheap; the cost it sometimes brings is loading
  Stripe.js, which only happens inside `handleAddCard`. Not part of
  the lag.

---

## Outcome

All open design choices are resolved. No NEEDS CLARIFICATION items
remain. Proceed to Phase 1.
