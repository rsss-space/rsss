# Human Test Plan: fix-silent-update-gap

Generated from automated test coverage analysis at HEAD `70df2dc`.

## Prerequisites

- Cloudflare dev environment with `npm run dev` running.
- Authenticated session (real DID, OPFS-SQLite available).
- DevTools open with Network, Console, and Application > Service Workers visible.
- A throwaway test feed URL that returns valid RSS (for example
  `https://news.ycombinator.com/rss`).
- A throwaway URL that is expected to be slow to resolve (or use DevTools
  network throttling).
- A test feed URL that is invalid (returns 500 or non-RSS HTML) for the
  failure path.
- `npm test && npm run lint` passing in CI.

## Phase 1: Header dot during add-feed (AC1.1 / AC1.2 / AC1.5 / AC2.x / AC5.2)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Log in, navigate to `/`. Note current header dot color and tooltip text. | Dot is blue/gray (`'inactive'` or `'synced'`) before any action. |
| 2 | Click "Add feed", enter the test RSS URL, submit. | Within roughly 300 ms of submit, the dot turns yellow (`syncing`). |
| 3 | Hold the cursor on the dot while it is yellow. | Tooltip indicates "syncing" / "updating" — confirms `displayedFeedSyncStatus === 'syncing'`. |
| 4 | Wait for the feed to resolve (server delivers SSE `feed-updates-available` with the new feedId). | Dot transitions yellow -> blue with `"X updates"` text. There is no intermediate gray (`inactive`) or green (`synced`) flash. |
| 5 | Submit a second add-feed for a slow-resolving URL (or throttle network to 3G) and start a stopwatch. Do not let the SSE arrive. | Dot stays yellow continuously. After ~35 seconds (RESOLVE_WINDOW_MS + CLIENT_GRACE_MS), the dot returns to its previous color without a stuck "syncing" state. |
| 6 | Submit an add-feed for a URL that already exists in the feed list. | The 409 short-circuit fires: dot does not get stuck at yellow, no red flash. |

## Phase 2: Debounce + min-visible (AC2.1 / AC2.2 / AC2.3 / AC2.4)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open DevTools console. Use `state.refreshInProgress.value = true` then immediately (within ~100 ms) `state.refreshInProgress.value = false`. | Dot never becomes yellow — fast operations under 300 ms are hidden. |
| 2 | Set `state.refreshInProgress.value = true`, wait 400 ms, then set `false`. Start a stopwatch when you set false. | Dot remains yellow for at least 500 ms after you clear the signal (MIN_VISIBLE_MS hold). |
| 3 | Set `state.refreshInProgress.value = true`, wait 400 ms, set `false`, wait 200 ms, set `true` again. | Dot stays continuously yellow — no flicker to non-yellow between the toggles. |

Note: in production `refreshInProgress` is now `ReadonlySignal<boolean>` — direct writes are a TypeScript error. For console testing, invoke the test-only helpers `_acquireRefreshForTest(state)` and `_releaseRefreshForTest(state)` from the dev console (they are exported from `src/client/state.ts`).

## Phase 3: SSE feed-updated background sync (AC1.3)

| Step | Action | Expected |
|------|--------|----------|
| 1 | With the app open and idle (dot blue/gray), trigger a server-side `feed-updated` SSE — either by waiting for background polling on a low-poll feed, or by injecting the event in DevTools via the SSE stream. | After ~250 ms debounce, the dot turns yellow while the client runs `refreshAfterSync`. |
| 2 | Wait for `refreshAfterSync` to complete. | Dot returns to its prior state (blue or "X updates") with no error. |
| 3 | Rapidly fire 3+ `feed-updated` events within 250 ms. | Only one yellow -> non-yellow cycle is observed (debounce coalesces). |

## Phase 4: Online recovery (AC1.4)

| Step | Action | Expected |
|------|--------|----------|
| 1 | In DevTools Network tab, set throttling to "Offline". Wait 5 seconds. | App detects offline; no yellow during the offline period (no sync attempts). |
| 2 | Switch throttling back to "Online". | Within a few hundred ms the dot turns yellow as `handleOnline` runs `runSync` + `refreshAfterSync`. |
| 3 | Wait for the online recovery cycle to complete. | Dot returns to blue/gray; no leftover yellow, no error unless network truly failed. |

## Phase 5: Failure surfaces as red (AC4.1)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Submit add-feed using an invalid URL that returns HTTP 500 or non-RSS HTML. | Dot turns yellow briefly, then transitions directly to red (`'error'`). |
| 2 | Observe the transition carefully (use slow-motion screen recording if needed). | No intermediate green (`synced`) or gray (`inactive`) frame between yellow and red. |
| 3 | Trigger an online-recovery sync (Phase 4) while the server-side `runSync` is forced to fail (for example revoke session or break creds). | Dot goes yellow -> red, not yellow -> blue. |

## End-to-End: Add-feed happy path

**Purpose:** Validate AC1.1, AC1.2, AC2.x, AC4.2, AC5.2 together — the design's core user-visible promise.

**Steps:**
1. Start from a quiescent app (blue/gray dot).
2. Add a real feed.
3. Confirm yellow appears within 300 ms.
4. Confirm yellow persists for at least 500 ms (no flicker).
5. Confirm yellow holds continuously until the new items arrive via SSE.
6. Confirm transition straight to blue + "X updates" — never green/gray in between.
7. Refresh the page; the new feed and its unread count persist (sanity).

## End-to-End: Slow resolve with timeout

**Purpose:** Validate AC1.5 — the hard timeout prevents a stuck indicator.

**Steps:**
1. Throttle the network heavily (or use a known-slow feed source).
2. Add the feed.
3. Confirm yellow appears.
4. Time the yellow duration: it must not exceed ~35 seconds (RESOLVE_WINDOW_MS + CLIENT_GRACE_MS) regardless of whether SSE arrives.
5. Confirm dot returns to prior color (or red if convergence failed); never stuck yellow.

## Manual Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC1.1 / AC1.2 / AC1.5 visual end-to-end | Tests assert signal values; humans assess perceptual smoothness ("no flicker", "no stuck yellow"). | Run Phase 1 steps 1-5 in dev; visually confirm transitions. |
| AC1.3 SSE feed-updated visible feedback | Server-side SSE wiring exists outside the JS state machine; verify the dot reflects real server events. | Run Phase 3 with real server polling or manual SSE injection. |
| AC1.4 online-recovery visual feedback | DOM event `online` is browser-native and not exercised in CI; needs real toggling. | Run Phase 4 with DevTools network throttling. |
| Manual-refresh flow regression (AC3 sanity) | The "Refresh" button path was not changed but should be regression-tested. | Click Refresh in toolbar; confirm dot turns yellow, holds visible, returns to non-yellow with correct count. |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | `test/add-feed-acquire.ts` ("AC1.1: acquire is synchronous") | Phase 1 step 2 |
| AC1.2 | `test/add-feed-acquire.ts` ("AC1.2: SSE event releases the acquire") | Phase 1 step 4 |
| AC1.3 | `test/background-sync-acquire.ts` (Group A tests) | Phase 3 |
| AC1.4 | `test/background-sync-acquire.ts` ("AC1.4.1: _onlineRecoverySyncForTest...") | Phase 4 |
| AC1.5 | `test/add-feed-acquire.ts` ("AC1.5: hard-timeout force-release") | Phase 1 step 5; End-to-End slow resolve |
| AC2.1 | `test/displayed-refresh-in-progress.ts` ("AC2.1") | Phase 2 step 1 |
| AC2.2 | `test/displayed-refresh-in-progress.ts` ("AC2.2") | Phase 2 step 1 |
| AC2.3 | `test/displayed-refresh-in-progress.ts` ("AC2.3") | Phase 2 step 2 |
| AC2.4 | `test/displayed-refresh-in-progress.ts` ("AC2.4") | Phase 2 step 3 |
| AC3.1 | `test/refresh-refcount.ts` ("AC3.1") + `test/track-refresh.ts` ("AC3.1") | Implicitly via Phase 1 / Phase 5 (concurrent flows) |
| AC3.2 | `test/refresh-refcount.ts` ("AC3.2") | (None — internal invariant) |
| AC4.1 | `test/track-refresh.ts` ("AC4.1") + add-feed-acquire.ts + resolve-convergence-trackrefresh.ts + background-sync-acquire.ts | Phase 5 |
| AC4.2 | `test/track-refresh.ts` ("AC4.2 corollary") | Phase 1 step 4 (no spurious status writes during happy path) |
| AC5.1 | `test/displayed-refresh-in-progress.ts` (transitively via AC2.x) | Phase 1 step 3 (tooltip / class assertion) |
| AC5.2 | `test/add-feed-acquire.ts` ("AC5.2: end-state transition") | Phase 1 step 4; End-to-End happy path step 6 |
