# Phase 5: Wire paint-cache writes into load actions

**Goal:** After each successful load (`loadFeeds`, `loadItems`,
`loadCounts`, `loadFeedStatus`), schedule a debounced paint-cache
snapshot write via the existing `scheduleIdle` helper. On logout and
`disableLocalFirst`, clear the paint-cache key (and
`rsss.lastSessionDid` on logout) so a returning user does not see
stale data from a previous account.

**Architecture:** A single new private helper
`schedulePaintCacheWrite(state)` lives in `state.ts`. It uses a
module-scoped `IdleHandle` and cancels any in-flight idle callback
before scheduling a new one, giving cheap debounce semantics.
Snapshot construction reads the current signal values via `.peek()`
(no subscription) to avoid creating effect dependencies. The helper
is called at the end of each load action's success path.

`State.logout` gains two cleanup calls (`clearPaintCache(did)` +
`clearStoredDid()`) inside the existing `batch` block.
`disableLocalFirst` in `src/client/db/index.ts` gains
`clearPaintCache(did)` next to the existing OPFS cleanup. AC6.4 (DID
isolation on logout) is satisfied by Phase 3's per-DID key design.

**Tech Stack:** TypeScript (browser, ES2022), `@preact/signals`,
existing `scheduleIdle` helper.

**Scope:** Phase 5 of 8. Depends on Phase 3 (module exists) and
Phase 4 (the `setStoredDid` hook in `checkAuth` already exists).

**Codebase verified:** 2026-05-24

**Key facts from investigation:**
- `State.loadFeeds` (state.ts:1751-1775) updates `state.feeds.value`
  inside `batch()` at lines 1761-1765. Schedule the write *after* the
  batch closes.
- `loadItems` writes go through the helper `applyItemsResult`
  (state.ts:829-852), which is the single success path for both the
  cache-hit and live-fetch branches. Schedule from inside
  `applyItemsResult` *after* the `batch()` block (line 843).
- `State.loadCounts` (state.ts:2054-2066) writes
  `state.counts.value = counts` directly at line 2062. Schedule
  immediately after.
- `State.loadFeedStatus` (state.ts:1789-1829) does NOT touch the
  paint-cache fields (it only writes `feedUpdateCounts` and
  `feedSyncStatus`). Therefore we do **not** schedule from this
  function — it would only re-write the same snapshot. AC2.4 listed
  this in the design but the field-level audit shows it would be a
  no-op.
- `scheduleIdle` (util/schedule-idle.ts) takes `(fn, opts?)` where
  `opts.timeout` defaults to 200ms. The design specifies a 1000ms
  timeout for paint-cache writes — pass it explicitly.
- `State.logout` (state.ts:1715-1743) currently does NOT clear any
  localStorage. The existing `batch` block (lines 1730-1740) wraps
  signal resets. `clearPaintCache(did)` and `clearStoredDid()` can
  go inside or just before this batch (they touch localStorage, not
  signals — placement outside the batch is cleaner).
- `disableLocalFirst` (db/index.ts:275-297) is the single site for
  the "user turned off local-first" flow. It already removes the
  OPFS file and clears the adapter cache. Add
  `clearPaintCache(did)` next to `removeOpfsDb(did)` at line 287.
- The `disableLocalFirst` call site is `routes/settings.ts:284` (the
  user-facing toggle handler) — no other call sites.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### 023-fix-initial-load.AC2: Paint cache module persists and reads correctly
- **023-fix-initial-load.AC2.4 Success:** Successful loads in
  `state.ts` schedule a debounced paint-cache write via
  `scheduleIdle`.

### 023-fix-initial-load.AC6: Logout and account-switch cleanup
- **023-fix-initial-load.AC6.1 Success:** Logging out removes
  `rsss.paintCache.v1.<did>` for the current user from localStorage.
- **023-fix-initial-load.AC6.2 Success:** Logging out removes
  `rsss.lastSessionDid` from localStorage.
- **023-fix-initial-load.AC6.3 Success:** Disabling local-first sync
  via `disableLocalFirst` also clears that DID's paint cache.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: `schedulePaintCacheWrite` helper

**Verifies:** AC2.4 (the helper is the call site for the scheduled
write)

**Files:**
- Modify: `src/client/state.ts`

**Implementation:**

Extend the existing `./paint-cache.js` import added in Phase 4 by
adding only these names:

```typescript
// Add these names to the existing import block from Phase 4:
//   writePaintCache, snapshotFromState, clearStoredDid, clearPaintCache
//
// The final block will read like:
import {
    readPaintCache,             // already imported in Phase 4
    setStoredDid,               // already imported in Phase 4
    type PaintCacheV1,          // already imported in Phase 4
    writePaintCache,            // NEW (this task)
    snapshotFromState,          // NEW (this task)
    clearStoredDid,             // NEW (this task)
    clearPaintCache             // NEW (this task)
} from './paint-cache.js'
```

Phase 7 will add `paintCacheHydratedOnBootstrap`, but it lives in
`state.ts` itself (not in `paint-cache.js`), so no further edit to
this import block is required.

Add a module-scoped handle and the helper. Place it near
`hydratePaintCache` from Phase 4 — these two helpers are siblings:

```typescript
let _pendingPaintCacheWrite:IdleHandle|null = null

const PAINT_CACHE_WRITE_DEBOUNCE_MS = 1000

/**
 * Schedule a debounced paint-cache write. Coalesces multiple loads
 * within the same idle window into a single write. The write only
 * happens when a logged-in DID is available — otherwise it is a
 * no-op (there is no per-tab cache for unauthenticated users).
 */
export function schedulePaintCacheWrite (state:AppState):void {
    const did = state.user.value?.did
    if (!did) return
    cancelIdle(_pendingPaintCacheWrite)
    _pendingPaintCacheWrite = scheduleIdle(() => {
        _pendingPaintCacheWrite = null
        const snap = snapshotFromState(
            state.feeds.peek(),
            state.items.peek(),
            state.counts.peek(),
            state.selectedFeedId.peek()
        )
        writePaintCache(did, snap)
    }, { timeout: PAINT_CACHE_WRITE_DEBOUNCE_MS })
}
```

**Implementation notes:**
- Reads use `.peek()` not `.value` so the helper does not subscribe to
  the signals (would create a re-fire loop).
- The `did` is captured at schedule-time, not at fire-time. If the
  user logs out between schedule and idle-fire, the write still
  succeeds with the old DID — which is the desired behavior (we
  preserve their last view for when they log back in). Logout's
  explicit `clearPaintCache(did)` (Task 3) wipes that key
  synchronously after the user actually logs out.
- The module-level `_pendingPaintCacheWrite` is fine for the single
  `State()` instance the app creates. Tests may instantiate multiple
  `State()` objects but they all share this handle — for test
  hermeticity, tests should call `cancelIdle` between assertions, or
  call the helper synchronously by stubbing `scheduleIdle`.

**Verification:**

Run: `npm run typecheck && npm run lint`
Expected: Clean.

**Commit:** Combine with Task 2 (single coherent commit per
load-action wiring).

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Call `schedulePaintCacheWrite` from load actions

**Verifies:** AC2.4

**Files:**
- Modify: `src/client/state.ts`

**Implementation:**

Add three call sites. Each appears immediately after the existing
batch / direct-assign that updates the relevant signals.

1. **`State.loadFeeds`** — after the success-path `batch()` block
   closes (after line 1765, inside `try`, before `} catch`):

   ```typescript
   batch(() => {
       state.feeds.value = data.feeds
       state.feedsError.value = null
       state.feedsLoading.value = false
   })
   schedulePaintCacheWrite(state)   // NEW
   ```

2. **`applyItemsResult`** — after the success batch (after line 843):

   ```typescript
   batch(() => {
       state.items.value = result.items as Item[]
       state.itemsTotal.value = result.total
       state.itemsLoading.value = false
   })
   schedulePaintCacheWrite(state)   // NEW
   ```

3. **`State.loadCounts`** — after the assignment (after line 2062):

   ```typescript
   const counts = await adapter.getCounts()
   state.counts.value = counts
   schedulePaintCacheWrite(state)   // NEW
   ```

4. **`selectedFeedId` changes need no additional hook.** Concrete
   investigation:

   ```bash
   rg -n "selectedFeedId\\.value\\s*=" src/client/
   ```

   Today the only assignment sites are:
   - `src/client/routes/feed-reader.ts:74` — `state.selectedFeedId.value = newId`
     (user navigation into a feed)
   - `src/client/routes/feed-reader.ts:82` — `state.selectedFeedId.value = null`
     (cleanup when leaving the feed view)

   Both assignments are immediately followed by
   `State.loadItems(state)` (lines 76 and 84), which routes through
   `applyItemsResult` and triggers `schedulePaintCacheWrite` via the
   call site added in step 2 above. The cache therefore captures
   the new `selectedFeedId` automatically.

   If a future edit adds a `selectedFeedId.value =` assignment that
   is *not* followed by `loadItems` (e.g., a setting it from a
   route-driven URL parse with no item refresh), the implementer
   must call `schedulePaintCacheWrite(state)` directly. As of the
   codebase verification on 2026-05-25, no such site exists — so no
   new code is added in this task for `selectedFeedId`.

We do NOT add a call site in `State.loadFeedStatus` — it does not
modify any paint-cache-relevant signal.

**Verification:**

Run: `npm run typecheck && npm run lint`
Expected: Clean.

Run: `npm test`
Expected: Existing test suite passes. No new tests required for this
task — coverage is in Task 4.

Manual check (per the `run` skill):
1. Log in to the app fresh; navigate around to load feeds, items,
   counts.
2. In DevTools: `localStorage.getItem('rsss.paintCache.v1.' +
   localStorage.getItem('rsss.lastSessionDid'))` returns a non-empty
   string within ~2 seconds of the last interaction.
3. The cached JSON has `feeds`, `items`, `counts`, `selectedFeedId`,
   `schemaVersion: 1`, and a recent `writtenAt`.

**Commit:**

```bash
git add src/client/state.ts
git commit -m "feat: schedule paint-cache write after each successful load

Adds schedulePaintCacheWrite(state) helper and calls it from
loadFeeds, applyItemsResult, loadCounts, and selectedFeedId
assignments. Uses scheduleIdle with a 1s timeout and debounces by
cancelling any pending handle. Reads use .peek() to avoid signal
subscriptions.

Part of 023-fix-initial-load."
```

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Clear paint cache on logout

**Verifies:** AC6.1, AC6.2, AC6.4

**Files:**
- Modify: `src/client/state.ts` (`State.logout`, lines 1715-1743)

**Implementation:**

Inside `State.logout`, capture the DID *before* the existing `batch`
clears `state.user.value`, then clear paint-cache localStorage keys
after the batch. Final shape:

```typescript
State.logout = async function (
    state:AppState
):Promise<void> {
    const did = state.user.value?.did                       // NEW
    let serverLogoutOk = false
    try {
        const res = await api.post('auth/logout', {
            throwHttpErrors: false
        })
        serverLogoutOk = res.ok
        if (!res.ok) {
            debug('logout request failed:', res.status)
        }
    } catch (err) {
        debug('logout request error:', err)
    }
    batch(() => {
        state.user.value = null
        state.feeds.value = []
        state.items.value = []
        state.authError.value = serverLogoutOk ?
            null :
            'Logout may not have completed. Please clear cookies' +
                ' if you continue to see your account.'
        resetBilling()
        resetPaymentMethods()
    })
    if (did) clearPaintCache(did)                           // NEW
    clearStoredDid()                                        // NEW
    State.closeEventStream()
    state._setRoute('/login')
}
```

Per-DID isolation (AC6.4) is structurally guaranteed by the
storage-key scheme in Phase 3: `clearPaintCache(did)` removes only
`rsss.paintCache.v1.<did>` and leaves all other entries intact.

**Testing:**

Extend the integration test added in Phase 4 (or add a new test file
`test/paint-cache-cleanup.ts` if the file already covers enough
ground). Tests must verify each AC listed:

- **AC6.1:** Pre-populate `rsss.paintCache.v1.<did>` for the test
  user. Stub `api.post('auth/logout')` to succeed. Call
  `State.logout(state)`. Assert
  `localStorage.getItem('rsss.paintCache.v1.<did>')` is `null`.
- **AC6.2:** After the same logout call, assert
  `localStorage.getItem('rsss.lastSessionDid')` is `null`.
- **AC6.4:** Pre-populate paint caches for *two* DIDs. Set
  `state.user.value` to DID-A. Call `State.logout`. Assert
  `localStorage.getItem('rsss.paintCache.v1.<DID-A>')` is `null`
  AND `localStorage.getItem('rsss.paintCache.v1.<DID-B>')` is still
  the original snapshot.

The `api.post` call must be stubbed (the test should not hit a real
server). Use the existing pattern from `test/local-first-settings.ts`
or whatever the project's standard stub pattern is for `api` —
inspect existing tests that exercise `State.logout` to find it.
If there is no existing pattern, narrow the test to exercise
*just the cleanup logic* by extracting it into a small helper, or
construct a fake `api` object via `module.replaceModule`-style
techniques used elsewhere in the project.

If a clean stubbing pattern is not available, narrow this task's
test to a *unit* test of the cleanup behavior: simulate the cleanup
calls directly (`clearPaintCache(didA); clearStoredDid()`) and
verify localStorage state. The manual check below still verifies
the integrated behavior end-to-end.

Task-implementor decides between the two test approaches based on
what's already available in the codebase.

**Verification:**

Run: `npm test`
Expected: All tests pass, including the new cleanup-on-logout
coverage.

Manual check (per the `run` skill):
1. Log in. Use the app until a paint-cache snapshot is written
   (verify in DevTools).
2. Log out via the header menu.
3. In DevTools:
   - `localStorage.getItem('rsss.lastSessionDid')` is `null`.
   - `localStorage.getItem('rsss.paintCache.v1.<your DID>')` is
     `null`.
4. (DID isolation) Manually set
   `localStorage.setItem('rsss.paintCache.v1.did:plc:other', '{"x":1}')`,
   then log in/out as your own user; verify `did:plc:other`'s entry
   is preserved.

**Commit:**

```bash
git add src/client/state.ts test/paint-cache-cleanup.ts package.json test/run-all-tests.mjs
git commit -m "feat: clear paint cache and lastSessionDid on logout

State.logout now captures the user's DID before resetting signals
and calls clearPaintCache(did) + clearStoredDid() after. Per-DID
isolation is structural — other accounts' cached snapshots remain
in localStorage and are picked up when those users log back in.

Part of 023-fix-initial-load."
```

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Clear paint cache on `disableLocalFirst`

**Verifies:** AC6.3

**Files:**
- Modify: `src/client/db/index.ts` (`disableLocalFirst`, lines 275-297)

**Implementation:**

Add the import at the top of the file (alongside the existing
imports):

```typescript
import { clearPaintCache } from '../paint-cache.js'
```

Inside `disableLocalFirst`, add the cache clear next to the existing
OPFS removal (after line 287, `await removeOpfsDb(did)`):

```typescript
await removeOpfsDb(did)
clearPaintCache(did)                                        // NEW
batch(() => {
    setSyncSubscriptions(false)
})
saveLocalFirstSettings()
```

`clearPaintCache` is synchronous (localStorage), so it does not need
`await` and cannot fail in a way that breaks the flow (errors are
swallowed by the module).

**Testing:**

Add to the same test file as Task 3 (or wherever
`disableLocalFirst` is already tested if a relevant suite exists):

- **AC6.3:** Pre-populate `rsss.paintCache.v1.<did>` for a user.
  Call `disableLocalFirst(did, fetchFn)` with a stubbed fetchFn
  (existing tests already exercise this — match the established
  pattern). Assert
  `localStorage.getItem('rsss.paintCache.v1.<did>')` is `null`
  after the call resolves.

**Verification:**

Run: `npm test`
Expected: All tests pass.

Manual check (per the `run` skill):
1. Enable local-first sync on `/settings`. Use the app until paint
   cache is populated.
2. On `/settings`, disable local-first sync (the toggle).
3. In DevTools: `localStorage.getItem('rsss.paintCache.v1.<your DID>')`
   is `null`.

**Commit:**

```bash
git add src/client/db/index.ts test/
git commit -m "feat: clear paint cache when local-first sync is disabled

disableLocalFirst now calls clearPaintCache(did) alongside the
existing OPFS removal so a user opting out of local-first does not
keep an orphan paint-cache snapshot that would hydrate on next
load.

Part of 023-fix-initial-load."
```

<!-- END_TASK_4 -->
