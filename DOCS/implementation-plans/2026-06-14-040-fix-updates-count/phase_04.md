# "N updates" Count Accuracy + Freshness — Phase 4

**Goal:** Ensure an already-open tab's "N updates" header updates without a
hard reload when discovery inserts items (verify the existing
`feed-updates-available` push), and add a focus/visibility fallback that
re-fetches the canonical count when a backgrounded tab returns to the
foreground — covering the case where the live socket was down. Guarded against
redundant fetches.

**Architecture:** The live push already works: `fetchFeed` broadcasts
`feed-updates-available`, and `src/client/state.ts`'s `onUpdatesAvailable`
handler applies the per-feed counts directly. Phase 3's `poll-now` is the way
to exercise it. This phase adds a `visibilitychange`→visible / window `focus`
handler beside the existing `online` / WS-reconnect re-sync handlers, calling
`State.loadFeedStatus`, with a small in-flight guard so the focus+visibility
pair (and concurrent triggers) don't double-fetch. The WebSocket transport is
retained; "make the push reliable" means verify + add the fallback, not
re-architect the channel.

**Tech Stack:** TypeScript (browser, ES2022 via Vite), Preact +
`@preact/signals`, `@substrate-system/tapzero` in the consolidated browser
bundle (`test/index.ts`).

**Scope:** Phase 4 of 4.

**Codebase verified:** 2026-06-14

**Skills to activate (executor):** `ed3d-house-style:howto-code-in-typescript`,
`ed3d-house-style:programming-in-react`, `superpowers:test-driven-development`,
`ed3d-house-style:writing-good-tests`, `modern-web-guidance` (for
`visibilitychange`/`focus` semantics).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### 040-fix-updates-count.AC4: Live delivery to an open tab + focus fallback
- **040-fix-updates-count.AC4.1 Success:** when discovery inserts items, an
  already-open tab's "N updates" updates without a hard reload
  (`feed-updates-available` received and applied).
- **040-fix-updates-count.AC4.2 Success:** returning to a backgrounded tab
  (`visibilitychange`→visible / `focus`) re-fetches the canonical count.
- **040-fix-updates-count.AC4.3 Edge:** the focus/visibility re-sync is
  guarded against redundant/duplicate fetches.

---

## Verified codebase facts (read before starting)

`src/client/state.ts`, line numbers as of 2026-06-14 (re-confirm before
editing):

- Re-sync handlers live inside the `State()` factory. `handleOnline`
  (998-1009) calls `State.loadFeedStatus(state)` when `state.user.value` is
  set; listeners are registered at 1027-1028:
  ```ts
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  ```
  and removed in `state.cleanup` (1064-1069):
  ```ts
  state.cleanup = () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      State.closeEventStream()
      disposeDocumentTitle()
  }
  ```
- WS reconnect also calls `State.loadFeedStatus(state)` (1488-1492) when a
  reconcile is needed.
- `State.loadFeedStatus(state)` (2410-2450): `GET /api/feed-status`; on success
  `batch()`-updates `state.feedUpdateCounts`, `state.feedSyncStatus`,
  `state.feedSyncError`. **It has NO in-flight/dedup guard** — three concurrent
  callers each fire a request.
- `onUpdatesAvailable(data)` (1396-1442): the `feed-updates-available` handler.
  It applies `feedUpdateCounts` from the message payload directly via `batch()`
  (no reload), filtering to known feeds, and recomputes `feedSyncStatus`. This
  is what makes AC4.1 already work once discovery fires.
- The "N updates" text is rendered by `src/client/components/feed-status.ts`
  from `state.feedUpdateCounts` + `state.displayedFeedSyncStatus`. **Do not
  assert on this DOM text in tests.**
- There is a refcount refresh guard (`trackRefresh` / `acquireRefresh`,
  257-321) for the manual refresh op, but it does NOT wrap `loadFeedStatus`.
  The new handler needs its own small guard.
- Tests:
  - `test/state-auth-storage.ts` (imported by `test/index.ts:19`) tests
    `state.ts` window-event handlers; it stubs `window.addEventListener`
    (capture pattern) and/or dispatches events, and mocks `navigator.onLine`
    via `Object.defineProperty`. **Add the new test here** — no runner wiring.
  - `test/state-refresh-audit.ts` shows the `State.loadFeedStatus` spy pattern
    (replace the method, record calls, restore via `Object.assign(State,
    original)`).

---

<!-- START_TASK_1 -->
### Task 1: Manual verification that the live push reaches an open tab (verify-first)

**Verifies:** 040-fix-updates-count.AC4.1 (verification; code only if broken)

**Files:** none expected (verification step). The push is already wired
(`fetchFeed` broadcast → `onUpdatesAvailable`).

**Steps:**
1. Run the dev server and a worker that fires the alarm/discovery, or use
   Phase 3's `POST /api/dev/poll-now`. Ensure `.dev.vars` port and
   `APP_ORIGIN` match `vite.config.js` (cross-origin POSTs are otherwise 403).
2. Open the app (logged in) so the live WebSocket is connected. Note the
   current "N updates" value.
3. Point a test feed at content with genuinely new items, then
   `POST /api/dev/poll-now`. NOTE: `poll-now` is NOT CSRF-exempt, so a bare
   `curl -X POST` is rejected with 403. Trigger it same-origin from the app's
   own browser console (so the `csrf_token` cookie + `x-csrf-token` header +
   `sec-fetch-site: same-origin` are sent), e.g.
   `fetch('/api/dev/poll-now', { method:'POST', credentials:'same-origin',
   headers:{ 'x-csrf-token': <csrf_token cookie value> } })`; or, with curl,
   pass `--cookie 'csrf_token=...'`, `-H 'x-csrf-token: ...'`, and
   `-H 'sec-fetch-site: same-origin'` matching the cookie.
4. Confirm the "N updates" header increases WITHOUT a page reload.

**If it does NOT update:** debug the broadcast → `onUpdatesAvailable` path and
fix the broadcast (the expected outcome per diagnosis is that it already
works). Only then add a code change + a targeted test. If it works, no code
change for AC4.1.

**Verification:** header count changes live after `poll-now`. Record the
result in the PR description (this AC is human-verified — see
test-requirements.md).

**Commit:** none unless a broadcast fix was required.
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->
<!-- START_TASK_2 -->
### Task 2: Focus/visibility re-sync handler with in-flight guard

**Verifies:** 040-fix-updates-count.AC4.2, .AC4.3

**Files:**
- Modify: `src/client/state.ts` — inside the `State()` factory, beside
  `handleOnline` (after the offline handler, ~1025) and the
  register/cleanup blocks (1027-1028, 1064-1069).

**Implementation:**

Add a guarded handler that re-syncs the canonical count when the tab becomes
visible / regains focus:
```ts
// Re-sync the canonical pending count when the user returns to a
// backgrounded tab. Covers the case where the live socket was down while
// hidden, so feed-updates-available was missed. Guarded so the
// visibilitychange + focus pair (and any concurrent trigger) fire at most
// one in-flight loadFeedStatus.
let resyncInFlight = false
const handleVisibleResync = () => {
    if (document.visibilityState !== 'visible') return
    if (!state.user.value) return
    if (resyncInFlight) return
    resyncInFlight = true
    State.loadFeedStatus(state)
        .catch((err) => {
            debug('focus loadFeedStatus error:', err)
        })
        .finally(() => {
            resyncInFlight = false
        })
}
document.addEventListener('visibilitychange', handleVisibleResync)
window.addEventListener('focus', handleVisibleResync)
```
And in `state.cleanup`:
```ts
document.removeEventListener('visibilitychange', handleVisibleResync)
window.removeEventListener('focus', handleVisibleResync)
```

Notes:
- `visibilitychange` is a `document` event; `focus` is a `window` event. The
  `document.visibilityState !== 'visible'` check makes a stray `focus` while
  hidden a no-op, and means the focus+visibilitychange pair on tab-return only
  produces one fetch (the second sees `resyncInFlight === true`).
- Use the file's existing `debug` logger.
- The guard is synchronous (set before the `await`), so two listeners firing in
  the same tick dedupe correctly.

**Testing:** covered in Task 3.

**Commit:** `feat: re-sync feed count on tab focus/visibility (040 AC4.2/4.3)`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Test the focus/visibility handler

**Verifies:** 040-fix-updates-count.AC4.2, .AC4.3

**Files:**
- Modify: `test/state-auth-storage.ts` (add tests).

**Implementation (test design):**

Construct the app state so the handlers register (same setup the existing
online-handler tests use), with `state.user.value` set to a truthy user. Spy on
`State.loadFeedStatus` using the `state-refresh-audit.ts` pattern (replace the
method with a recorder; restore afterward). Mock visibility with
`Object.defineProperty(document, 'visibilityState', { value: 'visible',
configurable: true })`.

- **AC4.2:** with `visibilityState` = 'visible' and a user present, dispatch the
  re-sync trigger (either call the captured `visibilitychange`/`focus` listener
  directly, or `document.dispatchEvent(new Event('visibilitychange'))` /
  `window.dispatchEvent(new Event('focus'))`); assert `State.loadFeedStatus`
  was called.
- **AC4.3 (dedup):** make the `loadFeedStatus` spy return a pending
  (unresolved) promise, then fire BOTH `focus` and `visibilitychange` in the
  same tick; assert `loadFeedStatus` was called exactly ONCE (in-flight guard).
  Optionally, resolve the promise and fire again to confirm a later return
  re-syncs (guard resets on settle).
- Guard with no user: with `state.user.value` null, firing the event does NOT
  call `loadFeedStatus`.
- (Optional) Confirm `state.cleanup()` removes the listeners (mirror the
  existing online/offline cleanup assertion if that file has one).

Do NOT assert on DOM text. `document` is shared across the whole consolidated
`test/index.ts` browser bundle, so restore EVERY patched global in a `finally`:
`State.loadFeedStatus` (via `Object.assign(State, original)`), the captured
event listeners, and — critically — `document.visibilityState`. Capture its
original property descriptor before overriding (or `delete
document.visibilityState` to drop the own-property override) and restore it in
`finally`, so neighbouring browser tests that read `visibilityState` see the
real value rather than the test's pinned `'visible'`.

**Verification:** run the consolidated browser bundle (or, faster, a temporary
standalone bundle of `state-auth-storage.ts`) and confirm the new assertions
pass with no `console.error`:
```bash
esbuild ./test/state-auth-storage.ts --bundle \
  --loader:.css=text --loader:.wasm=dataurl \
  --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts \
  --alias:@sentry/cloudflare=./test/sentry-cloudflare-stub.ts | tapout
```
(The authoritative run is `npm test`, which includes this file via
`test/index.ts`.)

**Commit:** `test: focus/visibility feed-count re-sync + dedup (040 AC4.2/4.3)`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

---

## Phase Done When

- Manual verification confirms `poll-now` updates an open tab's "N updates"
  without reload (AC4.1); any broadcast fix only if verification failed.
- The focus/visibility handler re-syncs the count on tab return and is
  deduped against the focus+visibility pair; listeners are cleaned up.
- New tests in `test/state-auth-storage.ts` pass.
- `npm test && npm run lint` is green.

**Covers:** 040-fix-updates-count.AC4.1, .AC4.2, .AC4.3
