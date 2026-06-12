# Correctness Audit — Phase 6: Client data-integrity cluster

**Goal:** Fix three narrower-trigger client data-integrity bugs:
(#7) the multi-tab lock is released before the blocking OPFS delete/rebootstrap,
opening a race; (#8) the subscription `rkey` is derived from the canonical URL
but the published record and reconcile key on the raw URL, so canonicalization
collisions overwrite records and break reconcile; (#9) the image cache writes
the Cache Storage blob before the DB row and swallows a DB-write failure,
leaving an orphan blob and corrupting eviction accounting.

**Architecture:**
- **#7:** `releaseLocalTabLock()` is called before `await removeOpfsDb(did)` /
  re-bootstrap, so a second tab can acquire the `rsss-opfs` Web Lock and open
  the SAH-pool DB inside the window, making the delete fail (open sync handle).
  Fix: hold the lock through confirmation, deletion, and re-bootstrap; release
  only after.
- **#8:** `subscriptionRkeyForFeedUrl` hashes `canonicalizeFeedUrl(url)`, but
  `buildFeedSubscriptionRecord` stores `feedUrl: feed.url` (raw) and reconcile
  does `remoteByUrl.get(feed.url)` (raw). Two raw URLs that canonicalize to the
  same rkey overwrite each other's PDS record, and reconcile can't match the
  overwritten record back. Fix: store the canonical URL in the record and key
  reconcile on the canonical URL, matching the rkey derivation.
- **#9:** `bucket.put(url, ...)` runs before `recordCachedImage(db, ...)`; a DB
  throw leaves the blob in Cache Storage with no `cached_images` row (eviction
  under-counts → under-evicts). Fix: on a DB-write failure, delete the Cache
  Storage entry so the two stores stay consistent.

**Tech Stack:** TypeScript (browser, ES2022 via Vite), Web Locks API,
Cache Storage API, `@sqlite.org/sqlite-wasm` (OPFS SAH-pool), Preact client.

**Scope:** Phase 6 of 8. Derived from audit findings **P2 #7, #8, #9**.

**Codebase verified:** 2026-06-11 (codebase-investigator). Confirmed:
- #7: `src/client/db/bootstrap.ts:177–178` releases the lock (catch path);
  terminal-reset block at `183–191` calls `removeOpfsDb(did)` after release.
  `src/client/db/index.ts:325/327` mirrors this. Lock name `'rsss-opfs'`,
  Web Locks exclusive; `releaseLocalTabLock()` at `tab-coordination.ts:179`.
  Tests disable the Web Locks API (`test/bootstrap.ts`).
- #8: `subscriptionRkeyForFeedUrl` at `src/shared/subscription-rkey.ts:21–34`
  hashes `canonicalizeFeedUrl()` (`:4–19`). `buildFeedSubscriptionRecord` at
  `src/server/durable-objects/index.ts:766–776` stores `feedUrl: feed.url`
  (raw). Reconcile maps `subscriptionFromRecord` (`827–848`) by raw `feedUrl`
  and looks up `remoteByUrl.get(feed.url)` at `:931`.
- #9: `src/client/db/image-cache.ts:25–81` — `bucket.put` at `:63` precedes
  `recordCachedImage` at `:68`; catch (`74–79`) swallows. `recordCachedImage`
  at `src/client/db/cached-images.ts:11–28`. Eviction reads `cached_images` via
  `sumByFeed()`/`sumTotal()`.

---

## Acceptance Criteria Coverage

This phase implements and tests (ACs derived from audit P2 #7, #8, #9):

### correctness-audit.AC8: Tab lock held across OPFS delete and rebootstrap
- **correctness-audit.AC8.1 Success:** in the reset/terminal-reset paths,
  `releaseLocalTabLock()` is not called until **after** `removeOpfsDb(did)`
  (and after re-bootstrap reacquires, where applicable) — no release/delete
  window.

### correctness-audit.AC9: Subscription rkey/record/reconcile all use the canonical URL
- **correctness-audit.AC9.1 Success:** `buildFeedSubscriptionRecord` stores the
  canonical URL (the same form `subscriptionRkeyForFeedUrl` hashes).
- **correctness-audit.AC9.2 Success:** reconcile keys/matches on the canonical
  URL, so a record published under the rkey round-trips back to its feed even
  when the raw URL differs by fragment/query-order/default-port.

### correctness-audit.AC10: Image cache stays consistent with its DB rows
- **correctness-audit.AC10.1 Failure→handled:** if `recordCachedImage` throws,
  the Cache Storage entry written for that URL is removed (no orphan blob).
- **correctness-audit.AC10.2 Success:** after a DB-write failure, eviction
  accounting (`cached_images` sums) reflects only blobs that actually have rows.

---

## Notes for the executor

- This is a **functionality** phase: tests are deliverables.
- For #7, the meaningful, non-brittle assertion is **call ordering**: the OPFS
  delete completes before the lock is released. Assert via spies on
  `removeOpfsDb` and `releaseLocalTabLock` (order of invocation), not on UI text.
- For #8, `canonicalizeFeedUrl` lives in `src/shared/subscription-rkey.ts` and
  is importable server-side — reuse it; do not reimplement canonicalization.
- Findings: `/tmp/plan-2026-06-11-correctness-audit-12661ed6/phase6-findings.md`.

---

<!-- START_TASK_1 -->
### Task 1: Hold the tab lock through OPFS delete and rebootstrap (#7)

**Verifies:** correctness-audit.AC8.1

**Files:**
- Modify: `src/client/db/bootstrap.ts` (~177–191).
- Modify: `src/client/db/index.ts` (~325–327, the reset path).

**Implementation:**
Reorder so `releaseLocalTabLock()` runs only after the blocking work:
- Do **not** release the lock before `await confirmTerminalReset(...)` /
  `await removeOpfsDb(did)` / re-bootstrap.
- Release in a `finally` (or at the end of the success path) after
  `removeOpfsDb` resolves and, where the path re-bootstraps, after the
  re-bootstrap has reacquired the lock for its own lifetime.
- Preserve the existing error handling: if a step throws, still release the
  lock in `finally` (so a failure doesn't leave the lock held forever), but
  only after the delete attempt — never before it.

Mirror the same reordering in `index.ts`'s reset path. Keep the lock
name/scope (`'rsss-opfs'`) and the `releaseLocalTabLock` helper unchanged.

**Testing (in `test/bootstrap.ts`, following its existing terminal-reset
tests):**
- AC8.1: spy on `removeOpfsDb` and `releaseLocalTabLock`. Drive the
  terminal-reset path and assert `removeOpfsDb` was invoked-and-resolved
  before `releaseLocalTabLock` was called (assert invocation order). Also
  assert the lock is still released on the error path (delete throws →
  `releaseLocalTabLock` still called afterward).

**Verification:**
Run: `npm test` (bootstrap tests). Expected: AC8.1 passes; existing
bootstrap/reset tests green.

**Commit:** `fix(db): hold tab lock through OPFS delete and rebootstrap`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Key subscription record + reconcile on the canonical URL (#8)

**Verifies:** correctness-audit.AC9.1, AC9.2

**Files:**
- Modify: `src/server/durable-objects/index.ts`
  - `buildFeedSubscriptionRecord` (~766–776): store the canonical URL.
  - reconcile lookup (`subscriptionFromRecord` ~827–848 and the
    `remoteByUrl.get(feed.url)` site ~931): key/match on canonical URL.
- Import `canonicalizeFeedUrl` from `src/shared/subscription-rkey.ts`.

**Implementation:**
1. In `buildFeedSubscriptionRecord`, set `feedUrl: canonicalizeFeedUrl(feed.url)`
   (the same canonical form the rkey is derived from). This makes the stored
   record consistent with its rkey.
2. In reconcile, build the `remoteByUrl` map keyed on canonical URL and look up
   `remoteByUrl.get(canonicalizeFeedUrl(feed.url))`. Apply canonicalization on
   both the map-build side (records may carry raw or canonical historically —
   canonicalize whatever the record's `feedUrl` is when keying) and the
   lookup side, so old raw-keyed records still match.
3. Confirm no other consumer relies on the record's `feedUrl` being the exact
   raw string (grep usages of the record/`subscriptionFromRecord` result); if a
   consumer needs the raw URL for display, keep it locally from `feed.url`
   rather than from the record.

**Testing (extend `test/subscription-rkey.ts` and/or the reconcile test):**
- AC9.1: `buildFeedSubscriptionRecord({ url: rawWithFragmentOrQueryOrder })`
  stores `feedUrl === canonicalizeFeedUrl(raw)`.
- AC9.2: reconcile matches a published record back to a feed whose raw `url`
  differs only by fragment/query-order/default-port (same canonical form) —
  i.e. `remoteByUrl` lookup succeeds and the feed's `published` state is set
  correctly. Two feeds that canonicalize identically should be recognized as
  the same subscription (document this as the intended collision behavior).

**Verification:**
Run: `npm test` (subscription-rkey + reconcile/feeds tests). Expected: AC9
cases pass; existing rkey tests green.

**Commit:** `fix(subscriptions): store + reconcile on canonical feed URL`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Keep image Cache Storage consistent with `cached_images` (#9)

**Verifies:** correctness-audit.AC10.1, AC10.2

**Files:**
- Modify: `src/client/db/image-cache.ts` (~25–81, the put/record sequence).

**Implementation:**
Keep `bucket.put` where it is, but guarantee the two stores agree: if
`recordCachedImage(db, ...)` throws, delete the just-written Cache Storage
entry so no orphan blob remains.

```ts
await bucket.put(url, response.clone() /* or current arg */)
try {
    await recordCachedImage(db, /* current args */)
} catch (err) {
    // DB row failed (e.g. SQLITE_FULL): don't leave an untracked blob.
    await bucket.delete(url).catch(() => {})
    logImageCacheWarning('recordCachedImage failed; rolled back blob', { url, err })
    return   // or rethrow per current contract — match existing behavior
}
```

Match the actual `bucket` API (`caches.open(...)` Cache vs a wrapper) and the
existing logging helper. Preserve the function's current return contract for
the success path.

**Testing (in `test/image-cache.ts`, which already tests fetch-error paths):**
- AC10.1: make `recordCachedImage` throw (inject a DB that errors on the
  insert). Assert the Cache Storage entry for `url` is absent afterward
  (`bucket.match(url)` is undefined) — no orphan.
- AC10.2: after the simulated DB failure, assert eviction accounting
  (`sumTotal()`/`sumByFeed()`) does not count the rolled-back blob (i.e. the
  blob isn't lingering uncounted in Cache Storage).

**Verification:**
Run: `npm test` (image-cache tests). Expected: AC10 cases pass; existing
image-cache tests green.

**Commit:** `fix(image-cache): roll back blob when DB row write fails`
<!-- END_TASK_3 -->
