# Sync Status Detail (`/sync-status`) — Test Requirements

Traceability matrix mapping every acceptance criterion in the design
(`sync-status-detail.AC1.1` … `sync-status-detail.AC11.2`) to its automated
test coverage and, where automation cannot fully verify the behavior, to a
documented human-verification step.

**Source of truth:** the per-AC phase/task assignments are taken directly from
the implementation plan (`phase_01.md` … `phase_06.md`). Each row reflects the
phase/task the plan states verifies that criterion and the test file the plan
names.

## Conventions and constraints (apply to every automated test below)

These are real, verified decisions from planning. They shape what the tests
assert and how:

- **Client-only feature.** No server route, no DO SQLite, and no local-schema
  changes. Every automated test runs in the browser bundle or as pure logic;
  there is no server-side test surface for this feature.
- **Test framework / runner.** `@substrate-system/tapzero` (with
  `@substrate-system/tapout` for the browser run). Browser-component tests
  mount with Preact `render` + `htm/preact` `html`, using the
  `mountRoot()` / `waitFor()` / `nextTask()` helpers and seeding signals via
  `batch()`. Every new browser/pure test file is wired into
  `test/browser-tests.ts` as a side-effect import. The **authoritative gate is
  `npm test`** (runs `node test/run-all-tests.mjs`, which bundles the browser
  suite); `npm run test:browser` is the faster inner loop.
- **Assert behavior, never copy.** Per project rules, tests assert structure,
  ARIA roles, stable class hooks, dispatched `State` methods, and dynamic data
  bindings (e.g. that the seeded `syncError` sentinel string is present) — they
  never assert static rendered UI copy, and there are no tests for docs.
- **Dead-letter remediation lives in `push-sync.ts`.** The
  `requeueDeadLetter` / `removeDeadLetter` transactions are DB-layer functions
  in `src/client/db/push-sync.ts`; `State.retryDeadLetter` /
  `State.discardDeadLetter` are thin orchestration wrappers in
  `src/client/state.ts`. AC4 therefore has both a DB-layer test
  (`test/push-sync.ts`) and a State-level test.
- **Offline is derived, not a signal.** `offline = syncStatus.value ===
  'offline'`. AC11 tests seed `syncStatus='offline'` rather than a dedicated
  offline flag.
- **`feed.publish_error` is a code.** Persisted values are the literals
  `'reauth_required'` or `'pds_write_failed'` (or `null`). AC10.2 seeds
  `publish_error === 'reauth_required'` to reach the re-auth branch.

### Test-type legend

- **unit (pure):** no DB, no DOM — plain function over literals
  (`@substrate-system/tapzero`).
- **unit (DB):** real in-browser SQLite via `openLocalDb` with a unique test
  DID, seeded with SQL, asserted against the DB and/or signals.
- **browser-component:** Preact component mounted with `render` + `htm/preact`,
  asserting on the rendered DOM (roles / class hooks / `href` / focus / dynamic
  bindings).

---

## Coverage matrix

### sync-status-detail.AC1 — Header entry point & route reachability

| AC | Text | Test type | Phase / Task | Test file |
|----|------|-----------|--------------|-----------|
| AC1.1 | In the `warning` state, the sync indicator renders a link to `/sync-status`. | browser-component | Phase 6 / Task 1 | `test/sync-status-header.ts` |
| AC1.2 | In the `error` state, the sync indicator renders a link to `/sync-status`. | browser-component | Phase 6 / Task 1 | `test/sync-status-header.ts` |
| AC1.3 | In `idle`, `syncing`, and `offline`, the indicator is not a link (no `href`). | browser-component | Phase 6 / Task 1 | `test/sync-status-header.ts` |
| AC1.4 | An authenticated user reaches the page directly by URL. | browser-component | Phase 3 / Task 2 (+ Task 3 registration) | `test/sync-status-route.ts` |
| AC1.5 | An unauthenticated user at `/sync-status` is redirected to `/login`. | browser-component | Phase 3 / Task 2 | `test/sync-status-route.ts` |

Notes:
- AC1.1/AC1.2 assert an `a[href="/sync-status"]` exists and wraps the
  `role="status"` span, and that the `<tool-tip>` wrapper is preserved — by
  role/href, not copy.
- AC1.3 asserts the absence of any `a[href="/sync-status"]` while confirming the
  `role="status"` span still renders, for each of the three states.
- AC1.4/AC1.5 are verified at the component-guard level (authenticated → renders
  `.route.sync-status`, no `_setRoute('/login')`; unauthenticated → `_setRoute`
  spy called with `'/login'`, component renders null). The route *registration*
  in `index.ts` (Phase 3 Task 3) mirrors `/updates` and is config, not a
  separately tested unit — its behavior is exercised by the Task 2 guard tests.

### sync-status-detail.AC2 — Blocked local changes are listed

| AC | Text | Test type | Phase / Task | Test file |
|----|------|-----------|--------------|-----------|
| AC2.1 | Each `dead_letter_outbox` row appears as a row in the "Blocked local changes" section. | unit (DB) for the read + browser-component for the render | Phase 1 / Task 1 (read); Phase 4 / Task 2 (render) | `test/push-sync.ts`; `test/sync-status-blocked.ts` |
| AC2.2 | A row shows the op description, attempt count, and last error. | browser-component | Phase 4 / Task 2 | `test/sync-status-blocked.ts` |
| AC2.3 | With no dead-letter rows, the section is omitted. | browser-component | Phase 4 / Task 2 | `test/sync-status-blocked.ts` |

Notes:
- AC2.1 is split: Phase 1 verifies `listDeadLetterOutbox(db)` returns one row per
  `dead_letter_outbox` row (ordered by `id`, fields intact, `[]` when empty);
  Phase 4 verifies N seeded rows render N `.blocked-change` elements.
- AC2.2 asserts the row contains a non-empty description element (from
  `describeOp`), an attempt-count element bound to `row.attempts`, and a
  last-error element bound to `row.last_error` — dynamic data, not copy.
- The Phase 4 render tests may live in an extended `test/sync-status-route.ts` or
  a dedicated `test/sync-status-blocked.ts`; the plan permits either and names
  `test/sync-status-blocked.ts` as the new-file option (used here).

### sync-status-detail.AC3 — Failed feeds are listed and partitioned

| AC | Text | Test type | Phase / Task | Test file |
|----|------|-----------|--------------|-----------|
| AC3.1 | A feed with `last_error` (or `last_status >= 400`) appears under "Feeds that couldn't fetch". | unit (pure predicate) + browser-component (render) | Phase 1 / Task 4 (predicate); Phase 5 / Task 1 (render) | `test/sync-status-format.ts`; `test/sync-status-feeds.ts` |
| AC3.2 | A feed with `publish_error` appears under "Feeds that couldn't share to Bluesky". | unit (pure predicate) + browser-component (render) | Phase 1 / Task 4 (predicate); Phase 5 / Task 2 (render) | `test/sync-status-format.ts`; `test/sync-status-feeds.ts` |
| AC3.3 | A feed with both a fetch error and a publish error appears in both sections. | unit (pure predicate) + browser-component (render) | Phase 1 / Task 4 (predicate); Phase 5 / Task 2 (render) | `test/sync-status-format.ts`; `test/sync-status-feeds.ts` |
| AC3.4 | A feed with no error appears in neither section. | unit (DB query) + unit (pure predicate) + browser-component | Phase 1 / Task 2 (query) + Task 4 (predicate); Phase 5 / Task 1 (render guard) | `test/local-adapter.ts`; `test/sync-status-format.ts`; `test/sync-status-feeds.ts` |
| AC3.5 | An empty feed-failure section is omitted. | browser-component | Phase 5 / Tasks 1 & 2 | `test/sync-status-feeds.ts` |

Notes:
- The partition is driven by the pure predicates `isFetchFailed` /
  `isPublishFailed` (Phase 1 Task 4) — these are the single source of truth and
  carry the bulk of the edge coverage (`last_status` of 200/304 is *not* a fetch
  failure; both-error feed satisfies both predicates).
- Phase 1 Task 2 (`listFailedFeeds`) verifies the SQL filter at the DB layer:
  the clean feed is excluded; every errored feed (fetch-only, `>=400`,
  publish-only, both) is included.
- Phase 5 verifies the rendered partition: a fetch-failed feed renders under
  `.feeds-fetch-failed`, a publish-failed feed under `.feeds-publish-failed`, a
  both-error feed renders one row in each, and each section is omitted when its
  filtered list is empty (AC3.5 covered in both Task 1 and Task 2).

### sync-status-detail.AC4 — Blocked changes can be retried or discarded

| AC | Text | Test type | Phase / Task | Test file |
|----|------|-----------|--------------|-----------|
| AC4.1 | Retry moves the row from `dead_letter_outbox` back into `outbox` with `attempts` reset to 0 and `last_error` cleared. | unit (DB) | Phase 2 / Task 1 | `test/push-sync.ts` |
| AC4.2 | Retry removes the row from view and decrements the dead-letter count signal. | unit (DB/signal) at State level + browser-component (row clears) | Phase 2 / Task 2 (signal); Phase 4 / Task 3 (view) | State test (`test/sync-status-state-actions.ts`*); `test/sync-status-blocked.ts` |
| AC4.3 | Discard deletes the `dead_letter_outbox` row and decrements the count. | unit (DB/signal) at State level | Phase 2 / Task 2 | State test (`test/sync-status-state-actions.ts`*) |
| AC4.4 | If the requeue transaction fails, neither table is left partially modified (atomic) and the row remains dead-lettered. | unit (DB) | Phase 2 / Task 1 | `test/push-sync.ts` |
| AC4.5 | A retried op that fails again returns to `dead_letter_outbox` with refreshed `last_error`. | unit (DB/signal) at State level | Phase 2 / Task 2 | State test (`test/sync-status-state-actions.ts`*) |

Notes:
- \* The plan does not pin the State-level test filename; it instructs the
  implementor to "follow `test/add-feed-acquire.ts` conventions" and wire the new
  State test into `test/browser-tests.ts` (mirroring
  `test/resolve-convergence-trackrefresh.ts`). `test/sync-status-state-actions.ts`
  is a placeholder name — match the actual file created in Phase 2 Task 2.
- AC4.1 asserts the requeued `outbox` row preserves `op` / `target_id` /
  `payload` / `client_op_id` / `client_updated_at` with `attempts = 0` and
  `last_error = NULL`, the dead-letter row is gone, and `requeueDeadLetter` on a
  missing id returns `false` without mutating either table.
- AC4.4 forces the INSERT to fail deterministically by pre-inserting an `outbox`
  row with the same `UNIQUE` `client_op_id`; asserts the promise rejects, the
  dead-letter row survives (rollback), and no partial/extra `outbox` row exists.
- AC4.2 (signal half) asserts `retryDeadLetter` decrements
  `syncDeadLetters.value` by 1, moves the row to `outbox`, and invokes the
  stubbed `_runSyncImpl`. AC4.3 asserts `discardDeadLetter` deletes + decrements
  and does NOT call `runSync`.
- AC4.2 (view half, Phase 4) asserts that after a stubbed Retry resolves (count
  decremented, list updated), the row is gone from the rendered list.
- AC4.5 asserts the requeued row has a fresh budget (`attempts = 0`) and that
  driving the standard failure path (`moveOutboxRowToDeadLetters`) re-dead-letters
  it with the new `last_error` — it does not re-run the full retry loop.
- A correctness invariant is also tested here: discarding the last dead-letter
  while `syncStatus='error'`/`syncError` is set must leave `syncError` unchanged
  (only `syncDeadLetters` updates). This protects AC7.

### sync-status-detail.AC5 — Empty state

| AC | Text | Test type | Phase / Task | Test file |
|----|------|-----------|--------------|-----------|
| AC5.1 | With no current error, no dead-letters, and no failed feeds, the page shows the empty state. | browser-component | Phase 3 / Task 2 | `test/sync-status-route.ts` |
| AC5.2 | Resolving the last problem while the page is open transitions it to the empty state. | browser-component | Phase 3 / Task 2 | `test/sync-status-route.ts` |

Notes:
- AC5.1 asserts `.empty-state` present and `.current-error` absent for
  authenticated + empty lists + `syncStatus='idle'`.
- AC5.2 asserts the reactive transition: seed one dead-letter row (no empty
  state) → in `batch()` clear `deadLetters` and set `syncDeadLetters=0` → after a
  render tick, `.empty-state` is present.

### sync-status-detail.AC6 — Op descriptions

| AC | Text | Test type | Phase / Task | Test file |
|----|------|-----------|--------------|-----------|
| AC6.1 | Known ops render a human-readable description derived from the payload. | unit (pure) | Phase 1 / Task 3 | `test/sync-status-format.ts` |
| AC6.2 | An unrecognized op renders a safe fallback description (no crash). | unit (pure) | Phase 1 / Task 3 | `test/sync-status-format.ts` |

Notes:
- AC6.1 asserts each known op (`add_feed`, `delete_feed`, `update_item` read vs
  starred, `mark_all_read` single vs global) produces a non-empty, *distinct*
  description string — distinctness/non-emptiness, never exact copy.
- AC6.2 asserts an unknown op (e.g. `'frobnicate'`) and an invalid-JSON payload
  both return a non-empty string and do not throw.

### sync-status-detail.AC7 — Current sync error section

| AC | Text | Test type | Phase / Task | Test file |
|----|------|-----------|--------------|-----------|
| AC7.1 | When `syncStatus === 'error'`, the page shows the `syncError` message. | browser-component | Phase 3 / Task 2 | `test/sync-status-route.ts` |
| AC7.2 | When `syncStatus !== 'error'`, the section is omitted. | browser-component | Phase 3 / Task 2 | `test/sync-status-route.ts` |

Notes:
- AC7.1 seeds `syncError='SENTINEL_ERR'` and asserts `.current-error` is present
  and contains the sentinel — testing the dynamic binding, not static copy.
- AC7.2 asserts `.current-error` is absent for `syncStatus='idle'`.

### sync-status-detail.AC8 — Inline confirmation for destructive actions

| AC | Text | Test type | Phase / Task | Test file |
|----|------|-----------|--------------|-----------|
| AC8.1 | Clicking Discard reveals an inline confirm; the row is not removed yet. | browser-component | Phase 4 / Task 3 | `test/sync-status-blocked.ts` |
| AC8.2 | Confirming commits the discard; cancelling restores the row. | browser-component | Phase 4 / Task 3 | `test/sync-status-blocked.ts` |
| AC8.3 | Clicking Unsubscribe reveals an inline confirm before the feed is removed. | browser-component | Phase 5 / Task 3 | `test/sync-status-feeds.ts` |
| AC8.4 | Non-destructive actions (Retry) act immediately with no confirm step. | browser-component | Phase 4 / Task 3 | `test/sync-status-blocked.ts` |

Notes:
- AC8.1 asserts clicking Discard renders the inline-confirm element, that
  `State.discardDeadLetter` is NOT called, and the row is still present.
- AC8.2 asserts Cancel removes the confirm and restores the actions without
  calling `discardDeadLetter`; the danger commit calls
  `State.discardDeadLetter(state, row.id)`.
- AC8.3 reuses the same confirm machine keyed `'feed:'+id`: Unsubscribe reveals
  the confirm (feed not removed, `State.deleteFeed` not called yet); confirm
  calls `State.deleteFeed(state, feed.id)`, cancel clears it.
- AC8.4 asserts Retry calls `State.retryDeadLetter` with the row id immediately
  and no inline-confirm element appears.

### sync-status-detail.AC9 — Accessibility of live updates

| AC | Text | Test type | Phase / Task | Test file | Human verification |
|----|------|-----------|--------------|-----------|--------------------|
| AC9.1 | A persistent `role="status"` `aria-live="polite"` region exists and is present before content is injected. | browser-component (DOM presence) | Phase 4 / Task 3 | `test/sync-status-blocked.ts` | Recommended (screen-reader) |
| AC9.2 | Action outcomes announce via a single batched message, not per row. | browser-component (single node updated once) | Phase 4 / Task 3 | `test/sync-status-blocked.ts` | Recommended (screen-reader) |
| AC9.3 | When a row is removed, focus moves to the next actionable element (or the section heading if the list is now empty). | browser-component (`document.activeElement` assertion) | Phase 4 / Task 3 | `test/sync-status-blocked.ts` | Recommended (keyboard + screen-reader) |

Automated assertions:
- AC9.1: the `role="status" aria-live="polite"` region is present on first render
  (no rows needed).
- AC9.2: after an action, the live region's text is set once — a single
  announcement node updates; there is not one announcement element per row.
- AC9.3: with 2 seeded rows, committing the first row's action moves
  `document.activeElement` to the next row's first action button; with 1 row, it
  moves focus to the section heading (`<h2 tabindex="-1">`).

Human verification (see "Human-verified items" below) is *recommended* for
AC9.1–AC9.3 because the DOM contract is automatable but the actual assistive-tech
experience (whether the announcement is voiced, whether focus order feels
correct with a real screen reader / keyboard) is not.

### sync-status-detail.AC10 — Publish failures and re-authentication

| AC | Text | Test type | Phase / Task | Test file | Human verification |
|----|------|-----------|--------------|-----------|--------------------|
| AC10.1 | Retry share calls `toggleFeedPublished(…, true)`; on success the feed leaves the publish-failed section. | browser-component | Phase 5 / Task 2 | `test/sync-status-feeds.ts` | No |
| AC10.2 | When `publish_error === 'reauth_required'`, the row shows a re-authentication affordance instead of a plain Retry. | browser-component (link presence) | Phase 5 / Task 2 | `test/sync-status-feeds.ts` | **Yes — full re-auth round-trip** |
| AC10.3 | A retry-share that fails leaves the feed in the publish-failed section with refreshed error text. | browser-component | Phase 5 / Task 2 | `test/sync-status-feeds.ts` | No |

Automated assertions:
- AC10.1: stub `State.toggleFeedPublished` to simulate success by clearing that
  feed from `failedFeeds.value`; assert it was called with `(state, feed.id,
  true)` and the row leaves the publish section.
- AC10.2: seed `publish_error='reauth_required'`; assert the row renders the
  `.reauth-link` (`<a href="/login">`) and NO Retry-share button.
- AC10.3: stub `State.toggleFeedPublished` to simulate failure by updating that
  feed's `publish_error` in `failedFeeds.value`; assert the row stays with the
  refreshed error value.

Human verification: AC10.2's *link presence* is automated, but the full
`/login` → OAuth re-authentication round-trip (token re-issued, the feed's
`publish_error` clears after the next sync, the row disappears) crosses the
network and the auth server and is verified end-to-end by a human.

### sync-status-detail.AC11 — Offline behavior

| AC | Text | Test type | Phase / Task | Test file |
|----|------|-----------|--------------|-----------|
| AC11.1 | While offline, server-dependent actions (Retry fetch, Retry share) are disabled. | browser-component | Phase 5 / Task 3 | `test/sync-status-feeds.ts` |
| AC11.2 | While offline, local-only Discard remains enabled. | browser-component | Phase 5 / Task 3 | `test/sync-status-feeds.ts` |

Notes:
- AC11.1 seeds `syncStatus='offline'` and asserts the Retry-fetch and Retry-share
  buttons are `disabled`.
- AC11.2 seeds `syncStatus='offline'` plus a dead-letter row and asserts the
  dead-letter Discard button (Phase 4) is NOT disabled (and feed Unsubscribe is
  likewise not disabled).

---

## Human-verified items

Every criterion above maps to at least one automated test. The following carry an
*additional* human-verification step because automation can confirm the
structure/contract but not the full lived behavior. None of these replaces the
automated test — they supplement it.

### AC9.3 — Focus management (recommended)

- **Why automation is insufficient:** the test asserts
  `document.activeElement` lands on the expected element after a row is removed,
  which proves the focus *target*. It does not prove the focus *experience* with
  a real keyboard or screen reader (e.g. that the focused heading is announced,
  that there is no transient focus-on-detached-node flash, that tab order remains
  sensible).
- **Manual approach:** with VoiceOver (macOS) or NVCanvas/NVDA equivalent and
  keyboard only, seed two or more blocked changes, Retry/Discard the first row,
  and confirm focus visibly and audibly moves to the next row's action; then
  reduce to one row and confirm focus moves to the section heading and is
  announced. Repeat for the failed-feed sections' Unsubscribe confirm.

### AC9.1 / AC9.2 — Live-region announcements (recommended)

- **Why automation is insufficient:** the tests assert the
  `role="status" aria-live="polite"` region exists before content injection
  (AC9.1) and that its text updates exactly once per action via a single node
  (AC9.2). DOM presence and update-count are automatable, but whether a screen
  reader actually *voices* the polite announcement (once, not duplicated, not
  swallowed) is environment-dependent and human-verified.
- **Manual approach:** with a screen reader active, perform a Retry, a Discard
  (confirmed), a Retry-share, and an Unsubscribe (confirmed); confirm exactly one
  announcement is heard per action and no per-row chatter.

### AC10.2 — Re-authentication round-trip (required for full confidence)

- **Why automation is insufficient:** the automated test verifies only that a
  `reauth_required` feed renders an `<a href="/login">` affordance instead of a
  Retry button. The end-to-end re-auth flow — clicking the link, completing the
  Bluesky OAuth flow, the token being re-issued, the feed's `publish_error`
  clearing on the next pull-sync, and the row leaving the publish-failed section
  — spans the client, the worker, and the external auth server and is not
  reproducible in the component test harness.
- **Manual approach:** drive a feed into `publish_error = 'reauth_required'`
  (e.g. expire/revoke the session token), open `/sync-status`, follow the re-auth
  link, complete OAuth, and confirm the feed's publish-failed row disappears
  after sync (and a subsequent share succeeds).

---

## Automated-coverage completeness check

- Every scoped id `sync-status-detail.AC1.1` through `sync-status-detail.AC11.2`
  appears in the matrix above and maps to at least one automated test.
- AC9.1, AC9.2, AC9.3, and AC10.2 additionally carry documented human
  verification (the first three recommended, AC10.2 required for full
  confidence), because their automated tests verify the DOM/contract but not the
  full assistive-tech or cross-service behavior.
- The authoritative gate for all automated coverage is `npm test`
  (`node test/run-all-tests.mjs`); `npm run lint` must also be clean per the
  per-phase "Done when" criteria.

### Test files referenced

| File | Status | Suites it carries |
|------|--------|-------------------|
| `test/push-sync.ts` | existing — extended | AC2.1 (read), AC4.1, AC4.4 |
| `test/local-adapter.ts` | existing — extended | AC3.4 (`listFailedFeeds` query) |
| `test/sync-status-format.ts` | new (pure) | AC6.1, AC6.2, AC3.1–AC3.4 (predicates) |
| State-level test (e.g. `test/sync-status-state-actions.ts`) | new — name per Phase 2 Task 2 | AC4.2 (signal), AC4.3, AC4.5, AC7 invariant |
| `test/sync-status-route.ts` | new (browser-component) | AC1.4, AC1.5, AC5.1, AC5.2, AC7.1, AC7.2 |
| `test/sync-status-blocked.ts` | new (browser-component; may instead extend `sync-status-route.ts`) | AC2.1 (render), AC2.2, AC2.3, AC4.2 (view), AC8.1, AC8.2, AC8.4, AC9.1, AC9.2, AC9.3 |
| `test/sync-status-feeds.ts` | new (browser-component) | AC3.1–AC3.5 (render), AC8.3, AC10.1, AC10.2, AC10.3, AC11.1, AC11.2 |
| `test/sync-status-header.ts` | new (browser-component; may instead extend the header test) | AC1.1, AC1.2, AC1.3 |

All new files are wired into `test/browser-tests.ts` as side-effect imports.
