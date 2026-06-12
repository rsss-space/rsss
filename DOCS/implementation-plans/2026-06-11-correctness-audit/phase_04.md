# Correctness Audit — Phase 4: Pull-sync `UNIQUE(url)` collision wedge

**Goal:** Stop a pull-sync wedge where a server feed arriving under a different
`id` than a local row with the same `url` violates the separate `UNIQUE(url)`
constraint, throws, rolls back the entire pull page, and (with a stuck
`add_feed` outbox entry) prevents `lastPullAt` from ever advancing.

**Architecture:** `upsertFeed` reconciles with `INSERT ... ON CONFLICT(id) DO
UPDATE`, but `url` is a separate `UNIQUE` column that `ON CONFLICT(id)` does
not catch. We address this in layers, ordered by safety:
1. **Per-feed isolation** — wrap each feed's upsert in a `SAVEPOINT` so a
   single feed's constraint failure rolls back only that feed, not the whole
   page; `lastPullAt` still advances. This alone removes the "drops the page /
   wedge" failure mode.
2. **`shouldSkipFeed`** — skip a server feed whose `url` matches a pending
   `add_feed` outbox entry, so push-sync's `replaceOptimisticFeed` reconciles
   the id instead of pull inserting a conflicting copy. This removes the
   primary trigger (optimistic add not yet reconciled).
3. **Enforce the dead-letter cap** — `DEAD_LETTER_ATTEMPT_LIMIT` (=10) is
   defined but never applied to 5xx, so a stuck `add_feed` retries forever and
   keeps re-triggering the collision. Promote to `dead_letter_outbox` once the
   limit is reached.

**Tech Stack:** TypeScript (browser, ES2022 via Vite), `@sqlite.org/sqlite-wasm`
3.53 (OPFS, SQLite ≥ 3.35 — `SAVEPOINT` and multi-`ON CONFLICT` supported),
client outbox/pull-sync.

**Scope:** Phase 4 of 8. Derived from audit finding **P1 #4**.

**Codebase verified:** 2026-06-11 (codebase-investigator + SQLite research).
Confirmed: `upsertFeed` SQL at `src/client/db/pull-sync.ts:164–170` is
`ON CONFLICT(id)` only; `shouldSkipFeed` exists in the same file; schema
`src/shared/schema.ts:47–48` has two independent UNIQUE constraints (`id` PK,
`url`); the pull transaction is `pull-sync.ts:433–478` with `lastPullAt`
advancing at line 469 **inside** `BEGIN/COMMIT` (rolled back at 478 on throw);
`push-sync.ts:15` defines `DEAD_LETTER_ATTEMPT_LIMIT = 10` but it is **never
enforced** for 5xx — `recordTransientFailure` increments `attempts` and leaves
the row in `outbox`; only 4xx calls `recordPermanentFailure`. sqlite-wasm
`@sqlite.org/sqlite-wasm@3.53.0-build1`. SQLite research: multiple
`ON CONFLICT` clauses supported since 3.35.0, but **updating a PK with FK
children is unsafe** unless the FK is `ON UPDATE CASCADE` — hence we do NOT
adopt the server id on a `url` conflict; per-feed isolation + skip is the safe
path.

---

## Acceptance Criteria Coverage

This phase implements and tests (ACs derived from audit P1 #4):

### correctness-audit.AC5: Pull-sync tolerates `url` collisions without wedging
- **correctness-audit.AC5.1 Success:** when one server feed in a pull page has
  a `url` that collides with a local row under a different `id`, the other
  feeds in that page are still upserted and `lastPullAt` still advances (the
  page is not dropped, the transaction is not wholly rolled back).
- **correctness-audit.AC5.2 Success:** `shouldSkipFeed` skips a server feed
  whose `url` matches a pending `add_feed` outbox entry.
- **correctness-audit.AC5.3 Failure→handled:** an `add_feed` outbox entry that
  keeps receiving 5xx is promoted to `dead_letter_outbox` after
  `DEAD_LETTER_ATTEMPT_LIMIT` attempts (no infinite retry loop).

---

## Notes for the executor

- This is a **functionality** phase: tests are deliverables.
- Do **not** mutate a feed's primary key on a `url` conflict (FK children in
  `items.feed_id`). Task 1 verifies the FK clause and records the decision.
- Tests use the client SQLite DB. Follow `test/pull-sync.ts` /
  `test/push-sync.ts` for how a client DB is created and seeded.
- Findings: `/tmp/plan-2026-06-11-correctness-audit-12661ed6/phase4-findings.md`.

---

<!-- START_TASK_1 -->
### Task 1: Verify FK clause on `items.feed_id` and record id-adoption decision

**Verifies:** (design-gating step — no AC)

**Files:**
- Read-only: `src/shared/schema.ts` (feeds + items DDL, all UNIQUE/FK clauses).

**Implementation:**
Read the `items` table FK on `feed_id`. Confirm whether it is `ON UPDATE
CASCADE`. Record the result in the commit body of Task 2:
- If **not** `ON UPDATE CASCADE` (expected): do **not** adopt the server `id`
  on a `url` conflict — rely on per-feed isolation (Task 2) + skip (Task 3).
- If it **is** `ON UPDATE CASCADE`: an `ON CONFLICT(url) DO UPDATE SET id =
  excluded.id, ...` becomes possible, but is still out of scope for this phase
  unless trivial — note it as a follow-up; per-feed isolation is sufficient.

**Verification:**
Run: `rg -n 'FOREIGN KEY|REFERENCES|ON UPDATE|ON DELETE' src/shared/schema.ts`
Expected: documented FK behavior. No code change.

**Commit:** none (read-only; decision recorded in Task 2 commit body).
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Isolate each feed upsert in a SAVEPOINT so one collision can't drop the page

**Verifies:** correctness-audit.AC5.1

**Files:**
- Modify: `src/client/db/pull-sync.ts` — the feed loop inside the pull
  transaction (`for (const feed of data.feeds)` at ~437–446; `BEGIN` at ~433,
  `COMMIT` at ~474, the catch `ROLLBACK` at ~478). `upsertFeed` is at ~164–170.

**Verified context:** the transaction uses raw statements through `execDb`
(`await execDb(db, 'BEGIN' | 'COMMIT' | 'ROLLBACK')`), so `execDb` accepts raw
`SAVEPOINT`/`RELEASE`/`ROLLBACK TO` strings the same way. The loop already
tracks a `skippedRows` boolean that, when true, prevents `lastPullAt` from
advancing and resets the pull cursor for a re-pull (~462–471) — reuse it.

**Implementation:**
Wrap each individual `upsertFeed` call in a SQLite `SAVEPOINT` (nested inside
the existing `BEGIN` transaction) so a `UNIQUE(url)` violation (or any
single-feed error) rolls back only that feed and the loop continues; the outer
transaction still commits the rest. Adapt the existing loop body:

```ts
for (const feed of data.feeds) {
    if (shouldSkipFeed(feed, pendingRefs)) {
        skippedRows = true
        continue
    }
    await execDb(db, 'SAVEPOINT feed_upsert')
    try {
        await upsertFeed(db, feed)
        await execDb(db, 'RELEASE feed_upsert')
        feedCount++
        opts.onFeedUpserted?.(feedCount)
    } catch (err) {
        await execDb(db, 'ROLLBACK TO feed_upsert')
        await execDb(db, 'RELEASE feed_upsert')
        // url collision (or other per-feed failure): skip this feed this pull.
        // Mark skippedRows so the cursor is not advanced past it — it will be
        // reconciled by push-sync (optimistic add) or re-pulled next sync.
        skippedRows = true
        if (trackStatus) reportSyncWarning(/* match existing warn helper */)
    }
}
```

Use the project's actual warning/log helper (match how the catch at ~478 logs
via `describeLocalDbError`/`setSyncError`). Keep the existing cursor/`lastPullAt`
logic — it now runs reliably because a single feed no longer throws out to the
outer catch/`ROLLBACK`.

**Testing (in `test/pull-sync.ts`):**
- AC5.1: seed a local feed row (id `local-1`, url `U`). Run a pull page
  containing two server feeds: one with a *different* id but url `U` (the
  collider) and one independent feed (id `srv-2`, url `V`). Assert: `srv-2` is
  present after the pull, `lastPullAt` advanced, and the pull did not throw.
  (The collider may be skipped; the key behavior is the page is not dropped.)

**Verification:**
Run: `npm test` (pull-sync tests). Expected: AC5.1 passes; existing pull tests
green.

**Commit:** `fix(pull-sync): isolate per-feed upsert in SAVEPOINT (no page drop)`
(record the Task 1 FK decision in the commit body).
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Skip server feeds whose `url` matches a pending `add_feed` outbox entry

**Verifies:** correctness-audit.AC5.2

**Files:**
- Modify: `src/client/db/pull-sync.ts` — `PendingOutboxRefs` interface (~46),
  `getPendingOutboxRefs` (~294–333), and `shouldSkipFeed` (~336–340).

**Verified context:** `shouldSkipFeed(feed, refs:PendingOutboxRefs)` currently
returns `refs.feedIds.has(feed.id as number)`. The outbox-membership sets are
pre-resolved once per pull by `getPendingOutboxRefs`, which today selects only
`op, target_id`. The `add_feed` URL lives in the outbox `payload` column as
`JSON.parse(payload).url` (see `push-sync.ts:395,405`). The skip must be by
**url**, because the colliding server feed arrives under a *different* id than
the optimistic row, so `refs.feedIds.has(serverFeed.id)` is false.

**Implementation:**
1. Add `urls:Set<string>` to the `PendingOutboxRefs` interface.
2. In `getPendingOutboxRefs`, extend the SELECT to also read `payload` and, for
   each `add_feed` row, parse `JSON.parse(row.payload).url` and add it to
   `refs.urls` (guard the parse in try/catch; ignore malformed payloads):
   ```ts
   const rows = await queryDb<{ op:string; target_id:number|null; payload:string }>(
       db,
       `SELECT op, target_id, payload FROM outbox WHERE op IN (...)`)
   // ...
   refs: { feedIds, itemIds, markAllReadFeedIds, markAllReadAll, urls: new Set() }
   // ...
   if (row.op === 'add_feed') {
       refs.feedIds.add(row.target_id!)           // existing behavior
       try {
           const url = (JSON.parse(row.payload) as { url?:string }).url
           if (url) refs.urls.add(url)
       } catch { /* ignore malformed payload */ }
   }
   ```
   (Keep the existing handling for `delete_feed`/`update_item`/`mark_all_read`.)
3. Extend `shouldSkipFeed` to also skip on a pending `add_feed` url match:
   ```ts
   return refs.feedIds.has(feed.id as number) ||
       refs.urls.has(feed.url as string)
   ```
When skipped, push-sync's `replaceOptimisticFeed` reconciles the optimistic
row's id once the add succeeds.

**Testing (in `test/pull-sync.ts`):**
- AC5.2: seed a pending `add_feed` outbox entry for url `U`. Run a pull page
  containing a server feed with url `U` under a new id. Assert the server feed
  is **not** inserted (skipped), leaving reconciliation to push-sync.

**Verification:**
Run: `npm test` (pull-sync tests). Expected: AC5.2 passes.

**Commit:** `fix(pull-sync): skip server feed colliding with pending add_feed`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Enforce `DEAD_LETTER_ATTEMPT_LIMIT` for 5xx outbox failures

**Verifies:** correctness-audit.AC5.3

**Files:**
- Modify: `src/client/db/push-sync.ts` (`recordTransientFailure` and the 5xx
  branch; `DEAD_LETTER_ATTEMPT_LIMIT` at ~15).

**Implementation:**
In the transient-failure path, after incrementing `attempts`, promote the row
to `dead_letter_outbox` (the same way `recordPermanentFailure` does for 4xx)
once `attempts >= DEAD_LETTER_ATTEMPT_LIMIT`. This bounds retries so a
permanently-failing `add_feed` cannot loop forever and keep re-triggering the
url collision.

```ts
function recordTransientFailure (db:DB, row:OutboxRow):void {
    const attempts = row.attempts + 1
    if (attempts >= DEAD_LETTER_ATTEMPT_LIMIT) {
        recordPermanentFailure(db, row)   // move to dead_letter_outbox
        return
    }
    // existing behavior: bump attempts, leave in outbox for retry
}
```

Match the actual function/row shapes and the existing dead-letter promotion
helper.

**Testing (in `test/push-sync.ts`):**
- AC5.3: drive an `add_feed` outbox row through repeated 5xx responses. Assert
  that after `DEAD_LETTER_ATTEMPT_LIMIT` attempts the row is in
  `dead_letter_outbox` (no longer retried), not stuck in `outbox`. Follow the
  existing push-sync test harness for simulating responses.

**Verification:**
Run: `npm test` (push-sync tests). Expected: AC5.3 passes; existing push-sync
tests green.

**Commit:** `fix(push-sync): promote 5xx outbox rows to dead-letter at cap`
<!-- END_TASK_4 -->
