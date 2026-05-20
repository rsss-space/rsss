# Contract: Client-Internal View-Switch API

**Branch**: `021-fix-view-switch-lag` | **Date**: 2026-05-20

This feature has no external (HTTP / wire) contract change. The
contract documented here is the **client-internal** behavior that
`State.showAll`, `State.showStarred`, `State.loadItems`, and the new
helpers must conform to, plus the `<SidebarItem>` rendering contract.

These are the assertions a code reviewer should check against the
implementation, and the assertions the test specs in `test/` will
verify.

---

## `State.showAll(state)` and `State.showStarred(state)`

### Synchronous contract

1. **Same-tick paint**. Both functions MUST be synchronous from the
   caller's perspective. They MUST NOT `await` an adapter call before
   returning.
2. **Filter signal flip**. They MUST flip `state.showStarredOnly` to
   the matching value (`false` for `showAll`, `true` for
   `showStarred`) inside a `batch()`.
3. **Offset reset**. They MUST reset `state.itemsOffset.value` inside
   the same `batch()`. If a cache entry exists for the destination
   key, the reset MAY use the cached entry's `offset`; otherwise it
   uses `0`.
4. **Cache read**. They MUST attempt to read
   `state.viewItemsCache.get(destinationKey)`. If the entry is
   present:
   - `state.items.value` SHALL be set to the cached `items`.
   - `state.itemsTotal.value` SHALL be set to the cached `total`.
   - `state.itemsLoading.value` SHALL be set to `false`.
5. **No-cache fallback**. If the entry is absent, the function MUST
   NOT clear `state.items.value` to `[]`. It MAY leave the previous
   view's items on screen for the duration of one async refresh
   (this preserves FR-002 — the rendered list is never replaced by
   an empty state during the switch when local data exists).
6. **Background refresh**. After the synchronous batch, the function
   MUST call `State.loadItems(state)` without awaiting and without
   chaining `.catch` on the returned promise (errors are logged
   inside `loadItems` itself, per current behavior).
7. **`itemsLoading` gate**. The function MUST set
   `itemsLoading.value = true` ONLY when both (a) the cache entry is
   absent AND (b) `state.items.value.length === 0`. In all other
   cases `itemsLoading` MUST remain `false`.

### Forbidden behaviors

- MUST NOT call `await State.loadItems(state)` (the old code did).
- MUST NOT clear `state.items.value` to `[]` as part of the switch.
- MUST NOT set `itemsLoading.value = true` if a cache hit was just
  applied (would re-trigger the "Loading items…" placeholder).

---

## `State.loadItems(state)` and `applyItemsResult`

### Apply-time guard

`loadItems` MUST capture `currentFilterKey(state)` immediately before
issuing the adapter call. After the adapter resolves, the result MUST
be applied through the helper:

```ts
function applyItemsResult(
    state:AppState,
    requestKey:FilterKey,
    result:ItemsResponse|null
):void {
    if (currentFilterKey(state) !== requestKey) return
    if (result === null) {
        state.itemsLoading.value = false
        return
    }
    batch(() => {
        state.items.value = result.items as Item[]
        state.itemsTotal.value = result.total
        state.itemsLoading.value = false
    })
    state.viewItemsCache.set(requestKey, {
        items: result.items as Item[],
        total: result.total,
        limit: result.limit,
        offset: result.offset
    })
}
```

The guard SHALL run synchronously inside the same tick the adapter's
promise resolved on, so a fast subsequent switch can short-circuit
the stale apply before any signal write happens.

### `itemsLoading` policy

`loadItems` SHALL set `itemsLoading.value = true` only when:

```text
viewItemsCache.get(currentFilterKey(state)) === undefined &&
state.items.value.length === 0
```

In all other cases `itemsLoading` SHALL stay at its current value.
The `false` assignment in `applyItemsResult` is allowed
unconditionally (it is a no-op when already false).

### Pagination passthrough

`loadItems` continues to read `state.itemsOffset` /
`state.pageSize` / `state.selectedFeedId` / `state.showUnreadOnly`
via `buildItemOptions`. No new options are introduced.

When `state.selectedFeedId.value !== null` (per-feed route), the
apply path still writes through to `state.items` / `state.itemsTotal`
exactly as today, but MUST NOT write to `viewItemsCache`. Cache
writes only happen for the "all" and "starred" top-level filters
(`selectedFeedId === null`).

---

## Cache invalidation hooks

Existing mutation handlers MUST clear `viewItemsCache` before they
return:

- `State.toggleItemRead` — clear both keys.
- `State.toggleItemStarred` — clear both keys.
- `State.markAllRead` — clear both keys.

Existing refresh entry points MUST clear `viewItemsCache` at entry:

- `State.loadInitialView` — clear both keys at the top, before
  awaiting the parallel loads.
- `State.reconcileAfterRefresh` — clear both keys at the top.

The cache invalidation MUST happen even if the wrapped operation
later throws.

---

## `<SidebarItem>` rendering

### Element semantics

The component MUST render an `<a>` element, not a `<button>`. The
`href` for both All Items and Starred MUST be `/` (both filters are
sub-states of the root route).

### Active-state computation

The `isActive` computed MUST read from `state.route.value` and
`state.showStarredOnly.value`:

```ts
const isActive = useComputed(() => {
    if (route.value.startsWith('/feed/')) return false
    return starred === showStarredOnly.value
})
```

This is unchanged in shape from the existing implementation; what
changes is that the click handler no longer needs to drive the
highlight directly. The route-event tick that fires
`State.showAll` / `State.showStarred` flips `showStarredOnly` in the
same `batch()` as the items signals, so the highlight and the items
list land on the same frame (FR-008).

### Click handling

The component MUST attach a click listener (still on the link
element) that invokes `State.showAll` or `State.showStarred` and then
allows `route-event` to handle navigation. Because both entries link
to `/` and the route is already `/`, the route-event listener will
not produce a duplicate setRoute call when the user is already on
`/`; the synchronous `State.show*` invocation is what actually
toggles the view.

```ts
// inside the rendered <a>:
onClick=${(ev:MouseEvent) => {
    // Let route-event's global handler manage history/scroll; we
    // only run the local view-state toggle. The synchronous filter
    // flip + cache read happens before the next paint.
    if (starred) {
        State.showStarred(state)
    } else {
        State.showAll(state)
    }
}}
```

The `<a>` MUST NOT call `preventDefault()`; `route-event` does its
own intercept and the default link behavior is the correct fallback
when scripting is disabled. (This matches the project's existing
pattern of using `<a href>` for in-app navigation.)

---

## Things explicitly NOT part of this contract

- The shape of `ItemsResponse` is unchanged.
- The `DbAdapter` interface is unchanged.
- The route table (`src/client/routes/index.ts`) is unchanged.
- The `feed-reader.ts` render is unchanged (it already reads from
  `state.items` / `state.itemsLoading`).
- `State.openEventStream` and its SSE handlers are unchanged.
- `/api/sync` payload and headers are unchanged.
