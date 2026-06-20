# Scheduled-drain ingestion — Phase 4: Bounded drain (drainOnce) and stop conditions

**Goal:** Open a Jetstream socket, apply each event in order, advance the cursor
only after each event is persisted, and stop on the first of idle / live-edge /
budget — all behind a seam that makes the loop unit-testable without a network.

**Architecture:** `drainOnce(deps, apply, cursor)` takes an injected
`open(url)→DrainSocket`, an injectable `now()`, and tunable thresholds. The
production opener `openJetstreamSocket` (`fetch` → `resp.webSocket` →
`.accept()`) is thin I/O, separated from the loop and exercised only on the real
runtime. Tests drive a `FakeSocket`.

**Tech Stack:** TypeScript (Cloudflare Workers runtime; outbound WebSocket via
`fetch` + `Upgrade` header, `https://` scheme), `@substrate-system/tapzero`.

**Scope:** Phase 4 of 6 (scheduled-drain ingestion).

**Codebase verified:** 2026-06-19

**External research applied (2026-06-19):** Workers `fetch()` outbound
WebSocket uses the `https://` scheme (not `wss://`) with
`{ headers: { Upgrade: 'websocket' } }` → `resp.webSocket` → `.accept()`.
`time_us` is microseconds. 6 simultaneous outbound connections / 15-min DO
keep-alive ceiling both have wide slack vs the 20s budget. 📖 Cloudflare Workers
WebSockets docs; bluesky-social/jetstream.

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

Implements and tests `scheduled-drain.AC3` (bounded drain). Derived from
`specs/scheduled-drain.md` "The drain", "Stop conditions", and "Correctness
invariants" (advance the cursor only after the batch is persisted; events
persisted strictly in order).

Design choice (recorded): on `apply` error or socket `error`, `drainOnce`
**rejects** — the whole tick replays from the last stored cursor next time.
Replays are idempotent (Phase 3), so this is safe; the alternative (resolve with
the last successfully-persisted prefix) is a possible future efficiency
improvement, deliberately not taken here for simplicity.

### scheduled-drain.AC3: Bounded drain and stop conditions
- **scheduled-drain.AC3.1 idle:** after N events then silence, resolves once
  `idleMs` elapses with the cursor = the last event's `time_us`.
- **scheduled-drain.AC3.2 live-edge:** an event whose `time_us` is within
  `caughtUpUs` of `now()` stops the drain immediately (no idle wait).
- **scheduled-drain.AC3.3 budget:** when `now()` passes the `deadline`
  (`start + maxWallMs`), the drain stops.
- **scheduled-drain.AC3.4 in-order persist:** `apply` is called with events in
  delivery order; the resolved cursor equals the last applied `time_us`.
- **scheduled-drain.AC3.5 persist-before-advance:** if `apply` throws/rejects
  for an event, `drainOnce` rejects and does not advance the cursor.
- **scheduled-drain.AC3.6 close:** a socket `close` resolves with the current
  cursor.
- **scheduled-drain.AC3.7 url:** `jetstreamUrl(null)` yields the `https://`
  subscribe URL with `wantedCollections=space.rsss.*` and no `cursor`;
  `jetstreamUrl(123)` adds `cursor=123`.
- **scheduled-drain.AC3.8 non-commit advances cursor:** an event with
  `kind: 'identity'` (or `'account'`) advances the cursor (`last = time_us`)
  WITHOUT calling `apply` — the cursor must pass non-commit events so replay
  resumes correctly.
- **scheduled-drain.AC3.9 host failover:** `openJetstreamSocketWithFailover`
  opens the primary host; if that open throws, it retries the secondary
  (`JETSTREAM_HOSTS[1]`) with the same query string and returns that socket.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: drain.ts (url builder, seam, drainOnce, production opener)

**Verifies:** scheduled-drain.AC3.1–AC3.9

**Files:**
- Create: `src/server/indexer/drain.ts`

**Implementation:**

```ts
import type { JetstreamEvent } from './types.js'

export const MAX_WALL_MS = 20_000      // backstop, well under DO limits
export const IDLE_MS = 2_000           // quiet => replay buffer drained
export const CAUGHT_UP_US = 5_000_000  // within 5s of now => live edge

// https:// (not wss://) — Workers fetch upgrades https + Upgrade header.
export const JETSTREAM_HOSTS = [
    'https://jetstream1.us-east.bsky.network/subscribe',
    'https://jetstream2.us-west.bsky.network/subscribe'
]
const WANTED = ['space.rsss.*']

export function jetstreamUrl (
    cursor:number|null,
    base:string = JETSTREAM_HOSTS[0]
):string {
    const url = new URL(base)
    for (const c of WANTED) url.searchParams.append('wantedCollections', c)
    if (cursor !== null) url.searchParams.set('cursor', String(cursor))
    return url.toString()
}

export interface DrainSocket {
    addEventListener(t:'message', cb:(ev:{ data:string }) => void):void
    addEventListener(t:'close', cb:() => void):void
    addEventListener(t:'error', cb:(err:unknown) => void):void
    close():void
}

export interface DrainDeps {
    open:(url:string) => Promise<DrainSocket>
    now?:() => number
    maxWallMs?:number
    idleMs?:number
    caughtUpUs?:number
}

export async function drainOnce (
    deps:DrainDeps,
    apply:(evt:JetstreamEvent) => void | Promise<void>,
    cursor:number|null
):Promise<number> {
    const now = deps.now ?? Date.now
    const maxWallMs = deps.maxWallMs ?? MAX_WALL_MS
    const idleMs = deps.idleMs ?? IDLE_MS
    const caughtUpUs = deps.caughtUpUs ?? CAUGHT_UP_US

    const ws = await deps.open(jetstreamUrl(cursor))
    let last = cursor ?? 0
    const deadline = now() + maxWallMs

    return await new Promise<number>((resolve, reject) => {
        let idle:ReturnType<typeof setTimeout> | undefined
        let chain:Promise<void> = Promise.resolve()
        let stopped = false

        const finish = (fn:() => void) => {
            if (stopped) return
            stopped = true
            if (idle !== undefined) clearTimeout(idle)
            try { ws.close() } catch {}
            fn()
        }
        const stop = () => finish(() => resolve(last))
        const fail = (err:unknown) => finish(() => reject(err))
        const bumpIdle = () => {
            if (idle !== undefined) clearTimeout(idle)
            idle = setTimeout(stop, idleMs)
        }

        ws.addEventListener('message', (ev) => {
            if (stopped) return
            bumpIdle()
            let evt:JetstreamEvent
            try { evt = JSON.parse(ev.data) as JetstreamEvent }
            catch { return }  // skip malformed frame, keep draining
            // Serialize: persist in order; advance cursor only after persist.
            chain = chain.then(async () => {
                if (stopped) return
                if (evt.kind === 'commit') await apply(evt)
                last = evt.time_us
                const stale = now() * 1000 - evt.time_us
                if (now() > deadline || stale < caughtUpUs) stop()
            }).catch(fail)  // persist failure => no cursor advance this tick
        })
        ws.addEventListener('close', stop)
        ws.addEventListener('error', fail)
        bumpIdle()
    })
}

export async function openJetstreamSocket (url:string):Promise<DrainSocket> {
    // `Response.webSocket` is the real Cloudflare Workers runtime field — it is
    // only present on the response of an `Upgrade: websocket` fetch in the
    // Workers runtime (not Node). This function runs only on the live edge;
    // tests inject a fake opener and never call it.
    const resp = await fetch(url, { headers: { Upgrade: 'websocket' } })
    const ws = (resp as unknown as { webSocket:DrainSocket | null }).webSocket
    if (!ws) throw new Error('jetstream: no websocket in response')
    ;(ws as unknown as { accept():void }).accept()
    return ws
}

// Try the primary host; on an open failure, retry the secondary, preserving
// the query string. `open` is injectable so this is unit-testable (AC3.9).
export async function openJetstreamSocketWithFailover (
    url:string,
    open:(u:string) => Promise<DrainSocket> = openJetstreamSocket
):Promise<DrainSocket> {
    try {
        return await open(url)
    } catch {
        const alt = new URL(JETSTREAM_HOSTS[1])
        alt.search = new URL(url).search
        return await open(alt.toString())
    }
}
```

Notes:
- `drain.ts` imports only the `JetstreamEvent` type — no `cloudflare:workers`
  import — so its test bundles under plain node esbuild (no alias). `fetch` /
  `Response.webSocket` are referenced only inside `openJetstreamSocket`, which
  tests never call.
- `openJetstreamSocket` is intentionally untested at the unit level (thin I/O).
  It is exercised on the real runtime via Phase 5's `runDrain` and the dev
  `drain-now` trigger.
- Host failover is kept OUT of `drainOnce` (it stays host-agnostic) and lives in
  `openJetstreamSocketWithFailover` below: try `JETSTREAM_HOSTS[0]`, and on an
  open failure retry `JETSTREAM_HOSTS[1]` preserving the query string. Phase 5's
  `drainDeps()` injects this wrapper as `open` in production. The wrapper takes
  its underlying opener as an injectable parameter so it is unit-testable
  (AC3.9) without a network.

**Verify:** `npm run typecheck` && `npm run lint`.

**Commit:** `feat: add bounded Jetstream drain (drainOnce) with stop conditions`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: drainOnce tests

**Verifies:** scheduled-drain.AC3.1–AC3.9

**Files:**
- Create: `test/drain-once.ts` (unit)
- Modify: `test/run-all-tests.mjs` (register)

**Testing:**

Build a `FakeSocket` implementing `DrainSocket` that stores registered
listeners and exposes test helpers `emitMessage(data:string)`,
`emitClose()`, `emitError(err)`, plus a `closed` flag. The injected
`deps.open` resolves to the `FakeSocket`. Use a controllable `deps.now` (a
closure over a mutable number) and small `deps.idleMs` (e.g. 15) so real-timer
idle waits are fast. Author with `@substrate-system/tapzero`; one
`test('scheduled-drain.AC3.x: …')` per case. Tests verify observable behavior:

- AC3.1 idle: `now` constant `T`; emit 2 events with very stale `time_us`
  (`T*1000 - 100*caughtUpUs`) so neither live-edge nor budget fires; after the
  chain settles, the idle timer resolves `drainOnce` with the 2nd event's
  `time_us`.
- AC3.2 live-edge: `now` constant `T`; emit one event with
  `time_us = T*1000 - (caughtUpUs/2)`; `drainOnce` resolves promptly with that
  `time_us` WITHOUT waiting `idleMs` (assert it resolves well under `idleMs`).
- AC3.3 budget: `maxWallMs` small (e.g. 5) with a `now` that returns `T` for the
  deadline computation then a value `> deadline` during the chain check; emit a
  stale event; `drainOnce` resolves (budget stop).
- AC3.4 in-order: emit events e1,e2,e3 (stale, non-live-edge); `apply` pushes
  each `time_us` into an array; after idle stop, assert the array is
  `[e1,e2,e3]` in order and the resolved cursor === e3.time_us.
- AC3.5 persist-before-advance: `apply` throws on the 2nd event; assert
  `drainOnce` rejects (use try/catch around the awaited promise; assert it
  threw).
- AC3.6 close: emit one event, then `emitClose()`; assert `drainOnce` resolves
  with that event's `time_us` and `fakeSocket.closed === true`.
- AC3.8 non-commit: emit an event with `kind: 'identity'` (stale, non-live-edge)
  with `apply` spying for calls; after idle stop, assert `apply` was NOT called
  and the resolved cursor === that event's `time_us`.
- AC3.9 failover: call `openJetstreamSocketWithFailover(url, fakeOpen)` where
  `fakeOpen` throws for any URL on `JETSTREAM_HOSTS[0]`'s host and resolves a
  `FakeSocket` for `JETSTREAM_HOSTS[1]`'s host; assert it returns the secondary
  socket and that `fakeOpen`'s second call carried the original query string.
- AC3.7 url: `jetstreamUrl(null)` includes `wantedCollections=space.rsss.*`,
  starts with `https://`, and has NO `cursor`; `jetstreamUrl(123)` includes
  `cursor=123`. (Parse with `new URL(...)` and assert `searchParams`, do not
  string-match the whole URL.)

Register in `test/run-all-tests.mjs` node-platform section (NO cloudflare
alias):

```js
    [
        'esbuild ./test/drain-once.ts --bundle',
        '--platform=node --format=esm',
        '| node --input-type=module | tap-spec'
    ].join(' '),
```

**Verify:** `npm test` (new suite green; whole run green; NO console.error —
note: drainOnce never logs; a stray console.error from a test double would fail
the run) + `npm run typecheck` + `npm run lint`.

**Commit:** `test: cover drainOnce stop conditions and ordering (scheduled-drain.AC3)`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

---

## Phase 4 done when

- `src/server/indexer/drain.ts` exports `jetstreamUrl`, `DrainSocket`,
  `DrainDeps`, `drainOnce`, `openJetstreamSocket`,
  `openJetstreamSocketWithFailover`, `JETSTREAM_HOSTS`, and the threshold
  constants.
- `test/drain-once.ts` covers AC3.1–AC3.9 with a fake socket and is registered.
- `npm test`, `npm run typecheck`, `npm run lint` all pass.
