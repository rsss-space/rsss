# Correctness Audit — Phase 1: `.one()` zero-row crash + DO test-fake fix

**Goal:** Stop production 500s on the normal zero-row path by replacing
optional-row `SqlStorageCursor.one()` calls with a null-safe read, and close
the test-suite blind spot by making the Durable Object test fake model real
`.one()` semantics.

**Architecture:** Cloudflare's `SqlStorage` cursor `.one()` is typed
non-nullable (`worker-configuration.d.ts`) and **throws at runtime** when the
query returns zero (or more than one) rows. Many call sites do
`.one() as T | null` then `if (!row)` — a guard that never executes because
the throw fires first. We replace every *optional-row* `.one()` with
`.toArray()[0] ?? null` (leaving guaranteed-singleton queries such as
`SELECT COUNT(*)` untouched). Separately, every DO test file currently
defines its own fake cursor whose `one()` returns `rows[0] ?? null` — the
*opposite* of production — so the entire DO suite is blind to this bug class.
We introduce one shared test fake whose `one()` throws on a non-singleton
result, and migrate all DO test files onto it.

**Tech Stack:** TypeScript (Cloudflare Workers, ES2022 lib),
`@cloudflare/workers-types`, Durable Object SQLite (`ctx.storage.sql`).
Tests: `@substrate-system/tapzero`, run via `npm test`
(`node test/run-all-tests.mjs`), bundled with esbuild.

**Scope:** Phase 1 of 8. Derived from audit finding **P0 #1** in
`/Users/nick/code/rsss/correctness-audit-2026-06-10.md`.

**Codebase verified:** 2026-06-11 (codebase-investigator). Audit line numbers
had drifted 2–5 lines; current locations are recorded below. Investigation
found the bug class is ~3× larger than the audit's 8 cited sites: ~25–27
optional-row `.one()` calls exist across `src/server`, and there is **no
shared test fake** — 17 test files each define their own faulty `one()`.

---

## Acceptance Criteria Coverage

This phase implements and tests (ACs derived from audit P0 #1):

### correctness-audit.AC1: Optional-row DO queries return null, not 500, on zero rows
- **correctness-audit.AC1.1 Success:** `followUser` for a target the user does
  not already follow completes the follow (happy path), instead of 500.
- **correctness-audit.AC1.2 Success:** `unfollowUser` existing-check on a
  not-followed target returns gracefully (no throw).
- **correctness-audit.AC1.3 Failure→handled:** `GET /graph/follow/:targetDid`
  for a target the user does not follow returns a normal "not following"
  response (200), not 500.
- **correctness-audit.AC1.4 Failure→handled:** feed-by-id endpoints
  (`publish`, `unpublish`, `PATCH`, `refresh`) return 404 for a
  missing/deleted feed id, not 500.
- **correctness-audit.AC1.5 Failure→handled:** registry `GET /lookup/:did` for
  an unregistered DID returns its not-found response, not 500.

### correctness-audit.AC2: DO test fake models real `.one()` semantics
- **correctness-audit.AC2.1 Failure:** the shared test fake `one()` throws when
  the result set has zero rows.
- **correctness-audit.AC2.2 Failure:** the shared test fake `one()` throws when
  the result set has more than one row.
- **correctness-audit.AC2.3 Success:** the full `npm test` suite passes after
  every DO test file is migrated to the shared fake.

---

## Notes for the executor

- **Do NOT change** `.one()` calls that are guaranteed to return exactly one
  row: `SELECT COUNT(*)`, `MAX(...)`, single-row `UPDATE ... RETURNING`, and
  the `user_state` singleton (`WHERE id = 1`). The investigator counted ~8
  such safe sites. Touching them adds churn and risk.
- The canonical replacement is: `const row = cursor.toArray()[0] ?? null`
  (or `[...cursor][0] ?? null`). Preserve any existing `as T | null` cast on
  the resulting variable so downstream typing is unchanged.
- The order of tasks matters: **fix all production sites first (Tasks 1–3),
  then flip the test fake (Tasks 4–5).** If you flip the fake first, the suite
  will redden across unrelated tests and obscure your progress.
- Findings file with the full grep + classification:
  `/tmp/plan-2026-06-11-correctness-audit-12661ed6/phase1-findings.md`.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Fix the eight audit-cited optional-row `.one()` sites

**Verifies:** correctness-audit.AC1.1, AC1.2, AC1.3, AC1.4, AC1.5

**Files:**
- Modify: `src/server/durable-objects/index.ts` at these current locations
  (verify each before editing — quote the surrounding code):
  - `followUser` existing-check (~1123–1128): `SELECT rkey FROM graph_follows
    WHERE subject_did = ?`
  - `unfollowUser` existing-check (~1179–1184): same query
  - `GET /graph/follow/:targetDid` follow-status (~2332–2335): same query
  - `POST /feeds/:id/publish` (~1664–1669): `SELECT * FROM feeds WHERE id = ?`
  - `DELETE /feeds/:id/publish` (~1686–1691): same
  - `PATCH /feeds/:id` (~1720–1723): same
  - `POST /feeds/:id/refresh` (~1754–1758): same
- Modify: `src/server/durable-objects/registry.ts`
  - `GET /lookup/:did` (~77–82): `SELECT ... FROM known_users WHERE did = ?`

**Implementation:**
For each site, replace the `.one()` read with a `.toArray()[0] ?? null` read,
keeping the existing null-guard (which now actually executes). Example
transform:

```ts
// BEFORE — throws on zero rows; the guard below is dead code
const existing = this.sql
    .exec('SELECT rkey FROM graph_follows WHERE subject_did = ?', targetDid)
    .one() as { rkey:string } | null
if (existing) { /* ... */ }

// AFTER — returns null on zero rows; guard now reachable
const existing = this.sql
    .exec('SELECT rkey FROM graph_follows WHERE subject_did = ?', targetDid)
    .toArray()[0] as { rkey:string } | undefined ?? null
if (existing) { /* ... */ }
```

Keep the column/shape cast identical to what the code uses today. Do not
change the surrounding control flow except to ensure the existing
"missing → 404 / not-following" branch is what runs on the null case.

**Testing:**
The behavioral tests for these sites are written in Tasks 4–5 against the
corrected test fake (the fake must throw before these tests are meaningful).
This task is the production fix; verification here is type-check + build.

**Verification:**
Run: `npm run lint` and the project's type-check (`npx tsc --noEmit` if wired,
otherwise the build). Expected: no new errors.

**Commit:** `fix(do): null-safe .one() at eight audit-cited optional-row sites`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Sweep and fix the remaining optional-row `.one()` sites in `src/server`

**Verifies:** correctness-audit.AC1 (completeness — prevents the same crash at
the ~17–19 sites the audit did not enumerate)

**Files:**
- Modify: `src/server/durable-objects/index.ts` (remaining optional-row sites)
- Modify: any other `src/server/**` file containing optional-row `.one()`
  (investigator counted ~25–27 optional-row total; ~7 live outside
  `index.ts`/`registry.ts`).

**Implementation:**
1. Enumerate every `.one()` in `src/server`:
   `rg -n '\.one\(\)' src/server`
2. Classify each as **guaranteed-singleton** (leave alone) or **optional-row**
   (fix). Guaranteed-singleton = `COUNT(*)`, `MAX/MIN/SUM(...)`,
   `... RETURNING` from a single-row write, or `WHERE <pk> = <literal>` that is
   known to exist (e.g. the `user_state` `id = 1` singleton). Everything that
   selects `WHERE <non-pk-or-possibly-absent> = ?` is optional-row.
3. Apply the same `.toArray()[0] ?? null` transform from Task 1 to each
   optional-row site, preserving casts and guards.
4. When in doubt about a borderline site, treat it as optional-row (the
   null-safe form is always behaviorally correct; the throw form is the bug).

**Testing:**
No new behavioral tests required for this sweep beyond Tasks 4–5; the shared
fake (Task 4) will throw on any optional-row site still using `.one()` that a
test exercises, surfacing misses. Verification is build + full suite (Task 5).

**Verification:**
Run: `rg -n '\.one\(\)' src/server` and manually confirm every remaining
`.one()` is a documented guaranteed-singleton (add a brief trailing comment
`// guaranteed single row: COUNT(*)` at each kept site so future audits don't
re-flag it). Run `npm run lint`.

**Commit:** `fix(do): null-safe .one() across remaining optional-row queries`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Confirm `this.sql` is real SqlStorage (no code change)

**Verifies:** (context only — no AC)

**Files:**
- Read-only: `src/server/durable-objects/index.ts` (~465,
  `this.sql = ctx.storage.sql`).

**Implementation:**
Confirm `this.sql` is assigned from `ctx.storage.sql` (the real SqlStorage,
which throws on `.one()` zero-row), not a wrapper that softens it. This
verifies the fix is necessary and complete. No edit. Record the confirmation
in the commit body of Task 2 if not already committed; otherwise skip the
commit (this is a read-only verification step).

**Verification:**
Run: `rg -n 'this\.sql\s*=' src/server/durable-objects/index.ts`
Expected: assignment from `ctx.storage.sql`.

**Commit:** none (verification only).
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->

<!-- START_TASK_4 -->
### Task 4: Create a shared DO SQL test fake whose `one()` throws on non-singleton

**Verifies:** correctness-audit.AC2.1, AC2.2

**Files:**
- Create: `test/helpers/sql-fake.ts` (confirm the directory; if `test/helpers`
  does not exist, create it — the investigator found no shared helper today).
- Test: covered by Task 5's migration + the suite run.

**Implementation:**
Provide a single factory that returns a fake `SqlStorage`-style query result
matching the production contract: `toArray()` returns all rows; `one()`
**throws** unless exactly one row is present. Mirror the exact method surface
the existing per-file fakes expose (the investigator found the recurring
shape below — match whatever the current fakes provide, e.g. `columnNames`,
`rowsRead`, iterator, if any test relies on them):

```ts
export interface FakeQueryResult<T = Record<string, unknown>> {
    toArray():T[]
    one():T
    // add any other members the current per-file fakes expose
}

export function fakeResult<T = Record<string, unknown>> (
    rows:T[]
):FakeQueryResult<T> {
    return {
        toArray () { return rows },
        one () {
            // Match Cloudflare SqlStorage: throws unless exactly one row.
            if (rows.length !== 1) {
                throw new Error(
                    'SqlStorageCursor.one(): expected exactly one row, got ' +
                    rows.length
                )
            }
            return rows[0]!
        }
    }
}
```

Also export whatever helper the per-file fakes use to build a fake
`ctx.storage.sql.exec(...)` so Task 5 can swap each file's local definition
for an import. Keep the public shape identical to today's local fakes so the
migration is mechanical.

**Testing:**
Add a focused unit test for the fake itself (it is test infrastructure, but
its throw-semantics are the whole point):
- AC2.1: `fakeResult([]).one()` throws.
- AC2.2: `fakeResult([a, b]).one()` throws.
- `fakeResult([a]).one()` returns `a`; `fakeResult([]).toArray()` is `[]`.

Place the test at `test/helpers/sql-fake.test.ts` (or wire it into the
existing runner per project convention — check `test/run-all-tests.mjs` for
how test files are registered, and register it the same way).

**Verification:**
Run: `npm test` filtered to the new test if the runner supports it, else full
`npm test`. Expected: the three fake-semantics assertions pass.

**Commit:** `test(do): add shared SQL fake with real one() throw semantics`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Migrate all DO test files to the shared fake and make the suite green

**Verifies:** correctness-audit.AC1.1–AC1.5 (now actually exercised),
correctness-audit.AC2.3

**Files (all in `test/`, migrate the local `one()` fake to import the shared
one from Task 4):**
- `test/graph-follow.ts`, `test/graph-following.ts`, `test/registry.ts`,
  `test/feed-cursor.ts`, `test/fetch-full-endpoint.ts`, `test/do-handlers.ts`,
  `test/do-migrations.ts`, `test/oauth-credential-persistence.ts`,
  `test/account-deletion-alarm.ts`, `test/server-foreign-keys.ts`,
  `test/store-full-content-endpoint.ts`, `test/fetch-full-body-blur.ts`,
  `test/profile-api.ts`, `test/alarm.ts`, `test/item-route.ts`,
  `test/feed-create.ts`, `test/feed-cache-column.ts`
  (17 files — re-grep to confirm the current set:
  `rg -ln 'one\s*\(\s*\)\s*\{' test`).

**Implementation:**
1. In each file, delete the local `function result(...)` / inline `one()` fake
   and import `fakeResult` (and any companion helper) from
   `test/helpers/sql-fake.ts`.
2. Run the suite. Where a test now fails because `one()` throws on a path the
   production code still calls with `.one()`, that is a **real missed site** —
   go back and fix it under Task 2's pattern (null-safe read). Do **not**
   "fix" it by softening the fake.
3. Add the AC1 behavioral assertions that the old fakes made impossible:
   - AC1.1: in the graph-follow test, follow a target with **no** pre-existing
     `graph_follows` row and assert the follow succeeds (no throw / expected
     status).
   - AC1.2: unfollow path existing-check on a not-followed target returns
     gracefully.
   - AC1.3: `GET /graph/follow/:targetDid` for a non-followed target returns
     the "not following" response (200), not an error.
   - AC1.4: a feed-by-id endpoint (`publish`) for a non-existent id returns
     404.
   - AC1.5: registry `GET /lookup/:did` for an unregistered DID returns its
     not-found response.
   Follow the existing per-file test style (tapzero `test(...)` blocks,
   how each file builds the fake DO state).

**Testing:**
These ARE the tests. Each assertion above maps to an AC1 case.

**Verification:**
Run: `npm test`
Expected: full suite passes (AC2.3), including the new AC1 assertions. No DO
test file defines its own `one()` fake anymore
(`rg -n 'one\s*\(\s*\)\s*\{' test` returns only `test/helpers/sql-fake.ts`).

**Commit:** `test(do): migrate DO tests to shared fake; cover zero-row paths`
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->
