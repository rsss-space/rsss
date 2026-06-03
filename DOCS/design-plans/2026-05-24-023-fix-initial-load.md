# 023 Fix Initial Load Design

## Summary

The current client bootstrap is a serial chain of awaited operations
that ends with setting `initialLoadComplete = true`, a single flag
that gates the entire app render. Any slow step — an Autumn/billing
HTTP round-trip, OPFS initialization, or the initial item-list fetch
— holds the user on a skeleton screen. Additionally, `getAdapter`
(which decides whether to use the local OPFS adapter or the remote
API) reads `billingStatus`, a signal that cannot be set until the
billing network call resolves, introducing a hidden race on every
load.

This design eliminates the global render gate and the `billingStatus`
dependency in adapter selection. A new `paint-cache.ts` module writes
a capped, versioned snapshot of the current feed list, item list,
and counts to localStorage after each successful load, keyed by the
authenticated user's DID. On the next bootstrap, the snapshot is
read synchronously and applied to signals via `batch()` before
Preact mounts — so the shell and sidebar paint from real data in a
single synchronous read, with no network on the critical path.
Authentication, billing status, Stripe SDK loading, and the actual
sync cycle all fire in parallel after first paint, and surface their
results through existing freshness signals (the sync-status dot,
per-feed "Resolving…" badges). A first-ever load on a device that
has no cache falls back to the existing behavior, showing a one-time
progress card while the initial OPFS bootstrap runs.

## Definition of Done

Re-architect the client bootstrap so that **on every load after the**
**first successful sync**, the app shell and last-known-cached items
paint immediately (target: well under 1 second on local dev), with no
third-party round-trips on the critical render path. The first-ever
bootstrap on a device still waits for the initial pull-sync (current
behavior). All non-essential work — billing/Autumn status, Stripe SDK
loading, OG-image fetching, and any feed-refresh round-trip — runs in
the background after first paint, and surfaces its results via
existing freshness signals (the sync-status dot, per-feed "Resolving…"
badges, etc.). The investigation must also identify and document
**why** the current bootstrap is slow on local dev (specific render
gates, network blockers, eager imports) so the fix is targeted rather
than speculative. Out of scope: production performance work,
redesigning the sync protocol itself, and fixing the underlying Autumn
/ Stripe local-dev latency (we route around those rather than fixing
them).

## Acceptance Criteria

### 023-fix-initial-load.AC1: Render gate is removed; shell paints unconditionally
- **023-fix-initial-load.AC1.1 Success:** With a populated paint cache
  and `syncSubscriptions=true`, the sidebar feed list is in the DOM
  with real data before any `/api/feeds` request resolves (verified
  with a slow-stub fetch).
- **023-fix-initial-load.AC1.2 Success:** The app shell (header,
  sidebar chrome, top-level layout) is in the DOM on every load
  regardless of `authLoading` state.
- **023-fix-initial-load.AC1.3 Success:** Sub-trees with empty
  signals and no fetch in flight show their empty-state UI (not a
  skeleton).
- **023-fix-initial-load.AC1.4 Failure:** Sub-trees with empty
  signals AND a fetch in flight show a contextual loading
  placeholder (e.g., 1-2 skeleton rows), not a full-page block.
- **023-fix-initial-load.AC1.5 Edge:** Removing `pageReady` does
  not regress the unauthenticated landing view (login form still
  renders correctly).

### 023-fix-initial-load.AC2: Paint cache module persists and reads correctly
- **023-fix-initial-load.AC2.1 Success:** `writePaintCache(did, snap)`
  followed by `readPaintCache(did)` round-trips an equivalent snapshot
  when the snapshot is under all caps.
- **023-fix-initial-load.AC2.2 Success:** A snapshot with 300 items
  is written with exactly 200 items after truncation (newest-first
  preserved).
- **023-fix-initial-load.AC2.3 Success:** A snapshot whose serialized
  JSON would exceed 1 MB has additional items dropped from the tail
  until under the cap.
- **023-fix-initial-load.AC2.4 Success:** Successful loads in
  `state.ts` schedule a debounced paint-cache write via
  `scheduleIdle`.
- **023-fix-initial-load.AC2.5 Failure:** `readPaintCache(did)`
  returns `null` (does not throw) when the localStorage key is
  missing.
- **023-fix-initial-load.AC2.6 Failure:** `readPaintCache(did)`
  returns `null` when the stored JSON is malformed.
- **023-fix-initial-load.AC2.7 Failure:** `readPaintCache(did)`
  returns `null` when `schemaVersion` does not match the current
  version constant.

### 023-fix-initial-load.AC3: Bootstrap hydrates synchronously from the cache
- **023-fix-initial-load.AC3.1 Success:** `readPaintCache` is called
  before Preact `render()` in `src/client/index.ts`.
- **023-fix-initial-load.AC3.2 Success:** Signal hydration uses
  `batch()` so consumers observe one update, not four.
- **023-fix-initial-load.AC3.3 Failure:** When `rsss.lastSessionDid`
  is DID-B but a paint cache exists only for DID-A, no hydration
  occurs (DID-A's data is not rendered for DID-B).
- **023-fix-initial-load.AC3.4 Edge:** When `rsss.lastSessionDid`
  is missing (first-ever load on this device), bootstrap proceeds
  without hydration and does not crash.

### 023-fix-initial-load.AC4: `getAdapter` no longer reads `billingStatus`
- **023-fix-initial-load.AC4.1 Success:** With `syncSubscriptions=true`,
  OPFS supported, `did` set, `bootstrapInProgress=false`, and
  `billingStatus.value === null`, `getAdapter(did)` returns the local
  adapter. (Today's code returns the remote adapter in this state.)
- **023-fix-initial-load.AC4.2 Success:** With `syncSubscriptions=false`,
  `getAdapter` returns the remote adapter regardless of
  `billingStatus`.
- **023-fix-initial-load.AC4.3 Failure:** A lapsed-billing user
  receiving `SyncBillingError` on the first background sync still
  triggers `loadBillingStatus()` and the existing downgrade flow.

### 023-fix-initial-load.AC5: First-ever bootstrap UI
- **023-fix-initial-load.AC5.1 Success:** When `bootstrapInProgress`
  is `true` AND `readPaintCache` returned `null`, the items pane
  renders a card with the text "Setting up your local cache. This
  only happens once on this device."
- **023-fix-initial-load.AC5.2 Success:** The bootstrap card surfaces
  `bootstrapFeedsCount` and `bootstrapItemsCount` progress values.
- **023-fix-initial-load.AC5.3 Failure:** When `bootstrapInProgress`
  becomes `false`, the card is removed from the DOM in the same
  render and replaced by real content (no orphan card).
- **023-fix-initial-load.AC5.4 Edge:** On a returning load (paint
  cache hit), the card is never shown.

### 023-fix-initial-load.AC6: Logout and account-switch cleanup
- **023-fix-initial-load.AC6.1 Success:** Logging out removes
  `rsss.paintCache.v1.<did>` for the current user from localStorage.
- **023-fix-initial-load.AC6.2 Success:** Logging out removes
  `rsss.lastSessionDid` from localStorage.
- **023-fix-initial-load.AC6.3 Success:** Disabling local-first sync
  via `disableLocalFirst` also clears that DID's paint cache.
- **023-fix-initial-load.AC6.4 Failure:** Logout of DID-A does not
  remove a paint-cache entry for DID-B.

### 023-fix-initial-load.AC7: Third-party latency does not block paint
- **023-fix-initial-load.AC7.1 Success:** With `/api/billing/status`
  artificially delayed (5s stub), first paint of the home route still
  occurs within 1s of JS bundle execution (cached-data render path).
- **023-fix-initial-load.AC7.2 Success:** `loadBillingStatus()` is
  not awaited anywhere on the render critical path
  (`src/client/state.ts:572` remains fire-and-forget; no other
  awaiter exists).
- **023-fix-initial-load.AC7.3 Failure:** Failure of
  `/api/billing/status` (503 response) does not prevent the shell
  from rendering or items from appearing.

### 023-fix-initial-load.AC8: Stripe SDK is not on the home critical path
- **023-fix-initial-load.AC8.1 Success:** Loading the home route in
  a fresh tab (no DOM leftovers) does not result in a network request
  to `https://js.stripe.com/v3` or any `https://js.stripe.com/*`
  resource.
- **023-fix-initial-load.AC8.2 Success:** The served HTML includes
  `<link rel="preconnect" crossorigin href="https://js.stripe.com">`
  in `<head>`.
- **023-fix-initial-load.AC8.3 Success:** Opening the payment-method
  modal on the settings route still successfully loads Stripe.js and
  initializes Elements.

### 023-fix-initial-load.AC9: Investigation deliverable
- **023-fix-initial-load.AC9.1 Success:** Phase 1's investigation
  produces a written finding (in the PR description or a committed
  note) identifying why `js.stripe.com/v3` was pending on the home
  page in the original report. The finding either documents that no
  code change is needed (DOM leftover) or names the specific code
  change made.

## Glossary

- **Durable Object (DO)**: Cloudflare's stateful edge primitive. Each
  user gets a single DO instance with its own SQLite database that is
  the server-authoritative store for feeds, items, and counts.
- **OPFS (Origin Private File System)**: A browser storage API that
  gives a web app access to a sandboxed local filesystem. Used here
  to run SQLite in the browser (via a WASM build), enabling the
  local-first sync for paid users.
- **SQLite-WASM**: SQLite compiled to WebAssembly, running inside
  the browser tab against an OPFS-backed file.
- **signal**: A reactive cell from `@preact/signals`. Reading its
  `.value` inside a Preact component subscribes that component to
  future updates.
- **batch()**: A function from `@preact/signals` that defers signal
  notifications until the callback completes, so consumers observe
  one combined update rather than one per assignment.
- **DID**: Decentralized Identifier — a Bluesky/AT Protocol user
  identifier (e.g. `did:plc:…`). Used here as the per-user namespace
  for localStorage keys.
- **paint cache**: The new `rsss.paintCache.v1.<did>` localStorage
  entry. A best-effort snapshot of the last known feed list, item
  list, and counts, read synchronously at bootstrap to seed signals
  before any network request.
- **render gate**: A boolean signal (`initialLoadComplete`,
  `pageReady`) that prevents any part of the app shell from
  rendering until it becomes `true`. The design removes this in
  favor of per-sub-tree rendering rules.
- **bootstrapInProgress**: An existing signal
  (`src/client/db/bootstrap.ts`) that is `true` while the first-ever
  OPFS sync is pulling data. New UI reads this to show a one-time
  progress card.
- **getAdapter**: A function in `src/client/db/index.ts` that
  selects between the local OPFS adapter and the remote HTTP adapter
  based on feature flags and (currently) billing status.
- **loadInitialView**: The function that `Promise.all`-waits the
  four initial data loads (feeds, items, counts, feed status)
  before declaring the app ready.
- **SyncBillingError / PushSyncBillingError**: Error types thrown by
  the OPFS sync cycle when the server detects a lapsed subscription.
  The existing handler uses these to downgrade the UI to free-tier
  behavior.
- **scheduleIdle**: A thin wrapper around `requestIdleCallback` with
  a timeout fallback (`src/client/state.ts`). Used to defer
  non-urgent work (e.g., writing the paint cache) until the browser
  is idle.
- **fire-and-forget**: Starting an async operation without awaiting
  it — the call site does not block. Used throughout to describe
  network calls that should not hold up the render.
- **preconnect link hint**: `<link rel="preconnect" href="…">` in
  `<head>`. Tells the browser to perform DNS lookup and TLS
  handshake for the target origin ahead of any resource fetch,
  reducing latency when the resource is eventually needed.
- **stale-while-revalidate**: A caching pattern where the previously
  cached response is shown immediately while a fresh fetch runs in
  the background. The paint cache implements this pattern for the
  app shell.
- **Stripe / `@stripe/stripe-js`**: Third-party payment SDK. The
  `@stripe/stripe-js/pure` sub-path defers SDK script injection
  until `loadStripe()` is explicitly called.
- **Autumn**: Third-party billing reconciliation service. Calls to
  it are made server-side by `/api/billing/status`; its latency is
  the primary current cause of the billing-status load being slow.
- **KV**: Cloudflare Workers KV — a global key-value store used
  server-side to cache `billingStatus` results so repeated requests
  within the TTL window do not hit Autumn.
- **FCIS (Functional Core / Imperative Shell)**: An architecture
  pattern where pure business logic (functional core) is separated
  from side-effecting orchestration (imperative shell). Referenced
  in project house-style conventions.

## Architecture

The current bootstrap is a serial chain of awaited operations whose
final link, `initialLoadComplete = true`, gates the entire render:

```
checkAuth (awaited) -> user.value set
  -> effect -> microtask:
       loadBillingStatus()      // fire-and-forget but slow (Autumn)
       startLocalSync(did)
            getAdapter(did)     // reads billingStatus -> races
              -> loadInitialView    // Promise.all of 4 loads
                 -> initialLoadComplete.value = true
```

If any link stalls — slow Autumn round-trip via `billingStatus`,
OPFS init, a slow item-list API — the user sees only skeletons.

The new bootstrap removes the global render gate, hydrates signals
synchronously from a small localStorage paint cache before mounting
Preact, and fires every network operation in parallel:

```
on import:
  loadLocalFirstSettings()      // existing: sync localStorage read
  hydratePaintCache(lastSessionDid)   // NEW: sync localStorage read
  mount Preact root              // shell paints from seeded signals

then, in parallel (fire-and-forget):
  checkAuth() -> user signal
  loadBillingStatus() -> billing signals (never gates render)
  startLocalSync(did) -> OPFS, pullSync, loadInitialView
  // preconnect to js.stripe.com warms third-party DNS/TLS
```

Each sub-tree of the UI renders based on its own signals rather than
a global `pageReady`. Sub-trees show contextual loading hints only
when their data is genuinely empty AND a fetch is in flight; with
paint-cache data present (the common case for returning users),
they render real content immediately.

`getAdapter` no longer reads `billingStatus`. It reads
`syncSubscriptions` (already in localStorage, synchronous) plus the
existing `isLocalFirstSupported` feature detection. Lapsed billing
is policed by the existing `SyncBillingError` handler on the next
sync cycle, not by a pre-flight check.

### Key components

| Component | Path | Role |
|---|---|---|
| Paint cache module | `src/client/paint-cache.ts` (NEW) | Synchronous, per-DID, capped localStorage cache. Read at bootstrap, written debounced after each load. |
| Bootstrap entry | `src/client/index.ts` | Hydrate paint cache before mounting Preact. Remove the `pageReady` render gate. |
| Adapter selection | `src/client/db/index.ts` | `getAdapter` stops reading `billingStatus`. |
| Load coordinators | `src/client/state.ts` | After successful `loadFeeds` / `loadItems` / `loadCounts`, schedule debounced paint-cache write via existing `scheduleIdle`. Persist `rsss.lastSessionDid` on `checkAuth` success. |
| HTML head | `public/index.html` | `<link rel="preconnect" crossorigin href="https://js.stripe.com">` to warm Stripe's origin without fetching the SDK. |
| Stripe SDK boundary | `src/client/components/payment-method-modal.ts` | If Phase 1 investigation finds eager script injection, switch import to `@stripe/stripe-js/pure`. |

### Paint cache contract

The paint cache is a best-effort synchronous read-through layer. It is
never the source of truth — OPFS SQLite (paid users) and the remote
HTTP API (free users) remain authoritative.

```typescript
interface PaintCacheV1 {
    schemaVersion: 1
    writtenAt: number
    feeds: FeedSummary[]                // capped at 100
    counts: { feedId: string; unread: number }[]
    items: ItemSummary[]                // capped at 200, newest first
    selectedFeedId: string | null
}

interface PaintCacheModule {
    readPaintCache(did: string): PaintCacheV1 | null
    writePaintCache(
        did: string,
        snapshot: Omit<PaintCacheV1, 'schemaVersion' | 'writtenAt'>
    ): void
    clearPaintCache(did?: string): void
}
```

- Storage key: `rsss.paintCache.v1.<did>` (versioned for forward-compat).
- 1 MB hard byte cap: items dropped from the tail until serialized
  size fits. Feeds and counts are small enough to never need
  truncation but are capped defensively.
- Errors are swallowed; the cache is best-effort.
- `FeedSummary` and `ItemSummary` are the narrowest shapes needed to
  render a list (id, title, unread count, url, publishedAt). Content
  bodies stay in OPFS / remote.

### Data flow on a returning-user bootstrap

```
1. Module load: loadLocalFirstSettings(), readPaintCache(did) (both sync).
2. batch(): seed feeds/items/counts/selectedFeedId signals from cache.
3. Mount Preact root. Shell + sidebar + items pane paint from signals.
4. checkAuth(), loadBillingStatus(), startLocalSync() fire in parallel.
5. As each load resolves, signals update -> UI updates in place.
6. After each successful load, scheduleIdle(writePaintCache(...)).
```

The visible time from "JS bundle loaded" to "real content on screen"
is the time of one synchronous localStorage read + one Preact render.
No network is on this path.

### First-ever bootstrap

When `readPaintCache` returns `null` AND `bootstrapInProgress.value`
becomes `true` (signal exists at `src/client/db/bootstrap.ts:23`),
the items pane renders an explicit card:

> Setting up your local cache. This only happens once on this device.

The card surfaces the existing `bootstrapFeedsCount` and
`bootstrapItemsCount` signals for progress. When bootstrap finishes
and `loadInitialView` populates signals, the card is replaced by the
real content and the first paint-cache write fires for next time.

## Existing Patterns

This design layers onto established conventions rather than inventing
new infrastructure.

| Pattern | Existing reference | How we use it |
|---|---|---|
| **localStorage hydration at startup** | `src/client/local-first-settings.ts` (key `rsss.localFirst`, sync read + `batch()` apply) | Paint cache uses the same shape: versioned key, sync read, JSON parse with try/swallow, `batch()` apply. Hydration runs from the same bootstrap path. |
| **`batch()` for multi-signal writes** | Global rule in `CLAUDE.md`; example `loadBillingStatus` at `src/client/state.ts:1299-1302` | Every paint-cache hydration and load action that writes multiple signals uses `batch()`. |
| **Idle-deferred work** | Feature 022 added `scheduleIdle` / `cancelIdle` (`src/client/state.ts:678-681`) | Paint-cache writes use `scheduleIdle` with a 1000ms timeout. Same import, same idiom. |
| **Sync-status freshness UI** | Feature 006 sync-status legend (header dot) | No new freshness UI added. The existing dot already communicates stale / refreshing / up-to-date during the window between cache render and fresh-data arrival. |
| **First-time bootstrap signals** | `src/client/db/bootstrap.ts:23-28` exposes `bootstrapInProgress`, `bootstrapFeedsCount`, `bootstrapItemsCount` | Render the new "Setting up your local cache…" card from these existing signals. No new state. |
| **Per-feed "Resolving…" badge** | Feature 020 add-feed-zero-unread | Already present in sidebar; unchanged. |
| **Server-side billing cache** | `src/server/index.ts` `BILLING_CACHE_TTL_SECONDS = 600`, `resolveBilling` KV cache | Already in place; we don't add a new cache, only confirm nothing on the client awaits this endpoint. |
| **Adapter selection from persisted settings** | `syncSubscriptions` in `local-first-settings.ts` (sync, localStorage-backed) | `getAdapter` reads this directly; matches how every other "do we use local-first?" check already works. |
| **Logout cleanup** | Existing logout flow clears local-first DB and signals | Extend it with `clearPaintCache(did)` plus a `rsss.lastSessionDid` clear. |
| **Versioned identifiers** | DO SQLite migrations in `wrangler.jsonc:26-36` (v1, v2 migration tags) | Paint cache key includes `.v1.` for forward-compat. |

No new dependencies. No new infrastructure. No build-pipeline change.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Investigate Stripe v3 critical-path load
**Goal:** Determine why `js.stripe.com/v3` appeared in the home-page
network panel, and whether any code change is needed.

**Components:**
- Investigation only; no source code changes unless the root cause
  is in our code.
- Reproduction steps: fresh tab with "Disable cache" in DevTools,
  navigate to home route, observe whether `js.stripe.com/v3` is
  fetched.
- If yes: trace the trigger. Candidates include `<Elements>` provider
  rendered above the modal, `loadStripe` called outside the modal's
  `handleAddCard`, or `@stripe/stripe-js` invoking the script on
  module import.
- If a fix is needed: switch
  `src/client/components/payment-method-modal.ts:10` import from
  `'@stripe/stripe-js'` to `'@stripe/stripe-js/pure'`, which
  guarantees no script injection until `loadStripe()` is called.

**Dependencies:** None.

**Done when:** Either a written finding ("script was a DOM leftover
from a prior modal open in the same tab; no code change needed") or
a one-line import change is committed. The home route in a fresh
tab does not request `js.stripe.com/v3`.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Add `preconnect` hint for `js.stripe.com`
**Goal:** Warm DNS/TLS for Stripe's origin in parallel with page
render, so the SDK fetch starts ~100-300ms warmer when the user
eventually opens settings.

**Components:**
- `public/index.html` — add one `<link rel="preconnect" crossorigin
  href="https://js.stripe.com">` in `<head>`.

**Dependencies:** None (independent of Phase 1).

**Done when:** The link tag is present in the served HTML and
DevTools' Network panel shows an early connection to `js.stripe.com`
without a script fetch.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Build the paint-cache module
**Goal:** Stand up the new synchronous, capped, per-DID localStorage
cache as a standalone module with property tests.

**Components:**
- New file `src/client/paint-cache.ts` exporting `readPaintCache`,
  `writePaintCache`, `clearPaintCache`, the `PaintCacheV1` interface,
  and the `FeedSummary` / `ItemSummary` summary types.
- Storage key format `rsss.paintCache.v1.<did>`.
- Caps: 100 feeds, 200 items, 1MB serialized JSON ceiling with
  tail-eviction.
- Test file `test/paint-cache.ts` covering: round-trip identity under
  caps; truncation past 200 items / 100 feeds; null on missing key /
  parse failure / schema-version mismatch; `clearPaintCache()` removes
  every matching key; `clearPaintCache(did)` removes only that DID's
  entry. Uses property-style assertions per project conventions
  (`house-style:property-based-testing` skill).
- New test script in `package.json`:
  `"test:paint-cache": "esbuild ./test/paint-cache.ts --bundle |
   tapout"`.

**Dependencies:** None.

**Done when:** All property tests pass. `npm run typecheck` clean.
Module is importable but not yet wired into `state.ts` or
`index.ts`.

**Covers ACs:** `023-fix-initial-load.AC2.*` (paint cache round-trip,
capping, invalidation).
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Wire paint-cache reads into bootstrap
**Goal:** Hydrate signals synchronously from the paint cache before
mounting Preact, so the shell paints with real content on returning
loads.

**Components:**
- `src/client/index.ts` — call `readPaintCache(getStoredDid())` after
  `loadLocalFirstSettings()` and before mounting Preact. On a non-
  null result, apply the snapshot via `batch()` to the feeds, items,
  counts, and `selectedFeedId` signals.
- New helper `getStoredDid()` reading `rsss.lastSessionDid` from
  localStorage. Lives in `paint-cache.ts` or a sibling.
- `src/client/state.ts` — write `rsss.lastSessionDid` from
  `checkAuth` on successful auth; clear it on logout.
- No removal of `initialLoadComplete` yet; render gate still in
  place. This phase is additive.

**Dependencies:** Phase 3.

**Done when:** Integration test with a slow-stubbed `/api/feeds`
shows the sidebar feeds list in the DOM before the fetch resolves,
when the paint cache key is pre-populated. Cache key for DID-A is
not hydrated when `lastSessionDid` is DID-B.

**Covers ACs:** `023-fix-initial-load.AC3.*` (hydration ordering and
DID isolation).
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Wire paint-cache writes into load actions
**Goal:** Persist a paint-cache snapshot after each successful load
so the next bootstrap has fresh data to hydrate from.

**Components:**
- New helper in `src/client/state.ts` (e.g., `schedulePaintCacheWrite
  (state)`) that snapshots the current `feeds`, `items`, `counts`,
  and `selectedFeedId` signals and calls `writePaintCache` via the
  existing `scheduleIdle` (1000ms timeout).
- Call sites: end of `State.loadFeeds`, `State.loadItems`,
  `State.loadCounts` success paths, and end of `State.loadFeedStatus`
  if counts can change there.
- `src/client/db/index.ts` and the logout flow — call
  `clearPaintCache(did)` when local-first is disabled and when the
  user logs out, alongside existing cleanup.
- The disable-local-first flow in `src/client/db/index.ts:275-` also
  clears the cache.

**Dependencies:** Phase 3 (module exists).

**Done when:** After a successful `loadFeeds`, the corresponding
localStorage key is present and parseable; after logout, the key is
gone. `npm test && npm run lint` clean.

**Covers ACs:** `023-fix-initial-load.AC2.*` (write triggers and
invalidation) and `023-fix-initial-load.AC6.*` (logout cleanup).
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Decouple `getAdapter` from `billingStatus`
**Goal:** Remove the cross-cutting race where adapter selection
depends on an unloaded billing signal.

**Components:**
- `src/client/db/index.ts:175-213` — remove the
  `billingStatus.value?.entitled` check from the predicate.
- Audit `recomputeCacheStatus` (in `src/client/state.ts` and
  `src/client/cache-status-state.ts`) to confirm it tolerates
  `billingStatus.value === null` without throwing or misrendering.
  This is likely already the case because the current code reaches
  this state on every page load before billing resolves.
- Verify the existing `SyncBillingError` / `PushSyncBillingError`
  handlers at `src/client/state.ts:545-550` still cover the lapsed-
  billing fallback path.

**Dependencies:** None (independent of paint cache).

**Done when:** A test exercising "syncSubscriptions=true, OPFS
supported, billingStatus signal still null" returns the local
adapter (today's code returns the remote adapter). No regression in
the lapsed-billing flow.

**Covers ACs:** `023-fix-initial-load.AC4.*` (adapter selection
without billing).
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: Remove the global render gate
**Goal:** Replace the all-or-nothing `pageReady` gate with sub-tree
local rendering rules. This is the user-visible payoff phase.

**Components:**
- `src/client/index.ts:46-49` — remove the `pageReady` `useComputed`
  and any component that branches on it. The shell renders
  unconditionally.
- Each sub-tree of the UI (sidebar feeds list, items pane, header
  auth UI) is audited against the rendering rules in the Architecture
  section's table. Components show placeholders only when their own
  signals are empty AND a fetch is in flight.
- Add a "Setting up your local cache. This only happens once on this
  device." card to the items-pane render path, shown when
  `bootstrapInProgress.value === true` AND no paint-cache snapshot
  was hydrated. Renders existing `bootstrapFeedsCount` and
  `bootstrapItemsCount` for progress.
- `state.initialLoadComplete` — audit consumers. If safely removable,
  delete; otherwise keep set to `true` once any initial load succeeds
  for back-compat only.

**Dependencies:** Phases 3-6 (must have paint-cache hydration in
place before removing the gate, or returning users would see flashes
of empty state).

**Done when:** Manual verification: with a populated paint cache,
the home route paints sidebar + items within ~100ms of JS bundle
load. With no paint cache, the bootstrap card is shown. All existing
tests pass.

**Covers ACs:** `023-fix-initial-load.AC1.*` (render-gate behavior)
and `023-fix-initial-load.AC5.*` (first-ever bootstrap UI).
<!-- END_PHASE_7 -->

<!-- START_PHASE_8 -->
### Phase 8: Finalize — full AC test coverage, manual verification,
cleanup

**Goal:** Land remaining tests, verify behavior end-to-end, and
clean up any dead code surfaced during earlier phases.

**Components:**
- Backfill any AC integration tests not landed in earlier phases.
  Specifically: slow-billing-doesn't-delay-first-paint
  (`023-fix-initial-load.AC7.*`).
- Manual verification (per project `verify` skill): measure local
  time-to-first-paint baseline vs. after; confirm
  `js.stripe.com/v3` not requested on home in a fresh tab; confirm
  `/api/billing/status` latency does not change perceived load
  time; confirm post-logout / account-switch cache isolation.
- Delete `state.initialLoadComplete` if unused after Phase 7.
- Run `npm test && npm run lint && npm run typecheck` and confirm
  clean.
- Standard code-review fix loop (handled by writing-implementation-
  plans' finalization).

**Dependencies:** Phases 1-7.

**Done when:** All ACs have passing tests. Manual verification log
included in the PR. `npm test && npm run lint` clean. PR opened.

**Covers ACs:** Any remaining ACs not covered earlier.
<!-- END_PHASE_8 -->

## Additional Considerations

**Multi-tab interaction:** localStorage is shared across tabs of the
same origin. If tab A writes a paint-cache snapshot while tab B is
mid-bootstrap, tab B reads what tab A wrote — which is correct
behavior (always read the most recent snapshot). The existing
`tab-coordination.ts` lock applies only to the OPFS DB, not to
localStorage; we don't introduce new locking.

**Account switching:** Switching from DID-A to DID-B reads
`rsss.paintCache.v1.<DID-B>` (likely null on first switch), so the
fallback is identical to a first-ever-load for the new account.
DID-A's cache stays in localStorage until A logs in again (or
forever if A never returns from this device); the 1 MB cap keeps
the footprint bounded.

**Stale-render window:** The window between paint-cache hydration
and fresh-data arrival is when the user could see stale items. The
existing sync-status dot (feature 006) communicates this. Per the
clarification in design, stale-while-revalidate is the desired
behavior — staleness is acceptable AND visible.

**Lapsed-billing edge case:** A paid user whose subscription has
lapsed since their last visit will see one render from OPFS + paint
cache before the next sync cycle returns `SyncBillingError`. The
existing handler will downgrade the UI to free-tier behavior on the
next paint. We deliberately accept this tiny edge-case latency for
the giant common-case win.

**`/api/billing/status` server-side improvement (out of scope):**
The current handler synchronously hits Autumn on a cold KV cache
miss. A future enhancement could serve stale-or-synthetic immediately
and refresh in `c.executionCtx.waitUntil()`. Flagged here for a
follow-up issue, not for this design.

**OG image and `bafkrei...` fetch in the screenshot:** The user's
screenshot also showed a `bafkreibrz3enag5rkk6uvxkkj2hobipbbsnvjfuze
vefxpuc3bpvxviu7ti` request pending. That is content-addressed asset
loading, not on the render critical path. Out of scope for this
design.
