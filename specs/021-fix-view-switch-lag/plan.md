# Implementation Plan: Instant Switch Between Starred and All Items Views

**Branch**: `021-fix-view-switch-lag` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/021-fix-view-switch-lag/spec.md`

## Summary

Switching between the **All Items** and **Starred** sidebar entries
currently routes through `State.showAll` / `State.showStarred`, which
synchronously flip `state.showStarredOnly` and then `await
State.loadItems()` against the local SQLite store. Because every
`getItems` call is a `postMessage` round-trip into the OPFS-SAH-pool
SQLite worker (see `src/client/db/local-db.ts:24-46` →
`WorkerBackedLocalDb.query`), the destination list does not paint
until the worker has finished both the `COUNT(*)` and `SELECT … LIMIT
… OFFSET …` queries on a join of `items` and `feeds`
(`src/client/db/local-adapter.ts:147-206`). During the wait,
`state.items.value` is still the *previous* view (the user briefly
sees the wrong subset, or — when offset was non-zero — an apparently
frozen page), and on slow devices the `itemsLoading=true` flicker can
also show the "Loading items…" placeholder despite local data
existing.

The fix decouples the **render of the destination view** from the
**refresh of its data**:

1. Maintain a small in-memory cache keyed by `(filterKey, page)`
   where `filterKey ∈ { 'all', 'starred' }` and `page` is the offset.
   The cache stores the last successful `ItemsResponse` (items, total,
   limit, offset) for that key. The cache is per-`AppState` (per-tab,
   per-session) and is invalidated by background refresh, mutations,
   and pull-sync.
2. `State.showAll` / `State.showStarred` become synchronous: they
   `batch()` the filter signal, reset `itemsOffset`, write the cached
   `items`/`itemsTotal` for the destination key on the **same tick**
   if a cache entry exists, then fire-and-forget a background
   `State.loadItems(state)` to refresh the cache. They never await.
3. `State.loadItems` is split into a guarded shape:
   - It still performs the adapter query, but its result is now
     applied through a single helper (`applyItemsResult`) that
     **only writes to `state.items` / `state.itemsTotal` if the
     filter key the request was issued against still matches the
     current filter key** (FR-006: stale refresh must not overwrite
     the visible view).
   - It only sets `itemsLoading=true` when both the cache miss *and*
     `state.items.value.length === 0` are true, so the "Loading
     items…" placeholder is reserved for genuinely empty views (FR-003,
     SC-002).
4. `SidebarItem` switches from `<button onClick>` to `<a href="/?…">`
   per the project rule (`memory/feedback_links_not_buttons.md`). The
   route-event handler in `state.ts:416-423` calls `setRoute('/')` and
   the existing `effect()` reads a new "view" query param to drive
   `showAll` / `showStarred`. Active highlighting moves into the
   computed against `route.value`, so the highlight transitions on the
   same frame as the items list (FR-008).

The cache is small (at most ~`pageSize * 2` items per key plus the
total), survives only until the page is reloaded, and is invalidated
on: `markAllRead`, `toggleItemRead`, `toggleItemStarred`, `pullSync`
upserts that touch the visible page, and `reconcileAfterRefresh`.

### Why not just memoize the filtered list locally?

The destination view is paginated server-side (offset/limit on the
adapter). Rendering "All Items" by client-side-filtering the
in-memory `items.value` array would be incorrect — the array only
contains the currently-paginated page of the *current* filter, not
the full set. The per-`filterKey` cache is the smallest correct unit:
it preserves the destination view's last-known items at its last-known
offset, which is exactly what FR-001 ("the destination view using
locally available data on the same frame") requires.

### Why not just read OPFS synchronously?

OPFS access from the main thread is async by design (the SAH-pool VFS
runs in a Web Worker). Any approach that "just blocks until the query
returns" violates the worker-thread boundary and cannot honor SC-001
(<100ms) on cold worker startup. The cache sidesteps this entirely.

## Technical Context

**Language/Version**: TypeScript (browser, ES2022 lib via Vite for
the client; Node 22.x for build tooling).
**Primary Dependencies**: Preact + `@preact/signals` (UI + state),
`htm/preact` (templates), `@substrate-system/routes` + `route-event`
(client routing), `@sqlite.org/sqlite-wasm` over OPFS-SAH-pool (local
SQLite worker). No new runtime dependencies.
**Storage**: Per-user Durable Object SQLite (server, unchanged) +
local OPFS-backed SQLite (unchanged). The fix introduces an
**in-memory** cache on `AppState` only — no schema change on either
side, no DO change, no `/api/sync` change.
**Testing**: `npm test` (the `node test/run-all-tests.mjs` runner that
bundles each `test/*.ts` with esbuild and pipes into `tapout`). The
new tests live under `test/` and follow the existing `state.ts` /
`sidebar-item.ts` style (signal-only, no DOM render unless the
existing test already mounts Preact).
**Target Platform**: Modern evergreen browsers with OPFS-SAH-pool
support (local-first path) and the `remoteAdapter` fallback for the
rest.
**Project Type**: SPA client + Worker/DO server — same `src/client`,
`src/server`, `src/shared` split as the rest of the repo.
**Performance Goals**: SC-001 (<100ms click-to-paint after the
destination view has been rendered once in the session), SC-002 (zero
frames in which the items list is empty during the switch), SC-003
(in-place update on background refresh: same `<li>` keys, no
re-mount).
**Constraints**: No CSS unrelated to the task may change
(constitution). No new packages. Multi-signal writes must go through
`batch()`. Lines ≤ 80 cols. The sidebar entries become `<a href>`
links per global instruction (`memory/feedback_links_not_buttons.md`).
**Scale/Scope**: Five files touched —
`src/client/state.ts`,
`src/client/components/sidebar-item.ts`,
plus three new `test/` specs. Roughly +120 / -40 lines of source.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1
design.*

| Principle | Status | Notes |
|---|---|---|
| I. Local-First Reads | PASS | The read path remains `localAdapter.getItems()`. The cache layer sits **above** the adapter and is purely a UI-state memo — it does not introduce a network read or bypass the local DB. Cold reads (first time a view is rendered in a session) still hit local SQLite first. |
| II. Idempotent, Outbox-Backed Sync | PASS | No new mutations. No change to the outbox, push-sync, or pull-sync flows. Cache invalidation hooks into existing mutation/refresh paths (`toggleItemRead`, `markAllRead`, `pullSync` upserts, `reconcileAfterRefresh`) without altering their semantics. |
| III. Edge-Native Topology | PASS | Server unchanged. All work is in the client. |
| IV. Capability-Gated Progressive Enhancement | PASS | The cache wraps `getAdapter()` indifferently — works identically on `localAdapter` and `remoteAdapter`. The `remoteAdapter` path actually benefits more because its `getItems` round-trips to the server. No feature is gated to local-first-only. |
| V. Bluesky-Anchored Identity | PASS | No auth changes. |

**Development workflow checks**:

- *Schema-and-sync coupling*: No schema change — N/A.
- *Idempotency review*: No new mutation routes — N/A.
- *Capability fallback review*: Both adapters are covered by the same
  caching code; no new local-first-only behavior.
- *Local verification*: The `quickstart.md` companion document
  prescribes the manual browser steps required by the constitution
  ("UI changes MUST be exercised in a browser before being claimed
  complete").

**Result**: No constitutional violations. Complexity Tracking section
is intentionally empty.

## Project Structure

### Documentation (this feature)

```text
specs/021-fix-view-switch-lag/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (root-cause + alternatives)
├── data-model.md        # Phase 1 output (in-memory cache shape +
│                        # state transitions)
├── quickstart.md        # Phase 1 output (manual browser verification)
├── contracts/
│   └── view-switch-contract.md   # Client-internal contract for
│                                 # `State.showAll` / `State.showStarred`
│                                 # and stale-refresh guard
├── spec.md              # already present
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT this
                         # command)
```

### Source Code (repository root)

```text
src/
├── client/
│   ├── components/
│   │   └── sidebar-item.ts        # Replace <button onClick> with
│   │                              # <a href="/"> and a "view" query
│   │                              # param (or attribute) so route-
│   │                              # event handles navigation. Move
│   │                              # active highlighting onto
│   │                              # route.value + showStarredOnly so
│   │                              # the highlight lands on the same
│   │                              # frame as the items list.
│   └── state.ts                   # 1) Add `viewItemsCache` (per-
│   │                              #    AppState in-memory cache keyed
│   │                              #    by 'all' | 'starred').
│   │                              # 2) Rewrite `State.showAll` /
│   │                              #    `State.showStarred` as
│   │                              #    synchronous: batch the filter
│   │                              #    flip + cache read, then
│   │                              #    fire-and-forget refresh.
│   │                              # 3) Split `State.loadItems` into a
│   │                              #    fetch path and a guarded
│   │                              #    `applyItemsResult` that
│   │                              #    checks the filter key at
│   │                              #    apply-time (FR-006).
│   │                              # 4) Gate `itemsLoading=true` on
│   │                              #    "no cached items AND
│   │                              #    state.items is empty" so the
│   │                              #    "Loading items…" placeholder
│   │                              #    is reserved for genuine first
│   │                              #    renders (FR-003).
│   │                              # 5) Invalidate the cache key
│   │                              #    inside the existing mutation
│   │                              #    handlers and after pull-sync
│   │                              #    upserts touch a visible row.
│   └── routes/
│       └── feed-reader.ts         # No change in this feature. The
│                                  # render-time "Loading items…"
│                                  # condition already reads from
│                                  # `itemsLoading && items.length
│                                  # === 0`, which becomes correct
│                                  # automatically once `state.ts`
│                                  # only sets `itemsLoading` for
│                                  # genuine first loads.
│
└── shared/                         # No change (no schema, no wire-
                                    # format change).

test/                               # New specs:
                                    # - view-switch-instant.ts:
                                    #   `State.showAll` /
                                    #   `State.showStarred` paint the
                                    #   destination view from the
                                    #   cache on the same tick they
                                    #   are called (FR-001, SC-001,
                                    #   SC-002).
                                    # - view-switch-stale-refresh.ts:
                                    #   When a slow `getItems` for the
                                    #   previous view resolves AFTER
                                    #   the user has already switched,
                                    #   it must NOT overwrite
                                    #   `state.items` (FR-006).
                                    # - view-switch-cache-invalidate.ts:
                                    #   Mutations and pull-sync
                                    #   upserts evict the relevant
                                    #   cache entry so the next switch
                                    #   sees fresh data (FR-005).
                                    # The existing `sidebar-item.ts`
                                    # spec is extended to assert the
                                    # rendered element is an `<a>`
                                    # with the right `href`, not a
                                    # `<button>`.
```

**Structure Decision**: Follow the existing `src/client`, `src/server`,
`src/shared` split. No new top-level directories. The cache lives on
`AppState` so it shares the same lifecycle as every other client
signal (created in `State()`, torn down with the App).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified.**

No violations. Section intentionally empty.
