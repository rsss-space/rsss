# Phase 3: Op-type-aware discard infrastructure

**Goal:** Add the low-level pieces that let the feed-page banner discard a
blocked `add_feed` op by deleting the local feed WITHOUT enqueuing a
server-bound `delete_feed` op.

**Dependencies:** none new for the db helper; `State.discardBlockedFeedAdd`
uses Phase 1's `refreshDeadLetterCounts` (which now also refreshes
`deadLetterRows`). Pairs with Phase 4 (the banner calls these).

> Read the "Project conventions" and "How tests run" sections in
> `phase_01.md` before starting. They apply here too.

---

## Acceptance Criteria Coverage

### blocked-feed-controls.AC5: Op-type-aware discard
- **blocked-feed-controls.AC5.1 Success:** Discarding a blocked `add_feed`
  removes the dead-letter op, deletes the local feed row and its items, and
  navigates away from the feed page.
- **blocked-feed-controls.AC5.2 Regression:** Discarding a blocked `add_feed`
  does NOT enqueue a `delete_feed` outbox op (`removeLocalFeedRow` leaves the
  outbox untouched).
- **blocked-feed-controls.AC5.4 Success:** After any retry/discard, dead-letter
  counts and the global `deadLetterRows` signal refresh so the sidebar circle
  and banner update.

*(AC5.3 — non-`add_feed` discard removes only the op — is the banner's branch
selection; it is verified in Phase 4. This phase provides the `add_feed`
branch.)*

---

## Verified codebase facts (Phase 3)

- `src/client/db/local-adapter.ts` exposes the transactional delete inside the
  adapter object: `deleteFeed(id)` (lines 138-156) runs
  `execDb(db, 'BEGIN')`, `DELETE FROM items WHERE feed_id = ?`,
  `DELETE FROM feeds WHERE id = ?`, then
  `insertOutbox(db, 'delete_feed', id, { id }, now)` and `COMMIT`. The new
  helper omits exactly the `insertOutbox(...)` line. The file already exports a
  standalone `listFailedFeeds(db)` (line 92), so a standalone
  `removeLocalFeedRow(db, feedId)` export fits the existing shape.
- DB helpers: `execDb(db, 'BEGIN' | 'COMMIT' | 'ROLLBACK')` and
  `execDb(db, { sql, bind })` from `./local-db.js` (already imported in
  local-adapter.ts).
- `State` actions are attached as `State.foo = async function (state, ...) {}`
  (e.g. `State.retryResolveFeed` at `state.ts:3020`, `State.discardDeadLetter`
  at `state.ts:3125`, `State.deleteFeed` at `state.ts:2545`,
  `State.clearSelectedItem` at `state.ts:3140`). Add `State.discardBlockedFeedAdd`
  the same way.
- `State.discardDeadLetter` (`state.ts:3125-3135`) reads the db via
  `_getLocalDbImpl(did)` (the test-injectable seam) then
  `removeDeadLetter(db, id)` + `refreshDeadLetterCounts(db)`. `removeDeadLetter`
  is already imported into `state.ts` (line 50).
- `State.deleteFeed` (`state.ts:2545-2578`) is the reload pattern to mirror:
  after the delete it calls `State.loadFeeds(state)`, `State.loadItems(state)`,
  `State.loadCounts(state)`. These read through `getAdapter(did)`.
- `refreshDeadLetterCounts(db)` (`state.ts:3088`) refreshes
  `syncPending`/`syncDeadLetters` and (after Phase 1, Task 4) also
  `deadLetterRows`. It only downgrades a `warning` status; it never clobbers an
  `error`/`syncing` status.
- Programmatic navigation: `state._setRoute('/')` (see
  `State.clearSelectedItem`, `state.ts:3140-3142`).
- Test harness for State db actions (`test/retry-discard-dead-letter.ts`):
  `setTestMode(true, wasmUrl)` + `openLocalDb(did)` gives a real db;
  `makeTestState()` builds a fake `AppState`;
  `_setRunResolveConvergenceDepsForTest({ runSync, getLocalDb })` injects the
  test db so `_getLocalDbImpl(did)` returns it; `_resetRunResolveConvergenceDepsForTest()`
  restores. Direct db helper tests (`test/local-adapter.ts`) build the adapter
  with `createLocalAdapter(db)` and assert via `db.exec({..., resultRows})`.
- `getAdapter(did)` (`src/client/db/index.ts:179`) returns the local adapter
  only when `syncSubscriptions.value` + local-first support + tab lock all hold;
  otherwise it returns `remoteAdapter` (which calls `globalThis.fetch`). The
  Task 4 test must therefore stub `globalThis.fetch` so the reload calls resolve
  harmlessly (see `test/add-feed-acquire.ts` `withStubbedFetch`).

---

## Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: `removeLocalFeedRow` db helper (failing test first)

**Verifies:** blocked-feed-controls.AC5.1 (local delete), AC5.2 (no outbox op)

**Files:**
- Create: `test/remove-local-feed-row.ts` (db-backed unit test)
- Modify: `src/client/db/local-adapter.ts`

**Step 1: Write the failing test**

Create `test/remove-local-feed-row.ts`, modeled on `test/local-adapter.ts` and
`test/retry-discard-dead-letter.ts`:
- `setTestMode(true, wasmUrl)`; in each test `const db = await
  openLocalDb('did:plc:test-remove-feed-row')`; `try { ... } finally {
  db.close() }`.
- Seed a feed and two items for it via `db.exec({ sql, bind })`. Capture the
  feed id (`SELECT id FROM feeds ORDER BY id DESC LIMIT 1`). Seed an UNRELATED
  outbox row directly (e.g. an `update_item` op) so the test can prove
  `removeLocalFeedRow` does not touch the outbox.
- Call `await removeLocalFeedRow(db, feedId)`.
- Assert (AC5.1): `SELECT COUNT(*) FROM feeds WHERE id = ?` is 0;
  `SELECT COUNT(*) FROM items WHERE feed_id = ?` is 0.
- Assert (AC5.2): `SELECT COUNT(*) FROM outbox WHERE op = 'delete_feed'` is 0,
  AND the pre-seeded unrelated outbox row still exists (outbox count unchanged
  by the call). This is the core regression: no `delete_feed` was enqueued.

Import `removeLocalFeedRow` from `../src/client/db/local-adapter.js`. Register
the file: add `import './remove-local-feed-row.js'` to `test/browser-tests.ts`.

**Step 2: Add a stub export so the import resolves and the test FAILS**

In `src/client/db/local-adapter.ts`, add an exported async stub that does
nothing yet:

```ts
export async function removeLocalFeedRow (
    _db:Sqlite3Db,
    _feedId:number
):Promise<void> {
    // implemented in Task 2
}
```

Run `npm run test:browser`; confirm the feed/items-still-present assertions
FAIL.

**Step 3: Commit**

```bash
git add test/remove-local-feed-row.ts src/client/db/local-adapter.ts \
    test/browser-tests.ts
git commit -m "test: failing test for removeLocalFeedRow"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement `removeLocalFeedRow`

**Verifies:** blocked-feed-controls.AC5.1, AC5.2

**Files:**
- Modify: `src/client/db/local-adapter.ts`

**Implementation:**

Mirror `deleteFeed`'s two-DELETE transaction (lines 140-155) WITHOUT the
`insertOutbox(...)` line and without the timestamp it needs:

```ts
export async function removeLocalFeedRow (
    db:Sqlite3Db,
    feedId:number
):Promise<void> {
    await execDb(db, 'BEGIN')
    try {
        await execDb(db, {
            sql: 'DELETE FROM items WHERE feed_id = ?',
            bind: [feedId]
        })
        await execDb(db, {
            sql: 'DELETE FROM feeds WHERE id = ?',
            bind: [feedId]
        })
        await execDb(db, 'COMMIT')
    } catch (err) {
        await execDb(db, 'ROLLBACK')
        throw err
    }
}
```

**Testing:** Task 1's test now passes (feed + items deleted; outbox untouched;
no `delete_feed` op).

**Verification:**
Run: `npm run test:browser` — `remove-local-feed-row` passes.
Run: `npm run lint` — clean.

**Commit:** `feat: removeLocalFeedRow deletes a feed row without an outbox op`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: `State.discardBlockedFeedAdd` (failing test first)

**Verifies:** blocked-feed-controls.AC5.1, AC5.4

**Files:**
- Create: `test/discard-blocked-feed-add.ts` (db-backed State-action test)
- Modify: `src/client/state.ts` (stub the action)

**Step 1: Write the failing test**

Create `test/discard-blocked-feed-add.ts`, modeled on
`test/retry-discard-dead-letter.ts` plus the fetch stub from
`test/add-feed-acquire.ts`:

- `setTestMode(true, wasmUrl)`; `const db = await
  openLocalDb('did:plc:test-discard-add')`.
- Build a fake state via a local `makeTestState()` (copy the one in
  `test/retry-discard-dead-letter.ts`) but capture navigation: give it
  `_setRoute: (r) => { lastRoute = r }` with a `let lastRoute:string|null =
  null` in scope so the test can assert navigation.
- Seed a feed (capture `feedId`) and an item for it. Seed a dead-letter
  `add_feed` row whose `target_id = feedId` (capture its dead-letter id
  `deadId`).
- Set `batch(() => { syncDeadLetters.value = 1; syncPending.value = 0 })`.
- Inject deps: `_setRunResolveConvergenceDepsForTest({ runSync: async () => {},
  getLocalDb: (did) => did === state.user.value?.did ? db : null })`.
- Stub `globalThis.fetch` for the duration so the reload calls
  (`loadFeeds`/`loadItems`/`loadCounts` via `remoteAdapter`) resolve harmlessly:
  return `jsonResponse({ feeds: [] })` for the feeds endpoint,
  `jsonResponse({ items: [], total: 0 })` for items, and
  `jsonResponse({ unread: 0, starred: 0, total: 0, perFeed: {} })` for counts —
  a single handler returning a permissive shape covering all three is fine
  (mirror `withStubbedFetch` in `test/add-feed-acquire.ts`). Restore
  `globalThis.fetch` and call `_resetRunResolveConvergenceDepsForTest()` in
  `finally`.
- Call `await State.discardBlockedFeedAdd(state, feedId, deadId)`.

Assert:
- AC5.1: `SELECT id FROM dead_letter_outbox WHERE id = ?` (deadId) is gone;
  `SELECT COUNT(*) FROM feeds WHERE id = ?` (feedId) is 0;
  `SELECT COUNT(*) FROM items WHERE feed_id = ?` is 0;
  `lastRoute === '/'` (navigated away).
- AC5.4: `syncDeadLetters.value === 0` after the call (counts refreshed). (The
  `deadLetterRows` refresh is exercised by `refreshDeadLetterCounts`; asserting
  the count is the stable, non-brittle signal.)

Register: add `import './discard-blocked-feed-add.js'` to
`test/browser-tests.ts`.

**Step 2: Add a stub action so the import resolves and the test FAILS**

In `src/client/state.ts`, near `State.discardDeadLetter`, add:

```ts
State.discardBlockedFeedAdd = async function (
    state:AppState,
    feedId:number,
    deadLetterId:number
):Promise<void> {
    // implemented in Task 4
}
```

Add `discardBlockedFeedAdd` to the `AppState` type (beside
`discardDeadLetter`, line 733). NOTE: the existing `discardDeadLetter` entry
(line 733) has NO trailing comma before the type's closing `}` on line 734 —
add a comma after it, then the new member:

```ts
    retryDeadLetter:(state:AppState, id:number) => Promise<void>,
    discardDeadLetter:(state:AppState, id:number) => Promise<void>,
    discardBlockedFeedAdd:(
        state:AppState,
        feedId:number,
        deadLetterId:number
    ) => Promise<void>
}
```

Run `npm run test:browser`; confirm the assertions FAIL (nothing is deleted).

**Step 3: Commit**

```bash
git add test/discard-blocked-feed-add.ts src/client/state.ts \
    test/browser-tests.ts
git commit -m "test: failing test for discardBlockedFeedAdd"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Implement `State.discardBlockedFeedAdd`

**Verifies:** blocked-feed-controls.AC5.1, AC5.4

**Files:**
- Modify: `src/client/state.ts`

**Implementation:**

Add `import { removeLocalFeedRow } from './db/local-adapter.js'` (there is no
existing import of `local-adapter.js` in `state.ts`; add one). Implement the
action, composing the steps in the design's order (op first, then row, then
reload, then navigate). Mirror `deleteFeed`'s reload trio:

```ts
State.discardBlockedFeedAdd = async function (
    state:AppState,
    feedId:number,
    deadLetterId:number
):Promise<void> {
    const did = state.user.value?.did
    const db = did ? _getLocalDbImpl(did) : null
    if (!db) return

    await removeDeadLetter(db, deadLetterId)
    await removeLocalFeedRow(db, feedId)

    await State.loadFeeds(state)
    await State.loadItems(state)
    await State.loadCounts(state)
    await refreshDeadLetterCounts(db)

    state._setRoute('/')
}
```

Use `_getLocalDbImpl` (NOT `getLocalDb`) so the test-injected db is used, exactly
as `discardDeadLetter` does. Ordering note (from the design): the op is removed
before the local row so a failed row-delete leaves a benign blocked-op-free feed,
never a phantom present in both tables.

**Testing:** Task 3's test now passes.

**Verification:**
Run: `npm run test:browser` — `discard-blocked-feed-add` passes; the existing
`retry-discard-dead-letter` suite still passes.
Run: `npm run lint` — clean.

**Commit:** `feat: discardBlockedFeedAdd removes a phantom add-feed and navigates`
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

## Phase 3 done when

- `npm test && npm run lint` pass clean.
- `removeLocalFeedRow` deletes the feed row and its items inside one transaction
  and leaves the outbox untouched (no `delete_feed` op) — AC5.1, AC5.2.
- `State.discardBlockedFeedAdd` removes the dead-letter, deletes the local feed +
  items, reloads feeds/items/counts, refreshes the dead-letter count (and
  `deadLetterRows`), and navigates to `/` — AC5.1, AC5.4.
