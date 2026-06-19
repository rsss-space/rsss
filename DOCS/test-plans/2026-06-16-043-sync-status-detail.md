# Test Plan — sync-status-detail (`/sync-status`)

Implementation plan:
`DOCS/implementation-plans/2026-06-16-043-sync-status-detail/`

Coverage validation: **PASS** — 41/41 automated acceptance criteria
covered, 0 missing. Gate evidence: `npm run test:browser` (exit 0, `# ok`,
1287 tests), `npm run lint` (exit 0).

## Prerequisites

- Build the client and run the app locally (`wrangler dev` per project
  setup); keep `vite.config.js` port and `APP_ORIGIN` in `.dev.vars` in
  sync.
- Sign in as an entitled, local-first-active user (the sync indicator only
  links when `isLocalFirstActive` and billing are active).
- Automated gate green before manual testing: `npm run test:browser`
  (exit 0, `# ok`, 1287 tests) and `npm run lint` (exit 0).
- A macOS VoiceOver (or NVDA on Windows) screen reader available for the
  a11y items.
- Ability to drive a feed into error states (a feed URL that 5xx/404s, and
  a way to expire/revoke the Bluesky session token for the re-auth
  round-trip).

## Phase 1: Header entry point and route reachability

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | While signed in, drive sync into the `warning` state (leave a dead-letter present) and look at the header sync indicator | The indicator is a clickable link; hovering shows the tooltip |
| 1.2 | Click the header sync indicator | Navigates to `/sync-status` (the detail page renders) |
| 1.3 | With sync healthy (`idle`), inspect the header indicator | The indicator is plain text/icon, not a link; clicking does nothing |
| 1.4 | Sign out, then navigate directly to `/sync-status` by URL | Redirected to `/login`; the detail page does not flash |
| 1.5 | Sign back in, navigate directly to `/sync-status` by URL | The detail page renders without redirect |

## Phase 2: Blocked local changes (dead letters)

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | Drive at least two outbox ops to dead-letter (e.g. queue an add-feed and an update-item against an endpoint that keeps failing past the attempt cap), open `/sync-status` | A "Blocked local changes" section lists one row per dead-lettered op |
| 2.2 | Read one row | Shows a human-readable op description, the attempt count, and the last error text |
| 2.3 | On a blocked row, click Retry | The row disappears immediately (no confirm step); the dead-letter count in the header drops by one; the op re-enters the outbox |
| 2.4 | On another blocked row, click Discard | An inline confirm appears in that row; the row is not removed yet |
| 2.5 | Click Cancel in the confirm | The confirm disappears, the row's normal actions return, nothing is deleted |
| 2.6 | Click Discard again, then confirm | The row is removed and the count decrements |
| 2.7 | After discarding the last blocked change while a current sync error is showing | The blocked-changes section empties but the current-error section stays as-is (the error message is not cleared by the discard) |

## Phase 3: Failed feeds (fetch and publish)

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Subscribe to a feed whose URL returns 500/404 or fails DNS, let it sync, open `/sync-status` | The feed appears under "Feeds that couldn't fetch" with its error |
| 3.2 | Drive a feed into a publish failure (`pds_write_failed`) | The feed appears under "Feeds that couldn't share to Bluesky" |
| 3.3 | Drive one feed into both a fetch error and a publish error | The same feed appears once in each section |
| 3.4 | Confirm a healthy feed (last status 200) | Appears in neither section |
| 3.5 | Resolve all fetch errors but leave a publish error (and vice versa) | The now-empty section is removed entirely, not shown empty |
| 3.6 | On a fetch-failed feed, click Retry | Triggers a refresh of that feed; on success the row leaves the fetch section |
| 3.7 | On a publish-failed feed (non-reauth), click Retry share | Triggers a re-publish; on success the row leaves the publish section; on failure the row stays with refreshed error text |

## Phase 4: Inline confirmation for destructive actions

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | On a failed feed, click Unsubscribe | Inline confirm appears; the feed is not removed yet |
| 4.2 | Confirm the unsubscribe | The feed is removed from the list and unsubscribed |
| 4.3 | On another failed feed, click Unsubscribe then Cancel | The confirm disappears, the feed remains |
| 4.4 | Re-confirm: Retry / Retry share never show a confirm step | Non-destructive actions act immediately |

## End-to-End: Re-authentication round-trip (required for full confidence — AC10.2)

Purpose: validate the full re-auth flow that the component test cannot reach
(it only checks the link is rendered).

1. Drive a feed into `publish_error = 'reauth_required'` (expire or revoke
   the Bluesky session/refresh token, then attempt a share so the server
   marks the feed `reauth_required`).
2. Open `/sync-status`. Confirm the publish-failed row shows a
   re-authenticate link (pointing to `/login`) instead of a plain "Retry
   share" button.
3. Click the re-auth link and complete the full Bluesky OAuth flow.
4. After OAuth completes and the next pull-sync runs, confirm the feed's
   `publish_error` clears and the row disappears from the publish-failed
   section.
5. Perform a fresh share on that feed and confirm it now succeeds.

## End-to-End: Empty state lifecycle

Purpose: validate the page transitions to its empty state live, spanning all
problem categories.

1. With a current sync error, a dead letter, and a failed feed all present,
   open `/sync-status`. Confirm every relevant section renders and there is
   no empty state.
2. Resolve each problem one at a time (clear the sync error, retry/discard
   the dead letter, fix/unsubscribe the failed feed) while leaving the page
   open.
3. Confirm sections disappear as each is resolved, and when the last problem
   clears the page transitions to the empty/all-clear state without a
   reload.

## End-to-End: Offline behavior (AC11)

Purpose: validate the derived-offline gating end to end.

1. With at least one fetch-failed feed, one publish-failed feed, and one
   blocked local change present, take the browser offline (DevTools offline,
   or `syncStatus` becomes `offline`).
2. Confirm Retry (fetch) and Retry share buttons are visibly disabled and do
   not act when clicked.
3. Confirm the dead-letter Discard button and the feed Unsubscribe button
   remain enabled and still work (these are local-only).
4. Go back online and confirm the server-dependent buttons re-enable.

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC9.1 / AC9.2 | Tests assert the `role="status" aria-live="polite"` region exists and updates once, but cannot confirm a screen reader actually voices the polite announcement exactly once with no per-row chatter | With VoiceOver/NVDA active on `/sync-status`, perform a Retry, a confirmed Discard, a Retry share, and a confirmed Unsubscribe. Confirm exactly one spoken announcement per action and no duplicate or per-row announcements |
| AC9.3 | Tests assert `document.activeElement` lands on the right target, but not the lived keyboard/screen-reader experience (focus visibly moves, no flash on a detached node, the heading is announced) | Keyboard-only with a screen reader: seed two or more blocked changes, Retry/Discard the first row, confirm focus visibly and audibly moves to the next row's action. Reduce to one row, confirm focus moves to the section heading (then to the page heading when the section unmounts) and is announced. Repeat for the failed-feed Unsubscribe confirm |
| AC10.2 (full round-trip) | The test only verifies the re-auth link renders; the OAuth round-trip, token re-issue, and post-sync row removal cross the client, worker, and external auth server | See "End-to-End: Re-authentication round-trip" above |
| AC3.6 / AC3.7 / AC10.1 / AC10.3 (real network) | Component tests stub `refreshFeed` / `toggleFeedPublished`; the real fetch and Bluesky share round-trips are network-dependent | Drive real fetch and publish failures, click Retry / Retry share, and confirm the actual server round-trip succeeds (row leaves) or fails (row stays with refreshed error text) against a live backend |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 / AC1.2 / AC1.3 | sync-status-header.ts | Phase 1.1–1.3 |
| AC1.4 / AC1.5 | sync-status-route.ts | Phase 1.4–1.5 |
| AC2.1 | push-sync.ts; sync-status-route.ts | Phase 2.1 |
| AC2.2 | sync-status-route.ts | Phase 2.2 |
| AC2.3 | sync-status-route.ts | Phase 2.1 (omission when empty) |
| AC3.1 | sync-status-format.ts; sync-status-feeds.ts | Phase 3.1 |
| AC3.2 | sync-status-format.ts; sync-status-feeds.ts | Phase 3.2 |
| AC3.3 | sync-status-format.ts; sync-status-feeds.ts | Phase 3.3 |
| AC3.4 | local-adapter.ts; sync-status-format.ts; sync-status-feeds.ts | Phase 3.4 |
| AC3.5 | sync-status-feeds.ts | Phase 3.5 |
| AC4.1 / AC4.4 | push-sync.ts | Phase 2.3 (retry effect observed) |
| AC4.2 | retry-discard-dead-letter.ts; sync-status-route.ts | Phase 2.3 |
| AC4.3 | retry-discard-dead-letter.ts | Phase 2.6 |
| AC4.5 | retry-discard-dead-letter.ts | Phase 2.3 (op retries cleanly) |
| AC5.1 / AC5.2 | sync-status-route.ts | End-to-End: Empty state lifecycle |
| AC6.1 / AC6.2 | sync-status-format.ts | Phase 2.2 (descriptions readable) |
| AC7.1 / AC7.2 / AC7 invariant | sync-status-route.ts; retry-discard-dead-letter.ts | Phase 2.7 |
| AC8.1 / AC8.2 / AC8.4 | sync-status-route.ts | Phase 2.4–2.6, 4.4 |
| AC8.3 | sync-status-feeds.ts | Phase 4.1–4.3 |
| AC9.1 / AC9.2 | sync-status-route.ts | Human Verification (screen reader) |
| AC9.3 | sync-status-route.ts; sync-status-feeds.ts | Human Verification (keyboard + screen reader) |
| AC10.1 / AC10.3 | sync-status-feeds.ts | Phase 3.7 + Human Verification (real network) |
| AC10.2 | sync-status-feeds.ts | End-to-End: Re-authentication round-trip |
| AC11.1 / AC11.2 | sync-status-feeds.ts | End-to-End: Offline behavior |
