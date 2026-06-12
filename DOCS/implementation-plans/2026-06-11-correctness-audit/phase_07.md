# Correctness Audit — Phase 7: Followers conflation + lower-confidence cluster

**Goal:** Fix the followers availability/count conflation (#10) and the seven
lower-confidence data-integrity items (#11a–g), all of which were re-traced and
**confirmed real** during verification.

**Architecture:** Eight independent, mostly-local fixes:
- **#10** `/api/graph` `getFollowers`: `available` is true if *either* the list
  or the count call succeeds, and a missing real count is replaced by the
  capped `dids.length`. Derive `available` from the call that backs `dids`
  (the list call) and report an unknown count as `null` rather than a wrong
  number.
- **#11a** `delete_feed` 409 re-inserts the feed but not its items → empty feed.
- **#11b** `replaceOptimisticFeed` UPDATE omits `last_pulled_at`/`last_error`/
  `last_status` → feed renders empty/stale until next pull.
- **#11c** `upsertItemFromServer` overwrites `content`/`description` ignoring
  per-feed cache policy (no COALESCE), unlike pull's policy-aware `upsertItem`.
- **#11d** eviction `currentSize` includes the open item's images but the
  candidate set excludes the open item → over-eviction.
- **#11e** `FEEDS_UPDATED_AT_BUMP_KEY` guard can re-run the one-time
  `updated_at` bump on a cold start → spurious full resyncs.
- **#11f** `resetLocalFirst` doesn't `clearPaintCache(did)` (the disable path
  does) → stale paint cache survives a reset.
- **#11g** `removeOpfsDb` deletes a plain-OPFS filename, but the DB lives in the
  **opfs-sahpool** VFS — the correct deletion is `poolUtil.unlink()`, so OPFS
  space leaks across DID switches.

**Tech Stack:** TypeScript (Cloudflare Workers + DO server; browser client via
Vite), `@sqlite.org/sqlite-wasm` 3.53 (OPFS SAH-pool), Constellation backlinks
client, paint cache (localStorage), Cache Storage.

**Scope:** Phase 7 of 8. Derived from audit findings **P2 #10** and **P2 #11**.

**Codebase verified:** 2026-06-11 (codebase-investigator + OPFS research). All
items confirmed real with current line numbers:
- #10 `src/server/index.ts:1958–1969` (inside the `/api/graph` `getFollowers`
  dep). `backlinkRes` = list (`getDistinct` → `.subjects`); `countRes` = count
  (`getBacklinksCount` → `.count`); errors carry a `code` field.
- #11a `src/client/db/push-sync.ts:512` (`upsertFeedFromServer(db, feed)` alone
  on delete_feed 409; item-restore branch skipped).
- #11b `push-sync.ts:206–218` (`replaceOptimisticFeed` UPDATE column list).
- #11c `push-sync.ts:338–339` vs `pull-sync.ts:228–239`
  (`COALESCE(content, excluded.content)` when caching disabled).
- #11d `src/client/db/cache-eviction.ts:93–106` (size sum) vs `:121`
  (candidate `id != ?`).
- #11e `src/server/durable-objects/index.ts:520–527`
  (`FEEDS_UPDATED_AT_BUMP_KEY` get → UPDATE → put).
- #11f `src/client/db/index.ts:327` (`removeOpfsDb` only) vs disable path
  `:290–291` (`removeOpfsDb` + `clearPaintCache`).
- #11g `src/client/db/sqlite-init.ts:254` (`dir.removeEntry(getOpfsFilename(did))`)
  while `sqlite-worker.ts:161` uses `installOpfsSAHPoolVfs`. Research: the
  correct deletion for a SAH-pool DB is `poolUtil.unlink(name)` (connection
  closed first); the persisting pool *capacity* files are expected, not a leak.

---

## Acceptance Criteria Coverage

This phase implements and tests (ACs derived from audit P2 #10 + #11):

### correctness-audit.AC11: Followers availability/count derive from the backing call
- **correctness-audit.AC11.1 Failure→handled:** when the list call fails (count
  may succeed), `available` is false (UI does not show "available" with an
  empty follower list).
- **correctness-audit.AC11.2 Failure→handled:** when the count call fails, the
  count is reported as unknown (`null`), not the capped `dids.length`.

### correctness-audit.AC12: push-sync 409 reconcile is complete and policy-aware
- **correctness-audit.AC12.1 Success:** a `delete_feed` 409 re-insert restores
  the feed's items too (feed is not empty).
- **correctness-audit.AC12.2 Success:** `replaceOptimisticFeed` writes
  `last_pulled_at`, `last_error`, and `last_status`.
- **correctness-audit.AC12.3 Success:** `upsertItemFromServer` honors per-feed
  cache policy (COALESCE-preserves cached body when caching is disabled), same
  as pull's `upsertItem`.

### correctness-audit.AC13: Cache-eviction accounting is consistent about the open item
- **correctness-audit.AC13.1 Success:** the size total and the candidate set
  treat the open item consistently, so eviction does not over-evict.

### correctness-audit.AC14: The one-time `updated_at` bump runs at most once
- **correctness-audit.AC14.1 Success:** the `FEEDS_UPDATED_AT_BUMP` guard cannot
  re-run the bump on a cold start (flag persisted before/atomically with the
  UPDATE).

### correctness-audit.AC15: Reset clears paint cache and fully removes the OPFS DB
- **correctness-audit.AC15.1 Success:** `resetLocalFirst` calls
  `clearPaintCache(did)`.
- **correctness-audit.AC15.2 Success:** `removeOpfsDb` removes the DB from the
  opfs-sahpool VFS (via `poolUtil.unlink`), so its space is reclaimed.

---

## Notes for the executor

- This is a **functionality** phase: tests are deliverables. Each task is
  independent; commit per task.
- Existing tests to extend: `test/push-sync.ts`, `test/cache-eviction.ts`,
  `test/paint-cache.ts`, `test/local-first-opfs-persistence.ts`,
  `test/bootstrap.ts`. Graph/followers: see `test/` for graph coverage; if none
  exists for `getFollowers`, add a focused test of the dep's return shaping.
- #11g touches the SQLite worker boundary; confirm the VFS + logical filename
  before changing the deletion call. Closing the connection before `unlink` is
  required.
- Findings: `/tmp/plan-2026-06-11-correctness-audit-12661ed6/phase7-findings.md`.

---

<!-- START_TASK_1 -->
### Task 1: Derive followers `available`/`count` from the backing call (#10)

**Verifies:** correctness-audit.AC11.1, AC11.2

**Files:**
- Modify: `src/server/index.ts` (`/api/graph` `getFollowers` dep, ~1958–1969).
- Modify: `src/server/graph-api.ts` — widen `GraphApiDeps.getFollowers`'s
  `count:number` (line ~5) and `GraphApiResponse.followersCount:number`
  (line ~13) to `number|null`; `buildGraphResponse` maps
  `followersCount: followerResult.count` (line ~29) and passes the `null`
  through unchanged.
- Modify: `src/client/routes/graph.ts` — `GraphData.followersCount` (line ~11)
  widens to `number|null`, and the render at line ~123
  (`<span class="graph-count">${data.followersCount}</span>`) must handle
  `null` (see below).

**Implementation:**
```ts
const listFailed = 'code' in backlinkRes
const countFailed = 'code' in countRes

const dids = listFailed ? [] : backlinkRes.subjects.slice(0, 100)
// available reflects the call that actually backs `dids` (the list call).
const available = !listFailed
// unknown count when the count call failed — do NOT substitute capped length.
const count = countFailed ? null : countRes.count

return { dids, count, available }
```
Thread `count: number | null` through every layer (do NOT silently coerce
`null` back to a wrong number anywhere):
- `src/server/graph-api.ts`: widen `GraphApiDeps.getFollowers` `count` and
  `GraphApiResponse.followersCount` to `number|null`. `buildGraphResponse`
  already just forwards `followerResult.count`, so no logic change there beyond
  the type.
- `src/client/routes/graph.ts`: widen `GraphData.followersCount` to
  `number|null`. **Render decision:** when `followersCount === null`, omit the
  count badge entirely (render nothing in place of
  `<span class="graph-count">…</span>`) — the followers list itself still
  renders. Do NOT introduce new CSS; just conditionally render the existing
  `graph-count` span only when `followersCount !== null`. Example:
  ```ts
  ${data.followersCount !== null && html`
      <span class="graph-count">${data.followersCount}</span>
  `}
  ```

**Testing:**
- AC11.1: list call returns an error (`code`), count succeeds → `available`
  false, `dids` empty.
- AC11.2: count call returns an error, list succeeds → `count` is `null`,
  `dids` populated, `available` true. Assert at the `getFollowers`/
  `buildGraphResponse` boundary that `followersCount` is `null` (not the capped
  `dids.length`). Optionally assert the client omits the count badge when
  `followersCount` is `null`.
Drive `getFollowers` (or `buildGraphResponse`) with stubbed
`getDistinct`/`getBacklinksCount` results, following the graph test harness.

**Verification:** `npm test` (graph tests) + type-check.

**Commit:** `fix(graph): derive followers available/count from backing call`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Restore items on `delete_feed` 409 re-insert (#11a)

**Verifies:** correctness-audit.AC12.1

**Files:**
- Modify: `src/client/db/push-sync.ts` (~512, the `delete_feed` 409 branch).

**Implementation:**
When a `delete_feed` is rejected 409 (feed still exists server-side), the
handler re-inserts the feed via `upsertFeedFromServer(db, feed)` but does not
restore its items (already deleted locally). Restore the items too, the same
way the add/reconcile path does (extract items from the server payload and
upsert them). Match the existing item-extraction/upsert helpers used elsewhere
in push-sync/pull-sync.

**Testing (in `test/push-sync.ts`):**
- AC12.1: simulate a `delete_feed` that returns 409 with a feed payload that
  includes items. Assert the feed AND its items are present locally afterward
  (feed not empty).

**Verification:** `npm test` (push-sync tests).

**Commit:** `fix(push-sync): restore items on delete_feed 409 re-insert`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Include sync-status columns in `replaceOptimisticFeed` (#11b)

**Verifies:** correctness-audit.AC12.2

**Files:**
- Modify: `src/client/db/push-sync.ts` (`replaceOptimisticFeed` UPDATE,
  ~206–218).

**Implementation:**
Add `last_pulled_at`, `last_error`, and `last_status` to the UPDATE's SET list
(sourced from the server feed payload, consistent with how pull-sync sets
them). This ensures a feed reconciled after a 409 add renders with correct
status instead of appearing empty/stale until the next pull.

**Testing (in `test/push-sync.ts`):**
- AC12.2: reconcile an optimistic feed via `replaceOptimisticFeed` with a
  server payload carrying `last_pulled_at`/`last_status`; assert the local row
  reflects those columns afterward.

**Verification:** `npm test` (push-sync tests).

**Commit:** `fix(push-sync): write sync-status columns in replaceOptimisticFeed`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Make `upsertItemFromServer` cache-policy-aware (#11c)

**Verifies:** correctness-audit.AC12.3

**Files:**
- Modify: `src/client/db/push-sync.ts` (`upsertItemFromServer`, ~338–339).
- Reference: `src/client/db/pull-sync.ts` (`upsertItem`, ~228–239) for the
  policy-aware COALESCE pattern.

**Implementation:**
Mirror pull's per-feed cache-policy logic: when the feed's caching is disabled
(`keepContent === false`, per the feed's cache policy), use
`content = COALESCE(content, excluded.content)` (and the same for
`description`) so a 409 item reconcile does not clobber a cached body that
policy says to preserve. When caching is enabled, keep the current
unconditional write. Factor out the shared policy decision if pull and push can
reuse one helper (DRY), but do not change pull's behavior.

**Testing (in `test/push-sync.ts`):**
- AC12.3: for a feed with caching disabled, reconcile an item via
  `upsertItemFromServer` and assert the existing cached `content`/`description`
  is preserved (not overwritten), matching pull's behavior. For a
  caching-enabled feed, assert the content is written.

**Verification:** `npm test` (push-sync + pull-sync tests — confirm pull
unchanged).

**Commit:** `fix(push-sync): respect per-feed cache policy on item reconcile`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Make eviction size total consistent with the candidate set (#11d)

**Verifies:** correctness-audit.AC13.1

**Files:**
- Modify: `src/client/db/cache-eviction.ts` (~93–106 size sum, ~121 candidate
  `id != ?`).

**Implementation:**
The size total counts the open item's images while the candidate set excludes
the open item, so eviction over-evicts the others to make up for bytes it can
never reclaim. Make the two consistent: apply the same open-item predicate to
both. Recommended: exclude the open item from the size total too (so the
evict-to-target math only counts evictable bytes), keeping the open item's
images protected and uncounted. Confirm the intended cap semantics against how
the size cap is defined elsewhere; whichever predicate you choose, the size
total and the candidate set MUST use the same one.

**Testing (in `test/cache-eviction.ts`):**
- AC13.1: seed images for an open item plus other items near the cap. Run
  eviction and assert it does not evict more of the other items than the
  consistent accounting requires (no over-eviction caused by counting the open
  item's bytes against an unevictable target). Construct the assertion around
  bytes evicted vs the corrected target.

**Verification:** `npm test` (cache-eviction tests).

**Commit:** `fix(cache-eviction): align size total with candidate set`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Make the one-time `updated_at` bump idempotent across cold starts (#11e)

**Verifies:** correctness-audit.AC14.1

**Files:**
- Modify: `src/server/durable-objects/index.ts` (`FEEDS_UPDATED_AT_BUMP_KEY`
  guard, ~520–527).

**Implementation:**
Today: `get(KEY)` → if absent, `UPDATE feeds SET updated_at = datetime('now')`
→ `put(KEY, true)`. A cold start (or a failure between UPDATE and put) can
re-run the UPDATE, forcing spurious full resyncs for every feed. Make it run at
most once: persist the flag **before** the UPDATE (or wrap the flag-write and
UPDATE in a single `ctx.storage.transaction(...)` so they commit atomically).
Persisting the flag first trades a missed one-time bump (harmless) for never
re-bumping (the harmful case). Add a comment recording this tradeoff.

**Testing (DO test, e.g. extend `test/do-migrations.ts` or `test/alarm.ts`):**
- AC14.1: instantiate the DO twice (simulate a cold start) with the same
  storage that already has the bump flag set; assert the `UPDATE feeds SET
  updated_at` does NOT run on the second instantiation (e.g. spy on the
  exec/UPDATE or assert `updated_at` values are unchanged).

**Verification:** `npm test` (DO migration/alarm tests).

**Commit:** `fix(do): make updated_at bump idempotent across cold starts`
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Clear the paint cache on `resetLocalFirst` (#11f)

**Verifies:** correctness-audit.AC15.1

**Files:**
- Modify: `src/client/db/index.ts` (`resetLocalFirst`, ~327; compare disable
  path ~290–291 which calls both `removeOpfsDb` and `clearPaintCache`).

**Implementation:**
Add `clearPaintCache(did)` to `resetLocalFirst`, matching the disable path, so
a reset does not leave a stale paint cache that flickers old content on
re-bootstrap. Sequence it consistently with Phase 6 Task 1's lock ordering
(clear paint cache as part of the reset teardown).

**Testing (in `test/paint-cache.ts` or the reset test):**
- AC15.1: seed a paint cache entry for `did`, run `resetLocalFirst(did)`, assert
  the paint cache entry is gone (`clearPaintCache` invoked / entry absent).

**Verification:** `npm test` (paint-cache / reset tests).

**Commit:** `fix(db): clear paint cache on resetLocalFirst`
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Delete the OPFS DB via the SAH-pool VFS (`poolUtil.unlink`) (#11g)

**Verifies:** correctness-audit.AC15.2

**Background (verified):** The DB is opened in the worker via
`installOpfsSAHPoolVfs({ directory: 'rsss-db' })` → `new PoolDb(filename)`
where `filename = getOpfsFilename(did)` (e.g. `rsss-<did>.db`). The SAH-pool
VFS stores files **opaquely**, so the current `removeOpfsDb` — which runs on
the **main thread** doing `navigator.storage.getDirectory()` →
`dir('rsss-db').removeEntry(getOpfsFilename(did))` (`sqlite-init.ts:248–260`) —
does not match the SAH-pool's opaque file and is effectively a no-op. The
worker, at `sqlite-worker.ts:161–168`, captures only `opfsPoolDb =
pool.OpfsSAHPoolDb` and **discards the `pool` object**, so `pool.unlink` is not
retained. The protocol (`sqlite-worker-protocol.ts:46–59`) supports only
`probe`/`open`/`exec`/`query`/`close`.

**Files:**
- Modify: `src/client/db/sqlite-worker-protocol.ts` — add a `remove` request
  type to both unions.
- Modify: `src/client/db/sqlite-worker.ts` — widen the `installOpfsSAHPoolVfs`
  return type (~41–43) to include `unlink`, retain the pool's `unlink` at
  module scope (alongside `opfsPoolDb` ~63/167), and add a `remove` case to the
  `handleRequest` switch (~91–106).
- Modify: `src/client/db/sqlite-worker-client.ts` — add a `remove(options)`
  method mirroring `probe`/`open` (~35–47).
- Modify: `src/client/db/sqlite-init.ts` — rewrite `removeOpfsDb` to drive the
  worker `remove` RPC.

**Implementation:**
1. **Protocol** (`sqlite-worker-protocol.ts`): add
   ```ts
   export interface SqliteWorkerRemoveRequest {
       id:number
       type:'remove'
       did?:string
       filename?:string
       directory?:string
   }
   ```
   and add `SqliteWorkerRemoveRequest` to both the `SqliteWorkerRequest` union
   and (as `Omit<…, 'id'>`) the `SqliteWorkerRequestBody` union.
2. **Worker** (`sqlite-worker.ts`):
   - Widen the `installOpfsSAHPoolVfs` return type (~41–43) to
     `Promise<{ OpfsSAHPoolDb:WorkerDbConstructor; unlink:(name:string) => boolean }>`.
   - Add a module-scope `let opfsPoolUnlink:((name:string) => boolean)|null = null`
     near `opfsPoolDb` (~63); in `getOpfsPoolDb`, set `opfsPoolUnlink = pool.unlink`
     right where `opfsPoolDb = pool.OpfsSAHPoolDb` is set (~167).
   - Add a `case 'remove':` to `handleRequest`: resolve `filename` the same way
     `openDb` does (`request.filename || (request.did ? getOpfsFilename(request.did) : '')`);
     ensure the pool is initialized (`await getOpfsPoolDb(request.directory || 'rsss-db')`);
     `closeDb()` first (a SAH-pool `unlink` of an in-use file is undefined);
     then `if (opfsPoolUnlink) opfsPoolUnlink(filename)`. Use the **exact**
     filename string `openDb` passes to `new PoolDb(...)` (do not add/strip a
     leading slash unless `open` does). Do NOT call `removeVfs()`/`wipeFiles()` —
     the pool's reserved capacity files persisting is expected, not a leak.
3. **Client** (`sqlite-worker-client.ts`): add
   ```ts
   remove (options:{ did?:string; filename?:string; directory?:string } = {})
   :Promise<void> {
       return this.send<void>({ type: 'remove', ...options })
   }
   ```
   (Send `remove` before the client is `close()`d, or from a dedicated
   short-lived client — `send` rejects once `closed` is true.)
4. **sqlite-init** (`removeOpfsDb`): replace the main-thread `removeEntry` body
   with a call to the worker client's `remove({ did })` (best-effort: keep the
   surrounding try/catch so it resolves even if the DB/file is absent).
   `removeOpfsDb` is a standalone export with no client in scope — obtain a
   client via `_workerClientFactory()` (the existing factory seam at
   `sqlite-init.ts:53`, test-injectable via
   `setSQLiteWorkerClientFactoryForTests`), send `remove`, then `close()` it so
   the transient Worker is torn down. Do **not** reuse the probed client that
   `getOrCreateLocalDb` may consume. The plain-OPFS `removeEntry` path can be
   dropped (no DB uses the plain `opfs` VFS) — confirm via grep that nothing
   opens a non-SAH-pool OPFS DB; if something does, keep that branch for it only.

**Testing (in `test/local-first-opfs-persistence.ts`):**
- AC15.2: create a DB for a DID via the SAH-pool path, write data, then
  `removeOpfsDb(did)`; assert the logical DB no longer exists in the pool
  (e.g. a subsequent open finds no prior data / `poolUtil` reports it gone).
  If the test environment cannot exercise real OPFS, assert that `removeOpfsDb`
  invokes the worker `unlink` for the correct logical name (spy), and document
  that full OPFS reclamation is covered by the human test plan.

**Verification:** `npm test` (OPFS persistence tests).

**Commit:** `fix(db): delete OPFS DB via SAH-pool unlink, not plain removeEntry`
<!-- END_TASK_8 -->
