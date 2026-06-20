# Scheduled-drain ingestion — Phase 5: Alarm scheduling, runDrain, and dev trigger

**Goal:** Drive the drain on a recurring DO alarm that mirrors the project's
feed-refresh contract (reschedule before fallible work, self-heal an overdue
alarm), wire `runDrain` to the Phase 3/4 pieces, and add a development-only
manual trigger.

**Architecture:** Extends `RsssIndexerDO` (`src/server/durable-objects/indexer.ts`)
with `alarm()`, `scheduleNextDrain()`, `ensureDrainArmed()` (cold-start +
self-heal), and `runDrain()` (cursor → `drainOnce` → persist cursor). The drain
dependencies are injected via a `protected drainDeps()` so the alarm/cursor
logic is unit-testable without a network. A dev-gated `drain-now` (DO route +
worker route) mirrors the existing `poll-now` defense-in-depth.

**Tech Stack:** TypeScript (Cloudflare Workers runtime), Durable Object alarms
(`setAlarm`/`getAlarm`), Hono, `@substrate-system/tapzero` with the
`cloudflare:workers` test stub.

**Scope:** Phase 5 of 6 (scheduled-drain ingestion).

**Codebase verified:** 2026-06-19

---

## Verification gate (typecheck baseline)

The `hose-listening` branch baseline is NOT type-clean: `npm run typecheck`
(`tsc --noEmit`) exits non-zero with **25 pre-existing errors unrelated to this
feature** — 3 in `src/` (`src/client/routes/sync-status-format.ts`,
`src/client/routes/sync-status-state.ts`) and ~22 in `test/` (an undefined
`QueryResult` global). CI (`.github/workflows/nodejs.yml`) runs the same
command, so the branch is already red.

Therefore, wherever a task below says "`npm run typecheck` → passes", read it
as: **introduces NO NEW type errors in the files this task creates or
modifies.** Capture the baseline once before starting
(`npm run typecheck 2>&1 | grep -c 'error TS'` → `25`) and confirm the count
does not increase and that no new error line names a file this task touched.
`npm run lint` (clean on baseline) and `npm test` remain hard pass/fail gates.

---

## Acceptance Criteria Coverage

Implements and tests `scheduled-drain.AC4` (scheduling). Derived from
`specs/scheduled-drain.md` "Scheduling mechanism", "The drain" (`runDrain`), and
"Correctness invariants" (one scheduling mechanism; reschedule before fallible
work). The alarm trio mirrors the documented feed-refresh contract in the root
`CLAUDE.md`, minus the per-user inactivity/deletion gates — the global singleton
always reschedules then drains.

Cold-start (approved): **wake on first read.** Phase 6's read API constructs and
arms the singleton on the first frontend read; once armed, the alarm
self-perpetuates every `DRAIN_INTERVAL_MS` (Cloudflare durably re-instantiates
the DO to fire each alarm, which reschedules). In development, `drain-now` also
constructs+arms it. This phase therefore does NOT add a production kick of its
own.

### scheduled-drain.AC4: Alarm scheduling and runDrain
- **scheduled-drain.AC4.1 reschedule-before-fallible:** `alarm()` calls
  `setAlarm` BEFORE `runDrain`; if `runDrain` throws, the alarm is still armed
  and `alarm()` does not throw.
- **scheduled-drain.AC4.2 cold-start arm:** constructing the DO with no existing
  alarm arms one at `now + DRAIN_INTERVAL_MS`.
- **scheduled-drain.AC4.3 overdue re-arm:** an existing overdue alarm is re-armed
  at `now + OVERDUE_ALARM_REARM_DELAY_MS`.
- **scheduled-drain.AC4.4 idempotent arm:** an existing future alarm is left
  unchanged.
- **scheduled-drain.AC4.5 cursor persists after drain:** `runDrain` saves the
  advanced cursor only when it moved forward; a null starting cursor drives
  live-from-now (`jetstreamUrl(null)` — no `cursor` param).
- **scheduled-drain.AC4.6 dev gate:** the `drain-now` DO route returns 404 when
  `NODE_ENV !== 'development'`.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Alarm machinery + runDrain in indexer.ts

**Verifies:** scheduled-drain.AC4.1–AC4.5

**Files:**
- Modify: `src/server/durable-objects/indexer.ts`

**Implementation:**

Add imports at the top:

```ts
import {
    drainOnce,
    openJetstreamSocketWithFailover,
    type DrainDeps
} from '../indexer/drain.js'
import { applyCommit } from '../indexer/apply-commit.js'
import type { JetstreamEvent } from '../indexer/types.js'
```

Add constants near `CURSOR_KEY`:

```ts
const DRAIN_INTERVAL_MS = 60_000           // 60s (spec default)
const OVERDUE_ALARM_REARM_DELAY_MS = 5_000
```

In the constructor's existing `ctx.blockConcurrencyWhile(async () => { … })`,
after the schema `exec`s, arm the alarm on cold start:

```ts
            await this.ensureDrainArmed()
```

Add the methods (the alarm has no inactivity/deletion gate — always reschedule
then drain):

```ts
    async alarm ():Promise<void> {
        // Reschedule first: a throw in the drain must not strand the alarm.
        await this.scheduleNextDrain()
        try {
            await this.runDrain()
        } catch (err) {
            // Next tick retries from the saved cursor; writes are idempotent.
            console.error('indexer drain failed', err)
        }
    }

    private async scheduleNextDrain ():Promise<void> {
        await this.ctx.storage.setAlarm(Date.now() + DRAIN_INTERVAL_MS)
    }

    private async ensureDrainArmed ():Promise<void> {
        const existing = await this.ctx.storage.getAlarm()
        if (existing == null) {
            await this.ctx.storage.setAlarm(Date.now() + DRAIN_INTERVAL_MS)
            return
        }
        if (existing <= Date.now()) {
            await this.ctx.storage.setAlarm(
                Date.now() + OVERDUE_ALARM_REARM_DELAY_MS
            )
        }
    }

    // Injectable for tests; production uses the failover opener — primary
    // host, then secondary on an open failure (Phase 4 drain.ts).
    protected drainDeps ():DrainDeps {
        return { open: openJetstreamSocketWithFailover }
    }

    protected async runDrain ():Promise<void> {
        const cursor = await this.getCursor()        // null => live-from-now
        const next = await drainOnce(
            this.drainDeps(),
            (evt:JetstreamEvent) => applyCommit(this.sql, evt),
            cursor
        )
        if (next > (cursor ?? 0)) await this.setCursor(next)
    }
```

Notes:
- `getCursor`/`setCursor` were created `private` in Phase 1. Keep them as-is —
  they are called by `runDrain`/the stats route within the class.
- `this.env` is available on the `DurableObject` base (used by the dev route in
  Task 2); `IndexerEnv` already declares `NODE_ENV?`.
- The alarm deliberately omits the inactivity gate — the index must keep
  current regardless of reader activity.
- The constructor's `ctx.blockConcurrencyWhile(async () => { … })` is
  intentionally NOT awaited at the call site (it matches `registry.ts`), while
  `await this.ensureDrainArmed()` INSIDE its async body IS awaited. Do not "fix"
  the un-awaited call — `blockConcurrencyWhile` gates request handling until the
  body settles by design.
- `drainDeps()` returns `openJetstreamSocketWithFailover` (Phase 4): the drain
  opens the primary Jetstream host and falls back to the secondary on an open
  failure, so a single dead host does not stall every tick.

**Verify:** `npm run typecheck` && `npm run lint`.

**Commit:** `feat: drive the indexer drain on a self-healing DO alarm`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Dev-only drain-now trigger (DO route + worker route)

**Verifies:** scheduled-drain.AC4.6

**Files:**
- Modify: `src/server/durable-objects/indexer.ts` (add DO route in
  `createRouter()`)
- Modify: `src/server/index.ts` (add worker route)

**Implementation:**

DO route inside `createRouter()` (re-gated independently — the gate must live on
the DO too):

```ts
        app.post('/internal/dev/drain-now', async (c) => {
            if (this.env?.NODE_ENV !== 'development') return c.notFound()
            const before = Number((this.sql.exec(
                'SELECT count(*) AS c FROM items').one() as { c:number }).c)
            await this.runDrain()
            const after = Number((this.sql.exec(
                'SELECT count(*) AS c FROM items').one() as { c:number }).c)
            return c.json({
                before,
                after,
                newItems: after - before,
                cursor: await this.getCursor()
            })
        })
```

Worker route in `src/server/index.ts`, next to the existing
`POST /api/dev/poll-now` (the env gate runs BEFORE `requireAuth` so production
returns 404, not 401):

```ts
app.post('/api/dev/drain-now',
    async (c, next) => {
        if (c.env.NODE_ENV !== 'development') return c.notFound()
        return next()
    },
    requireAuth,
    async (c) => {
        const stub = getIndexerDO(c.env)
        if (!stub) return c.notFound()
        return stub.fetch(new Request(
            'http://do/internal/dev/drain-now', { method: 'POST' }))
    }
)
```

Notes:
- This route opens a REAL Jetstream socket under `wrangler dev`. With few/no
  `space.rsss.*` events live, it reaches the live edge / idles quickly and
  returns. That is the manual end-to-end smoke for the whole pipeline.
- Keep `requireAuth` for parity with `poll-now`; the route is already
  development-gated on both layers.

**Verify:** `npm run typecheck` && `npm run lint`.

**Commit:** `feat: add dev-only indexer drain-now trigger (gated both layers)`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Alarm + runDrain tests

**Verifies:** scheduled-drain.AC4.1–AC4.6

**Files:**
- Create: `test/indexer-alarm.ts` (unit/integration)
- Modify: `test/run-all-tests.mjs` (register, WITH the `cloudflare:workers`
  alias — `indexer.ts` imports `DurableObject` from `cloudflare:workers`)

**Testing:**

Mirror `test/account-deletion-alarm.ts`: construct the DO with a fake
`DurableObjectState` whose `storage` records `setAlarm` calls and returns chosen
`getAlarm` values, exposes `get`/`put` for the cursor, and a fake `sql` (capture
`exec`; return `fakeResult` from `./helpers/sql-fake.js`). Subclass
`RsssIndexerDO` to inject test seams. Author with `@substrate-system/tapzero`;
verify observable behavior:

- AC4.1: subclass overrides `runDrain` to throw. Call `await do.alarm()`. Assert
  `setAlarm` was called (rescheduled at ~`now + DRAIN_INTERVAL_MS`) AND the
  awaited `alarm()` did not reject. Also assert ordering: the reschedule happens
  even though `runDrain` threw.
- AC4.2: construct with `getAlarm` → `null`; assert the constructor armed
  `setAlarm(now + DRAIN_INTERVAL_MS)` (within a tolerance window).
- AC4.3: construct with `getAlarm` → a past timestamp; assert
  `setAlarm(now + OVERDUE_ALARM_REARM_DELAY_MS)`.
- AC4.4: construct with `getAlarm` → a far-future timestamp; assert `setAlarm`
  was NOT called during arming.
- AC4.5: subclass overrides `drainDeps()` to return `{ open: fakeOpen,
  idleMs: 5, now: () => T }` where `fakeOpen` yields a `FakeSocket` (reuse the
  Phase 4 fake; emit 2 stale events then idle). With `get('cursor')` → null,
  call the subclass's `runDrain`; assert `put('cursor', <2nd event time_us>)`
  was called, and that `fakeOpen` received a url with NO `cursor` param
  (live-from-now).
- AC4.6: call `do.fetch(new Request('http://do/internal/dev/drain-now',
  { method:'POST' }))` with `this.env.NODE_ENV` = `'test'`; assert status 404
  (no drain attempted).

Construction tolerance: arming/scheduling assert times within a small window
(e.g. ±2s) of `Date.now()` to avoid flakiness; do NOT assert exact timestamps.

Register in `test/run-all-tests.mjs` (node-platform section), WITH the alias:

```js
    [
        'esbuild ./test/indexer-alarm.ts --bundle',
        '--platform=node --format=esm',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '| node --input-type=module | tap-spec'
    ].join(' '),
```

If `indexer.ts` (transitively via `drain.ts`) trips the bundler on any other
`cloudflare:*`/runtime import, add the matching `--alias`/`--external` the same
way the neighboring DO tests do; `drain.ts` itself imports only the
`JetstreamEvent` type, so the `cloudflare:workers` stub should suffice.

**Verify:** `npm test` (new suite green; whole run green; no console.error from
test doubles — note `alarm()` logs via `console.error` only on a real drain
failure, which AC4.1 triggers; have that test stub/assert the logged error so it
does not fail the run, following the project's tapout console-error rule) +
`npm run typecheck` + `npm run lint`.

**Commit:** `test: cover indexer alarm scheduling and runDrain (scheduled-drain.AC4)`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

---

## Freshness and retention contract (known limitation)

State this plainly in the DO file's header comment (and honor it operationally):

- The index trails the live network by up to one alarm interval
  (`DRAIN_INTERVAL_MS`, ~60s) plus firehose propagation. The feed does not need
  sub-second freshness; if it ever does, this is the wrong design.
- First run with no saved cursor starts **live-from-now** (approved cold-start),
  so records committed before the singleton's first construction are not
  indexed.
- Jetstream retains only a bounded replay window (the server's `event-ttl`,
  **~24h by default**, operator-configurable). If the indexer is down longer
  than that window, cursor replay cannot fill the gap and those records are
  permanently missed.
- Full history (older than the replay window) is NOT a Jetstream job and is out
  of scope here — backfill via `com.atproto.repo.listRecords` per DID or a
  Hubble mirror is a separate, one-shot process (deferred per the spec).

## Phase 5 done when

- `RsssIndexerDO` arms its alarm on cold start, reschedules before the fallible
  drain, self-heals an overdue alarm, and `runDrain` persists the advanced
  cursor (live-from-now on first run).
- The dev-only `drain-now` trigger exists on both the worker and DO layers, both
  404 outside development.
- `test/indexer-alarm.ts` covers AC4.1–AC4.6 and is registered.
- `npm test`, `npm run typecheck`, `npm run lint` all pass.

## Note for AC4.1 and the tapout console-error rule

`alarm()` calls `console.error('indexer drain failed', err)` on a drain failure.
The project's test harness fails a run on any `console.error`. The AC4.1 test
deliberately makes `runDrain` throw, so it MUST intercept `console.error` (spy
and restore) and assert it was called with the expected message, rather than
letting it reach the real console. The task-implementor handles this in the test.
