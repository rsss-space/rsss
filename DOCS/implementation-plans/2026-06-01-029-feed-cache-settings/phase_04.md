# Feed Cache Settings — Phase 4: Enable-while-storage-off bootstrap

**Goal:** When an entitled user enables "Cache this feed" while device
local storage is off, bootstrap the local DB (reusing the `/settings`
flow), persist the feed's `content_enabled=1` override after bootstrap
succeeds, and revert cleanly on failure — without flipping the global
"Store article content locally" switch and without touching `/settings`.

**Architecture:** Extend `handleContentToggle` in
`src/client/components/cache-settings.ts`. When the toggle turns a feed
on and `!isLocalFirstActive.value`, optimistically set the in-memory
override, call `setSyncSubscriptions(true)` + `bootstrapLocalDb(did, fetch,
{ confirmTerminalReset, confirmLowStorage })` (the exact pair
`settings.ts:handleSyncChange` uses), then persist the override to the
now-existing DB, or revert the optimistic override if bootstrap did not
produce a DB. Handle `setSyncSubscriptions`'s `'pending'` (stash intent,
apply when billing resolves) and `'blocked'` (revert) results. Reflect
`bootstrapInProgress` as a disabled checkbox.

**Tech Stack:** TypeScript (browser, ES2022 via Vite) + Preact +
`@preact/signals`; bootstrap infra in `src/client/db/bootstrap.ts`; tests
with `@substrate-system/tapzero` + Preact render + global `fetch` stub.

**Scope:** Phase 4 of 4. **Depends on Phases 1 and 3.**

**Codebase verified:** 2026-06-01

---

## Acceptance Criteria Coverage

### 029-feed-cache-settings.AC5: Enable while storage off → bootstrap, only that feed
- **029-feed-cache-settings.AC5.1 Success:** Enabling while storage off +
  entitled calls `setSyncSubscriptions(true)` + `bootstrapLocalDb`.
- **029-feed-cache-settings.AC5.2 Success:** After bootstrap succeeds, the
  feed's `content_enabled=1` override is persisted.
- **029-feed-cache-settings.AC5.3 Success:** Post-enable, only that feed
  caches; inherit feeds (global off) do not.
- **029-feed-cache-settings.AC5.4 Failure:** Bootstrap failure reverts the
  optimistic override.
- **029-feed-cache-settings.AC5.5 Edge:** Enabling a feed does not flip the
  global `storeContent` on.

### 029-feed-cache-settings.AC8: Scope — /settings unchanged
- **029-feed-cache-settings.AC8.1 Success:** `/settings` per-feed control
  still grays out when storage is off (feature 027 intact).
- **029-feed-cache-settings.AC8.2 Success:** Enabling a feed on the reader
  route does not change the `/settings` global "Store article content
  locally" state.

---

## Verified Codebase Context (read before coding)

**`src/client/routes/settings.ts` (the flow to reuse — do NOT modify it):**
- `handleSyncChange` (232-299): `const did = state.user.value?.did`; on
  enable, `const result = setSyncSubscriptions(true)`;
  `saveLocalFirstSettings()`; if `result === 'applied' && did`
  → `bootstrapLocalDb(did, fetch, { confirmTerminalReset:
  confirmTerminalBootstrapReset, confirmLowStorage:
  confirmLowStorageBootstrap })`; else if `result === 'pending' && did`
  → stash `pendingBootstrapDid.current = did`.
- Confirm callbacks (215-230): `confirmTerminalBootstrapReset(message)` and
  `confirmLowStorageBootstrap(message)` both wrap `confirm(...)` and return
  `boolean`.
- `inProgress = bootstrapInProgress.value` (120) feeds the toggle
  `disabled` (579-580).

**`src/client/local-first-settings.ts`:**
- `setSyncSubscriptions(v):'applied'|'pending'|'blocked'` (75-100):
  `'applied'` = entitled (or disabling) — sets `syncSubscriptions.value =
  true`, **does not touch `storeContent`**; `'pending'` = billing not yet
  loaded (`billingStatus.value === null`); `'blocked'` = loaded but not
  entitled. Type `SyncSubscriptionsResult` at line 24.
- `saveLocalFirstSettings()` persists local-first prefs.

**`src/client/db/bootstrap.ts`:**
- `bootstrapLocalDb(did, fetchFn=fetch, opts={}):Promise<void>` (117-121);
  `BootstrapLocalDbOptions = { confirmTerminalReset?, confirmLowStorage? }`
  (58-61). On success sets the bootstrapped DB (so `getBootstrappedDb()`
  returns it) and `bootstrapInProgress=false`; on transient error it
  **resolves** but sets `bootstrapError` + `bootstrapRetryAvailable`; on
  terminal error it may prompt/reset.
- Signals: `bootstrapInProgress`, `bootstrapError` (23-28), all exported
  (re-exported through `../db/index.js`).

**`src/client/db/sync-status.ts`:** `isLocalFirstActive:Signal<boolean>`
(line 15), false until a local DB is active.

**`src/client/components/cache-settings.ts`:** Phase 3 left
`handleContentToggle` doing only the smart write; `getDb()` returns
`getBootstrappedDb() ?? getLocalDb(did)` (null when storage is off);
`saveFeedPolicy` already no-ops its DB write when `getDb()` is null but
still updates `feedPolicies` in memory.

**Tests:** Extend `test/feed-reader-cache-disclosure.ts`. For the bootstrap
path, drive a global `fetch` stub (see `test/bootstrap.ts` and
`test/settings-stale-async-writes.ts` for the stub pattern and a valid
`/api/sync` `SyncResponse`). Honor global CLAUDE.md style and the "no
brittle tests / no specific HTML text" rules.

---

## Design Decision (read): testable seam + failure detection

`bootstrapLocalDb` **may resolve even on transient failure**, so do not
rely on a thrown error alone. Detect success by whether a DB now exists:
- After `await bootstrapLocalDb(...)`, if `getDb()` is non-null → persist
  the override (`saveFeedPolicy({ content_enabled: 1 })` now writes to the
  real DB). If `getDb()` is still null (or the call threw) → revert the
  optimistic override (`saveFeedPolicy({ content_enabled: prev })`).

Keep the override-value math in the existing pure expression
`(checked === storeContent.value) ? null : (checked ? 1 : 0)` (already
unit-tested via Phase 3). The Phase 4 additions are imperative wiring
(bootstrap orchestration), tested through observable signal effects and a
`fetch` stub; the full happy-path OPFS bootstrap is also covered by human
verification (see test-requirements.md).

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Bootstrap-on-enable wiring in `handleContentToggle`

**Verifies:** AC5.1, AC5.2, AC5.4, AC5.5, AC8.2.

**Files:**
- Modify: `src/client/components/cache-settings.ts`

**Implementation:**
1. Extend imports:
   - From `../local-first-settings.js`: add `setSyncSubscriptions`,
     `saveLocalFirstSettings` (alongside `storeContent`, `type CacheMode`).
   - From `../db/index.js`: add `bootstrapLocalDb`, `bootstrapInProgress`,
     `bootstrapError` (alongside the existing `getBootstrappedDb`,
     `getLocalDb`, `clearFeedCache`, `localFirstSupported`, `type Feed`).
   - From `../db/sync-status.js`: add `isLocalFirstActive`.
2. Add the two confirm callbacks inside the component, mirroring
   `settings.ts:215-230` (`confirmTerminalBootstrapReset(message):boolean`
   and `confirmLowStorageBootstrap(message):boolean`, each wrapping
   `confirm(...)`).
3. Add a `pendingContentDid` ref: `const pendingContentDid =
   useRef<string|null>(null)`. Extend the component's existing
   `preact/hooks` import (currently `useEffect, useState`) to add
   `useRef` — do not add a second import line.
4. Replace the Phase 3 `handleContentToggle` with a version that branches
   into bootstrap when enabling while storage is off:
   ```ts
   function handleContentToggle (ev:Event) {
       const checked = (ev.target as HTMLInputElement).checked
       const override = (checked === storeContent.value) ?
           null :
           (checked ? 1 : 0)
       if (checked && !isLocalFirstActive.value) {
           void enableWithBootstrap()
           return
       }
       saveFeedPolicy({ content_enabled: override })
   }

   async function enableWithBootstrap ():Promise<void> {
       const did = state.user.value?.did
       if (!did) return
       const prev = feedPolicies.value[selectedFeed.id]
           ?.content_enabled ?? null
       // optimistic in-memory override (DB write no-ops: no db yet)
       saveFeedPolicy({ content_enabled: 1 })
       const result = setSyncSubscriptions(true)
       saveLocalFirstSettings()
       if (result === 'blocked') {
           saveFeedPolicy({ content_enabled: prev })
           return
       }
       if (result === 'pending') {
           pendingContentDid.current = did
           return
       }
       // 'applied'
       try {
           await bootstrapLocalDb(did, fetch, {
               confirmTerminalReset: confirmTerminalBootstrapReset,
               confirmLowStorage: confirmLowStorageBootstrap
           })
       } catch (_err) {
           saveFeedPolicy({ content_enabled: prev })
           return
       }
       if (getDb()) {
           saveFeedPolicy({ content_enabled: 1 })
       } else {
           saveFeedPolicy({ content_enabled: prev })
       }
   }
   ```
   Notes: `setSyncSubscriptions(true)` flips `syncSubscriptions` only — it
   never sets `storeContent`, so the global content switch stays off
   (AC5.5/AC8.2). The optimistic `saveFeedPolicy({content_enabled:1})`
   updates `feedPolicies` immediately so the checkbox reflects on; after
   bootstrap, the second `saveFeedPolicy` persists it to the real DB
   (AC5.2). Any failure path reverts to `prev` (AC5.4).

**Verification:**
Run: `npm run lint`
Expected: passes.

**Commit:** `feat: bootstrap local storage when enabling a feed's cache`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Reflect bootstrap progress + apply pending intent

**Verifies:** AC5.1 (pending branch), AC6 interplay (disabled during
bootstrap).

**Files:**
- Modify: `src/client/components/cache-settings.ts`

**Implementation:**
1. Include `bootstrapInProgress` in the checkbox `disabled` expression
   (extend Phase 3's `contentDisabled`):
   `const contentDisabled = unentitled || !supported ||
   bootstrapInProgress.value`. (Reading the signal in render subscribes
   the component, so the checkbox disables while a bootstrap is running.)
2. Add a `useEffect` that applies a stashed pending intent once billing
   resolves, mirroring the `/settings` pending pattern:
   ```ts
   useEffect(() => {
       const did = pendingContentDid.current
       if (!did) return
       if (billingStatus.value === null) return  // still loading
       pendingContentDid.current = null
       if (billingStatus.value.entitled) {
           void enableWithBootstrap()
       }
   }, [billingStatus.value])
   ```
   (Guard against re-entrancy: clearing the ref before re-invoking avoids
   a loop. If not entitled when billing resolves, drop the intent — the
   billing gate disables the box anyway.)

**Verification:**
Run: `npm run lint`
Expected: passes.

**Commit:** `feat: disable cache toggle during bootstrap; apply pending`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-3) -->

<!-- START_TASK_3 -->
### Task 3: Tests — enable-while-off effects, revert, no-global-flip

**Verifies:** AC5.1, AC5.4, AC5.5, AC8.2 (automated); AC5.2, AC5.3, AC8.1
(see notes / human verification).

**Files:**
- Modify: `test/feed-reader-cache-disclosure.ts`

**Testing:** Extend the render-based suite. Set up: entitled
`billingStatus`, `storeContent.value = false`, `isLocalFirstActive.value =
false`, no override row. Stub global `fetch` (restore in `finally`).
Reset `feedPolicies` (`_resetFeedPolicies()`) and restore mutated signals
between cases. Add cases:

- **AC5.1 (observable) + AC5.5/AC8.2:** stub `fetch` so `bootstrapLocalDb`
  starts but stays pending (or returns a never-resolving / slow response);
  dispatch the checkbox `change` with `checked=true`; synchronously after,
  assert: `syncSubscriptions.value === true` (proves
  `setSyncSubscriptions(true)` ran → AC5.1), `storeContent.value ===
  false` (AC5.5/AC8.2), and `feedPolicies.value[id].content_enabled === 1`
  (optimistic). Optionally assert `fetch` was called with the `/api/sync`
  URL (proves `bootstrapLocalDb` started → AC5.1).
- **AC5.4 revert on failure:** stub `fetch` to reject (or return a
  non-ok / error response that drives `bootstrapLocalDb` to its failure
  path so no DB is produced); dispatch `change` `checked=true`; await
  microtasks/`bootstrapInProgress` settling; assert
  `feedPolicies.value[id].content_enabled` reverted to `null` (the prior
  value) and `storeContent.value === false`.
- **AC5.2 persist-after-success (best-effort automated):** if the
  `test/bootstrap.ts` harness's `fetch` stub + WASM/OPFS path can be
  reused here, stub `fetch` to return a minimal valid `SyncResponse` so
  `bootstrapLocalDb` produces a DB, then assert the feed's
  `content_enabled=1` is persisted (read back via `getFeedCachePolicy` on
  the bootstrapped DB). If a reliable harness is not available in this
  render suite, leave AC5.2 to human verification (document in
  test-requirements.md) rather than writing a flaky test.

**Notes on AC5.3 and AC8.1:**
- **AC5.3** (only that feed caches) is exercised by the Phase 2 pull-sync
  tests (override-on feed caches; inherit feed with global off does not)
  plus AC5.2; no new test needed here.
- **AC8.1** (/settings still grays when storage off) is guaranteed by
  **not modifying `settings.ts`**; the existing `test/settings-route.ts`
  suite continues to pass. Do not add a duplicate assertion that couples
  this feature to settings internals.

Query controls by `name`/`id`, never by text. Do not assert specific HTML
text.

**Verification:**
Run the aggregate suite:
`esbuild ./test/index.ts --bundle
--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts
--alias:@sentry/cloudflare=./test/sentry-cloudflare-stub.ts
--loader:.css=text --loader:.wasm=dataurl | tapout`
Expected: passes.
Run: `npm test && npm run lint`
Expected: full suite + lint pass.

**Commit:** `test: enable-while-storage-off bootstrap and revert`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_B -->

---

## Phase 4 Done When

- Enabling a feed while storage is off (entitled) calls
  `setSyncSubscriptions(true)` + `bootstrapLocalDb`, then persists the
  feed's `content_enabled=1` so only that feed caches.
- Bootstrap failure reverts the optimistic override; the global
  `storeContent` switch is never flipped on.
- The checkbox is disabled while a bootstrap is in progress; a `'pending'`
  result is applied once billing resolves.
- `/settings` is unchanged (`settings.ts` untouched); its existing tests
  still pass.
- `npm test` and `npm run lint` pass.
