# "N updates" Count Accuracy + Freshness — Phase 2

**Goal:** Make the per-DO polling alarm self-heal an overdue alarm on the next
construction/request, and guarantee the alarm always reschedules itself before
running any fallible discovery work — so the polling loop can never silently
die.

**Architecture:** Two small, defensive changes to `RsssUserDO` in
`src/server/durable-objects/index.ts`. (1) `ensureFeedRefreshArmed()` re-arms
not only when no alarm exists but also when the stored alarm time is in the
past (near-immediate fire), and the constructor routes its cold-start arming
through that same method (DRY). (2) `alarm()` is reordered/guarded so the
reschedule happens before fallible steps, while preserving the two intentional
non-rescheduling exits (pending-deletion-due, inactivity gate).

**Tech Stack:** TypeScript (Cloudflare DO runtime, ES2022), Cloudflare DO
alarm API (`ctx.storage.getAlarm()/setAlarm()`, epoch ms),
`@substrate-system/tapzero`, the DO storage/alarm fakes used in
`test/poll-state.ts` and `test/account-deletion-alarm.ts`.

**Scope:** Phase 2 of 4.

**Codebase verified:** 2026-06-14

**Skills to activate (executor):** `ed3d-house-style:howto-code-in-typescript`,
`durable-objects`, `superpowers:test-driven-development`,
`ed3d-house-style:writing-good-tests`.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### 040-fix-updates-count.AC2: Background discovery alarm self-heals and cannot silently die
- **040-fix-updates-count.AC2.1 Success:** an alarm whose stored fire-time is
  in the past is re-armed on the next DO construction/request.
- **040-fix-updates-count.AC2.2 Success:** `alarm()` schedules the next alarm
  even when a pre-discovery step (e.g. `sweepStuckResolvingFeeds`/
  `readAccountActivity`) throws.
- **040-fix-updates-count.AC2.3 Guard:** the inactivity gate still
  intentionally suppresses rescheduling (DO goes dormant), and the
  pending-deletion path is unaffected.

---

## Verified codebase facts (read before starting)

All line numbers are `src/server/durable-objects/index.ts` as of 2026-06-14;
re-confirm with a quick read before editing.

- `FEED_REFRESH_INTERVAL_MS = 60 * 60 * 1000` (line ~149).

- `ensureFeedRefreshArmed()` (lines 3674-3681) currently arms only when no
  alarm exists:

  ```ts
  private async ensureFeedRefreshArmed ():Promise<void> {
      const existing = await this.ctx.storage.getAlarm()
      if (existing == null) {
          await this.ctx.storage.setAlarm(
              Date.now() + FEED_REFRESH_INTERVAL_MS
          )
      }
  }
  ```
  Called from `maybeKickCatchUp()` (line ~3582). **It is NOT currently called
  by the constructor** — the constructor duplicates the arming inline.

- Constructor (lines 485-509) arms the initial alarm inline inside
  `blockConcurrencyWhile`:

  ```ts
  ctx.blockConcurrencyWhile(async () => {
      await this.initDatabase()
      const currentAlarm = await ctx.storage.getAlarm()
      if (!currentAlarm) {
          await ctx.storage.setAlarm(
              Date.now() + FEED_REFRESH_INTERVAL_MS
          )
      }
  })
  ```

- `scheduleNextFeedRefresh()` (lines 3683-3687):

  ```ts
  private async scheduleNextFeedRefresh ():Promise<void> {
      await this.ctx.storage.setAlarm(
          Date.now() + FEED_REFRESH_INTERVAL_MS
      )
  }
  ```

- `alarm()` (lines 3591-3620), current order of operations:
  1. read `PENDING_DELETION_KEY`; if a deletion is due →
     `executeAccountDeletion(...)` then `return` (intentional: no reschedule).
  2. `this.sweepStuckResolvingFeeds()` (synchronous SQL).
  3. `const activity = await this.readAccountActivity()` then the inactivity
     gate: if idle past `ACCOUNT_INACTIVITY_THRESHOLD_MS` AND no pending
     deletion → `return` (intentional dormancy: no reschedule).
  4. `await this.scheduleNextFeedRefresh()`.
  5. `await this.refreshFeedBatches()`.

  There is **no try/catch**. If `readAccountActivity()`,
  `scheduleNextFeedRefresh()`, or `refreshFeedBatches()` throws, the alarm
  exits without rescheduling — the loop dies.

- Existing tests + fakes to model on:
  - `test/poll-state.ts:195-236` — `ensureFeedRefreshArmed` arms-when-null /
    no-op-when-set, using a fake `ctx.storage` with `alarmTime` plus an
    `alarmTimes` array recording every `setAlarm` call. (Runs via
    `test/index.ts:23` `import './poll-state.js'`.)
  - `test/account-deletion-alarm.ts:104-200` — `alarm()` deletion + normal
    paths, fake `ctx.storage`. (Runs as a standalone node test registered in
    `test/run-all-tests.mjs:204-209`.)
  Both reuse `test/helpers/sql-fake.ts`. Adding tests to these existing files
  needs no runner wiring.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: `ensureFeedRefreshArmed()` re-arms an overdue alarm; constructor uses it

**Verifies:** 040-fix-updates-count.AC2.1

**Files:**
- Modify: `src/server/durable-objects/index.ts` — `ensureFeedRefreshArmed()`
  (~3674), constructor `blockConcurrencyWhile` block (~499-508), and a new
  near-immediate self-heal constant near `FEED_REFRESH_INTERVAL_MS` (~149).
- Test: `test/poll-state.ts` (add cases).

**Implementation:**

1. Add a constant beside `FEED_REFRESH_INTERVAL_MS`:
   ```ts
   // When a stored alarm is already overdue (e.g. it never fired under
   // `wrangler dev`, or the runtime dropped it), re-arm it to fire almost
   // immediately rather than a full interval out, so the heal runs a
   // discovery pass promptly. alarm() then reschedules to now + interval,
   // returning to the normal cadence (no tight loop).
   const OVERDUE_ALARM_REARM_DELAY_MS = 5 * 1000
   ```

2. Extend `ensureFeedRefreshArmed()` to re-arm when the stored alarm is `null`
   OR already in the past:
   ```ts
   private async ensureFeedRefreshArmed ():Promise<void> {
       const existing = await this.ctx.storage.getAlarm()
       if (existing == null) {
           await this.ctx.storage.setAlarm(
               Date.now() + FEED_REFRESH_INTERVAL_MS
           )
           return
       }
       if (existing <= Date.now()) {
           await this.ctx.storage.setAlarm(
               Date.now() + OVERDUE_ALARM_REARM_DELAY_MS
           )
       }
   }
   ```
   Idempotent: a future alarm is left untouched.

3. Replace the constructor's inline arming with a call to the same method, so
   cold start heals an overdue alarm too. Inside `blockConcurrencyWhile`, after
   `await this.initDatabase()`:
   ```ts
   await this.ensureFeedRefreshArmed()
   ```
   Remove the now-redundant inline `getAlarm()/setAlarm()` block. (Calling a
   private method on `this` inside the constructor's `blockConcurrencyWhile`
   callback is fine; it only touches `ctx.storage`, not SQL, so ordering vs
   `initDatabase()` does not matter.)

**Testing (add to `test/poll-state.ts`):**
- AC2.1: with the fake `getAlarm()` returning a timestamp in the past,
  `ensureFeedRefreshArmed()` calls `setAlarm()` once with a near-immediate
  time (assert the recorded time is `<= Date.now() + a small slack`, e.g.
  within ~2× `OVERDUE_ALARM_REARM_DELAY_MS`, and clearly far below
  `Date.now() + FEED_REFRESH_INTERVAL_MS`).
- Regression: with `getAlarm()` returning a FUTURE time, `setAlarm()` is NOT
  called (still a no-op). Keep/extend the existing arms-when-null case.

Follow house TS style; assert on the recorded `setAlarm` times, not on
implementation wiring.

**Verification:**
```bash
esbuild ./test/poll-state.ts --bundle \
  --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts | tapout
```
Expected: all assertions pass.

**Commit:** `fix: self-heal overdue feed-refresh alarm on construction (040 AC2.1)`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: `alarm()` reschedules before fallible work; intentional exits preserved

**Verifies:** 040-fix-updates-count.AC2.2, .AC2.3

**Files:**
- Modify: `src/server/durable-objects/index.ts` — `alarm()` (~3591-3620).
- Test: `test/account-deletion-alarm.ts` (add cases).

**Implementation:**

Reorder/guard `alarm()` so the reschedule cannot be skipped by a thrown
fallible step, while keeping the two intentional non-rescheduling exits. Target
shape (preserve existing comments / constants; adapt names to the file):

```ts
async alarm ():Promise<void> {
    const pending = await this.ctx.storage.get<PendingDeletion>(
        PENDING_DELETION_KEY
    )
    if (pending && Date.now() >= pending.scheduledFor) {
        await this.executeAccountDeletion(pending.did)
        return  // intentional: DO is being deleted, do not reschedule
    }

    // Fallible pre-discovery step: a throw here must not kill the loop.
    try {
        this.sweepStuckResolvingFeeds()
    } catch (err) {
        console.error('alarm sweepStuckResolvingFeeds error:', err)
    }

    // Inactivity gate. readAccountActivity() is fallible; if it throws we
    // cannot prove idleness, so default to "active" and keep polling rather
    // than dying.
    let idlePastThreshold = false
    try {
        const activity = await this.readAccountActivity()
        idlePastThreshold = activity != null &&
            Date.now() - activity.lastActiveAt >
                ACCOUNT_INACTIVITY_THRESHOLD_MS
    } catch (err) {
        console.error('alarm readAccountActivity error:', err)
        idlePastThreshold = false
    }
    if (idlePastThreshold && pending == null) {
        return  // intentional dormancy: do not reschedule (AC2.3)
    }

    // Reschedule BEFORE any further fallible discovery work (AC2.2): even if
    // refreshFeedBatches throws, the next tick is already armed.
    await this.scheduleNextFeedRefresh()

    try {
        await this.refreshFeedBatches()
    } catch (err) {
        console.error('alarm refreshFeedBatches error:', err)
    }
}
```

Notes:
- Log with `console.error` — the DO file's existing error-logging convention
  (e.g. `src/server/durable-objects/index.ts:3640,3652,3661`); there is no
  `debug` logger in this file. Do NOT log PII.
- Keep the existing explanatory comments about the inactivity gate /
  pending-deletion intent.
- Only the two early `return`s remain as non-rescheduling exits.

**Testing (add to `test/account-deletion-alarm.ts`):**
Use the existing fake-DO harness in that file (fake `ctx.storage` recording
`setAlarm` calls). Add:
- AC2.2 (sweep throws): make `this.sweepStuckResolvingFeeds` throw; run
  `alarm()`; assert `setAlarm` WAS called (loop rescheduled) and no unhandled
  rejection.
- AC2.2 (readAccountActivity throws): make `readAccountActivity` reject; run
  `alarm()`; assert `setAlarm` WAS called.
- AC2.2 (refreshFeedBatches throws): make `refreshFeedBatches` reject; run
  `alarm()`; assert `setAlarm` was called BEFORE the throw (reschedule
  survives).
- AC2.3 (inactivity gate dormant): with `readAccountActivity` returning an
  activity marker older than `ACCOUNT_INACTIVITY_THRESHOLD_MS` and NO pending
  deletion, run `alarm()`; assert `setAlarm` was NOT called (stays dormant).
- AC2.3 (pending-deletion unaffected): keep the existing deletion-path
  assertions green (deletion-due executes deletion and does not reschedule;
  not-yet-due keeps ticking) — verify they still pass after the reorder.

Stub the DO's own methods on the `Object.create`d instance. NOTE: the existing
`createDeletionDo` harness (`test/account-deletion-alarm.ts:26-102`) currently
overrides only `refreshFeedBatches` (via `Object.defineProperty`) and runs
`sweepStuckResolvingFeeds` / `readAccountActivity` as the real methods against
the fakes. For these new cases you must add explicit `Object.defineProperty`
overrides for the other methods you need to control —
`sweepStuckResolvingFeeds`, `readAccountActivity`, `refreshFeedBatches` (and
`executeAccountDeletion` if exercised). Specifically, for the AC2.2
`readAccountActivity` case it must be made to REJECT (return a rejected
promise / throw), not merely return a value. Assert on observed `setAlarm`
calls, not on internal call wiring.

**Verification:**
```bash
esbuild ./test/account-deletion-alarm.ts --bundle \
  --platform=node --format=esm \
  --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts \
  | node --input-type=module | tap-spec
```
Expected: all assertions pass.

**Commit:** `fix: reschedule feed alarm before fallible discovery work (040 AC2.2/2.3)`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

---

## Phase Done When

- An overdue stored alarm is re-armed (near-immediate) on construction and via
  `ensureFeedRefreshArmed()`; a future alarm is left untouched.
- `alarm()` reschedules whenever `sweepStuckResolvingFeeds` /
  `readAccountActivity` / `refreshFeedBatches` throws, and still goes dormant
  on the inactivity gate and does not reschedule on a due deletion.
- New tests in `test/poll-state.ts` and `test/account-deletion-alarm.ts` pass.
- `npm test && npm run lint` is green.

**Covers:** 040-fix-updates-count.AC2.1, .AC2.2, .AC2.3
