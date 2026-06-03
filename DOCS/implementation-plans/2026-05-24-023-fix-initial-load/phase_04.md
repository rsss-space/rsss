# Phase 4: Wire paint-cache reads into bootstrap

**Goal:** Hydrate the `feeds`, `items`, `counts`, and `selectedFeedId`
signals synchronously from the paint cache *before* Preact mounts, so
the shell paints with real content on returning loads. Persist
`rsss.lastSessionDid` on successful auth so the next bootstrap knows
which DID's cache to hydrate.

**Architecture:** Additive only — the existing `pageReady` render gate
remains in place; this phase wires *reads* and the `lastSessionDid`
persistence. Phase 7 removes the gate. Hydration runs in
`src/client/index.ts` between `State()` (which already calls
`loadLocalFirstSettings()` internally) and `render()`. The hydration
is a single `batch()` call so consumers observe one update, not four.
Cache cleanup on logout / disableLocalFirst is wired in Phase 5
(alongside the writes), so this phase intentionally leaves logout
behavior unchanged.

**Tech Stack:** TypeScript (browser, ES2022), Preact + `@preact/signals`.

**Scope:** Phase 4 of 8. Depends on Phase 3 (paint-cache module
exists).

**Codebase verified:** 2026-05-24

**Key facts from investigation:**
- `src/client/index.ts` is small (95 lines). `State()` is called at
  line 20; `Router(state)` at line 21; Preact `render()` at line 94.
  The hydration call must sit between lines 20 and 94 — concretely,
  immediately after `Router(state)` and before any `import.meta.hot`
  block.
- `State()` (in `state.ts:363-432`) already calls
  `loadLocalFirstSettings()` at line 367 and seeds feeds/items/counts
  from a server-rendered bootstrap payload via `peekInitialFeed()` at
  lines 373-378. Initial seed defaults are empty arrays and zeroed
  counts.
- Signal types: `feeds:Signal<Feed[]>` (line 394), `items:Signal<Item[]>`
  (line 420), `counts:Signal<CountsResponse>` (line 424),
  `selectedFeedId:Signal<number|null>` (line 428).
- `State.checkAuth` (lines 1180-1218) sets `state.user.value` to a
  `User { did, handle, avatar }` object on successful auth response.
  This is where we add the `setStoredDid(user.did)` call.
- The `pageReady` `useComputed` is at lines 46-49 of `index.ts`. We do
  NOT touch it in this phase (Phase 7 removes it).
- No existing `rsss.lastSessionDid` storage; the key is introduced by
  Phase 3's `paint-cache.ts` (`getStoredDid` / `setStoredDid` /
  `clearStoredDid`).

---

## Acceptance Criteria Coverage

This phase implements and tests:

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

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Add `hydratePaintCache` helper to state.ts

**Verifies:** AC3.1, AC3.2 (the helper is the call site for both)

**Files:**
- Modify: `src/client/state.ts` (add a new exported function near the
  other top-level helpers — place it just after the `State()`
  factory's closing brace and before `State.checkAuth`)

**Implementation:**

Add the import alongside the existing imports near the top of `state.ts`:

```typescript
import {
    readPaintCache,
    setStoredDid,
    type PaintCacheV1
} from './paint-cache.js'
```

Then add this exported function. Placement: after `State()` finishes
(the factory's closing brace is at `state.ts:704`, immediately after
`return state`) and before the first `State.X = ...` assignment
(currently `State.handleSyncAuthError` at line 706). Insert between
lines 704 and 706.

```typescript
/**
 * Synchronously apply a paint-cache snapshot to the state signals.
 * Returns true if hydration happened, false otherwise.
 *
 * Cache wins over the SSR seed: the cache is the user's last-rendered
 * view (selectedFeedId, scroll-relevant ordering); the immediate
 * `loadInitialView()` call after auth will overwrite authoritatively
 * within ~100ms.
 */
export function hydratePaintCache (
    state:AppState,
    did:string|null
):boolean {
    if (did === null) return false
    const snap:PaintCacheV1|null = readPaintCache(did)
    if (snap === null) return false
    batch(() => {
        state.feeds.value = snap.feeds
        state.items.value = snap.items
        state.counts.value = snap.counts
        state.selectedFeedId.value = snap.selectedFeedId
    })
    return true
}
```

The summary types defined in `paint-cache.ts` (Phase 3) are structurally
assignable to the signal types — `FeedSummary` includes every required
field of `Feed`; `ItemSummary` includes every required field of `Item`
with the heavy text fields explicitly typed as `null`. No casting is
needed.

**Verification:**

Run: `npm run typecheck`
Expected: Clean. If TypeScript complains that `FeedSummary[]` is not
assignable to `Signal<Feed[]>`, that means Phase 3's summary types
need to be widened — fix Phase 3 first rather than casting here.

Run: `npm run lint`
Expected: Clean.

**Commit:** Combine with Task 2 (single bootstrap-wiring commit).

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Call `hydratePaintCache` from bootstrap

**Verifies:** AC3.1, AC3.4

**Files:**
- Modify: `src/client/index.ts` (add the hydration call between
  `Router(state)` at line 21 and the `import.meta.hot` block at
  line 23)

**Implementation:**

After the line `const router = Router(state)` (line 21), add:

```typescript
hydratePaintCache(state, getStoredDid())
```

And add the imports near the top of `index.ts` (alongside the existing
`State` and routing imports):

```typescript
import { State, type AppState, hydratePaintCache } from './state.js'
import { getStoredDid } from './paint-cache.js'
```

The `getStoredDid()` returns `null` when no `lastSessionDid` is in
localStorage (first-ever load), and `hydratePaintCache` is null-safe
(it early-returns when `did === null`). AC3.4 is verified by this
no-throw path.

`hydratePaintCache` returns a boolean (true on hit, false on miss).
This phase ignores the return value; Phase 7 uses it to decide whether
to show the first-time bootstrap card.

**Verification:**

Run: `npm run typecheck && npm run lint`
Expected: Clean.

Manual check (per the `run` skill):
1. Open the app once with a real account and let it fully load. This
   primes the paint cache and sets `rsss.lastSessionDid` (via Task 3).
2. Reload the page. In a JS console BEFORE the first paint, run
   `JSON.parse(localStorage.getItem('rsss.paintCache.v1.' +
   localStorage.getItem('rsss.lastSessionDid')))` — confirm a snapshot
   exists.
3. With the dev-server slowing `/api/feeds` (e.g., add `?delay=3000`
   stub or use DevTools' "Slow 3G" throttle on the request), reload
   and confirm the sidebar shows feed titles *before* `/api/feeds`
   resolves. (Note: in this phase the global `pageReady` render gate
   is still in place, so the items pane will still show a skeleton
   until `initialLoadComplete` flips — that gate is removed in Phase
   7. The sidebar — which renders unconditionally in `Header` — does
   show cached feeds.)

**Commit:**

```bash
git add src/client/state.ts src/client/index.ts
git commit -m "feat: hydrate signals from paint cache before Preact mounts

Adds State.hydratePaintCache(state, did) which reads the per-DID
paint-cache snapshot and applies feeds/items/counts/selectedFeedId
via batch() so consumers see one update. index.ts calls this after
State() and before render(), using getStoredDid() to look up the
last logged-in user.

No render gate removed yet — Phase 7 does that. The pageReady
useComputed is preserved.

Part of 023-fix-initial-load."
```

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Persist `rsss.lastSessionDid` on successful auth

**Verifies:** AC3.3 (per-DID isolation), AC3.4 (no-crash without
storage)

**Files:**
- Modify: `src/client/state.ts` — inside `State.checkAuth`
  (lines 1180-1218), at the point where `state.user.value = user` is
  set on a successful authenticated response (line 1202).

**Implementation:**

Add the `setStoredDid` import to the existing
`./paint-cache.js` import block from Task 1 (if not already present
from Task 1's edit, this is a no-op).

In the success branch (line 1196-1203, inside
`if (data.authenticated) { ... }`):

```typescript
if (data.authenticated) {
    const user:User = {
        did: data.did,
        handle: data.handle,
        avatar: data.avatar
    }
    state.user.value = user
    setStoredDid(data.did)             // NEW
    State.openEventStream(state)
} else {
    state.user.value = null
    State.closeEventStream()
}
```

Logout cleanup (clearing the key) lives in Phase 5 because it ties to
the broader paint-cache write/clear wiring for the logout flow. This
phase's AC3.3 is satisfied because:

- `readPaintCache(did)` returns `null` whenever the key for that DID
  is absent (Phase 3, AC2.5).
- So if `rsss.lastSessionDid` says DID-B but only DID-A's snapshot
  exists in localStorage, `readPaintCache('did-b')` returns `null` and
  `hydratePaintCache` is a no-op.

**Testing:**

Add an integration test at `test/paint-cache-bootstrap.ts` that
exercises the hydration path end-to-end at the module level (without
spinning up Preact). Tests verify:

- **AC3.1:** After calling `hydratePaintCache(state, 'did:plc:alice')`
  with a pre-populated paint cache for alice, `state.feeds.value`,
  `state.items.value`, `state.counts.value`, and
  `state.selectedFeedId.value` reflect the cached snapshot.
- **AC3.2:** Subscribe an effect counter to all four signals;
  call `hydratePaintCache` once; assert the effect fires exactly
  one combined time (or the appropriate single-batch count for
  `@preact/signals`, which schedules one microtask per batch).
- **AC3.3:** Pre-populate paint cache for `did:plc:alice` only.
  `setStoredDid('did:plc:bob')`. Call
  `hydratePaintCache(state, getStoredDid())`. Assert state signals
  remain at their initial empty values.
- **AC3.4:** With no `rsss.lastSessionDid` key in localStorage, call
  `hydratePaintCache(state, getStoredDid())`. Assert it returns
  `false` and does not throw.

Use the existing tapzero test pattern. The test file resets
`localStorage` at the start of each test and constructs an
`AppState`-like object with just the signals the helper touches
(no need for a full `State()` instantiation — keep the test
narrow to the helper's contract).

Add the test script entry to `package.json` (next to `test:paint-cache`
from Phase 3):

```json
"test:paint-cache-bootstrap": "esbuild ./test/paint-cache-bootstrap.ts --bundle | tapout",
```

And to `test/run-all-tests.mjs`:

```javascript
    'esbuild ./test/paint-cache-bootstrap.ts --bundle | tapout',
```

**Verification:**

Run: `npm run test:paint-cache-bootstrap`
Expected: All tests pass.

Run: `npm test`
Expected: Existing test suite still passes (no regressions from the
new `setStoredDid` call in `checkAuth`).

Manual check (per the `run` skill):
1. Log in fresh on a clean browser profile.
2. In DevTools console: `localStorage.getItem('rsss.lastSessionDid')`
   — should return the user's DID.
3. Reload — the DID is still there.

**Commit:**

```bash
git add src/client/state.ts test/paint-cache-bootstrap.ts package.json test/run-all-tests.mjs
git commit -m "feat: persist last-session DID; integration test for hydration

checkAuth now writes rsss.lastSessionDid via setStoredDid on success,
so subsequent bootstraps know which DID's paint cache to hydrate. Adds
test/paint-cache-bootstrap.ts covering the AC3.* hydration matrix
end-to-end at the signal-helper level.

Part of 023-fix-initial-load."
```

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
