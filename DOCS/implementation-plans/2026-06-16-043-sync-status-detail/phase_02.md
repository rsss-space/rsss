# Sync Status Detail (`/sync-status`) — Phase 2

**Goal:** Add the primitives to retry (requeue) and discard a dead-lettered op:
a transactional DB-layer requeue/remove pair in `push-sync.ts`, plus two thin
`State` orchestration methods that kick `runSync` and refresh the count signals.

**Codebase verified:** 2026-06-18 (via codebase-investigator).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### sync-status-detail.AC4: Blocked changes can be retried or discarded
- **sync-status-detail.AC4.1 Success:** Retry moves the row from
  `dead_letter_outbox` back into `outbox` with `attempts` reset to 0 and
  `last_error` cleared.
- **sync-status-detail.AC4.2 Success:** Retry removes the row from view and
  decrements the dead-letter count signal.
- **sync-status-detail.AC4.3 Success:** Discard deletes the `dead_letter_outbox`
  row and decrements the count.
- **sync-status-detail.AC4.4 Failure:** If the requeue transaction fails, neither
  table is left partially modified (atomic) and the row remains dead-lettered.
- **sync-status-detail.AC4.5 Edge:** A retried op that fails again returns to
  `dead_letter_outbox` with refreshed `last_error`.

---

## Verified codebase facts (read before implementing)

- `src/client/db/push-sync.ts`
  - `moveOutboxRowToDeadLetters(db, row, error)` (~101-129) is the forward
    transaction to mirror: `BEGIN` → `INSERT INTO dead_letter_outbox (op,
    target_id, payload, client_op_id, client_updated_at, attempts, last_error)`
    → `DELETE FROM outbox WHERE id = row.id` → `COMMIT`. Phase 2 builds the
    reverse.
  - `getOutboxCount(db)` and `getDeadLetterOutboxCount(db)` exist (~59-75).
  - `execDb`/`queryDb` imported from `./local-db.js`; `Sqlite3Db` from
    `./sqlite-init.js`. `DeadLetterRow` added in Phase 1.
  - Transaction idiom in the codebase (from `local-adapter.ts` `addFeed`,
    ~104-124): `await execDb(db, 'BEGIN')`; `try { ...; await execDb(db,
    'COMMIT') } catch (err) { await execDb(db, 'ROLLBACK'); throw err }`.
  - `client_op_id` is `UNIQUE` in both `outbox` and `dead_letter_outbox`. A
    dead-lettered row was removed from `outbox` when it was dead-lettered, so
    reusing its `client_op_id` on requeue is safe and preserves the server-side
    idempotency key.
- `src/client/db/sync.ts` — `runSync(db, fetchFn?):Promise<void>` (~86) is the
  canonical push-sync kick; it dedupes in-flight syncs and, on completion,
  calls `setSyncDone(getOutboxCount(db), getDeadLetterOutboxCount(db))`.
  Imported in `state.ts` as `import { runSync } from './db/sync.js'`.
- `src/client/db/sync-status.ts` — `syncStatus`, `syncError`, `syncPending`,
  `syncDeadLetters` signals; `setSyncDone(pending, deadLetters?)` recomputes
  `syncStatus` (warning if deadLetters>0 else idle/offline) **and clears
  `syncError`**.
- `src/client/state.ts`
  - Methods follow `State.method = async function (state, ...) { ... }`.
  - DB handle access pattern (from `runResolveConvergence`, ~490-494): a
    test-injectable `_getLocalDbImpl(did)` returns `Sqlite3Db|null`, and
    `_runSyncImpl(db)` is the injectable bound `runSync`. Use these seams for
    testability. The setter `_setRunResolveConvergenceDepsForTest`
    (`state.ts` ~420-437) already injects both — `test/resolve-convergence-trackrefresh.ts`
    (~line 92) is the working example to mirror (inject a real `openLocalDb`,
    stub `runSync`). Reuse that seam; only add a new `_set*ForTest` setter
    (following `_setAddFeedAdapterForTest`) if these new methods need one the
    existing setter does not provide.
  - `state.user.value?.did` gives the current DID.

**Important correctness constraint (AC7 interaction):** Refreshing counts after
discard/retry must NOT clobber a genuine transient `syncError`. `setSyncDone`
clears `syncError` and forces `syncStatus` away from `'error'`; calling it
unconditionally would hide the "Current sync error" section (AC7) when a
dead-letter is discarded while a real error exists. Therefore the count refresh
here updates `syncDeadLetters` (and `syncPending` for retry) and only downgrades
a **dead-letter-driven `'warning'`** to idle/offline when the count reaches 0 —
it leaves `'error'`/`syncError` untouched. (`runSync`, which retry kicks
afterward, legitimately recomputes full status on its own.)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: DB-layer requeue + remove transactions

**Verifies:** sync-status-detail.AC4.1, sync-status-detail.AC4.4

**Files:**
- Modify: `src/client/db/push-sync.ts` (add two exported functions near
  `moveOutboxRowToDeadLetters`)
- Test: `test/push-sync.ts` (existing suite; add cases)

**Implementation:**
- Export `requeueDeadLetter(db:Sqlite3Db, id:number):Promise<boolean>`:
  - Read the target row: `SELECT * FROM dead_letter_outbox WHERE id = ?`
    via `queryDb<DeadLetterRow>`; take `rows[0] ?? null`. If null, return
    `false` (nothing to requeue — never throw).
  - Otherwise run an atomic transaction (BEGIN / try COMMIT / catch ROLLBACK +
    rethrow), mirroring `moveOutboxRowToDeadLetters` in reverse:
    - `INSERT INTO outbox (op, target_id, payload, client_op_id,
      client_updated_at, attempts, last_error) VALUES (?, ?, ?, ?, ?, 0, NULL)`
      binding the dead-letter row's `op, target_id, payload, client_op_id,
      client_updated_at` (attempts hard-set to `0`, last_error to `NULL`).
    - `DELETE FROM dead_letter_outbox WHERE id = ?`.
  - Return `true` on success.
- Export `removeDeadLetter(db:Sqlite3Db, id:number):Promise<void>`:
  - Single statement `DELETE FROM dead_letter_outbox WHERE id = ?`. No
    transaction needed.

**Testing:**
Real DB via `openLocalDb` (follow `test/push-sync.ts` conventions; unique test
DID; cleanup in `finally`). Verify:
- sync-status-detail.AC4.1: seed a `dead_letter_outbox` row (e.g. `attempts = 5`,
  `last_error = 'boom'`, a known `client_op_id`/`payload`). After
  `requeueDeadLetter(db, id)`: the `outbox` has one row with the SAME `op`,
  `target_id`, `payload`, `client_op_id`, `client_updated_at`, with
  `attempts = 0` and `last_error = NULL`; the `dead_letter_outbox` no longer
  contains that `id`. `requeueDeadLetter` on a missing id returns `false` and
  changes nothing.
- sync-status-detail.AC4.4 (atomicity): force the INSERT to fail deterministically
  by pre-inserting an `outbox` row with the SAME `client_op_id` (violates the
  UNIQUE constraint). Assert `requeueDeadLetter` rejects AND the
  `dead_letter_outbox` row is still present (rolled back) AND no partial/extra
  `outbox` row was created.
- `removeDeadLetter` deletes the row (covered fully via AC4.3 at the State level,
  but a direct DB test is welcome).

**Verification:**
Authoritative gate: `npm test` (bundles `test/push-sync.ts` via `npm run
test:browser`). Faster inner loop: `npm run test:browser` (or the focused
`npm run test:push-sync`).
Expected: all tests pass.

**Commit:** `feat: add requeueDeadLetter/removeDeadLetter transactions`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: `State.retryDeadLetter` and `State.discardDeadLetter`

**Verifies:** sync-status-detail.AC4.2, sync-status-detail.AC4.3,
sync-status-detail.AC4.5

**Files:**
- Modify: `src/client/state.ts` (add two methods; import `requeueDeadLetter`,
  `removeDeadLetter`, `getOutboxCount`, `getDeadLetterOutboxCount` from
  `./db/push-sync.js`; `syncStatus`, `syncPending`, `syncDeadLetters` from
  `./db/sync-status.js` — verify which are already imported)
- Test: a State-level test file (follow `test/add-feed-acquire.ts` conventions;
  add to the existing wiring)

**Implementation:**
- Add a private count-refresh helper (module-scope in `state.ts`, or inline in
  both methods) that, given `db`:
  - reads `pending = await getOutboxCount(db)` and
    `deadLetters = await getDeadLetterOutboxCount(db)`,
  - writes them in a single `batch()`:
    `syncPending.value = pending; syncDeadLetters.value = deadLetters`, and
    only if `syncStatus.value === 'warning'` and `deadLetters === 0`, set
    `syncStatus.value = navigator.onLine ? 'idle' : 'offline'`.
  - Does NOT touch `syncError` or an `'error'`/`'syncing'`/`'offline'` status
    (see the AC7 constraint above).
- `State.retryDeadLetter = async function (state, id:number):Promise<void>`:
  - Resolve `db` via the `_getLocalDbImpl(state.user.value?.did)` seam; if null,
    return.
  - `const moved = await requeueDeadLetter(db, id)`; if `!moved`, return.
  - Refresh counts (helper above) so the row leaves the page immediately
    (AC4.2).
  - Kick push-sync: `await _runSyncImpl(db)` (the requeued op is pushed; on
    repeat failure the existing dead-letter cap re-dead-letters it — AC4.5).
- `State.discardDeadLetter = async function (state, id:number):Promise<void>`:
  - Resolve `db` via the seam; if null, return.
  - `await removeDeadLetter(db, id)`.
  - Refresh counts (helper above) — AC4.3. No `runSync` (local-only; this is the
    action that must also work offline, Phase 5/AC11.2).

**Testing:**
Use a minimal `AppState` (per `test/add-feed-acquire.ts`) plus a real
`openLocalDb` injected through the `_getLocalDbImpl` seam, and stub
`_runSyncImpl` so no network occurs. Seed `dead_letter_outbox` directly. Verify:
- sync-status-detail.AC4.2: with `syncDeadLetters.value` seeded to the row count,
  `retryDeadLetter` decrements `syncDeadLetters.value` by 1 and the row is gone
  from `dead_letter_outbox` (moved to `outbox`); the stubbed `_runSyncImpl` was
  invoked.
- sync-status-detail.AC4.3: `discardDeadLetter` removes the `dead_letter_outbox`
  row and decrements `syncDeadLetters.value`; `_runSyncImpl` is NOT called.
- sync-status-detail.AC4.5: after `requeueDeadLetter`, the requeued `outbox` row
  has `attempts = 0` (a fresh budget, so it is genuinely retried rather than
  immediately re-dead-lettered); driving the standard failure path
  (`moveOutboxRowToDeadLetters`) on it returns it to `dead_letter_outbox` with
  the new `last_error`. (Assert the fresh budget + that the standard path
  re-dead-letters with updated `last_error`; do not re-test the full retry
  loop.)
- Also assert the AC7 constraint: with `syncStatus.value = 'error'` and
  `syncError.value = 'something'`, discarding the last dead-letter leaves
  `syncError.value` unchanged (not cleared) — only `syncDeadLetters` updates.

Restore all stubs/signals in `finally`.

**Verification:**
Authoritative gate: `npm test`. Wire the new State test file into
`test/browser-tests.ts` (side-effect import), mirroring
`test/resolve-convergence-trackrefresh.ts`. Faster inner loop: `npm run
test:browser`.
Expected: all tests pass; `npm run lint` clean.

**Commit:** `feat: add retryDeadLetter/discardDeadLetter State methods`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

---

**Done when:** `requeueDeadLetter`/`removeDeadLetter` move/delete rows atomically
(with a passing atomicity/rollback test), `State.retryDeadLetter` requeues with a
reset attempt budget + kicks `runSync` + decrements the count, and
`State.discardDeadLetter` deletes + decrements without clobbering a transient
`syncError`. Covers sync-status-detail.AC4. `npm run lint` clean.
