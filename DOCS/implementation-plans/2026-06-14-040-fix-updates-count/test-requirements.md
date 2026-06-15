# "N updates" Count Accuracy + Freshness — Test Requirements

Maps every acceptance criterion of feature `040-fix-updates-count` to either an
automated test or a documented human-verification item.

Source of truth for the criteria text:
`docs/design-plans/2026-06-14-040-fix-updates-count.md` (Acceptance Criteria
section).

## Test infrastructure notes

- This project uses `@substrate-system/tapzero` assertions piped through
  `tapout` (TAP). A `console.error` fails the run even when TAP is all-green.
- **DO-handler tests** build the Durable Object via
  `Object.create(RsssUserDO.prototype)` and a fake `sql`/`ctx.storage`,
  using the shared SQL fake `test/helpers/sql-fake.ts` (`fakeResult(rows)`).
  The fake does NOT execute SQL — it returns the canned rows you hand it. To
  pin a SQL predicate you must capture and assert the **query string** passed
  to `this.sql.exec(...)`, not rely on the fake to compute a result.
- **Client tests** run in the consolidated browser bundle via `test/index.ts`.
- **Node-platform worker tests** are registered in `test/run-all-tests.mjs`
  and run as `esbuild ... | node --input-type=module | tap-spec`.
- Brittleness constraint (project rule): no test asserts on specific HTML/DOM
  text content. The rendered "N updates" string in
  `src/client/components/feed-status.ts` is explicitly off-limits; client tests
  assert on signals, recorded calls, and spies instead.

---

## 1. Automated tests

### AC1 — Pending-count math is correct and pinned

All AC1 tests live in `test/feed-cursor.ts` (the new regression block sits
beside the existing `getFeedUpdateCounts` row→map test and the
`advanceFeedCursor` SQL-pinning precedent). Test type: **unit** (DO-handler,
`Object.create(RsssUserDO.prototype)` + `test/helpers/sql-fake.ts`).

| AC id | Verbatim text | File | Asserts |
| --- | --- | --- | --- |
| 040-fix-updates-count.AC1.1 | `getFeedUpdateCounts()` counts, per feed, items with `pub_date > last_pulled_at`. | `test/feed-cursor.ts` | Captures the query string `getFeedUpdateCounts()` passes to `this.sql.exec`; normalizes whitespace; asserts it contains the strict fragment `items.pub_date > feeds.last_pulled_at`. (Predicate is pinned via the query string because the SQL fake does not execute SQL.) |
| 040-fix-updates-count.AC1.2 | a feed with `last_pulled_at IS NULL` counts all its items that have a non-null `pub_date`. | `test/feed-cursor.ts` | Normalized query string contains the `feeds.last_pulled_at IS NULL` branch; a fixture row for a never-pulled feed maps to its full non-null-`pub_date` item count. |
| 040-fix-updates-count.AC1.3 | the header total equals the sum of the per-feed counts (one source of truth). | `test/feed-cursor.ts` | Normalized query contains `GROUP BY feeds.id`; with a mixed canned-rows fixture (never-pulled feed, pulled feed with newer items, zero-count feed, a `pending_count: null` row), `Object.values(result).reduce((a,b)=>a+b,0)` equals the expected header total, and the `null → 0` coercion holds. |
| 040-fix-updates-count.AC1.4 | items with `pub_date IS NULL`, and items where `pub_date == last_pulled_at` (boundary), are excluded from the count. | `test/feed-cursor.ts` | Normalized query contains `items.pub_date IS NOT NULL` (null-`pub_date` exclusion) and the strict `>` fragment with NO `>=` (boundary exclusion). Mutation check (Phase 1 Task 2) proves the assertion fails when `>` is flipped to `>=`. |

### AC2 — Background discovery alarm self-heals and cannot silently die

Test type: **unit** (DO-handler, fake `ctx.storage` recording `setAlarm`
calls + `test/helpers/sql-fake.ts`).

| AC id | Verbatim text | File | Asserts |
| --- | --- | --- | --- |
| 040-fix-updates-count.AC2.1 | an alarm whose stored fire-time is in the past is re-armed on the next DO construction/request. | `test/poll-state.ts` | With the fake `getAlarm()` returning a past timestamp, `ensureFeedRefreshArmed()` calls `setAlarm()` once with a near-immediate time (recorded time `<= Date.now()` + small slack, far below `Date.now() + FEED_REFRESH_INTERVAL_MS`). Regression: a FUTURE `getAlarm()` leaves `setAlarm()` uncalled; the null case still arms one interval out. |
| 040-fix-updates-count.AC2.2 | `alarm()` schedules the next alarm even when a pre-discovery step (e.g. `sweepStuckResolvingFeeds`/`readAccountActivity`) throws. | `test/account-deletion-alarm.ts` | Three cases on the `Object.create`d DO: (a) `sweepStuckResolvingFeeds` throws → `setAlarm` still called; (b) `readAccountActivity` rejects → `setAlarm` still called; (c) `refreshFeedBatches` rejects → `setAlarm` was called BEFORE the throw (reschedule survives). No unhandled rejection. |
| 040-fix-updates-count.AC2.3 | the inactivity gate still intentionally suppresses rescheduling (DO goes dormant), and the pending-deletion path is unaffected. | `test/account-deletion-alarm.ts` | Inactivity-gate case: `readAccountActivity` returns a marker older than `ACCOUNT_INACTIVITY_THRESHOLD_MS` with no pending deletion → `setAlarm` is NOT called (stays dormant). Pending-deletion: the existing deletion-path assertions in this file stay green after the reorder (deletion-due executes deletion and does not reschedule; not-yet-due keeps ticking). |

Note on AC2.3: the "pending-deletion path is unaffected" half is partly
covered by keeping the file's existing account-deletion assertions green
through the `alarm()` reorder — that is the deliberate regression-guard for
this clause, not a brand-new test.

### AC3 — Dev discovery endpoint exercises discovery without pulling

Test type: **integration** for the worker-route gate (worker `app` +
`makeEnv` from `test/signup-helpers.ts`, run as a node-platform test) and
**unit** for the DO route (`Object.create(RsssUserDO.prototype)` driven via
`createRouter().request(...)`). All AC3 tests live in `test/dev-poll-now.ts`
(new file, registered in `test/run-all-tests.mjs`).

| AC id | Verbatim text | File | Asserts |
| --- | --- | --- | --- |
| 040-fix-updates-count.AC3.1 | in dev, `POST /api/dev/poll-now` runs discovery and inserts new items (when the source has them) without changing `last_pulled_at`, so the pending count grows. | `test/dev-poll-now.ts` | DO-level: `fetchFeed` is called once per feed; a stub that increments the item count simulates inserts; response is 200 with `polledFeeds` === feed count and `newItems` === simulated inserts (> 0). Core guarantee: the `advanceFeedCursor` spy records ZERO calls (cursor untouched, count not zeroed). |
| 040-fix-updates-count.AC3.2 | when `NODE_ENV !== 'development'`, the endpoint returns 404. | `test/dev-poll-now.ts` | Worker-level: `app.request('/api/dev/poll-now', POST, ...)` with `makeEnv({ NODE_ENV: 'production' })` returns 404, and again with `'staging'` returns 404. The request carries the CSRF triple (`cookie: csrf_token=test-csrf`, `x-csrf-token: test-csrf`, `sec-fetch-site: same-origin`) + an `executionCtx`, so the global CSRF guard passes and the 404 comes from the NODE_ENV gate (which runs before `requireAuth`), not a 403/401. |
| 040-fix-updates-count.AC3.3 | a feed returning 304 yields no new items and does not error; the response still reports `{ polledFeeds, newItems, counts }`. | `test/dev-poll-now.ts` | DO-level: `fetchFeed` stubbed to insert nothing (304 simulation: item count unchanged) and resolve without error → `body.newItems` === 0, no thrown error, no `console.error`, and the response still contains all three fields `{ polledFeeds, newItems, counts }`. |

### AC4 — Live delivery to an open tab + focus fallback

AC4.2/AC4.3 are automated; AC4.1 is human-verified (see section 2). Automated
test type: **unit** (client, browser bundle via `test/index.ts`), with
`State.loadFeedStatus` spied per the `test/state-refresh-audit.ts` pattern and
`document.visibilityState` mocked via `Object.defineProperty` (restored in a
`finally`).

| AC id | Verbatim text | File | Asserts |
| --- | --- | --- | --- |
| 040-fix-updates-count.AC4.2 | returning to a backgrounded tab (`visibilitychange`→visible / `focus`) re-fetches the canonical count. | `test/state-auth-storage.ts` | With `visibilityState` = `'visible'` and `state.user.value` set, dispatching the re-sync trigger (`visibilitychange` and/or `focus`) calls `State.loadFeedStatus`. Negative guard: with `state.user.value` null, firing the event does NOT call `loadFeedStatus`. |
| 040-fix-updates-count.AC4.3 | the focus/visibility re-sync is guarded against redundant/duplicate fetches. | `test/state-auth-storage.ts` | With the `loadFeedStatus` spy returning a pending (unresolved) promise, firing BOTH `focus` and `visibilitychange` in the same tick calls `loadFeedStatus` exactly ONCE (in-flight guard). Optional: resolving the promise and firing again re-syncs (guard resets on settle). |

---

## 2. Human verification

### AC4.1 — verify-first (manual), per Phase 4 Task 1

| AC id | Verbatim text |
| --- | --- |
| 040-fix-updates-count.AC4.1 | when discovery inserts items, an already-open tab's "N updates" updates without a hard reload (`feed-updates-available` received and applied). |

**Why this is human-verified, not automated.** The end-to-end live path —
DO `fetchFeed` broadcasting `feed-updates-available` over the hibernating
WebSocket → the client `onUpdatesAvailable` handler applying counts → the
rendered header changing without a reload — spans the real worker, a real WS
connection, and the browser. It cannot be exercised faithfully in the
`tapout`/`Object.create` harnesses, and the only honest end-state assertion
would be on the rendered "N updates" DOM text, which the project's
no-brittle-DOM-text rule forbids. The diagnosis also frames this strand as
verify-first: the push is believed already wired and simply never exercised in
dev, so the deliverable is confirmation (a code fix only if verification
fails), not a new automated test.

**Verification approach.** Use Phase 3's `POST /api/dev/poll-now` to decouple
discovery from pulling, then watch an open tab update live:

1. Ensure `.dev.vars` `APP_ORIGIN` and the `vite.config.js` port match;
   otherwise non-exempt POSTs are rejected 403 "Cross-origin request
   rejected".
2. Start the dev server and log in so the live WebSocket is connected. Note
   the current "N updates" value in the header.
3. Point a test feed at a source with genuinely new content (a 304 yields no
   new items by design, so the count would not move).
4. Trigger discovery. **`POST /api/dev/poll-now` is NOT CSRF-exempt** — only
   the four `/api/auth/*` paths are. A bare `curl -X POST` (no origin / no
   CSRF token) is rejected 403 before the handler runs. Call it
   **same-origin from the app's own browser console** so the `csrf_token`
   cookie, the matching `x-csrf-token` header, and `sec-fetch-site:
   same-origin` are all sent:
   ```js
   fetch('/api/dev/poll-now', {
       method: 'POST',
       credentials: 'same-origin',
       headers: { 'x-csrf-token': /* csrf_token cookie value */ }
   })
   ```
   (Or with curl: pass `--cookie 'csrf_token=...'`, `-H 'x-csrf-token: ...'`
   matching the cookie, and `-H 'sec-fetch-site: same-origin'`.)
5. Confirm the "N updates" header **increases without a page reload**. The
   response body `{ polledFeeds, newItems, counts }` should show
   `newItems > 0` for the run to be a valid test of the live update.

**Pass criterion.** The header count changes live (no reload) after a
`poll-now` call that inserted items. **Record the result in the PR
description.** If the header does NOT update, debug the broadcast →
`onUpdatesAvailable` path, apply a broadcast fix, and add a targeted test for
the fix; otherwise no code change is required for AC4.1.

---

## Coverage summary

| AC | Disposition | File |
| --- | --- | --- |
| 040-fix-updates-count.AC1.1 | Automated (unit) | `test/feed-cursor.ts` |
| 040-fix-updates-count.AC1.2 | Automated (unit) | `test/feed-cursor.ts` |
| 040-fix-updates-count.AC1.3 | Automated (unit) | `test/feed-cursor.ts` |
| 040-fix-updates-count.AC1.4 | Automated (unit) | `test/feed-cursor.ts` |
| 040-fix-updates-count.AC2.1 | Automated (unit) | `test/poll-state.ts` |
| 040-fix-updates-count.AC2.2 | Automated (unit) | `test/account-deletion-alarm.ts` |
| 040-fix-updates-count.AC2.3 | Automated (unit) + existing-test regression guard | `test/account-deletion-alarm.ts` |
| 040-fix-updates-count.AC3.1 | Automated (unit, DO route) | `test/dev-poll-now.ts` |
| 040-fix-updates-count.AC3.2 | Automated (integration, worker gate) | `test/dev-poll-now.ts` |
| 040-fix-updates-count.AC3.3 | Automated (unit, DO route) | `test/dev-poll-now.ts` |
| 040-fix-updates-count.AC4.1 | Human verification (verify-first; `poll-now`) | manual / PR description |
| 040-fix-updates-count.AC4.2 | Automated (unit, client) | `test/state-auth-storage.ts` |
| 040-fix-updates-count.AC4.3 | Automated (unit, client) | `test/state-auth-storage.ts` |

All 12 acceptance criteria are mapped: 11 to automated tests, 1 (AC4.1) to a
documented human-verification item.
