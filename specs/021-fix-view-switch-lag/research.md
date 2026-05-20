# Phase 0: Research — Instant Starred ⇄ All Items Switch

**Branch**: `021-fix-view-switch-lag` | **Date**: 2026-05-20

## Research questions

The spec marked no NEEDS CLARIFICATION items. The Technical Context
section of the plan still has open design choices that need to be
resolved before Phase 1. Each is captured as a Decision / Rationale /
Alternatives block below.

---

## Decision 1: Where the lag actually comes from

**Question**: Is the user-visible lag caused by network I/O, by the
local SQLite worker round-trip, by a render-blocking `await`, or by
clearing `state.items` before the new query returns?

**Decision**: The lag is the local SQLite worker round-trip held
inside `State.showAll` / `State.showStarred` via their
`await State.loadItems(state)`. The on-screen list is **not** cleared
to empty during the wait — `state.items.value` still holds the
*previous* view's items until the adapter resolves, so the user sees
the **wrong** subset for the duration of the round-trip.

**Evidence**:

- `State.showAll` (`src/client/state.ts:1087-1094`) and
  `State.showStarred` (`src/client/state.ts:1096-1104`) both end by
  calling `State.loadItems(state)`.
- `State.loadItems` (`src/client/state.ts:1910-1945`) calls
  `await adapter.getItems(buildItemOptions(state))`.
- `buildItemOptions` (`src/client/state.ts:792-821`) reads
  `state.showStarredOnly.value` synchronously, so the *request* is
  for the new view, but the local state has not been updated yet
  when the response lands.
- `WorkerBackedLocalDb.query` (`src/client/db/local-db.ts:24-46`)
  goes through a `postMessage` to the SQLite worker; even on a warm
  worker this is ~10–50 ms per query, and the adapter issues a
  `COUNT(*)` plus a paginated `SELECT` (`local-adapter.ts:182-198`)
  against an `items ⋈ feeds` join with a non-trivial `WHERE` clause.
  On cold-start (e.g. the first switch in a session, when the worker
  is still booting), the latency is hundreds of ms.

**Rationale**: Once the round-trip is identified as the culprit, the
fix has to either (a) eliminate the await from the click handler or
(b) make the await unobservable to the user. Option (b) is what the
spec requires (FR-001: same-frame paint).

**Alternatives considered**:

- *"It's the network."* — Ruled out. `loadCounts` is the only network
  read on this path (and only on `remoteAdapter`); the user's report
  reproduces on the local-first path where there is no network round
  trip on a view switch.
- *"`itemsLoading` is flipping and the list is wiping."* — Partly
  true on slow devices, but the dominant symptom is the wrong-subset
  display, not the empty-list flash. Spec FR-002 and FR-003 cover
  both, and the fix addresses both.

---

## Decision 2: Cache shape

**Question**: How is the destination-view's "last known items"
recovered on the synchronous click handler?

**Decision**: A per-`AppState` in-memory `Map<FilterKey,
ItemsResponse>` where `FilterKey = 'all' | 'starred'`. The cache
entry is the full `ItemsResponse` (`{ items, total, limit, offset }`)
from the last successful `getItems` for that key.

**Rationale**:

- Smallest correct unit. Holding only the items array is not enough —
  the pagination header reads `total` and `offset`, and the
  destination view must render with the same `total`/`offset` it had
  the last time it was visible (spec edge case: "Pagination
  position").
- Bounded memory: at most `pageSize` items per key (≤ 200 with the
  100-item page size). The cache is per-tab, per-session — no
  persistence, no quota concerns.
- Keyed by filter only. Per-feed views are out of scope (spec edge
  case: "Switch made from a feed-specific route"). The cache key
  does not include `selectedFeedId`, and entering a feed-specific
  route does not read from or write to the cache.

**Alternatives considered**:

- *Per-(filter × offset) cache.* Allows revisiting page N after a
  detour. Rejected: the spec explicitly does **not** require
  preserving offset across a switch ("Pagination state … may be
  reset across a view switch") and the simpler model satisfies every
  FR.
- *No cache; render from `state.items` directly with a client-side
  predicate.* Rejected: `state.items` only contains the current
  page of the current filter. Filtering it would render *fewer*
  rows than the destination view actually contains.
- *Full materialized superset in memory.* Rejected: unbounded memory
  on accounts with thousands of items, and rebuilding the superset
  requires the same async adapter trip we are trying to avoid.

---

## Decision 3: Stale-refresh guard

**Question**: How do we prevent a slow `getItems` for filter A from
overwriting the items list after the user has already switched to
filter B (FR-006)?

**Decision**: Capture the `FilterKey` *at request time* and pass it
into the helper that writes the result. The write is a no-op if the
current `FilterKey` no longer matches.

```text
const requestKey = currentFilterKey(state)
const result = await adapter.getItems(buildItemOptions(state))
applyItemsResult(state, requestKey, result)

function applyItemsResult(state, requestKey, result) {
    if (currentFilterKey(state) !== requestKey) return  // stale
    batch(() => {
        state.items.value = result.items
        state.itemsTotal.value = result.total
        state.itemsLoading.value = false
    })
    viewItemsCache.set(requestKey, result)
}
```

**Rationale**: Pattern is identical to the existing
`routeItemRequest` guard in `state.ts:425-498`, which already
demonstrates the project's preferred approach: compare against the
current state at apply-time, not via an AbortController on the
underlying request. Adapters are not required to be cancellable, and
the unwanted side effect (cache pollution + render overwrite) is
prevented at the apply boundary.

**Alternatives considered**:

- *AbortController on `getItems`.* Rejected: the adapter interface
  does not currently accept an `AbortSignal`, and threading one
  through both `localAdapter` and `remoteAdapter` is broader change
  than this feature warrants. The apply-time guard is sufficient for
  FR-006.
- *Request-ID / monotonic counter.* Rejected: same effect as the
  FilterKey check but with a more complex invariant to keep. The
  FilterKey check naturally short-circuits because there are only two
  distinct keys.

---

## Decision 4: Cache invalidation

**Question**: When must a cache entry be evicted so the next switch
does not show stale data?

**Decision**: Evict the affected key (or both) in these existing
client paths:

| Trigger | Eviction |
|---|---|
| `toggleItemRead(itemId, isRead)` | Evict both keys when the toggled item is in either cached page. (Simpler: just evict both unconditionally — `toggleItemRead` is rare and the next switch refreshes async.) |
| `toggleItemStarred(itemId, isStarred)` | Evict both keys (star status changes cross-cuts both views). |
| `markAllRead(feedId)` | Evict both keys. |
| `reconcileAfterRefresh` / `loadInitialView` | Evict both keys before issuing the refresh, so the result lands in a clean cache. |
| `pullSync` upsert that touches an item the cache currently holds | Evict the relevant key. (Implementation: `pullSyncUpsertItem` in `src/client/db/pull-sync.ts` already runs inside the client; the cache lives on `AppState`, so the upsert path needs access to it. Easiest: have the *caller* — `runSync` / `reconcileAfterRefresh` — clear the cache, since per-item granularity is not required.) |
| `loadInitialView` finishing | Implicitly populated by the `loadItems` it runs — the apply-helper writes to the cache as a side effect. |

**Rationale**: The cache is conservative — it never holds stale data
through a mutation. The cost is one extra `getItems` call after every
mutation when the user next switches views, which is identical to
today's behavior anyway. The user-visible benefit (instant switch
when no mutation happened in between) covers the common case.

**Alternatives considered**:

- *Per-item surgical updates inside the cache.* Rejected: the
  invariant ("the cached page reflects the database") is more
  expensive to maintain than to drop and re-fetch on next access.
- *TTL / cache age.* Rejected: there is no natural staleness window
  that beats event-driven invalidation. Cache freshness comes from
  the same SSE / sync triggers that drive `state.items` today.

---

## Decision 5: Sidebar entry semantics — link vs. button

**Question**: The current `SidebarItem` renders `<button onClick>`.
The user's global instructions (`memory/feedback_links_not_buttons.md`)
require links for navigation in this project. Does the switch to
links affect timing?

**Decision**: Switch to `<a href="/">` with a `data-view` attribute
that the route-event subscriber reads to call `State.showAll` or
`State.showStarred`. The active-state highlighting moves onto a
computed signal that reads `route.value` + `showStarredOnly`.

**Rationale**:

- The repo's `route-event` package already binds a global click
  handler that intercepts `<a>` clicks and runs the route action
  synchronously (same tick). The switch from button → link is a
  conformance fix that does not regress timing.
- Active highlighting on a computed signal of `route.value` +
  `showStarredOnly` lands on the same frame as the items list
  (FR-008), because both the URL change and the synchronous
  `State.showAll`/`showStarred` call happen inside the same
  route-event tick.
- Both entries link to `/` because the spec treats All Items and
  Starred as filters of the same route. The distinguishing state is
  in the signal, not the URL. The href is identical for both — the
  `data-view` attribute is what the listener uses.

**Alternatives considered**:

- *Encode the view in the URL (e.g. `/?view=starred`).* Tempting for
  shareability and browser back/forward, but out of scope for this
  spec. The current behavior treats the filter as session state, and
  the spec does not introduce a URL contract. Leaving the URL alone
  also avoids touching the routing module
  (`src/client/routes/index.ts`).
- *Stay with `<button>`.* Rejected: violates the project's link/button
  rule and is a known footgun (the rule was added to prevent exactly
  this class of "navigation as state-mutation" bugs).

---

## Decision 6: Where to draw the "first render in session" line

**Question**: FR-003 says "no loading indicator after either view has
been rendered at least once." How is "rendered at least once"
expressed in code?

**Decision**: "Rendered once" maps to "the cache has an entry for
this filter key." `itemsLoading` is set to `true` from `loadItems`
**only** when the cache has no entry AND `state.items.value.length
=== 0`. After the first successful `applyItemsResult` for a key,
subsequent `loadItems` calls for that key never set `itemsLoading`,
because the cache hit gives the view real items to render and the
render-time condition in `feed-reader.ts:187-189`
(`itemsLoading.value && items.value.length === 0`) evaluates to false.

**Rationale**: Aligns the runtime state ("do I have data to render?")
with the user-visible promise. The session-render flag is implicit in
the cache state, so there is no separate `hasRenderedX` bookkeeping
signal to drift out of sync.

**Alternatives considered**:

- *Separate per-key "have-rendered" boolean signals.* Rejected:
  duplicates information already in the cache and would require
  matching invalidation rules.

---

## Out-of-scope decisions

The following were briefly evaluated and explicitly **not** taken on
in this feature:

- Cross-tab cache sharing via `BroadcastChannel`. The single-tab
  invariant (constitution IV) already limits the cache scope.
- Persistence of the cache across page reloads. The spec defines
  "session" — page reload is a new session and the loading indicator
  is permitted at that point.
- Same treatment for per-feed routes (`/feed/<url>`). The spec
  explicitly puts those out of scope.
- A general client-side cache layer in front of every adapter call.
  This feature scopes the cache narrowly to `getItems` view-filter
  switches; generalizing it is a future feature, not part of this fix.

---

## Outcome

All open design choices are resolved. No NEEDS CLARIFICATION items
remain. Proceed to Phase 1.
