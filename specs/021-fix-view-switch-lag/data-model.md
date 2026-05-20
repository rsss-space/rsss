# Phase 1: Data Model — Instant Starred ⇄ All Items Switch

**Branch**: `021-fix-view-switch-lag` | **Date**: 2026-05-20

This feature does **not** introduce a persistent schema change.
Everything below describes the **in-memory client state** that the
fix adds to `AppState`.

## Entities

### `FilterKey`

```ts
type FilterKey = 'all' | 'starred'
```

The discriminant that identifies which of the two top-level sidebar
filter modes the user is in. Derived from `state.showStarredOnly`:

| `showStarredOnly.value` | `FilterKey` |
|---|---|
| `false` | `'all'` |
| `true` | `'starred'` |

`FilterKey` is **only** meaningful when the user is not on a
feed-specific route (`!route.value.startsWith('/feed/')`). On a
feed-specific route, the cache is not read and not written.

### `ViewItemsCacheEntry`

```ts
type ViewItemsCacheEntry = {
    items:Item[]      // the items returned by adapter.getItems
    total:number      // the total count returned by the adapter
    limit:number      // the page size used for the cached fetch
    offset:number     // the offset used for the cached fetch
}
```

A snapshot of the destination view's last successful items fetch.
Shape mirrors `ItemsResponse` from `src/client/db/types.ts` exactly
so the cache can hold an `ItemsResponse` directly without
transformation.

### `ViewItemsCache`

```ts
type ViewItemsCache = Map<FilterKey, ViewItemsCacheEntry>
```

Holds at most one entry per filter key. Lives on `AppState` as
`state.viewItemsCache` and is owned by the same lifecycle as every
other client signal: created in `State()` and discarded with the
`AppState` instance. Not exposed as a signal — readers (the view-
switch action and the apply helper) read it imperatively; the
visible signals (`state.items`, `state.itemsTotal`) remain the
trigger for re-renders.

## Relationships

```text
AppState
 ├─ showStarredOnly:Signal<boolean> ─┐
 ├─ items:Signal<Item[]>             │ writes here are the
 ├─ itemsTotal:Signal<number>        │ trigger for re-renders
 ├─ itemsOffset:Signal<number>       │
 ├─ itemsLoading:Signal<boolean>     ┘
 │
 └─ viewItemsCache:ViewItemsCache  ◄─── in-memory only,
                                        not a signal,
                                        not persisted
```

## State transitions

### View-switch action (`State.showAll` / `State.showStarred`)

```text
[user clicks A or B sidebar entry]
      │
      ▼
nextKey   = 'all'  | 'starred'   (from which action was invoked)
cached    = viewItemsCache.get(nextKey)
      │
      ▼
batch {
    showStarredOnly.value = (nextKey === 'starred')
    itemsOffset.value     = cached?.offset ?? 0
    items.value           = cached?.items  ?? items.value  // ← see Note
    itemsTotal.value      = cached?.total  ?? itemsTotal.value
    itemsLoading.value    = (cached === undefined &&
                             items.value.length === 0)
}
      │
      ▼
[same tick: route-event sets state.route.value = '/']
[same tick: render: <ItemRow> list reflects destination view]
      │
      ▼
fire-and-forget: State.loadItems(state)
```

**Note**: When there is no cached entry but `items.value` is
non-empty (the view has never been rendered but the other view's
items are still on screen), the policy is to leave `items.value`
alone for one tick and let the async `loadItems` replace it. The
spec edge case "destination view has genuinely zero items" is
handled in `applyItemsResult`, which sets `items.value = []` and
falls through to the empty-state branch of the existing render
logic. There is no UI state where the *wrong* items remain on
screen indefinitely — the async refresh always corrects within one
worker round-trip, exactly the same window today, and the user
sees the empty state appear as the only delta. This case only
arises on the very first switch into a never-rendered view; once
the cache has an entry (including an empty one), it is authoritative.

### Refresh apply (`State.loadItems` → `applyItemsResult`)

```text
[loadItems invoked]
      │
      ▼
requestKey = currentFilterKey(state)
data       = await adapter.getItems(buildItemOptions(state))
      │
      ▼
[applyItemsResult]
      │
      ├─ if currentFilterKey(state) !== requestKey:
      │     return    // stale; FR-006 guard
      │
      ▼
batch {
    items.value        = data.items
    itemsTotal.value   = data.total
    itemsLoading.value = false
}
viewItemsCache.set(requestKey, data)
```

### Cache invalidation

| Trigger | Effect on `viewItemsCache` |
|---|---|
| `State.toggleItemRead` | Clear both keys before returning. |
| `State.toggleItemStarred` | Clear both keys before returning. |
| `State.markAllRead` | Clear both keys before returning. |
| `State.loadInitialView` (entry) | Clear both keys before the bulk refresh runs; new entries are populated by the `loadItems` it awaits. |
| `State.reconcileAfterRefresh` (entry) | Clear both keys before the refresh runs. |
| `pullSync` upserts touching items | Cleared by the caller (`runSync`) before / after the upsert pass; no per-item granularity is required (Decision 4 in `research.md`). |
| Account switch / sign-out | The `AppState` instance is replaced, so the cache is discarded with it. |
| Page reload | New `AppState`, new cache. |

### Empty-state behavior

When `loadItems` returns `data.items = []` for a key that has never
been rendered, the apply helper writes the empty result through:

- `state.items.value = []`
- `state.itemsTotal.value = 0`
- `state.itemsLoading.value = false`
- `viewItemsCache.set(key, { items: [], total: 0, limit, offset: 0 })`

The render in `feed-reader.ts:200-201` then dispatches to
`renderEmptyState()` which already handles "No items to show" and the
feed-specific variants. No new empty-state UI is introduced.

On subsequent switches into the same (still empty) key, the cached
entry — including `items: []` — is restored on the same frame, so the
empty state appears immediately without a loading-text flash (spec
edge case: "Starred list is empty", "All Items list is empty").

## Invariants

- `viewItemsCache` keys are exactly `'all'` and `'starred'` (or
  absent). No other keys are ever written.
- A cache entry's `items` may be empty; an empty cache entry is a
  positive assertion "this view has zero items right now," distinct
  from cache miss.
- The cache never holds an entry for a per-feed view.
- Writes to the cache only happen inside `applyItemsResult`, never
  from sidebar code or render code.
- Reads from the cache only happen inside `State.showAll` /
  `State.showStarred`.
- After a mutation handler returns, the cache contains zero entries
  for both keys until the next `loadItems` completes.
- The user is never shown items that belong to a different filter key
  than `currentFilterKey(state)` for more than one frame. (Stale-
  apply guard.)
