# Test Requirements — fix-silent-update-gap

Generated: 2026-05-27
Source design: /Users/nick/code/rsss/DOCS/design-plans/2026-05-27-fix-silent-update-gap.md
Source plan:   /Users/nick/code/rsss/DOCS/implementation-plans/2026-05-27-fix-silent-update-gap/

---

## AC1: Background-sync activity is observable in the header dot

### fix-silent-update-gap.AC1.1: addFeed -> refreshInProgress=true synchronously before POST returns
- **Type:** Automated unit test
- **Test file:** /Users/nick/code/rsss/test/add-feed-acquire.ts
- **Test case:** Test case #1 in Task 4 of phase_04 ("AC1.1: acquire is synchronous (signal `true` before POST resolves)") — stubs `adapter.addFeed` with a never-resolving Promise, calls `State.addFeed(state, url)` without awaiting, asserts `state.refreshInProgress.value === true` immediately.
- **Verifies:** `trackRefresh` acquires the refcount synchronously before the POST is awaited, so the raw signal is `true` before `addFeed` returns.

### fix-silent-update-gap.AC1.2: SSE feed-updates-available with added feedId -> refreshInProgress=false
- **Type:** Automated unit test
- **Test file:** /Users/nick/code/rsss/test/add-feed-acquire.ts
- **Test case:** Test case #2 in Task 4 of phase_04 ("AC1.2: SSE event releases the acquire") — fires SSE `feed-updates-available` with `{ feedUpdateCounts: { '42': 3 } }` after `_pendingAddFeedAcquires` contains `42`; asserts `refreshInProgress.value === false` once the addFeed Promise settles.
- **Verifies:** The augmented SSE handler's `drainAddFeedAcquires` call releases the pending acquire for the matching feed id.

### fix-silent-update-gap.AC1.3: SSE feed-updated debounced handler fires -> refreshInProgress=true for duration of refreshAfterSync
- **Type:** Automated unit test
- **Test file:** /Users/nick/code/rsss/test/background-sync-acquire.ts
- **Test case:** Group A test case #1 in Task 3 of phase_05 ("`feed-updated` fires -> debounce elapses -> refreshAfterSync runs under trackRefresh") — fires `feed-updated` on the `StubEventSource`, waits past `SSE_REFRESH_DEBOUNCE_MS`, asserts `refreshInProgress.value === true`, waits for the stubbed `refreshAfterSync` to finish, then asserts `refreshInProgress.value === false`.
- **Verifies:** The SSE `feed-updated` debounce body wraps `State.refreshAfterSync` in `trackRefresh(state, 'sse-feed-updated', ...)` such that the raw signal is held for the call's duration.

### fix-silent-update-gap.AC1.4: online event -> refreshInProgress=true for duration of runSync + refreshAfterSync
- **Type:** Automated unit test
- **Test file:** /Users/nick/code/rsss/test/background-sync-acquire.ts
- **Test case:** Group B test case #4 in Task 3 of phase_05 ("`_onlineRecoverySyncForTest` acquires + releases") — invokes the exported `_onlineRecoverySyncForTest(state)` with stubbed `runSync` and `refreshAfterSync`, asserts `refreshInProgress.value === true` after microtask and `false` after settle.
- **Verifies:** `handleOnline`'s `runSync` + `refreshAfterSync` chain is wrapped in `trackRefresh(state, 'online-recovery', ...)`.

### fix-silent-update-gap.AC1.5: addFeed acquire force-releases after RESOLVE_WINDOW_MS+CLIENT_GRACE_MS (35s)
- **Type:** Automated unit test
- **Test file:** /Users/nick/code/rsss/test/add-feed-acquire.ts
- **Test case:** Test case #3 in Task 4 of phase_04 ("AC1.5: hard-timeout force-release") — calls `_setAddFeedHardTimeoutForTest(50)` to shrink the timeout, invokes `State.addFeed` without firing SSE, waits past the timeout, asserts `refreshInProgress.value === false` and `_pendingAddFeedAcquires.size === 0`.
- **Verifies:** `waitForAddFeedRelease`'s hard-timeout fallback fires after `_addFeedHardTimeoutMs` (production: `RESOLVE_WINDOW_MS + CLIENT_GRACE_MS` = 35s) so the acquire never leaks.

---

## AC2: Debounce and minimum-visible behavior of displayedRefreshInProgress

### fix-silent-update-gap.AC2.1: raw stays true for SHOW_DELAY_MS (300ms) -> displayed becomes true
- **Type:** Automated unit test
- **Test file:** /Users/nick/code/rsss/test/displayed-refresh-in-progress.ts
- **Test case:** Case AC2.1 in Task 3 of phase_03 ("raw stays true past show-delay -> displayed becomes true") — sets `raw.value = true`, asserts `displayedRefreshInProgress.value === false` at 50ms, asserts `=== true` after `SHOW_DELAY_MS + 50` ms.
- **Verifies:** The PENDING_SHOW -> SHOWN_MIN_VISIBLE transition fires only after the 300ms show-delay elapses.

### fix-silent-update-gap.AC2.2: raw flips true->false before SHOW_DELAY_MS -> displayed never true (no flicker)
- **Type:** Automated unit test
- **Test file:** /Users/nick/code/rsss/test/displayed-refresh-in-progress.ts
- **Test case:** Case AC2.2 in Task 3 of phase_03 ("raw flips `true -> false` before show-delay -> displayed never becomes `true`") — sets `raw.value = true`, after ~100ms sets `raw.value = false`, waits past 350ms total, asserts `displayedRefreshInProgress.value === false`.
- **Verifies:** PENDING_SHOW -> IDLE transition cancels the show-timer so the displayed signal never latches `true` for fast operations.

### fix-silent-update-gap.AC2.3: displayed stays true for MIN_VISIBLE_MS (500ms) even if raw clears sooner
- **Type:** Automated unit test
- **Test file:** /Users/nick/code/rsss/test/displayed-refresh-in-progress.ts
- **Test case:** Case AC2.3 in Task 3 of phase_03 ("once displayed becomes `true`, it stays `true` for at least `MIN_VISIBLE_MS` even if raw clears sooner") — clears `raw` partway into the min-visible window and verifies `displayedRefreshInProgress.value === true` is held until the min-visible window expires (~850ms total).
- **Verifies:** SHOWN_MIN_VISIBLE -> SHOWN_MIN_PENDING_CLEAR transition holds the displayed signal `true` until `MIN_VISIBLE_MS` elapses.

### fix-silent-update-gap.AC2.4: raw re-acquires inside min-visible window -> displayed stays continuously true (no gap)
- **Type:** Automated unit test
- **Test file:** /Users/nick/code/rsss/test/displayed-refresh-in-progress.ts
- **Test case:** Case AC2.4 in Task 3 of phase_03 ("raw re-acquires inside the min-visible window -> displayed stays continuously `true`") — toggles `raw` false then true inside the min-visible window, asserts displayed remains `true` continuously past min-visible expiry, then clears displayed when raw finally clears post-min-visible.
- **Verifies:** SHOWN_MIN_PENDING_CLEAR -> SHOWN_MIN_VISIBLE re-arm transition keeps displayed continuously `true` with no observable gap.

---

## AC3: Refcount safety

### fix-silent-update-gap.AC3.1: two concurrent trackRefresh calls both acquire; raw stays true until both settle
- **Type:** Automated unit test
- **Test files:**
  - /Users/nick/code/rsss/test/refresh-refcount.ts
  - /Users/nick/code/rsss/test/track-refresh.ts
- **Test case:** Test case #2 in Task 3 of phase_01 ("Two concurrent acquires keep the signal true until both release") — exercises the underlying refcount via `_acquireRefreshForTest` / `_releaseRefreshForTest`. Also test case #5 in Task 2 of phase_02 ("concurrent `trackRefresh` calls keep signal `true` until both settle") — two deferred promises wrapped in `trackRefresh` calls, asserts signal stays `true` until both settle.
- **Verifies:** The module-private refcount keeps `refreshInProgress` `true` until every outstanding `trackRefresh` (or direct `acquire`) has released.

### fix-silent-update-gap.AC3.2: extra releaseRefresh does not underflow; does not toggle signal back to true on next acquire
- **Type:** Automated unit test
- **Test file:** /Users/nick/code/rsss/test/refresh-refcount.ts
- **Test case:** Test case #3 in Task 3 of phase_01 ("Extra release is a no-op (no underflow)") — acquires once, releases twice, then acquires again; asserts the signal transitions from `false -> true` on the third acquire (proving the counter did not go negative).
- **Verifies:** `releaseRefresh`'s bounded-at-zero guard prevents counter underflow and preserves correct acquire-toggle semantics.

---

## AC4: Failure surfaces as red

### fix-silent-update-gap.AC4.1: trackRefresh fn rejects -> feedSyncStatus='error' in same batch as release
- **Type:** Automated unit test
- **Test files:**
  - /Users/nick/code/rsss/test/track-refresh.ts
  - /Users/nick/code/rsss/test/add-feed-acquire.ts
  - /Users/nick/code/rsss/test/resolve-convergence-trackrefresh.ts
  - /Users/nick/code/rsss/test/background-sync-acquire.ts
- **Test case:**
  - Test case #2 in Task 2 of phase_02 ("Reject path: AC4.1 — release + `'error'` in same batch") — subscribes to `displayedFeedSyncStatus` via `effect`, asserts the observed sequence is exactly `['syncing', 'error']` with no intermediate `'synced'`/`'inactive'` frame.
  - Test case #5 in Task 4 of phase_04 ("AC4.1 (addFeed branch): non-409 error -> red") — exercises the addFeed call site.
  - Test case #2 in Task 5 of phase_04 ("Failure path -> red") — exercises the resolve-convergence call site.
  - Group A test case #3 ("`refreshAfterSync` rejects -> red") and Group B test case #5 ("`runSync` rejects -> red") in Task 3 of phase_05 — exercise the SSE and online-recovery call sites.
- **Verifies:** `trackRefresh`'s catch block uses `batch()` to coalesce the release and the `feedSyncStatus = 'error'` write so the computed `displayedFeedSyncStatus` transitions directly from `'syncing'` to `'error'` with no intermediate state, for every wired call site.

### fix-silent-update-gap.AC4.2: trackRefresh fn resolves -> feedSyncStatus not modified by helper
- **Type:** Automated unit test
- **Test file:** /Users/nick/code/rsss/test/track-refresh.ts
- **Test case:** Test case #1 in Task 2 of phase_02 ("Resolve path holds signal `true` for the duration and releases on settle") and test case #4 ("Resolve path: `feedSyncStatus` is NOT touched") — primes `feedSyncStatus` to `'updates'`, calls `trackRefresh` with a resolving `fn`, asserts post-state is still `'updates'`.
- **Verifies:** The helper's success path runs `releaseRefresh(state)` alone and never writes `feedSyncStatus`.

---

## AC5: Visual contract preserved

### fix-silent-update-gap.AC5.1: displayedFeedSyncStatus returns 'syncing' whenever displayedRefreshInProgress=true
- **Type:** Automated unit test
- **Test file:** /Users/nick/code/rsss/test/displayed-refresh-in-progress.ts
- **Test case:** Covered by the assertions in Cases AC2.1, AC2.3, and AC2.4 in Task 3 of phase_03 — each case asserts on `displayedRefreshInProgress.value` while the raw signal drives the underlying state machine. Task 2 of phase_03 ("Wire `displayedFeedSyncStatus` through the derived signal") rewires the computed to read `displayedRefreshInProgress.value`, so any test that asserts `displayedRefreshInProgress.value === true` transitively asserts `displayedFeedSyncStatus === 'syncing'` via the unchanged computed body.
- **Verifies:** The computed `displayedFeedSyncStatus` reads the new derived signal in its `true` branch, preserving the existing UI binding semantics.

### fix-silent-update-gap.AC5.2: end-state for successful add-feed is unchanged (blue + "X updates")
- **Type:** Automated unit test
- **Test file:** /Users/nick/code/rsss/test/add-feed-acquire.ts
- **Test case:** Test case #6 in Task 4 of phase_04 ("AC5.2: end-state transition yellow -> blue+\"X updates\" has no intermediate `'inactive'` / `'synced'` frame") — primes `feedSyncStatus = 'inactive'`, runs the full add-feed flow against a stubbed adapter and SSE event with `{ feedUpdateCounts: { '42': 3 } }`, records observed `displayedFeedSyncStatus` values via `effect`, asserts the final value is `'updates'` and the de-duplicated sequence contains no `'inactive'`/`'synced'` after the first `'syncing'`.
- **Verifies:** Successful add-feed end-state is unchanged from before this design — the dot transitions yellow -> blue with `'X updates'` text and no intermediate frame.

---

## Human verification

These manual sanity steps appear in the Phase Completion Checklists of phase_04.md and phase_05.md. They complement the automated coverage above and are not the primary verification path for any AC, but should be performed before release.

### Categorized by AC

- **AC1.1 / AC1.2 / AC1.5 (and AC2.x / AC5.2 visual end-to-end):**
  - From phase_04.md completion checklist: "In dev, click 'Add feed' with a real URL. Dot turns yellow within ~300 ms of the click, stays yellow until items become available (SSE arrival OR ~35 s timeout), then transitions to blue + 'X updates' if the resolve produced items, or back to its previous state if not. No flicker."

- **AC1.4 (online recovery):**
  - From phase_05.md completion checklist: "In dev, with the network throttled or via dev-tools 'offline -> online' toggle, the dot turns yellow during the online-recovery sync."

- **AC1.3 (SSE feed-updated):**
  - From phase_05.md completion checklist: "Receive a server-side `feed-updated` event (manually inserted via the SSE stream, or by triggering server-side polling): dot turns yellow during the resulting refreshAfterSync."

- **AC3.x / regression check for existing manual-refresh flow:**
  - From phase_01.md completion checklist: "Manual refresh flow behaves identically to today (no UI changes, no flicker, no missing 'updating…' state during manual refresh). If the test suite covers this, automated verification suffices; otherwise spot-check by running the dev server and clicking the Refresh button."
