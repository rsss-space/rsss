# Sync Status Detail (`/sync-status`) Implementation Plan

**Goal:** Build a client-only authenticated `/sync-status` page that lists
everything currently failing in the sync pipeline (transient sync error,
dead-lettered outbox ops, failed feeds) with per-row remediation.

**Architecture:** A new Preact route reads the local SQLite mirror via the
existing `queryDb`/`execDb` helpers and reuses existing remediation endpoints
(`/api/feeds/:id/refresh`, `/api/feeds/:id/publish`, the `delete_feed` outbox
op). No server or schema changes. New dead-letter requeue/discard transactions
live in `push-sync.ts` (mirroring `moveOutboxRowToDeadLetters` in reverse);
`State` methods orchestrate them and kick `runSync`.

**Tech Stack:** TypeScript (browser, ES2022 via Vite), Preact +
`@preact/signals`, `htm/preact`, in-browser SQLite (`@sqlite.org/sqlite-wasm`),
`@substrate-system/tapzero` + `@substrate-system/tapout` for tests.

**Scope:** 6 phases (all phases from the design).

**Codebase verified:** 2026-06-18 (via codebase-investigator).

---

## Phase 1: Read layer

**Goal:** Query the local DB for the two problem lists, and provide a pure
op-description helper plus pure failed-feed partition predicates.

---

## Acceptance Criteria Coverage

This phase implements and tests the data-layer and pure-logic portions of:

### sync-status-detail.AC2: Blocked local changes are listed
- **sync-status-detail.AC2.1 Success:** Each `dead_letter_outbox` row appears as
  a row in the "Blocked local changes" section.
  *(Phase 1 owns the data read — `listDeadLetterOutbox` returns one row per
  `dead_letter_outbox` row. The rendering assertion lands in Phase 4.)*

### sync-status-detail.AC3: Failed feeds are listed and partitioned
- **sync-status-detail.AC3.1 Success:** A feed with `last_error` (or
  `last_status >= 400`) appears under "Feeds that couldn't fetch".
- **sync-status-detail.AC3.2 Success:** A feed with `publish_error` appears under
  "Feeds that couldn't share to Bluesky".
- **sync-status-detail.AC3.3 Edge:** A feed with both a fetch error and a publish
  error appears in both sections.
- **sync-status-detail.AC3.4 Edge:** A feed with no error appears in neither
  section.
  *(Phase 1 owns the query filter + the pure `isFetchFailed`/`isPublishFailed`
  predicates that drive the partition. The rendering lands in Phase 5.)*

### sync-status-detail.AC6: Op descriptions
- **sync-status-detail.AC6.1 Success:** Known ops render a human-readable
  description derived from the payload.
- **sync-status-detail.AC6.2 Edge:** An unrecognized op renders a safe fallback
  description (no crash).

---

## Verified codebase facts (read before implementing)

- `src/client/db/push-sync.ts`
  - Private `interface OutboxRow` (lines ~43-52) has exactly the 8 columns:
    `id, op, target_id, payload, client_op_id, client_updated_at, attempts,
    last_error`. The `dead_letter_outbox` table (`src/shared/schema.ts`
    ~119-130) has the IDENTICAL columns.
  - `getDeadLetterOutboxCount(db:Sqlite3Db):Promise<number>` and
    `getOutboxCount(db:Sqlite3Db):Promise<number>` already exist (~59-75) and
    use `queryDb<{ n:number }>`.
  - `queryDb` is imported here from `./local-db.js`.
  - `Sqlite3Db` is imported from `./sqlite-init.js`.
- `src/client/db/local-adapter.ts`
  - `db` is the open handle in scope (passed to `createLocalAdapter(db)`).
  - The adapter method `getFeeds()` does
    `queryDb<Feed>(db, 'SELECT * FROM feeds ORDER BY title ASC')` (~94-100).
  - `queryDb` and `execDb` are already imported from `./local-db.js`; `Feed`
    from `./types.js`.
- `src/client/db/types.ts` — `Feed` (lines ~9-25) has
  `last_error:string|null`, `last_status:number|null`,
  `publish_error?:string|null`, plus `id:number`, `url:string`,
  `title:string|null`, `site_url:string|null`.
- Outbox op vocabulary (authoritative — from the adapter + push-sync encoder):
  - `'add_feed'` — `target_id` = feed id, `payload` = `{ url:string }`
  - `'delete_feed'` — `target_id` = feed id, `payload` = `{ id:number }`
  - `'update_item'` — `target_id` = item id,
    `payload` = `{ id:number, is_read?:boolean, is_starred?:boolean }`
  - `'mark_all_read'` — `target_id` = feed id | `null`,
    `payload` = `{ feedId:number }` or `{}`
  - Unknown ops are skipped silently by the push encoder; `describeOp` must not
    throw on them.
- `describeOp` MUST be pure (no DB access). For `delete_feed` the feed row is
  already deleted locally, so the only data available is `target_id` — name it
  by id, not by title.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: `DeadLetterRow` type + `listDeadLetterOutbox` read

**Verifies:** sync-status-detail.AC2.1 (data read)

**Files:**
- Modify: `src/client/db/push-sync.ts` (add an exported type + function near
  `getDeadLetterOutboxCount`, ~line 67)
- Test: `test/push-sync.ts` (existing suite for this module; add cases)

**Implementation:**
- Export an interface `DeadLetterRow` with exactly these fields (matches the
  `dead_letter_outbox` columns):
  ```ts
  export interface DeadLetterRow {
      id:number
      op:string
      target_id:number|null
      payload:string
      client_op_id:string
      client_updated_at:string
      attempts:number
      last_error:string|null
  }
  ```
- Export `listDeadLetterOutbox(db:Sqlite3Db):Promise<DeadLetterRow[]>` that runs
  `SELECT id, op, target_id, payload, client_op_id, client_updated_at,
  attempts, last_error FROM dead_letter_outbox ORDER BY id ASC` via
  `queryDb<DeadLetterRow>`. Mirror the style of the existing
  `getOutboxRows`/`getDeadLetterOutboxCount` helpers.

**Testing:**
Follow the existing `test/push-sync.ts` pattern (real DB via `openLocalDb` with
a unique test DID; seed `dead_letter_outbox` rows with `execDb`/`db.exec`; clean
up in `finally`). Verify:
- sync-status-detail.AC2.1: after seeding N dead-letter rows,
  `listDeadLetterOutbox(db)` returns N rows, ordered by `id` ascending, each
  carrying `op`, `attempts`, and `last_error` intact. With zero rows it returns
  `[]`.

`test/push-sync.ts` already exists and is wired into `test/browser-tests.ts`
(the consolidated browser bundle) — just add cases to it, adding dead-letter
seeding helpers following the file's own conventions.

**Verification:**
Authoritative gate: `npm test` (runs `node test/run-all-tests.mjs`, which bundles
`test/push-sync.ts` via `npm run test:browser`). You may run `npm run test:browser`
(or the focused `npm run test:push-sync`) for a faster inner loop.
Expected: all tests pass.

**Commit:** `feat: add listDeadLetterOutbox read for sync-status page`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: `listFailedFeeds` read

**Verifies:** sync-status-detail.AC3.4 (no-error feeds excluded)

**Files:**
- Modify: `src/client/db/local-adapter.ts` (add an exported standalone function
  beside `getFeeds`)
- Test: `test/local-adapter.ts` (existing suite; add cases)

**Implementation:**
- Export `listFailedFeeds(db:Sqlite3Db):Promise<Feed[]>` running:
  ```sql
  SELECT * FROM feeds
  WHERE last_error IS NOT NULL
     OR last_status >= 400
     OR publish_error IS NOT NULL
  ORDER BY title ASC
  ```
  via `queryDb<Feed>`. Export it as a standalone function (it takes `db`
  explicitly), not as an adapter method — the design's contract is
  `listFailedFeeds(db)`.

**Testing:**
Follow the existing `test/local-adapter.ts` pattern (`openLocalDb` + seed feeds
via SQL + assert). Verify:
- sync-status-detail.AC3.4: seed a mix of feeds — one clean (no error), one with
  `last_error`, one with `last_status >= 400`, one with `publish_error`, one
  with both a fetch and a publish error. Assert the clean feed is NOT returned
  and every errored feed IS returned (count + ids).

**Verification:**
Authoritative gate: `npm test`. `test/local-adapter.ts` already exists and is
wired into `test/browser-tests.ts` — just add cases. For a faster inner loop run
`npm run test:browser` (or the focused `npm run test:local-adapter`).
Expected: all tests pass.

**Commit:** `feat: add listFailedFeeds read for sync-status page`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Pure `describeOp` helper

**Verifies:** sync-status-detail.AC6.1, sync-status-detail.AC6.2

**Files:**
- Create: `src/client/routes/sync-status-format.ts`
- Test: `test/sync-status-format.ts` (new; pure logic, no DB)

**Implementation:**
Create a pure module exporting
`describeOp(row:DeadLetterRow):string`. Import the `DeadLetterRow` type from
`../db/push-sync.js`. The function:
- Parses `row.payload` JSON inside a `try/catch`; on parse failure treat the
  payload as `{}` (never throw).
- Switches on `row.op` and returns a concise human-readable label derived from
  the payload + `target_id`:
  - `add_feed` → use `payload.url` when it is a string, else fall back to the
    feed id (`target_id`).
  - `delete_feed` → describe by feed id (`target_id`); the feed row is gone, so
    no title is available.
  - `update_item` → describe by which fields changed (`is_read` / `is_starred`
    present in payload) and the item id (`target_id`).
  - `mark_all_read` → distinguish single-feed (`target_id != null`) from global
    (`target_id == null`).
  - `default` → a safe fallback that includes the raw `op` string, never
    throwing.
- Keep every line <= 80 columns; no spaces between `:` and type annotations.

**Testing:**
Pure unit tests with `@substrate-system/tapzero`. Build `DeadLetterRow` literals
(no DB needed). Verify:
- sync-status-detail.AC6.1: each known op (`add_feed`, `delete_feed`,
  `update_item` with read vs starred, `mark_all_read` single vs global)
  produces a non-empty, distinct description string. (Assert on structure /
  that distinct ops produce distinct, non-empty output — do NOT assert exact
  copy, per project test rules.)
- sync-status-detail.AC6.2: an unrecognized op (e.g. `'frobnicate'`) and a row
  whose `payload` is invalid JSON both return a non-empty string and do not
  throw.

Wire `test/sync-status-format.ts` in by adding `import './sync-status-format.js'`
to `test/browser-tests.ts` — the same side-effect-import pattern sibling pure
suites use (e.g. `publisher-link`, `article-extract`). No new `package.json`
script is needed (one bundle).

**Verification:**
Authoritative gate: `npm test`. Faster inner loop: `npm run test:browser`.
Expected: all tests pass; `npm run lint` clean.

**Commit:** `feat: add pure describeOp helper for sync-status page`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Pure failed-feed partition predicates

**Verifies:** sync-status-detail.AC3.1, sync-status-detail.AC3.2,
sync-status-detail.AC3.3, sync-status-detail.AC3.4

**Files:**
- Modify: `src/client/routes/sync-status-format.ts` (add two predicates)
- Test: `test/sync-status-format.ts` (extend)

**Implementation:**
Add two pure predicates (import `Feed` from `../db/types.js`):
- `isFetchFailed(feed:Feed):boolean` — true when `last_error` is non-null OR
  `last_status` is non-null and `>= 400`.
- `isPublishFailed(feed:Feed):boolean` — true when `publish_error` is non-null.

These are the single source of truth for the Phase 5 partition.

**Testing:**
Pure unit tests with `Feed` literals. Verify:
- sync-status-detail.AC3.1: a feed with `last_error` set, and (separately) a
  feed with `last_status = 500`, are `isFetchFailed === true`.
- sync-status-detail.AC3.2: a feed with `publish_error` set is
  `isPublishFailed === true`.
- sync-status-detail.AC3.3: a feed with both → both predicates true.
- sync-status-detail.AC3.4: a clean feed → both predicates false. Also confirm
  `last_status` below 400 (e.g. 200, 304) is NOT a fetch failure.

**Verification:**
Authoritative gate: `npm test`. Faster inner loop: `npm run test:browser`.
Expected: all tests pass; `npm run lint` clean.

**Commit:** `feat: add failed-feed partition predicates for sync-status page`
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

---

**Done when:** `listDeadLetterOutbox`, `listFailedFeeds`, `describeOp`,
`isFetchFailed`, and `isPublishFailed` exist with passing tests covering
sync-status-detail.AC2.1 (data read), AC3.1-AC3.4 (partition logic), and
AC6.1-AC6.2 (op description). `npm run lint` is clean.
