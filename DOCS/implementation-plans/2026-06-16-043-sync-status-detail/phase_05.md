# Sync Status Detail (`/sync-status`) — Phase 5

**Goal:** The two labeled failed-feed sections — "Feeds that couldn't fetch"
(Retry fetch + Unsubscribe) and "Feeds that couldn't share to Bluesky" (Retry
share + Unsubscribe, with a re-auth affordance for `reauth_required`) — with
inline-confirm Unsubscribe, offline-gated server actions, and a follow-up
sync/reload so retried rows clear.

**Codebase verified:** 2026-06-18 (via codebase-investigator).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### sync-status-detail.AC3: Failed feeds are listed and partitioned (rendering)
- **sync-status-detail.AC3.1 Success:** A feed with `last_error` (or
  `last_status >= 400`) appears under "Feeds that couldn't fetch".
- **sync-status-detail.AC3.2 Success:** A feed with `publish_error` appears under
  "Feeds that couldn't share to Bluesky".
- **sync-status-detail.AC3.3 Edge:** A feed with both a fetch error and a publish
  error appears in both sections.
- **sync-status-detail.AC3.4 Edge:** A feed with no error appears in neither
  section.
- **sync-status-detail.AC3.5 Edge:** An empty feed-failure section is omitted.

### sync-status-detail.AC8: Inline confirmation for destructive actions
- **sync-status-detail.AC8.3 Success:** Clicking Unsubscribe reveals an inline
  confirm before the feed is removed.

### sync-status-detail.AC10: Publish failures and re-authentication
- **sync-status-detail.AC10.1 Success:** Retry share calls
  `toggleFeedPublished(…, true)`; on success the feed leaves the publish-failed
  section.
- **sync-status-detail.AC10.2 Success:** When `publish_error === 'reauth_required'`,
  the row shows a re-authentication affordance instead of a plain Retry.
- **sync-status-detail.AC10.3 Failure:** A retry-share that fails leaves the feed
  in the publish-failed section with refreshed error text.

### sync-status-detail.AC11: Offline behavior
- **sync-status-detail.AC11.1 Success:** While offline, server-dependent actions
  (Retry fetch, Retry share) are disabled.
- **sync-status-detail.AC11.2 Success:** While offline, local-only Discard
  remains enabled.

---

## Verified codebase facts (read before implementing)

- Partition predicates (Phase 1, `sync-status-format.ts`):
  `isFetchFailed(feed)` and `isPublishFailed(feed)`. A feed satisfying both
  appears in both sections (AC3.3).
- `State.refreshFeed(state, feedId:string):Promise<void>` → `POST
  /api/feeds/:id/refresh` (server re-fetch). Pass `String(feed.id)`.
- `State.toggleFeedPublished(state, feedId:number, publish:boolean):Promise<void>`
  → `POST /api/feeds/:id/publish` when `publish` is true. On success it clears
  the feed's `publish_error`; on failure it records an error. Pass
  `(state, feed.id, true)` for Retry share.
- `State.deleteFeed(state, feedId:number):Promise<{ success:boolean;
  error?:string }>` — delegates to `adapter.deleteFeed` (which enqueues the
  `delete_feed` outbox op, local-first) and reloads `state.feeds` etc. Use
  `feed.id` (number) for Unsubscribe. It is local-first, so it remains usable
  offline.
- **`publish_error` persisted values are codes:** the server stores the literal
  `'reauth_required'` (auth failure) or `'pds_write_failed'` (other PDS write
  failure) into `feeds.publish_error`, or `NULL` on success; pull-sync mirrors
  the column to the client `Feed.publish_error`. So `feed.publish_error ===
  'reauth_required'` is a real, reachable client state (AC10.2).
- **Re-auth mechanism:** on auth expiry the app routes to `/login`
  (`state._setRoute('/login')`), and `State.login` → OAuth. The re-auth
  affordance is therefore **navigation** → an `<a href="/login">` (project rule:
  links, not buttons, for navigation; route-event handles the click globally).
- **Offline:** there is NO dedicated offline signal. Offline is
  `syncStatus.value === 'offline'` (reactive; the offline event handler sets it).
  Use that to gate server actions.
- **Follow-up sync/reload:** after a server round-trip retry, the updated feed
  row reaches the local DB only via pull-sync. Per the design data-flow, a retry
  must trigger a follow-up sync + reload so the row clears (or refreshes its
  error). Kick `runSync(db)` (db via `getBootstrappedDb() ?? getLocalDb(did)`),
  then `loadSyncStatus(state)`.
- Confirm machine (Phase 4): `confirmingKey` signal in `sync-status-state.ts`;
  Phase 5 uses key `'feed:' + feed.id`. Announcement + focus rules from Phase 4
  apply identically.
- There is no AC asserting Retry-fetch clears the row; only Retry-share has a
  success AC (AC10.1). Keep the fetch retry simple (dispatch + reload).

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: "Feeds that couldn't fetch" section

**Verifies:** sync-status-detail.AC3.1, sync-status-detail.AC3.4 (rendering),
sync-status-detail.AC3.5, sync-status-detail.AC8.3

**Files:**
- Modify: `src/client/routes/sync-status.ts`
- Modify: `src/client/routes/sync-status.css`
- Test: `test/sync-status-feeds.ts` (new browser test; wire into
  `test/browser-tests.ts`)

**Implementation:**
- Compute `fetchFeeds = failedFeeds.value.filter(isFetchFailed)`.
- Render a "Feeds that couldn't fetch" section ONLY when `fetchFeeds.length > 0`
  (AC3.5). Stable hooks: `class="sync-status-section feeds-fetch-failed"`, a
  focusable `<h2 tabindex="-1">`, list rows `class="failed-feed"`
  `key=${feed.id}`. Each row shows the feed name (`feed.title` falling back to
  `feed.url`) and the fetch error (`feed.last_error` / `feed.last_status`).
- Row actions:
  - **Retry fetch** (`<button>`): on click call
    `State.refreshFeed(state, String(feed.id))`, then trigger the follow-up
    sync + `loadSyncStatus(state)`; announce once + focus per Phase 4 rules.
    `disabled` when `syncStatus.value === 'offline'` (AC11.1).
  - **Unsubscribe** (`<button>`): reuses the inline-confirm machine with key
    `'feed:' + feed.id` (Task 3). NOT disabled offline (local-first).

**Testing (browser):**
- sync-status-detail.AC3.1: seed `failedFeeds` with a feed having `last_error`
  set (and separately one with `last_status = 500`) → it renders under
  `.feeds-fetch-failed`.
- sync-status-detail.AC3.4: a clean feed is never in `failedFeeds` (Phase 1) and
  does not render. (Guard: a feed with `last_status = 200` is not in this
  section.)
- sync-status-detail.AC3.5: `fetchFeeds` empty → no `.feeds-fetch-failed`
  section.
- Retry fetch dispatches `State.refreshFeed` with `String(feed.id)` (stub the
  method).

**Verification:** `npm run test:browser`; `npm run lint`.

**Commit:** `feat: render feeds-that-couldnt-fetch section on /sync-status`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: "Feeds that couldn't share to Bluesky" section + reauth

**Verifies:** sync-status-detail.AC3.2, sync-status-detail.AC3.3,
sync-status-detail.AC3.5, sync-status-detail.AC10.1, sync-status-detail.AC10.2,
sync-status-detail.AC10.3

**Files:**
- Modify: `src/client/routes/sync-status.ts`
- Modify: `src/client/routes/sync-status.css`
- Test: `test/sync-status-feeds.ts` (extend)

**Implementation:**
- Compute `publishFeeds = failedFeeds.value.filter(isPublishFailed)`.
- Render a "Feeds that couldn't share to Bluesky" section ONLY when
  `publishFeeds.length > 0` (AC3.5). Stable hooks:
  `class="sync-status-section feeds-publish-failed"`, focusable `<h2>`, rows
  `class="failed-feed"` `key=${feed.id}` showing the feed name and the publish
  error (`feed.publish_error`).
- Row actions:
  - When `feed.publish_error === 'reauth_required'` (AC10.2): render a re-auth
    affordance — `<a href="/login">` (navigation; stable hook e.g.
    `class="reauth-link"`) — INSTEAD OF the Retry-share button.
  - Otherwise: **Retry share** (`<button>`): on click call
    `State.toggleFeedPublished(state, feed.id, true)`, then trigger the
    follow-up sync + `loadSyncStatus(state)`; announce once + focus per Phase 4.
    `disabled` when `syncStatus.value === 'offline'` (AC11.1).
  - **Unsubscribe** (`<button>`): inline-confirm machine, key `'feed:' +
    feed.id` (Task 3). Not disabled offline.
- A feed in BOTH `fetchFeeds` and `publishFeeds` renders a row in each section
  (AC3.3) — the two `filter`s are independent.

**Testing (browser):**
- sync-status-detail.AC3.2: a feed with `publish_error = 'pds_write_failed'`
  renders under `.feeds-publish-failed`.
- sync-status-detail.AC3.3: a feed with BOTH `last_error` and `publish_error`
  renders one `.failed-feed` under `.feeds-fetch-failed` AND one under
  `.feeds-publish-failed`.
- sync-status-detail.AC10.2: a feed with `publish_error = 'reauth_required'`
  renders the `.reauth-link` (`<a href="/login">`) and NO Retry-share button.
- sync-status-detail.AC10.1: stub `State.toggleFeedPublished` to simulate success
  by clearing that feed from `failedFeeds.value` (the synced-reload outcome);
  assert it is called with `(state, feed.id, true)` and the row leaves the
  publish section.
- sync-status-detail.AC10.3: stub `State.toggleFeedPublished` to simulate failure
  by updating that feed's `publish_error` in `failedFeeds.value`; assert the row
  stays in the publish section with the refreshed error value. (Stub/own
  `loadSyncStatus` in the test so the simulated signal state is what renders.)

**Verification:** `npm run test:browser`; `npm run lint`.

**Commit:** `feat: render feeds-that-couldnt-share section + reauth on
/sync-status`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Unsubscribe inline confirm + offline gating

**Verifies:** sync-status-detail.AC8.3, sync-status-detail.AC11.1,
sync-status-detail.AC11.2

**Files:**
- Modify: `src/client/routes/sync-status.ts`
- Modify: `src/client/routes/sync-status.css`
- Test: `test/sync-status-feeds.ts` (extend)

**Implementation:**
- **Unsubscribe** reuses the Phase 4 inline-confirm machine: clicking
  Unsubscribe sets `confirmingKey.value = 'feed:' + feed.id` (reveals the
  confirm; the feed is NOT removed yet — AC8.3). The confirm shows Cancel
  (default-focused; clears `confirmingKey`) and a danger commit that calls
  `State.deleteFeed(state, feed.id)`, then `loadSyncStatus(state)`, then clears
  `confirmingKey`, announces once, and moves focus per the Phase 4 rule.
- **Offline gating:** derive `offline = syncStatus.value === 'offline'`. Set
  `disabled=${offline}` on Retry-fetch and Retry-share buttons (AC11.1). Do NOT
  disable Unsubscribe or the dead-letter Discard (local-first / local-only —
  AC11.2).

**Testing (browser):**
- sync-status-detail.AC8.3: clicking a feed's Unsubscribe renders the inline
  confirm for that feed; `State.deleteFeed` is NOT called yet and the feed is
  still present. Confirming calls `State.deleteFeed(state, feed.id)`; cancelling
  clears the confirm without calling it.
- sync-status-detail.AC11.1: with `syncStatus='offline'`, the Retry-fetch and
  Retry-share buttons are `disabled`.
- sync-status-detail.AC11.2: with `syncStatus='offline'` and a dead-letter row
  also seeded, the dead-letter Discard button (Phase 4) is NOT disabled (and the
  feed Unsubscribe button is not disabled either).

**Verification:** `npm run test:browser`; `npm run lint`.

**Commit:** `feat: unsubscribe inline confirm + offline gating on /sync-status`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

---

**Done when:** both failed-feed sections render and partition correctly (AC3),
each empty section is omitted (AC3.5), Retry fetch/share dispatch the right
methods with a follow-up sync/reload, `reauth_required` shows a `/login` re-auth
link instead of Retry (AC10.2), a failed retry-share keeps the row with
refreshed error (AC10.3), Unsubscribe requires an inline confirm (AC8.3), and
server actions are disabled offline while Discard/Unsubscribe stay enabled
(AC11). Tests pass; `npm run lint` clean.
