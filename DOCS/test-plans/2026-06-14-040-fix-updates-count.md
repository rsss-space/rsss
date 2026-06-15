# Test Plan: "N updates" Count Accuracy + Freshness (040-fix-updates-count)

## Coverage Validation

**Automated Criteria:** 11 | **Covered:** 11 | **Missing:** 0
(AC4.1 is designated human-verified by the plan — not counted as an
automatable criterion.)

**Result: PASS**

| Criterion | Test File | Verifies |
|-----------|-----------|----------|
| AC1.1 | `test/feed-cursor.ts` | Query string contains strict `items.pub_date > feeds.last_pulled_at`. |
| AC1.2 | `test/feed-cursor.ts` | `feeds.last_pulled_at IS NULL` branch present (never-pulled feed counts all dated items). |
| AC1.3 | `test/feed-cursor.ts` | `GROUP BY feeds.id`; summed per-feed counts equal header total; `null → 0` coercion. |
| AC1.4 | `test/feed-cursor.ts` | `items.pub_date IS NOT NULL` (null exclusion); strict `>` (boundary exclusion). |
| AC2.1 | `test/poll-state.ts` | Past `getAlarm()` re-armed near-immediate; future → no-op; null → one interval out. |
| AC2.2 | `test/account-deletion-alarm.ts` | `alarm()` reschedules even when sweep / readAccountActivity / refreshFeedBatches throw (setAlarm ordered before the throw). |
| AC2.3 | `test/account-deletion-alarm.ts` | Inactivity gate stays dormant (no reschedule); deletion-due / not-yet-due paths preserved. |
| AC3.1 | `test/dev-poll-now.ts` | DO route runs `fetchFeed` per feed, `newItems` delta > 0, 200; `advanceFeedCursor` called ZERO times (cursor untouched). |
| AC3.2 | `test/dev-poll-now.ts` | Worker 404 in production AND staging (env gate before auth); DO-level defense-in-depth 404 with `fetchFeed` never called. |
| AC3.3 | `test/dev-poll-now.ts` | 304 → `newItems === 0`, no error, full `{ polledFeeds, newItems, counts }` shape. |
| AC4.1 | — (human-verified) | Live `feed-updates-available` updates an open tab without reload. |
| AC4.2 | `test/state-auth-storage.ts` | visibilitychange→visible / focus re-fetches the canonical count; no-user / hidden guards. |
| AC4.3 | `test/state-auth-storage.ts` | Concurrent focus+visibilitychange dedupe to exactly one in-flight call; guard resets after settle. |

---

## Human Test Plan

### Prerequisites

- Local dev environment for rsss; logged-in test account with at least one
  subscribed feed.
- `.dev.vars` `APP_ORIGIN` and the `vite.config.js` port MUST match (a
  mismatch makes non-exempt POSTs 403 "Cross-origin request rejected").
- Run the per-file automated suites green (the aggregate `npm test` combined
  browser bundle is pre-existing flaky; its non-zero exit is not a signal for
  this feature). With `export PATH="$PWD/node_modules/.bin:$PATH"` from the
  repo root:
  - `esbuild ./test/poll-state.ts --bundle --loader:.wasm=dataurl --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts --alias:@sentry/cloudflare=./test/sentry-cloudflare-stub.ts | tapout`
  - `esbuild ./test/account-deletion-alarm.ts --bundle --platform=node --format=esm --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts | node --input-type=module | tap-spec`
  - `esbuild ./test/dev-poll-now.ts --bundle --platform=node --format=esm --external:./src/server/blurhash-runtime.js --external:stripe --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts --alias:@sentry/cloudflare=./test/sentry-cloudflare-stub.ts | node --input-type=module | tap-spec`
  - `esbuild ./test/state-auth-storage.ts --bundle --loader:.css=text --loader:.wasm=dataurl --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts --alias:@sentry/cloudflare=./test/sentry-cloudflare-stub.ts | tapout`
  - feed-cursor (AC1): the new test `getFeedUpdateCounts pins pending-count
    predicate and mapping` is the relevant one. The full standalone suite has
    a pre-existing unrelated abort at test 17; to confirm the new test in
    isolation, temporarily mark it `test.only`, run the feed-cursor
    `esbuild | tapout` command, then revert (do not commit `test.only`).

### Phase 1: Pending-count accuracy (header math)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Log in. Note the "N updates" header count and the per-feed sidebar badges. | Header N equals the sum of the per-feed badge counts (single source of truth). |
| 2 | Open a feed (pull/read it), then return to the list. | That feed's badge drops to 0 and the header N decreases by exactly that feed's prior count; no off-by-one. |
| 3 | Subscribe to a brand-new feed with dated items. | Before its first pull (`last_pulled_at IS NULL`), all of its dated items are counted; header N grows by the full item count. |
| 4 | Inspect a feed whose newest item's `pub_date` equals its `last_pulled_at` (boundary), or an item with no `pub_date`. | Boundary-equal and null-`pub_date` items are NOT counted (strict `>`, `IS NOT NULL`). |

### Phase 2: Background discovery alarm self-heals

| Step | Action | Expected |
|------|--------|----------|
| 1 | Leave the app open / tab idle long enough for the background feed-refresh alarm to fire (or trigger an alarm tick in dev). | The alarm fires and reschedules the next tick; discovery continues. |
| 2 | Observe a transient failure in a pre-discovery step (e.g. sweep or activity read throwing). | The alarm still reschedules — polling does NOT silently die. No unhandled rejection in logs. |
| 3 | Leave the account idle past the inactivity threshold with no pending deletion. | The alarm intentionally stops (DO dormant, zero request cost). On your next request, polling re-arms. |

### Phase 3: Dev discovery endpoint (`POST /api/dev/poll-now`)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start the dev server (`NODE_ENV=development`). Log in. | App loads; live WebSocket connects. |
| 2 | Point a test feed at a source with genuinely new content. | Source ready to return new items. |
| 3 | From the app's own browser console (same-origin, so the `csrf_token` cookie, matching `x-csrf-token`, and `sec-fetch-site: same-origin` are sent — the endpoint is NOT CSRF-exempt; a bare `curl -X POST` is rejected 403): `fetch('/api/dev/poll-now', { method: 'POST', credentials: 'same-origin', headers: { 'x-csrf-token': /* csrf_token cookie value */ } }).then(r => r.json()).then(console.log)`. | 200 with `{ polledFeeds, newItems, counts }`; `newItems > 0`; `last_pulled_at` is NOT advanced (pending count grows rather than zeroing). |
| 4 | Point the test feed at a 304 source and repeat step 3. | 200 with `newItems === 0`, no error; response still includes all three fields. |
| 5 | Build for staging/production (`NODE_ENV !== 'development'`) and POST `/api/dev/poll-now`. | 404 (endpoint does not exist outside dev). |

### End-to-End: Live update to an open tab (AC4.1 + AC4.2/AC4.3 in the real stack)

Purpose: confirm the full live path — DO `fetchFeed` broadcasting
`feed-updates-available` over the hibernating WebSocket → client
`onUpdatesAvailable` applying counts → header changing without a reload —
works end to end, and that focus/visibility re-sync recovers a missed
broadcast.

1. With the dev server running and logged in, note the current "N updates"
   value in the header. Do NOT reload during this scenario.
2. Ensure a test feed points at a source with genuinely new content.
3. From the app's browser console, trigger discovery via the same-origin
   `fetch('/api/dev/poll-now', …)` call (Phase 3 step 3). Confirm the response
   body shows `newItems > 0` — otherwise the run is not a valid test.
4. Watch the header. **Expected:** the "N updates" count INCREASES live, with
   no page reload (AC4.1: `feed-updates-available` received and applied).
5. Re-sync fallback (AC4.2): switch to another browser tab (backgrounding
   rsss). Trigger another `poll-now` that inserts items while the rsss tab is
   hidden. Switch back to the rsss tab. **Expected:** on
   `visibilitychange`→visible / `focus`, the app re-fetches the canonical
   count and the header reflects the new total, even though the live broadcast
   may have been missed while hidden.
6. Dedup check (AC4.3): immediately after returning to the tab, the re-fetch
   fires once — observe a single `/api/feed-status` request in the Network
   panel per return-to-tab, no fetch storm.

**Pass criterion:** the header count changes live (no reload) after a
`poll-now` that inserted items (step 4), and recovers via focus/visibility
after a missed-while-hidden insert (step 5). Record the AC4.1 result in the
PR description. If the header does NOT update in step 4, debug the broadcast →
`onUpdatesAvailable` path, apply a broadcast fix, and add a targeted automated
test for the fix.

### Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC4.1 — live `feed-updates-available` updates an already-open tab without reload | The path spans the real worker, a real hibernating WS connection, and the browser; it cannot be exercised faithfully in the test harnesses, and the only honest end-state assertion would be on the rendered "N updates" DOM text, which the no-brittle-DOM-text rule forbids. Framed verify-first (push believed wired, just never exercised in dev). | End-to-End scenario steps 1-4. Pass = header increases live with no reload after a `poll-now` that inserted items. Record result in PR description. |
