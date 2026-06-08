# Reduce Durable Object Alarm Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut `rsss_RssUserDO` request volume (currently ~88% alarm-driven, breaking the Cloudflare free tier) by lengthening the background poll interval and stopping the periodic alarm for idle accounts.

**Architecture:** The per-user Durable Object arms a self-perpetuating feed-refresh alarm. Cloudflare bills every alarm invocation as a DO request. Three changes: (A) lengthen the poll interval from 10 to 60 minutes; (B) stop re-arming the alarm once an account is idle past the inactivity threshold (so the DO goes silent and costs zero requests), while keeping the alarm alive whenever a pending account deletion is scheduled; (C) shorten the inactivity threshold from 30 days to 3 days. A returning user re-arms the alarm via the existing constructor path and an explicit `ensureFeedRefreshArmed()` call on the per-request activity hook.

**Tech Stack:** TypeScript (Cloudflare Workers + ES2022), `@cloudflare/workers-types` Durable Objects (SQLite + alarms), `@substrate-system/tapzero` tests bundled with esbuild and run via `tapout` (browser) / `tap-spec` (node).

---

## Background / Evidence

Confirmed from the Cloudflare dashboard (DO → Metrics → "Requests by type"):

- **Alarm: 4.09k** / HTTP: 569 / RPC: 21 over a ~7-day window. Alarms are ~88% of all DO requests.
- WebSocket messages are negligible (138 inbound hibernatable, 0 non-hibernatable) — the keepalive ping is correctly handled by `setWebSocketAutoResponse` and is **not** a cost driver. Do not touch the WebSocket path.

Root cause in `src/server/durable-objects/index.ts`:

- `FEED_REFRESH_INTERVAL_MS = 10 * 60 * 1000` (`:108`) — alarm fires every 10 min = 144/day per DO, 24/7.
- `alarm()` always re-arms via `scheduleNextFeedRefresh()` (`:2817`, `:2883-2887`) **before** the inactivity gate, so the alarm never stops — even for abandoned accounts.
- `ACCOUNT_INACTIVITY_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000` (`:117`) — 30 days; and even past it the gate only skips feed work, never the alarm.

Confirmed Cloudflare alarm semantics (docs):

- On an alarm-triggered wake, the **constructor runs before** the alarm handler, and `getAlarm()` in the constructor returns the **firing alarm's timestamp (non-null)**. So the constructor's `if (!currentAlarm) setAlarm(...)` (`:406-412`) does NOT re-arm during alarm wakes — it will not defeat Lever B.
- For a non-alarm wake (a request hitting a DO with no alarm), the constructor's `getAlarm()` returns null and re-arms — this is part of the resume path for returning users.
- `setAlarm` replaces any existing alarm. Alarms retry with exponential backoff if `alarm()` throws.

## Files Touched

- Modify: `src/server/durable-objects/index.ts`
  - `:108` interval constant (Task 1)
  - `:117` inactivity threshold constant (Task 4)
  - `:381` class doc comment (Task 1)
  - `alarm()` handler `:2806-2835` (Task 2)
  - `maybeKickCatchUp()` `:2787-2801` (Task 3)
  - new `ensureFeedRefreshArmed()` method near `scheduleNextFeedRefresh()` `:2883` (Task 3)
- Modify: `test/alarm.ts` (Tasks 1, 2, 4)
- Modify: `test/poll-state.ts` (Task 3)

Do NOT change `test/account-deletion-alarm.ts` logic — it is a regression guard that must stay green.

## Verification Commands

- Targeted (alarm + poll-state run inside the `test/index.ts` browser bundle):

  ```bash
  npx esbuild ./test/index.ts --bundle \
    --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts \
    --alias:@sentry/cloudflare=./test/sentry-cloudflare-stub.ts \
    --loader:.css=text --loader:.wasm=dataurl | npx tapout
  ```

- Account-deletion regression guard (node bundle):

  ```bash
  npx esbuild ./test/account-deletion-alarm.ts --bundle \
    --platform=node --format=esm \
    --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts \
    | node --input-type=module | npx tap-spec
  ```

- Full gate (run before finishing): `npm test && npm run lint`

---

## Task 1: Lengthen the poll interval to 60 minutes (Lever A)

**Files:**
- Modify: `src/server/durable-objects/index.ts:108` and the class doc comment at `:381`
- Test: `test/alarm.ts`

`FEED_REFRESH_INTERVAL_MS` is the single source of truth for the alarm cadence, per-feed `nextDueAt`, backoff base, and the catch-up trigger (used at `:410`, `:1821`, `:1981`, `:1998`, `:2795`, `:2885`). Changing this one constant makes polling hourly end-to-end.

- [ ] **Step 1: Write the failing cadence test**

Add this test to `test/alarm.ts`, immediately after the `import` lines' helper block (anywhere above the final `'alarm tests done'` test is fine):

```ts
test('scheduleNextFeedRefresh arms the next alarm ~60 minutes out', async t => {
    const armedTimes:number[] = []
    const userDo = Object.create(RsssUserDO.prototype) as {
        ctx:{ storage:{ setAlarm:(time:number) => Promise<void> } }
        scheduleNextFeedRefresh:() => Promise<void>
    }
    userDo.ctx = {
        storage: {
            async setAlarm (time:number) {
                armedTimes.push(time)
            }
        }
    }

    const before = Date.now()
    await userDo.scheduleNextFeedRefresh()

    t.equal(armedTimes.length, 1, 'exactly one alarm armed')
    const delta = armedTimes[0] - before
    t.ok(
        delta >= 60 * 60 * 1000,
        'next alarm is at least 60 minutes out'
    )
    t.ok(
        delta < 61 * 60 * 1000,
        'next alarm is under 61 minutes out'
    )
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run the targeted command (see "Verification Commands"). Expected: the new test FAILS — with the current 10-minute interval, `delta` is ~600000 ms, so `delta >= 3600000` is false.

- [ ] **Step 3: Change the interval constant**

In `src/server/durable-objects/index.ts:108`, change:

```ts
const FEED_REFRESH_INTERVAL_MS = 10 * 60 * 1000
```

to:

```ts
const FEED_REFRESH_INTERVAL_MS = 60 * 60 * 1000
```

- [ ] **Step 4: Update the class doc comment**

In the `RsssUserDO` class doc comment (around `:381`), change the line:

```ts
 * - Uses alarms for periodic feed polling (every 10 min)
```

to:

```ts
 * - Uses alarms for periodic feed polling (every 60 min); the alarm
 *   stops re-arming once the account is idle past
 *   ACCOUNT_INACTIVITY_THRESHOLD_MS so an idle DO incurs zero request
 *   cost, and is re-armed on the user's next request.
```

- [ ] **Step 5: Run the test and verify it passes**

Run the targeted command. Expected: the new cadence test PASSES, and all existing `alarm.ts` tests still pass (none assert the interval value; they use relative times and `alarmTimes.length`).

- [ ] **Step 6: Commit**

```bash
git add src/server/durable-objects/index.ts test/alarm.ts
git commit -m "perf(do): poll feeds hourly instead of every 10 minutes

Alarm invocations are ~88% of RsssUserDO requests. A 10-min cadence
is 144 alarm-requests/day per DO; 60 min cuts that 6x. The interval
constant also drives per-feed nextDueAt and backoff, so the whole
poll cadence becomes hourly."
```

---

## Task 2: Stop the alarm when the account is idle (Lever B, part 1)

**Files:**
- Modify: `src/server/durable-objects/index.ts` — `alarm()` handler at `:2806-2835`
- Test: `test/alarm.ts` (update one existing test, add one guard test)

The alarm must stop re-arming once idle past the threshold, EXCEPT when a pending (not-yet-due) account deletion is scheduled — that deletion relies on the periodic alarm firing to execute when due, so silencing it would orphan the deletion.

- [ ] **Step 1: Update the existing inactive test to expect the alarm to stop**

In `test/alarm.ts`, find the test currently named `'alarm short-circuits when account is inactive past threshold'` (around `:409`). Rename it and change the alarm-count assertion. Replace the whole test with:

```ts
test(
    'alarm stops re-arming when account is idle past threshold',
    async t => {
        const feeds = [createFeed(1), createFeed(2), createFeed(3)]
        const fetched:number[] = []
        const stored = new Map<string, unknown>()
        const alarmTimes:number[] = []
        // Seed last_active_at well past the inactivity threshold.
        const longAgo = Date.now() - 31 * 24 * 60 * 60 * 1000
        stored.set('poll:account:last_active_at', {
            lastActiveAt: longAgo
        })

        const userDo = createAlarmDo(
            feeds,
            async (feed) => {
                fetched.push(feed.id)
            },
            async (time) => {
                alarmTimes.push(time)
            },
            {
                async get<T> (key:string) {
                    return stored.get(key) as T|undefined
                },
                async put (key:string, value:unknown) {
                    stored.set(key, value)
                },
                async delete (key:string) {
                    stored.delete(key)
                }
            }
        )

        await userDo.alarm()

        t.equal(
            fetched.length,
            0,
            'idle account: zero feed fetches during alarm tick'
        )
        t.equal(
            alarmTimes.length,
            0,
            'idle account: alarm is NOT re-armed (DO goes silent)'
        )
    }
)
```

- [ ] **Step 2: Add the pending-deletion guard test**

In `test/alarm.ts`, immediately after the test from Step 1, add:

```ts
test(
    'alarm stays armed for an idle account with a pending deletion',
    async t => {
        const feeds = [createFeed(1)]
        const stored = new Map<string, unknown>()
        const alarmTimes:number[] = []
        // Idle past threshold...
        stored.set('poll:account:last_active_at', {
            lastActiveAt: Date.now() - 31 * 24 * 60 * 60 * 1000
        })
        // ...but a deletion is scheduled for the future.
        stored.set('pending_deletion', {
            scheduledFor: Date.now() + 60_000,
            did: 'did:plc:alice'
        })

        const userDo = createAlarmDo(
            feeds,
            async () => {},
            async (time) => {
                alarmTimes.push(time)
            },
            {
                async get<T> (key:string) {
                    return stored.get(key) as T|undefined
                },
                async put (key:string, value:unknown) {
                    stored.set(key, value)
                },
                async delete (key:string) {
                    stored.delete(key)
                }
            }
        )

        await userDo.alarm()

        t.equal(
            alarmTimes.length,
            1,
            'pending deletion keeps the alarm ticking so it fires when due'
        )
    }
)
```

- [ ] **Step 3: Run the tests and verify the inactive test fails**

Run the targeted command. Expected: the Step 1 test FAILS (current code calls `scheduleNextFeedRefresh()` unconditionally, so `alarmTimes.length` is 1, not 0). The Step 2 guard test PASSES already (current code re-arms before the gate) — this is intentional; it guards against the naive fix orphaning deletions.

- [ ] **Step 4: Restructure the `alarm()` handler**

In `src/server/durable-objects/index.ts`, replace the `alarm()` body (`:2806-2835`) with:

```ts
    async alarm (): Promise<void> {
        const pending = await this.ctx.storage.get<PendingDeletion>(
            PENDING_DELETION_KEY
        )
        if (pending && Date.now() >= pending.scheduledFor) {
            await this.executeAccountDeletion(pending.did)
            return
        }

        this.sweepStuckResolvingFeeds()

        // Inactivity gate (FR-008, SC-005): once an account has been
        // idle past the threshold, STOP the polling alarm so the DO
        // goes silent and incurs zero Durable Object request cost.
        // It is re-armed on the user's next request (constructor +
        // maybeKickCatchUp -> ensureFeedRefreshArmed). A pending
        // (not-yet-due) deletion must keep the alarm ticking so it
        // executes when due, so only silence the alarm when no
        // deletion is pending.
        const activity = await this.readAccountActivity()
        const idlePastThreshold = activity != null &&
            Date.now() - activity.lastActiveAt >
                ACCOUNT_INACTIVITY_THRESHOLD_MS
        if (idlePastThreshold && pending == null) {
            return
        }

        await this.scheduleNextFeedRefresh()
        await this.refreshFeedBatches()
    }
```

- [ ] **Step 5: Run the tests and verify they pass**

Run the targeted command AND the account-deletion regression command (see "Verification Commands"). Expected:
- `test/alarm.ts`: all tests PASS, including the updated inactive test (now `alarmTimes.length === 0`) and the new guard test.
- `test/account-deletion-alarm.ts`: all 3 tests PASS unchanged (due-deletion still executes and does not reschedule; future-deletion still reschedules; no-deletion still reschedules — none seed a stale activity marker, so `idlePastThreshold` is false and behavior is preserved).

- [ ] **Step 6: Commit**

```bash
git add src/server/durable-objects/index.ts test/alarm.ts
git commit -m "perf(do): stop the feed-refresh alarm for idle accounts

The alarm previously re-armed every tick regardless of activity, so
every DO that ever existed kept waking forever (the dominant request
cost). Now alarm() stops re-arming once the account is idle past the
inactivity threshold, so an idle DO goes fully silent. A scheduled
account deletion keeps the alarm alive so it still fires when due."
```

---

## Task 3: Re-arm the alarm on user activity (Lever B, part 2)

**Files:**
- Modify: `src/server/durable-objects/index.ts` — add `ensureFeedRefreshArmed()` near `scheduleNextFeedRefresh()` (`:2883`); call it from `maybeKickCatchUp()` (`:2787-2801`)
- Test: `test/poll-state.ts`

When the alarm has been stopped by Task 2, the next request that touches the DO must resume polling. The constructor already re-arms when it wakes a DO with no alarm, but we make this explicit and unit-testable on the per-request activity hook so the "an active account always has a polling alarm" invariant is enforced locally and does not depend on constructor timing.

- [ ] **Step 1: Extend the poll-state test harness to track alarms**

In `test/poll-state.ts`, replace the `createPollDo` function (`:21-55`) with this version (adds `getAlarm`/`setAlarm` to the fake storage, plus `ensureFeedRefreshArmed`/`maybeKickCatchUp` on the typed handle, and returns alarm bookkeeping). All existing tests destructure `{ userDo, storage }` and keep working:

```ts
function createPollDo () {
    const storage = new Map<string, unknown>()
    let alarmTime:number|null = null
    const alarmTimes:number[] = []
    const userDo = Object.create(RsssUserDO.prototype) as {
        ctx:{
            storage:{
                get:<T>(key:string) => Promise<T|undefined>
                put:<T>(key:string, value:T) => Promise<void>
                delete:(key:string) => Promise<void>
                getAlarm:() => Promise<number|null>
                setAlarm:(time:number) => Promise<void>
            }
        }
        readPollerFeedState:(feedId:number) => Promise<PollerFeedState|undefined>
        writePollerFeedState:(feedId:number, state:PollerFeedState) => Promise<void>
        deletePollerFeedState:(feedId:number) => Promise<void>
        readAccountActivity:() => Promise<AccountActivityMarker|undefined>
        writeAccountActivity:(now:number) => Promise<void>
        readLastAnySuccess:() => Promise<number|undefined>
        writeLastAnySuccess:(now:number) => Promise<void>
        ensureFeedRefreshArmed:() => Promise<void>
        maybeKickCatchUp:(now:number) => Promise<void>
    }

    userDo.ctx = {
        storage: {
            async get<T> (key:string) {
                return storage.get(key) as T|undefined
            },
            async put<T> (key:string, value:T) {
                storage.set(key, value)
            },
            async delete (key:string) {
                storage.delete(key)
            },
            async getAlarm () {
                return alarmTime
            },
            async setAlarm (time:number) {
                alarmTime = time
                alarmTimes.push(time)
            }
        }
    }

    return {
        userDo,
        storage,
        alarmTimes,
        // Seed an existing alarm without recording it as a new arm.
        seedAlarm (time:number) {
            alarmTime = time
        }
    }
}
```

- [ ] **Step 2: Write the failing `ensureFeedRefreshArmed` tests**

In `test/poll-state.ts`, add these three tests immediately before the final `'poll-state tests done'` test:

```ts
test('ensureFeedRefreshArmed arms an alarm when none is set', async t => {
    const { userDo, alarmTimes } = createPollDo()
    const before = Date.now()

    await userDo.ensureFeedRefreshArmed()

    t.equal(alarmTimes.length, 1, 'an alarm was armed')
    const delta = alarmTimes[0] - before
    t.ok(
        delta >= 60 * 60 * 1000 && delta < 61 * 60 * 1000,
        'armed ~60 minutes out'
    )
})

test('ensureFeedRefreshArmed is a no-op when an alarm exists', async t => {
    const { userDo, alarmTimes, seedAlarm } = createPollDo()
    seedAlarm(Date.now() + 5 * 60 * 1000)

    await userDo.ensureFeedRefreshArmed()

    t.equal(alarmTimes.length, 0, 'existing alarm is left untouched')
})

test('maybeKickCatchUp re-arms the alarm for a returning user', async t => {
    const { userDo, storage, alarmTimes } = createPollDo()
    const now = 1_700_000_000_000
    // Recent activity + recent success -> catch-up NOT triggered, so
    // refreshFeedBatches/waitUntil are never referenced; we isolate the
    // alarm-arming behaviour. No alarm is currently set.
    storage.set('poll:account:last_active_at', { lastActiveAt: now - 1_000 })
    storage.set('poll:account:last_any_success_at', {
        lastAnySuccessAt: now - 1_000
    })

    await userDo.maybeKickCatchUp(now)

    t.equal(
        alarmTimes.length,
        1,
        'activity ensures a polling alarm is armed'
    )
})
```

- [ ] **Step 3: Run the tests and verify they fail**

Run the targeted command. Expected: all three new tests FAIL — `ensureFeedRefreshArmed` does not exist yet (the first two error / fail), and `maybeKickCatchUp` does not arm an alarm yet (third asserts `alarmTimes.length === 1` but it is 0).

- [ ] **Step 4: Add the `ensureFeedRefreshArmed` method**

In `src/server/durable-objects/index.ts`, add this method immediately before `scheduleNextFeedRefresh()` (around `:2883`):

```ts
    /**
     * Ensure a periodic feed-refresh alarm is armed. Called from the
     * per-request activity hook (maybeKickCatchUp) so a returning user
     * whose alarm was stopped by the inactivity gate resumes polling.
     * Idempotent: a no-op when an alarm is already scheduled.
     */
    private async ensureFeedRefreshArmed ():Promise<void> {
        const existing = await this.ctx.storage.getAlarm()
        if (existing == null) {
            await this.ctx.storage.setAlarm(
                Date.now() + FEED_REFRESH_INTERVAL_MS
            )
        }
    }
```

- [ ] **Step 5: Call it from `maybeKickCatchUp`**

In `src/server/durable-objects/index.ts`, in `maybeKickCatchUp` (`:2787-2801`), add the `ensureFeedRefreshArmed()` call right after `writeAccountActivity`. The method becomes:

```ts
    private async maybeKickCatchUp (now:number):Promise<void> {
        const prev = await this.readAccountActivity()
        const prevLastActiveAt = prev?.lastActiveAt
        const lastAnySuccessAt = await this.readLastAnySuccess()
        const trigger = (
            prevLastActiveAt === undefined ||
            now - prevLastActiveAt > ACCOUNT_INACTIVITY_THRESHOLD_MS ||
            lastAnySuccessAt === undefined ||
            lastAnySuccessAt < now - FEED_REFRESH_INTERVAL_MS
        )
        await this.writeAccountActivity(now)
        await this.ensureFeedRefreshArmed()
        if (trigger) {
            this.ctx.waitUntil(this.refreshFeedBatches())
        }
    }
```

- [ ] **Step 6: Run the tests and verify they pass**

Run the targeted command. Expected: all three new `poll-state.ts` tests PASS, and all existing `poll-state.ts` tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/durable-objects/index.ts test/poll-state.ts
git commit -m "feat(do): re-arm the feed-refresh alarm on user activity

Pairs with the idle-account alarm stop: ensureFeedRefreshArmed()
guarantees an active account always has a polling alarm. Called from
maybeKickCatchUp so a returning user whose alarm was silenced resumes
polling on their next request. Idempotent when an alarm exists."
```

---

## Task 4: Shorten the inactivity threshold to 3 days (Lever C)

**Files:**
- Modify: `src/server/durable-objects/index.ts:117`
- Test: `test/alarm.ts` (add one boundary test)

With Lever B in place, this constant decides how long an abandoned/test DO keeps polling before going silent. 3 days clears idle DOs quickly; a returning user re-arms on their next request (Task 3). It is used by both the alarm gate and the catch-up trigger (`:2793`, `:2828`); 3 days is consistent for both.

- [ ] **Step 1: Write the failing boundary test**

In `test/alarm.ts`, add this test immediately after the `'alarm stays armed for an idle account with a pending deletion'` test from Task 2:

```ts
test(
    'alarm stops for an account idle just over 3 days',
    async t => {
        const feeds = [createFeed(1)]
        const fetched:number[] = []
        const stored = new Map<string, unknown>()
        const alarmTimes:number[] = []
        // 4 days idle: under the old 30-day threshold (would have kept
        // polling) but over the new 3-day threshold.
        stored.set('poll:account:last_active_at', {
            lastActiveAt: Date.now() - 4 * 24 * 60 * 60 * 1000
        })

        const userDo = createAlarmDo(
            feeds,
            async (feed) => {
                fetched.push(feed.id)
            },
            async (time) => {
                alarmTimes.push(time)
            },
            {
                async get<T> (key:string) {
                    return stored.get(key) as T|undefined
                },
                async put (key:string, value:unknown) {
                    stored.set(key, value)
                },
                async delete (key:string) {
                    stored.delete(key)
                }
            }
        )

        await userDo.alarm()

        t.equal(fetched.length, 0, '4-days-idle: no feed fetches')
        t.equal(alarmTimes.length, 0, '4-days-idle: alarm stops re-arming')
    }
)
```

- [ ] **Step 2: Run the test and verify it fails**

Run the targeted command. Expected: the new test FAILS — with the current 30-day threshold, 4 days idle is still "active", so the alarm re-arms and feeds are fetched (`alarmTimes.length === 1`, `fetched.length === 1`).

- [ ] **Step 3: Change the threshold constant**

In `src/server/durable-objects/index.ts:117`, change:

```ts
const ACCOUNT_INACTIVITY_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000
```

to:

```ts
const ACCOUNT_INACTIVITY_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000
```

- [ ] **Step 4: Run the tests and verify they pass**

Run the targeted command. Expected: the new boundary test PASSES. The existing `'alarm stops re-arming when account is idle past threshold'` test (31 days) and `'alarm resumes polling once last_active_at advances to now'` test (5 s ago) still PASS — 31 days is still past 3 days (idle), and 5 s is still under it (active).

- [ ] **Step 5: Commit**

```bash
git add src/server/durable-objects/index.ts test/alarm.ts
git commit -m "perf(do): drop inactivity threshold from 30 to 3 days

With the idle-account alarm stop in place, this is how long an
abandoned DO keeps polling before going silent. 3 days clears idle
and one-off test DOs quickly; a returning user re-arms on their next
request."
```

---

## Task 5: Full verification and manual confirmation

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite and lint**

Run: `npm test && npm run lint`
Expected: all tests PASS and lint reports no errors. (Per project convention, `npm test && npm run lint` is the gate.)

- [ ] **Step 2: Record the manual staging-verification steps**

These cannot be asserted in unit tests (they need a live DO + the Cloudflare metrics pipeline). After deploying to staging, confirm:

1. Cloudflare dash → `rsss-staging_RssUserDO` → Metrics → "Requests by type": the **Alarm** series should drop toward zero when no tab is open, and tick at most hourly (not every 10 min) while a session is active.
2. Open the app, leave it idle, and confirm feeds still refresh on load and on manual refresh (the client's on-demand paths are unaffected).
3. After a session ends, the alarm series for that DO should flatten within ~3 days and then ~one final tick (the idle tick that declines to re-arm), then go silent.
4. Returning to the app issues a `/feed-status` request that re-arms the alarm (Task 3) and kicks an immediate catch-up refresh (existing `maybeKickCatchUp` trigger).

- [ ] **Step 3: Final commit (if any doc/notes changes were made)**

If Step 2 notes were added to a tracking doc, commit them. Otherwise this task produces no commit.

---

## Self-Review Notes

- **Spec coverage:** Lever A → Task 1; Lever B (stop) → Task 2; Lever B (resume) → Task 3; Lever C → Task 4; verification → Task 5. The WebSocket ping is intentionally untouched (confirmed not a cost driver).
- **Deletion safety:** Task 2's `idlePastThreshold && pending == null` guard, plus the Step 2 guard test and the unchanged `account-deletion-alarm.ts`, ensure a scheduled deletion is never orphaned by the idle stop.
- **Constructor interaction:** Per Cloudflare docs, the constructor sees the firing alarm as non-null during alarm wakes (so it does not re-arm and fight Lever B), and sees null on a request wake of a silenced DO (so it re-arms for returning users). Task 3 makes resume explicit and testable on top of that.
- **Type consistency:** `ensureFeedRefreshArmed` is referenced in Task 3's test harness type, the method definition, and the `maybeKickCatchUp` call — same name throughout. `FEED_REFRESH_INTERVAL_MS` and `ACCOUNT_INACTIVITY_THRESHOLD_MS` are the only constants changed and are used consistently.
