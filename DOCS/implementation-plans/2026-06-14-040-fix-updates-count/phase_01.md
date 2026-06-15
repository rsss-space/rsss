# "N updates" Count Accuracy + Freshness — Phase 1

**Goal:** Pin the already-correct pending-count math in `getFeedUpdateCounts()`
with a regression test so the predicate can't silently break later.

**Architecture:** No production code changes. Add a regression test that
(a) asserts the exact SQL predicate `getFeedUpdateCounts()` emits, and
(b) asserts the per-feed → count mapping (including the per-feed sum that
backs the header total). This is a "lock in correctness" phase only.

**Tech Stack:** TypeScript (Cloudflare Workers/DO runtime, ES2022), the DO
SQL fake at `test/helpers/sql-fake.ts`, `@substrate-system/tapzero`, run in
the consolidated browser bundle via `test/index.ts`.

**Scope:** Phase 1 of 4.

**Codebase verified:** 2026-06-14

**Skills to activate (executor):** `ed3d-house-style:howto-code-in-typescript`,
`superpowers:test-driven-development`, `ed3d-house-style:writing-good-tests`.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### 040-fix-updates-count.AC1: Pending-count math is correct and pinned
- **040-fix-updates-count.AC1.1 Success:** `getFeedUpdateCounts()` counts,
  per feed, items with `pub_date > last_pulled_at`.
- **040-fix-updates-count.AC1.2 Success:** a feed with `last_pulled_at IS
  NULL` counts all its items that have a non-null `pub_date`.
- **040-fix-updates-count.AC1.3 Success:** the header total equals the sum of
  the per-feed counts (one source of truth).
- **040-fix-updates-count.AC1.4 Edge:** items with `pub_date IS NULL`, and
  items where `pub_date == last_pulled_at` (boundary), are excluded from the
  count.

---

## Verified codebase facts (read before starting)

- `getFeedUpdateCounts()` lives in
  `src/server/durable-objects/index.ts:736-759`. It runs ONE SQL query and
  returns `Record<string, number>` (feed-id string → pending count). Current
  body:

  ```ts
  getFeedUpdateCounts ():Record<string, number> {
      const rows = this.sql.exec(`
          SELECT
              feeds.id AS id,
              COUNT(items.id) AS pending_count
          FROM feeds
          LEFT JOIN items
              ON items.feed_id = feeds.id
              AND items.pub_date IS NOT NULL
              AND (
                  feeds.last_pulled_at IS NULL
                  OR items.pub_date > feeds.last_pulled_at
              )
          GROUP BY feeds.id
      `).toArray() as Array<{
          id:number|string
          pending_count:number|string|null
      }>

      return rows.reduce<Record<string, number>>((counts, row) => {
          counts[String(row.id)] = Number(row.pending_count ?? 0)
          return counts
      }, {})
  }
  ```

- **Critical testing note — the SQL fake does not execute SQL.**
  `test/helpers/sql-fake.ts` `fakeResult(rows)` returns whatever canned rows
  you hand it; it does not interpret the query. Therefore feeding canned rows
  to `getFeedUpdateCounts()` only exercises the JS row→map reduction, NOT the
  `>` / `IS NULL` / `IS NOT NULL` SQL predicate. To pin the predicate
  (AC1.1, AC1.2, AC1.4) you MUST capture and assert the **query string** the
  method passes to `this.sql.exec(...)`. This is the established project
  pattern: `test/feed-cursor.ts:~1099` ("advanceFeedCursor SQL sets
  last_pulled_at = MAX(pub_date)") already pins `advanceFeedCursor()` by
  asserting its query text. Follow that precedent.

- `test/feed-cursor.ts:~750` ("GET /feeds includes per-feed update counts from
  cached items") already exercises the row→map mapping with faked rows, and is
  imported into the runner via `test/index.ts:36` (`import './feed-cursor.js'`).
  **Add the new regression test to `test/feed-cursor.ts`** — no test-runner
  wiring change is needed.

- The DO test harness in `test/feed-cursor.ts` builds the DO via
  `Object.create(RsssUserDO.prototype)` with a fake `sql` whose `exec(query,
  ...params)` inspects the query string and returns `fakeResult([...])`. Reuse
  that local harness style; do not invent a new one.

- Schema (`src/shared/schema.ts`): `feeds.last_pulled_at TEXT` and
  `items.pub_date TEXT` are ISO-8601 strings.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Regression test pinning `getFeedUpdateCounts()`

**Verifies:** 040-fix-updates-count.AC1.1, .AC1.2, .AC1.3, .AC1.4

**Files:**
- Modify (add tests): `test/feed-cursor.ts`
- No production code changes.

**Implementation (test design):**

Add a `test(...)` block to `test/feed-cursor.ts` that constructs a DO instance
with a fake `sql` (mirroring the existing harness in that file). The fake's
`exec` must (1) record the query string when it matches the update-counts
query, and (2) return canned `{ id, pending_count }` rows for that query.

The single test (or a small cluster of `t.*` assertions) must cover two
independent dimensions:

1. **Predicate pinning (AC1.1, AC1.2, AC1.4)** — capture the query string
   passed to `this.sql.exec` by `getFeedUpdateCounts()`, normalize whitespace
   (`query.replace(/\s+/g, ' ').trim()`), then assert it CONTAINS each of:
   - `items.pub_date IS NOT NULL` — excludes null-`pub_date` items (AC1.4).
   - `feeds.last_pulled_at IS NULL` — the never-pulled branch (AC1.2).
   - `items.pub_date > feeds.last_pulled_at` — the strict `>` predicate
     (AC1.1, and the boundary exclusion in AC1.4). Asserting the exact
     `> feeds.last_pulled_at` fragment fails if `>` is changed to `>=`
     (which would render `>= feeds.last_pulled_at`, breaking the substring).
   - `GROUP BY feeds.id` — per-feed grouping that makes the total a sum of
     per-feed counts (AC1.3).

   Add a short comment in the test explaining WHY the predicate is pinned via
   the query string (the SQL fake does not execute SQL), citing the
   `advanceFeedCursor` precedent.

2. **Mapping + header-total (AC1.3)** — have the fake return a mixed fixture,
   e.g. rows representing:
   - a never-pulled feed (its canned `pending_count` = all its non-null
     `pub_date` items),
   - a pulled feed with some newer items (`pending_count` > 0),
   - a feed whose only items are at/under the boundary or null `pub_date`
     (`pending_count` = 0), and
   - a row with `pending_count: null` (must coerce to `0` via `?? 0`).

   Assert that `getFeedUpdateCounts()` returns the expected
   `Record<string, number>` (each feed id → its number), and that
   `Object.values(result).reduce((a, b) => a + b, 0)` equals the expected
   header total. This pins AC1.3 ("header total = sum of per-feed counts") and
   the `null → 0` coercion.

Follow house TypeScript style (no space before type-annotation colons, ternary
style, ≤80 cols). Do NOT assert on any HTML/DOM text. Do NOT test the SQL by
relying on the fake to compute counts.

**Testing:**
Tests must verify each AC listed above:
- AC1.1: normalized query contains `items.pub_date > feeds.last_pulled_at`.
- AC1.2: normalized query contains `feeds.last_pulled_at IS NULL`.
- AC1.3: summed per-feed counts equal the expected total.
- AC1.4: normalized query contains `items.pub_date IS NOT NULL` and the strict
  `>` (no `>=`); a `null` `pending_count` row maps to `0`.

**Verification:**
Run the feed-cursor suite directly for a fast loop:
```bash
esbuild ./test/feed-cursor.ts --bundle \
  --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts | tapout
```
Expected: all assertions pass (TAP all-green, no `console.error`).

**Commit:** `test: pin getFeedUpdateCounts pending-count predicate (040 AC1)`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Prove the test actually pins the predicate (mutation check)

**Verifies:** 040-fix-updates-count.AC1.1, .AC1.4 (test efficacy)

**Files:**
- Temporary local edit to `src/server/durable-objects/index.ts` (reverted).

**Implementation:**
This is a verification-only step to prove the new test is not vacuous.

1. Temporarily change the predicate in `getFeedUpdateCounts()` from
   `items.pub_date > feeds.last_pulled_at` to
   `items.pub_date >= feeds.last_pulled_at`.
2. Re-run the feed-cursor suite (command from Task 1).
3. Confirm the predicate-pinning assertion now FAILS.
4. Revert the change (restore `>`), re-run, confirm green again.

Do NOT commit the temporary mutation. If the test still passes with `>=`, the
assertion is too loose — fix the test (it must key on the exact `>` fragment)
before proceeding.

**Verification:**
- With `>=`: the predicate assertion fails.
- With `>` restored: suite green.

**Commit:** none (verification only; working tree must be clean of the
mutation before the phase ends).
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

---

## Phase Done When

- New regression test is in `test/feed-cursor.ts` and passes.
- The mutation check (Task 2) proved the test fails when `>` is changed to
  `>=`, and the working tree no longer contains that mutation.
- `npm test && npm run lint` is green.

**Covers:** 040-fix-updates-count.AC1.1, .AC1.2, .AC1.3, .AC1.4
