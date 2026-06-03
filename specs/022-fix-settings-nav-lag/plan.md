# Implementation Plan: Instant Render When Navigating from Settings to Home

**Branch**: `022-fix-settings-nav-lag` | **Date**: 2026-05-21 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/022-fix-settings-nav-lag/spec.md`

## Summary

Navigating from `/settings` back to `/` updates the URL on the same
tick (route-event is synchronous) but the visible view sticks on the
Settings page for several seconds before `<FeedReader>` paints. The
root cause is **not** another `await` inside the click handler — that
class of bug was the subject of feature 021. The culprit this time is
an `effect()` block in `state.ts:654-667` whose body runs
synchronously on the main thread whenever one of its dependency
signals changes:

```ts
effect(() => {
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
    recomputeCacheStatus(state).catch(() => {})
})
```

`recomputeCacheStatus` calls `computeCacheStatus(db, { feedId })`
(`src/client/db/cache-status.ts:47-130`), which:

1. Runs `SELECT … FROM items` with **no `LIMIT`** — a single SQLite
   worker round-trip that ships every item row back over `postMessage`.
2. Iterates every row on the main thread, parsing HTML with a regex
   to extract `<img src>` URLs.
3. Chunks those URLs into batched `SELECT url FROM cached_images WHERE
   url IN (?, ?, …)` round-trips of up to 500 each.
4. Iterates every row a second time to build `itemsToCache`.

For an account with thousands of items this is multi-second
main-thread work. The relevant signals are exactly the ones the
Settings route writes to while the user is there — `feedPolicies`
(`loadFeedPolicies` in `routes/settings.ts:83`), `storeContent`,
`defaultCacheMode`, and `billingStatus` (`State.loadBillingStatus` in
`routes/settings.ts:71`). When the user clicks "Back to Feeds":

- `state.route.value` is set synchronously.
- Preact reconciles, mounts `<FeedReader>`.
- `<FeedReader>`'s mount-time `useEffect` (`routes/feed-reader.ts:71-87`)
  writes `state.selectedFeedId.value = null`.
- The `effect()` above fires, calls `recomputeCacheStatus`, which
  blocks the main thread for the remaining `await` of `computeCacheStatus`.
- Painting `<FeedReader>` is held up behind that work.

Additionally, in-flight Settings async work (e.g. a late
`loadFeedPolicies` response landing **after** navigation) writes to
the same signals from the previous route's effects, re-triggering the
recompute on the new view (FR-006 violation).

The fix is the same architectural shape as 021 — decouple **the
render of the destination view** from **expensive derived work**:

1. **Make the cache-status recompute non-blocking for paint.** Wrap
   the body of the `effect()` so it schedules `recomputeCacheStatus`
   via `requestIdleCallback` (with `setTimeout(fn, 0)` fallback for
   Safari) instead of calling it synchronously. Track a single
   `pendingHandle`; coalesce rapid signal changes so we run at most
   one recompute per idle window. The existing `recomputeToken`
   guard in `cache-status-state.ts:75-79` already discards stale
   results.
2. **Stale-write guard on the Settings async loads** (FR-006). The
   four mount-time async ops in `routes/settings.ts:67-94`
   (`loadBillingStatus`, `loadPaymentMethods`, `loadFeedPolicies`,
   `loadStorageUsage`) currently write into module-level signals with
   no awareness of route. Capture a per-mount `routeGeneration`
   token; their `.then()` writes no-op if the user has navigated
   away. This is a small surface (those four call sites in
   Settings); it does not change the signals' shape or any read path.
3. **Verify the existing `viewItemsCache` (from 021) covers
   settings→home.** It should — `viewItemsCache` is only cleared in
   `loadInitialView` and `reconcileAfterRefresh`, neither of which is
   provoked by navigating between routes. The `quickstart.md`
   includes the manual step to confirm that the items list is never
   blanked or replaced by "Loading items…" during the transition
   (FR-003, FR-004).

These three steps together satisfy SC-001 (<100ms paint), SC-002 (URL
and view never disagree), SC-003 (no Loading… placeholder), and
SC-005 (regression class eliminated). FR-008 (no regression of the
021 starred ⇄ all behaviour) is preserved because we are not
touching the `loadItems` / `viewItemsCache` path at all.

### Why not just remove the effect entirely?

The cache-status snapshot drives the header health indicator and the
per-feed `<CacheSettings>` controls (`feed-reader.ts:160-166`). Both
must update when the user toggles a cache mode, changes a per-feed
policy, or switches feeds. Removing the effect would break those
features. Scheduling it through idle time preserves the behaviour
while removing the paint coupling.

### Why not move `recomputeCacheStatus` into a Web Worker?

`computeCacheStatus` already calls into the SQLite Web Worker via
`queryDb`. The main-thread cost is the iteration + regex extraction
over the returned `rows`. Moving that to its own worker is broader
than this fix warrants — `requestIdleCallback` is enough to push the
work behind paint, which is what FR-001 / SC-001 require. Worker
offload remains available as a future feature.

### Why not debounce the effect?

A debounce would also defer the work, but it would (a) delay the
correct snapshot from appearing in the header for the chosen debounce
window even when the main thread is idle, and (b) still run on the
main thread on the trailing edge. `requestIdleCallback` runs only
when the browser has nothing else to do, which is the actual property
we want.

## Technical Context

**Language/Version**: TypeScript (browser, ES2022 lib via Vite for
the client; Node 22.x for build tooling).
**Primary Dependencies**: Preact + `@preact/signals` (UI + state),
`htm/preact` (templates), `@substrate-system/routes` + `route-event`
(client routing), `@sqlite.org/sqlite-wasm` over OPFS-SAH-pool (local
SQLite worker). No new runtime dependencies.
**Storage**: Per-user Durable Object SQLite (server, unchanged) +
local OPFS-backed SQLite (unchanged). No schema change on either
side, no DO change, no `/api/sync` change. The fix is entirely about
when (not whether) the existing `cacheStatus` snapshot is recomputed.
**Testing**: `npm test` (the `node test/run-all-tests.mjs` runner
that bundles each `test/*.ts` with esbuild and pipes into `tapout`).
New tests live under `test/` and follow the existing `state.ts` /
signal-only style. The asynchronicity is tested by stubbing
`requestIdleCallback` so the test owns when the deferred work runs.
**Target Platform**: Modern evergreen browsers. `requestIdleCallback`
ships in Chromium and Firefox; Safari requires a `setTimeout(fn, 0)`
fallback — captured in a tiny utility (`scheduleIdle.ts`).
**Project Type**: SPA client + Worker/DO server — same `src/client`,
`src/server`, `src/shared` split as the rest of the repo. All work
is client-side.
**Performance Goals**: SC-001 (<100ms click-to-paint after the home
view has been rendered once in the session), SC-002 (zero frames in
which the URL says `/` while Settings is still painted), SC-003
(zero frames with "Loading…" placeholder when local items exist),
SC-004 (every round-trip same as the first).
**Constraints**: No CSS unrelated to the task may change
(constitution). No new packages. Multi-signal writes must go through
`batch()`. Lines ≤ 80 cols. The Settings back-link is already an
`<a href="/">` per `memory/feedback_links_not_buttons.md` — no
button-to-link conversion is needed for this feature.
**Scale/Scope**: Three production files touched —
`src/client/state.ts` (one effect rewritten),
`src/client/routes/settings.ts` (four `.then()` callbacks gated on a
route-generation token), plus one new tiny helper
`src/client/util/schedule-idle.ts`. Three new `test/` specs.
Roughly +120 / -10 lines of source.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1
design.*

| Principle | Status | Notes |
|---|---|---|
| I. Local-First Reads | PASS | The local read path is unchanged. `recomputeCacheStatus` still queries the local SQLite database via `queryDb`. The only change is **when** it runs, not whether. |
| II. Idempotent, Outbox-Backed Sync | PASS | No mutations added. No change to the outbox, push-sync, or pull-sync flows. The route-generation guard in Settings only suppresses **stale signal writes**; it does not change any server contract or wire format. |
| III. Edge-Native Topology | PASS | Server unchanged. No DO change, no Hono route change. |
| IV. Capability-Gated Progressive Enhancement | PASS | The behaviour is identical on `localAdapter` and `remoteAdapter`. `recomputeCacheStatus` already early-returns for non-entitled / non-local users (`cache-status-state.ts:55-73`); deferring it does not change that. |
| V. Bluesky-Anchored Identity | PASS | No auth changes. |

**Development workflow checks**:

- *Schema-and-sync coupling*: No schema change. N/A.
- *Idempotency review*: No new mutation routes. N/A.
- *Capability fallback review*: The fix sits above the
  adapter/local-first capability gates entirely (it changes when an
  effect fires, not what it does). Both paths benefit equally.
- *Local verification*: `quickstart.md` documents the manual browser
  steps that the constitution requires before claiming the feature is
  complete.

**Result**: No constitutional violations. Complexity Tracking section
is intentionally empty.

## Project Structure

### Documentation (this feature)

```text
specs/022-fix-settings-nav-lag/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (root-cause + alternatives)
├── data-model.md        # Phase 1 output (route-generation token +
│                        # idle-schedule contract)
├── quickstart.md        # Phase 1 output (manual browser verification)
├── contracts/
│   └── settings-nav-contract.md   # Client-internal contract for
│                                  # the deferred recompute + the
│                                  # route-generation stale-write guard
├── spec.md              # already present
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT this
                         # command)
```

### Source Code (repository root)

```text
src/
├── client/
│   ├── state.ts                  # Rewrite the effect at lines 654-
│   │                             # 667. Today it calls
│   │                             # `recomputeCacheStatus(state).catch(
│   │                             # () => {})` synchronously. After:
│   │                             # `scheduleIdleRecompute(state)`,
│   │                             # which coalesces rapid signal
│   │                             # changes into a single
│   │                             # `requestIdleCallback`. The existing
│   │                             # `recomputeToken` guard inside
│   │                             # `cache-status-state.ts` discards
│   │                             # stale results, so we only need to
│   │                             # gate scheduling, not apply.
│   │
│   ├── routes/
│   │   └── settings.ts           # Wrap the four mount-time async
│   │                             # loads (`loadBillingStatus`,
│   │                             # `loadPaymentMethods`,
│   │                             # `loadFeedPolicies`,
│   │                             # `loadStorageUsage`) with a
│   │                             # per-mount `routeGeneration` token
│   │                             # captured in a `useRef`. The
│   │                             # `.then()` callbacks no-op if
│   │                             # `state.route.value !== '/settings'`
│   │                             # at apply time. This is the FR-006
│   │                             # stale-write guard.
│   │
│   ├── routes/
│   │   └── feed-reader.ts        # No change. The mount-time
│   │                             # useEffect already calls
│   │                             # `State.loadItems(state)` only when
│   │                             # `selectedFeedId` actually changes,
│   │                             # and `loadItems` short-circuits to
│   │                             # the `viewItemsCache` hit established
│   │                             # by feature 021.
│   │
│   └── util/
│       └── schedule-idle.ts      # NEW. Tiny helper:
│                                 #   - `requestIdleCallback` when
│                                 #     available, with a 1-frame
│                                 #     timeout option.
│                                 #   - `setTimeout(fn, 0)` fallback
│                                 #     (Safari).
│                                 #   - Returns a cancellable handle.
│                                 # Lets tests stub the scheduler.
│
└── shared/                       # No change (no schema, no wire-
                                  # format change).

test/                             # New specs:
                                  # - settings-nav-instant.ts:
                                  #   Setting `state.route.value` from
                                  #   '/settings' to '/' does NOT
                                  #   invoke `recomputeCacheStatus`
                                  #   synchronously; it is scheduled
                                  #   via the idle queue (FR-001,
                                  #   SC-001, SC-002).
                                  # - settings-stale-async-writes.ts:
                                  #   A `loadFeedPolicies` promise
                                  #   that resolves AFTER the user
                                  #   has navigated away does NOT
                                  #   write `feedPolicies.value`
                                  #   (FR-006).
                                  # - cache-status-coalesce.ts:
                                  #   Multiple rapid signal changes
                                  #   collapse into a single
                                  #   `recomputeCacheStatus` call
                                  #   (the previous handle is
                                  #   cancelled).
                                  # The existing `viewItemsCache`
                                  # tests from 021 already cover
                                  # "items appear instantly from
                                  # local cache on route switch"
                                  # (FR-003, FR-004) and do not need
                                  # to change.
```

**Structure Decision**: Follow the existing `src/client`,
`src/server`, `src/shared` split. The new `src/client/util/`
directory is the natural home for a small browser-API helper that
does not belong in `state.ts` or in `db/`. No new top-level
directories.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be
> justified.**

No violations. Section intentionally empty.
