# Phase 6: Decouple `getAdapter` from `billingStatus`

**Goal:** Remove the race where every adapter selection waits for an
HTTP-resolved `billingStatus` signal. Local-first sync becomes
governed solely by the user's persisted `syncSubscriptions` toggle
plus OPFS feature detection. Lapsed-billing policing remains intact —
it is enforced by the existing `SyncBillingError` / `PushSyncBillingError`
handlers on the next sync cycle.

**Architecture:** A one-line predicate change in
`src/client/db/index.ts:175-213`. No new modules, no signal changes,
no UI changes. `recomputeCacheStatus` in
`src/client/cache-status-state.ts:51-84` already tolerates
`billingStatus.value === null` (returns early with the empty
snapshot at lines 56-58), so it needs no edit.

The behavioral change: a paid user who reloads will now hit the
*local* adapter immediately (instead of falling through to the
remote adapter for the few hundred ms it takes
`/api/billing/status` to resolve). A lapsed user who has stale OPFS
data will see one cached render before the next sync cycle returns
`SyncBillingError`, at which point the existing handler triggers a
fresh `loadBillingStatus()` and the UI downgrades to free-tier
behavior. The design explicitly accepts this brief edge-case
latency.

**Tech Stack:** TypeScript (browser, ES2022).

**Scope:** Phase 6 of 8. Independent of the paint-cache work
(Phases 3-5) — can land alone.

**Codebase verified:** 2026-05-25

**Key facts from investigation:**
- `getAdapter` predicate at `src/client/db/index.ts:176-182`:
  ```typescript
  if (
      billingStatus.value?.entitled &&
      syncSubscriptions.value &&
      did &&
      !bootstrapInProgress.value &&
      await isLocalFirstSupported()
  ) {
  ```
  The fix is to remove the `billingStatus.value?.entitled &&` line
  (line 177).
- `billingStatus` is imported at the top of `db/index.ts` and is
  used *only* in this one place. After the predicate edit, the
  import is dead. Remove it cleanly.
- `recomputeCacheStatus` already tolerates `billing === null`
  (`cache-status-state.ts:55-59`):
  ```typescript
  const billing = billingStatus.value
  if (!billing || !billing.entitled) {
      if (cacheStatus.value !== null) cacheStatus.value = null
      return
  }
  ```
  This branch fires for both the "billing not yet loaded" and "user
  is not paid" cases — it has been correct from the start.
- `SyncBillingError` / `PushSyncBillingError` handlers at
  `state.ts:545-550` (sync-start effect) and
  `state.ts:626-629` (online-recovery effect) call
  `State.loadBillingStatus()` on those error classes. The handler
  remains the same; the downgrade flow continues to work because
  the *next* sync cycle (now that the user is on the local adapter)
  will surface the billing error and trigger the recovery path.
- Adapter cache (`_cachedAdapter`, `_cachedAdapterDid`) at the top
  of `db/index.ts` is per-DID. There is no risk of returning a
  stale-from-other-user adapter; the cache is invalidated on
  account switch by the existing `_resetAdapterCache()` calls
  (line 238-243).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### 023-fix-initial-load.AC4: `getAdapter` no longer reads `billingStatus`
- **023-fix-initial-load.AC4.1 Success:** With `syncSubscriptions=true`,
  OPFS supported, `did` set, `bootstrapInProgress=false`, and
  `billingStatus.value === null`, `getAdapter(did)` returns the local
  adapter. (Today's code returns the remote adapter in this state.)
- **023-fix-initial-load.AC4.2 Success:** With `syncSubscriptions=false`,
  `getAdapter` returns the remote adapter regardless of
  `billingStatus`.
- **023-fix-initial-load.AC4.3 Failure:** A lapsed-billing user
  receiving `SyncBillingError` on the first background sync still
  triggers `loadBillingStatus()` and the existing downgrade flow.

### 023-fix-initial-load.AC7: Third-party latency does not block paint
- **023-fix-initial-load.AC7.2 Success:** `loadBillingStatus()` is
  not awaited on the **initial render critical path** (app bootstrap,
  the first user effect at state.ts:572, the first sync cycle).
  User-initiated action handlers fired in response to user clicks
  AFTER first paint MAY await `loadBillingStatus()`; these are not
  on the initial-render path.

  *Verified by code search in Task 2 — this AC is a *constraint*
  this phase confirms, not a new behavior. See phase_06_findings.md
  for the complete audit results.*

---

<!-- START_TASK_1 -->
### Task 1: Drop the `billingStatus` predicate from `getAdapter`

**Verifies:** AC4.1, AC4.2, AC4.3

**Files:**
- Modify: `src/client/db/index.ts` (lines 175-213, plus the import
  cleanup at the top of the file)

**Implementation:**

In the `getAdapter` predicate (lines 176-182), remove the
`billingStatus.value?.entitled &&` line. The resulting predicate:

```typescript
export async function getAdapter (did?:string):Promise<DbAdapter> {
    if (
        syncSubscriptions.value &&
        did &&
        !bootstrapInProgress.value &&
        await isLocalFirstSupported()
    ) {
        // ...unchanged body...
    }
    return remoteAdapter
}
```

At the top of the file, remove the `billingStatus` import (it was
the only consumer):

```typescript
// Before:
import { billingStatus } from '../billing-status.js'

// After:
// (removed — no consumers in this file)
```

If `billingStatus` is imported alongside other names from the same
module, narrow the import instead of removing the whole line. (Run
`rg -n "from '../billing-status'" src/client/db/index.ts` first to
confirm the exact import shape.)

Update the docstring above `getAdapter` (lines 169-174) to remove the
mention of billing:

```typescript
/**
 * Returns `localAdapter` when the user has opted in to local-first
 * sync AND the browser supports OPFS. Otherwise returns
 * `remoteAdapter`.
 *
 * Pass `did` only when local-first is active (used to open the DB).
 *
 * Lapsed-billing enforcement happens at sync time via SyncBillingError
 * / PushSyncBillingError handlers in state.ts — not here.
 */
```

**Testing:**

Add tests in `test/adapter-factory.ts` (existing file; verify by
opening it for the established stub pattern for `billingStatus`,
`syncSubscriptions`, `bootstrapInProgress`, and `isLocalFirstSupported`).

Tests must verify each AC listed:
- **AC4.1:** Set `syncSubscriptions.value = true`,
  `bootstrapInProgress.value = false`,
  `billingStatus.value = null`,
  stub `isLocalFirstSupported()` to return `true`. Call
  `getAdapter('did:plc:alice')`. Assert the returned adapter is the
  local adapter (compare by reference to the local adapter export
  or by a marker property the existing tests use to distinguish).
- **AC4.2:** Set `syncSubscriptions.value = false`,
  `billingStatus.value = { entitled: true, ... }`. Call
  `getAdapter('did:plc:alice')`. Assert the returned adapter is the
  *remote* adapter — `syncSubscriptions` still gates local-first.
- **AC4.3:** Reuse existing coverage in
  `test/sync.ts` (or equivalent) that exercises the
  `SyncBillingError` -> `loadBillingStatus` recovery path. Confirm
  it still passes unchanged. No new test needed if existing
  coverage already runs this path; if it does not, add one that:
  1. Throws `SyncBillingError` from `runSync` inside the
     `startLocalSync` effect.
  2. Asserts `State.loadBillingStatus` is called as a side effect.
  3. (Optionally) asserts the UI downgrades.

  Task-implementor surveys `test/sync.ts` and decides whether
  existing coverage already verifies AC4.3 or if a new test is
  needed.

Run `rg -n "from '../billing-status'" src/` to confirm that
removing the `getAdapter` consumer does NOT break any other file's
import.

**Verification:**

Run: `npm run typecheck`
Expected: Clean. Confirms the `billingStatus` removal didn't leave a
dangling reference.

Run: `npm run lint`
Expected: Clean.

Run: `npm test`
Expected: All tests pass, including the new AC4.* coverage.

Manual check (per the `run` skill):
1. With an account that has `syncSubscriptions=true`, throttle
   `/api/billing/status` to take ≥3 seconds (DevTools network
   throttle or a server-side stub).
2. Reload the home route.
3. In DevTools, set a breakpoint or log on `getAdapter`. Confirm it
   returns the local adapter *immediately* (within the first
   render frame), without waiting for `/api/billing/status` to
   resolve.

**Commit:**

```bash
git add src/client/db/index.ts test/adapter-factory.ts
git commit -m "refactor: getAdapter no longer reads billingStatus

Removes billingStatus.value?.entitled from the getAdapter predicate
so adapter selection is no longer blocked on the (slow, third-party)
billing-status HTTP round-trip. Lapsed-billing enforcement remains
intact via the existing SyncBillingError handlers — they run on the
next sync cycle and trigger loadBillingStatus + UI downgrade as
before.

Part of 023-fix-initial-load."
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Confirm `loadBillingStatus` is not on the critical path

**Verifies:** AC7.2

**Files:**
- No files modified (audit-only).

**Implementation:**

This task is an audit that produces no code change but is required
to claim AC7.2.

1. Run:

   ```bash
   rg -n "await\\s+State\\.loadBillingStatus|await\\s+loadBillingStatus" src/
   ```

   Expected: zero matches. The only call to `loadBillingStatus` should
   be the fire-and-forget call at `state.ts:572` (inside the user
   effect's microtask).

2. Run:

   ```bash
   rg -n "loadBillingStatus" src/
   ```

   For each match, classify it as:
   - Fire-and-forget (no await) on render critical path: OK.
   - Awaited call in effect or bootstrap code: BLOCKER — investigate and refactor.
   - Awaited call in user-initiated action handler (checkout, account deletion, etc.): OK
     (not on the initial-render path).

3. Document the audit results in `phase_06_findings.md`. The note
   records the result of step 1-2, links each occurrence to its
   file:line, and classifies each match (critical-path vs. user-action).

If step 1 finds awaited calls on the initial-render critical path
(app bootstrap, the user effect, the first sync cycle), the
implementation plan needs an additional task to remove the await
before the AC can be claimed.

**Verification:**

`rg -n "await\\s+State\\.loadBillingStatus|await\\s+loadBillingStatus" src/`
returns no results.

**Commit:**

```bash
git add DOCS/implementation-plans/2026-05-24-023-fix-initial-load/phase_06_findings.md
git commit -m "docs: 023 phase 6 — confirm loadBillingStatus not on critical path"
```

<!-- END_TASK_2 -->
