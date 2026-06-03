# WebSocket Hibernation Live Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-user Durable Object's Server-Sent Events live channel with a hibernatable WebSocket so an open browser tab stops billing continuous DO wall-clock duration.

**Architecture:** The DO currently serves `GET /events` as an SSE `ReadableStream` held in an in-memory `Set<controller>`, plus a 20s `setInterval` keepalive. Both pin the DO active in memory, defeating hibernation and burning the free-tier daily duration budget (13,000 GB-s/day) — the budget exhaustion is what surfaces as the alarm-time error `Exceeded allowed duration in Durable Objects free tier`. We replace this with a hibernatable WebSocket (`ctx.acceptWebSocket` + `webSocket*` handlers), broadcast via `ctx.getWebSockets()` (survives eviction) instead of an in-memory Set, and a runtime-handled keepalive via `ctx.setWebSocketAutoResponse` (answers client pings without waking the DO). The Worker proxy gains a WebSocket-upgrade branch, and the client swaps `EventSource` for a `WebSocket` with its own reconnect/ping logic (raw WebSocket, unlike EventSource, does not auto-reconnect). SSE is removed entirely (no fallback — chosen cutover strategy).

**Tech Stack:** TypeScript (Cloudflare Workers + ES2022 lib), Hono (server router), `@cloudflare/durable-objects` Hibernation API, Preact + `@preact/signals` (client), `@substrate-system/tapzero` + esbuild/Node test harness.

---

## Context: why the test strategy is mixed (read before starting)

The repo's server tests run in **Node** (esbuild bundle → `node`/`tapout`), not the Cloudflare Workers runtime. Consequences that shape every task below:

- `WebSocketPair`, `ctx.acceptWebSocket`, `ctx.getWebSockets`, `WebSocketRequestResponsePair`, and `setWebSocketAutoResponse` **do not exist** in the test environment.
- `new Response(null, { status: 101, ... })` **throws** in undici (status must be 200–599), so the upgrade response cannot be constructed in a Node test.
- Forbidden headers like `Upgrade`/`Connection` are dropped by undici's `Headers`, so a Node test cannot faithfully send an upgrade request.

Therefore: we unit-test what is genuinely runnable in Node — `broadcast()` framing (mocking `ctx.getWebSockets`) and extracted **pure helpers** (`isWebSocketUpgrade`, `parseLiveMessage`, `liveChannelSocketUrl`). The actual upgrade handshake, hibernation eligibility, auto-response ping/pong, and client reconnect are verified **manually with `wrangler dev`** (Task 7). We do **not** fake the WebSocket stack with stubs — that would be brittle and is disallowed by project rules.

The DO test harness pattern (see `test/do-handlers.ts`) builds an instance via `Object.create(UserDO.prototype)`, hand-mocks `userDo.ctx` and `userDo.sql`, and exercises Hono routes via `app.request(path)`. New unit tests follow this exact pattern.

---

## File Structure

**Server — Durable Object (`src/server/durable-objects/index.ts`)**
- Remove: `private subscribers` Set, `private encoder`, `private keepaliveInterval`, `ensureKeepalive()`, `maybeStopKeepalive()`, the `GET /events` route.
- Add: `GET /ws` upgrade route, `webSocketMessage()`, `webSocketClose()`, `webSocketError()` instance methods, `ctx.setWebSocketAutoResponse(...)` in the constructor, `LIVE_PING` / `LIVE_PONG` constants.
- Rewrite: `broadcast(event, data)` to enumerate `ctx.getWebSockets()` and send a JSON envelope.

**Server — Worker proxy (`src/server/index.ts`)**
- Add: exported pure helper `isWebSocketUpgrade(req)`.
- Modify: `dataRouter.all('*')` to branch on WebSocket upgrades (forward with upgrade headers preserved; return the DO's 101 response directly).

**Client — pure helpers (`src/client/live-channel.ts`, new)**
- Add: `liveChannelSocketUrl(loc)` and `parseLiveMessage(raw)` in a dependency-free module so they are unit-testable in plain Node (importing `state.ts` directly pulls in `route-event`, `ky`, and the OPFS/db modules, which reference DOM globals at load and are heavy/unsafe in a Node test).

**Client — channel wiring (`src/client/state.ts`)**
- Import: `liveChannelSocketUrl`, `parseLiveMessage` from `./live-channel.js`.
- Rewrite: `State.openEventStream` (now a WebSocket) and `State.closeEventStream` (tear down socket + ping + reconnect timers); module-scope `eventSource` becomes a `WebSocket | null` plus ping/reconnect timer handles.

**Tests**
- `test/do-handlers.ts` — add `broadcast()` unit test (existing Node harness).
- `test/api-router.ts` — add `isWebSocketUpgrade` unit test (existing file already imports `index.js`; runs via `npm run test:api-router`).
- `test/live-channel-client.ts` (new) — Node-platform unit tests for the two pure client helpers; imports only `src/client/live-channel.js`. Wire one command into the `commands` array in `test/run-all-tests.mjs`.

---

## Task 1: DO — hibernatable WebSocket accept route + lifecycle handlers + auto-response

Adds the WebSocket endpoint and hibernation plumbing **alongside** the existing SSE code (SSE is removed in Task 3). After this task `/ws` accepts sockets but `broadcast()` still targets SSE subscribers; Task 2 switches broadcast over. This intermediate state is intentional and harmless.

**Files:**
- Modify: `src/server/durable-objects/index.ts` (constructor ~`365-388`; add route inside `createRouter()` near the existing `app.get('/events'...)` ~`706`; add handler methods on the class)

- [ ] **Step 1: Add live-channel constants near the other module constants**

Find the constants block (e.g. near `const FEED_REFRESH_INTERVAL_MS = 10 * 60 * 1000`) and add:

```ts
// Application-level WebSocket keepalive. The client sends LIVE_PING on a
// timer; the runtime answers LIVE_PONG via setWebSocketAutoResponse
// WITHOUT waking the hibernated DO, refreshing the idle timer so
// Cloudflare does not reap the connection.
const LIVE_PING = JSON.stringify({ type: 'ping' })
const LIVE_PONG = JSON.stringify({ type: 'pong' })
```

- [ ] **Step 2: Configure auto-response in the constructor**

In the `constructor`, after `this.app = this.createRouter()` and before `ctx.blockConcurrencyWhile(...)`, add:

```ts
        // Keepalive handled entirely by the runtime: matching pings are
        // answered without dispatching to webSocketMessage, so the DO
        // can stay hibernated while clients are connected.
        ctx.setWebSocketAutoResponse(
            new WebSocketRequestResponsePair(LIVE_PING, LIVE_PONG)
        )
```

- [ ] **Step 3: Add the `/ws` upgrade route inside `createRouter()`**

Immediately above the existing `app.get('/events', ...)` route, add:

```ts
        // Hibernatable WebSocket live channel. Replaces SSE: the DO can
        // hibernate between broadcasts because getWebSockets() (not an
        // in-memory Set) tracks live connections. Auth is enforced by
        // the Worker proxy (requireAuth) before the upgrade reaches here.
        app.get('/ws', (c) => {
            if (c.req.header('Upgrade') !== 'websocket') {
                return c.text('Expected WebSocket upgrade', 426)
            }
            const pair = new WebSocketPair()
            const client = pair[0]
            const server = pair[1]
            this.ctx.acceptWebSocket(server)
            return new Response(null, { status: 101, webSocket: client })
        })
```

- [ ] **Step 4: Add the hibernation lifecycle handlers as methods on the `UserDO` class**

Add these three methods to the class (e.g. directly after the `broadcast()` method). The client is push-only, so `webSocketMessage` is a no-op today (pings never reach it — the runtime auto-answers them); keep it for forward compatibility.

```ts
    // The live channel is server-push only; client pings are handled by
    // setWebSocketAutoResponse and never arrive here. Defined so future
    // client->server messages have a home and to satisfy the hibernation
    // contract.
    webSocketMessage (_ws:WebSocket, _message:string|ArrayBuffer):void {
        // no-op
    }

    webSocketClose (
        ws:WebSocket,
        _code:number,
        _reason:string,
        _wasClean:boolean
    ):void {
        // Close the server side without forwarding the peer's code:
        // reserved codes (e.g. 1005/1006) throw if passed to close().
        // No bookkeeping needed because broadcast() reads
        // ctx.getWebSockets() fresh each time.
        try {
            ws.close()
        } catch {
            // already closing/closed
        }
    }

    webSocketError (_ws:WebSocket, error:unknown):void {
        console.error('[DO] webSocketError', error)
    }
```

- [ ] **Step 5: Typecheck / lint the file compiles**

Run: `npm run lint`
Expected: PASS (no unused-var or type errors introduced). `WebSocketPair`, `WebSocket`, and `WebSocketRequestResponsePair` are ambient Workers globals via `@cloudflare/workers-types` / `worker-configuration.d.ts`; no import needed.

- [ ] **Step 6: Commit**

```bash
git add src/server/durable-objects/index.ts
git commit -m "feat(do): add hibernatable WebSocket /ws route and lifecycle handlers"
```

---

## Task 2: DO — rewrite `broadcast()` to use `getWebSockets()` + JSON envelope (TDD)

This is the correctness core: enumerate live sockets from the runtime (survives hibernation/eviction) instead of an in-memory Set, and frame each message as `{ event, data }` JSON.

**Files:**
- Modify: `src/server/durable-objects/index.ts` (`broadcast()` ~`1518-1534`)
- Test: `test/do-handlers.ts` (add a test using the existing harness)

- [ ] **Step 1: Write the failing test**

Add to `test/do-handlers.ts` (the harness builds `userDo` via `Object.create(UserDO.prototype)`; we attach a mock `ctx.getWebSockets` and call the private `broadcast` through a cast):

```ts
test('UserDO broadcast sends JSON envelope to every live socket', async t => {
    const sent:Array<{ socket:number; payload:string }> = []
    const makeSocket = (n:number) => ({
        send: (payload:string) => sent.push({ socket: n, payload })
    })
    const sockets = [makeSocket(1), makeSocket(2)]

    const userDo = Object.create(UserDO.prototype) as {
        ctx:{ getWebSockets:() => unknown[] }
        broadcast:(event:string, data:unknown) => void
    }
    userDo.ctx = { getWebSockets: () => sockets }

    userDo.broadcast('feed-updated', { feedId: 7 })

    t.equal(sent.length, 2, 'every live socket receives the message')
    t.deepEqual(
        sent.map(s => s.socket),
        [1, 2],
        'broadcast enumerates ctx.getWebSockets(), not an in-memory set'
    )
    t.equal(
        sent[0]!.payload,
        JSON.stringify({ event: 'feed-updated', data: { feedId: 7 } }),
        'payload is a JSON envelope of { event, data }'
    )
})

test('UserDO broadcast drops a failing socket and keeps going', async t => {
    const delivered:number[] = []
    const sockets = [
        { send: () => { throw new Error('socket gone') } },
        { send: () => delivered.push(2) }
    ]
    const userDo = Object.create(UserDO.prototype) as {
        ctx:{ getWebSockets:() => unknown[] }
        broadcast:(event:string, data:unknown) => void
    }
    userDo.ctx = { getWebSockets: () => sockets }

    userDo.broadcast('feed-updated', { feedId: 1 })

    t.deepEqual(delivered, [2], 'a throwing socket does not abort the loop')
})
```

- [ ] **Step 2: Run the test to verify it fails**

`do-handlers.ts` is normally run inside the combined browser bundle (`test/index.ts` → `tapout`). To exercise it alone with the same proven flags:

Run: `npx esbuild ./test/do-handlers.ts --bundle --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts --alias:@sentry/cloudflare=./test/sentry-cloudflare-stub.ts --loader:.css=text --loader:.wasm=dataurl | tapout`
Expected: FAIL — current `broadcast()` reads `this.subscribers` (undefined here) and frames SSE text, not `{event,data}` JSON via `getWebSockets()`.

- [ ] **Step 3: Rewrite `broadcast()`**

Replace the entire current `broadcast` method body:

```ts
    /**
     * Send a live-channel event to every connected WebSocket for this
     * user. Enumerates ctx.getWebSockets() so it works across DO
     * hibernation/eviction (no in-memory subscriber list to lose).
     */
    private broadcast (event:string, data:unknown):void {
        const sockets = this.ctx.getWebSockets()
        if (sockets.length === 0) return

        const payload = JSON.stringify({ event, data })
        for (const ws of sockets) {
            try {
                ws.send(payload)
            } catch {
                // Socket is closing; webSocketClose will not be needed
                // because the next broadcast re-reads getWebSockets().
            }
        }
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx esbuild ./test/do-handlers.ts --bundle --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts --alias:@sentry/cloudflare=./test/sentry-cloudflare-stub.ts --loader:.css=text --loader:.wasm=dataurl | tapout`
Expected: PASS — both new broadcast tests green, existing do-handlers tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/server/durable-objects/index.ts test/do-handlers.ts
git commit -m "feat(do): broadcast over getWebSockets with JSON envelope"
```

---

## Task 3: DO — remove the SSE channel and its in-memory state

`broadcast()` no longer touches `subscribers` (Task 2), so the SSE route, the subscriber Set, the encoder, and the keepalive interval are now dead. Remove them.

**Files:**
- Modify: `src/server/durable-objects/index.ts` (class fields ~`360-369`; `app.get('/events')` ~`706-734`; `ensureKeepalive`/`maybeStopKeepalive` ~`1536-1561`)

- [ ] **Step 1: Delete the SSE class fields**

Remove these three field declarations from the class:

```ts
    private subscribers = new Set<
        ReadableStreamDefaultController<Uint8Array>
    >()

    private encoder = new TextEncoder()
    private keepaliveInterval:ReturnType<typeof setInterval>|null = null
```

- [ ] **Step 2: Delete the `GET /events` route**

Remove the entire `app.get('/events', () => { ... })` block (the `ReadableStream` with `start`/`cancel` and the `text/event-stream` `Response`).

- [ ] **Step 3: Delete the keepalive helpers**

Remove the `ensureKeepalive()` and `maybeStopKeepalive()` methods in their entirety.

- [ ] **Step 4: Verify no dangling references remain**

Run: `rg -n "subscribers|ensureKeepalive|maybeStopKeepalive|keepaliveInterval|this\.encoder|/events|event-stream" src/server/durable-objects/index.ts`
Expected: no matches. If any remain, they are leftovers — remove them.

- [ ] **Step 5: Lint and run the server DO tests**

Run: `npm run lint && npx esbuild ./test/do-handlers.ts --bundle --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts --alias:@sentry/cloudflare=./test/sentry-cloudflare-stub.ts --loader:.css=text --loader:.wasm=dataurl | tapout`
Expected: PASS — no unused symbols, all DO handler tests green.

- [ ] **Step 6: Commit**

```bash
git add src/server/durable-objects/index.ts
git commit -m "refactor(do): remove SSE channel now that broadcast uses WebSockets"
```

---

## Task 4: Worker proxy — WebSocket upgrade branch (TDD on the pure predicate)

The `/api/*` proxy currently runs `buildDoProxyHeaders`, which **strips** `Upgrade`/`Connection`, and returns the body response — both fatal to a WS handshake. Add a branch: detect the upgrade, forward the request with upgrade headers intact (rewriting `/api/ws` → `/ws`), and return the DO's 101 response directly so `.webSocket` passes through. Extract the detection as a pure, testable helper.

**Files:**
- Modify: `src/server/index.ts` (`dataRouter.all('*')` ~`1883-1919`; add `isWebSocketUpgrade` export near `buildDoProxyHeaders` ~`1861`)
- Test: `test/api-router.ts` (existing file; already imports `index.js` and runs via `npm run test:api-router`)

- [ ] **Step 1: Write the failing test for `isWebSocketUpgrade`**

Add `isWebSocketUpgrade` to the existing import from `../src/server/index.js` at the top of `test/api-router.ts`, then append this test to the file:

```ts
test('isWebSocketUpgrade detects the Upgrade header case-insensitively', t => {
    t.equal(
        isWebSocketUpgrade(new Headers({ Upgrade: 'websocket' })),
        true,
        'lowercase value matches'
    )
    t.equal(
        isWebSocketUpgrade(new Headers({ Upgrade: 'WebSocket' })),
        true,
        'mixed-case value matches'
    )
    t.equal(
        isWebSocketUpgrade(new Headers({})),
        false,
        'no Upgrade header is not an upgrade'
    )
    t.equal(
        isWebSocketUpgrade(new Headers({ Upgrade: 'h2c' })),
        false,
        'a non-websocket upgrade is not a websocket upgrade'
    )
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:api-router`
Expected: FAIL — `isWebSocketUpgrade` is not exported from `index.js` (import error / undefined).

- [ ] **Step 3: Add the `isWebSocketUpgrade` helper**

Near `buildDoProxyHeaders` in `src/server/index.ts`, add and export:

```ts
export function isWebSocketUpgrade (headers:Headers):boolean {
    return headers.get('Upgrade')?.toLowerCase() === 'websocket'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:api-router`
Expected: PASS.

- [ ] **Step 5: Add the upgrade branch to the proxy**

At the **top** of the `dataRouter.all('*')` handler body — after `const session = c.get('session')!` and `const stub = getUserDO(c.env, session.did)`, before the existing header/URL building — insert:

```ts
    // WebSocket upgrades cannot go through buildDoProxyHeaders (it
    // strips Upgrade/Connection) and must return the DO's 101 response
    // verbatim so the attached `webSocket` survives. Forward the raw
    // request (preserving Sec-WebSocket-* and Cookie) with the /api
    // mount prefix stripped from the path.
    if (isWebSocketUpgrade(c.req.raw.headers)) {
        const wsUrl = new URL(c.req.url)
        wsUrl.pathname = wsUrl.pathname.replace(/^\/api/, '') || '/'
        return stub.fetch(new Request(wsUrl.toString(), c.req.raw))
    }
```

- [ ] **Step 6: Run the full api-router suite (regression: non-upgrade proxying unchanged)**

Run: `npm run test:api-router`
Expected: PASS — existing proxy tests (header stripping, auth-before-proxy, gated routes) are unaffected because the new branch only triggers on `Upgrade: websocket`.

- [ ] **Step 7: Commit**

```bash
git add src/server/index.ts test/api-router.ts
git commit -m "feat(proxy): forward WebSocket upgrades to the user DO"
```

---

## Task 5: Client — pure live-channel helpers in a dedicated module (TDD)

Create the two genuinely-pure pieces of the client channel in their own dependency-free module so they can be unit-tested in plain Node without a real `WebSocket`, DOM, or the heavy `state.ts` import graph. The message-dispatch switch stays inline in Task 6 (it closes over component state and refresh helpers).

**Files:**
- Create: `src/client/live-channel.ts`
- Test: `test/live-channel-client.ts` (new)
- Modify: `test/run-all-tests.mjs` (add one command to the `commands` array)

- [ ] **Step 1: Write the failing tests for the client helpers**

Create `test/live-channel-client.ts`:

```ts
import { test } from '@substrate-system/tapzero'
import {
    liveChannelSocketUrl,
    parseLiveMessage
} from '../src/client/live-channel.js'

test('liveChannelSocketUrl maps http->ws and https->wss', t => {
    t.equal(
        liveChannelSocketUrl({ protocol: 'https:', host: 'rsss.space' }),
        'wss://rsss.space/api/ws',
        'https yields a wss URL'
    )
    t.equal(
        liveChannelSocketUrl({ protocol: 'http:', host: 'localhost:8888' }),
        'ws://localhost:8888/api/ws',
        'http yields a ws URL'
    )
})

test('parseLiveMessage returns the envelope for a valid message', t => {
    const parsed = parseLiveMessage(
        JSON.stringify({ event: 'feed-updated', data: { feedId: 3 } })
    )
    t.deepEqual(
        parsed,
        { event: 'feed-updated', data: { feedId: 3 } },
        'a well-formed envelope is returned as-is'
    )
})

test('parseLiveMessage ignores pongs and malformed input', t => {
    t.equal(
        parseLiveMessage(JSON.stringify({ type: 'pong' })),
        null,
        'keepalive pongs are ignored'
    )
    t.equal(parseLiveMessage('not json'), null, 'invalid JSON is ignored')
    t.equal(
        parseLiveMessage(JSON.stringify({ data: {} })),
        null,
        'a message with no event is ignored'
    )
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx esbuild ./test/live-channel-client.ts --bundle --platform=node --format=esm | node --input-type=module | tap-spec`
Expected: FAIL — `src/client/live-channel.js` does not exist / nothing is exported.

- [ ] **Step 3: Create `src/client/live-channel.ts`**

This module has **no imports** (pure functions only), which is what keeps the test Node-runnable.

```ts
/**
 * Build the WebSocket URL for the live channel from a location-like
 * object. https -> wss, everything else -> ws.
 */
export function liveChannelSocketUrl (
    loc:{ protocol:string; host:string }
):string {
    const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${scheme}//${loc.host}/api/ws`
}

/**
 * Parse a raw live-channel frame into a { event, data } envelope.
 * Returns null for keepalive pongs, malformed JSON, or any frame
 * without a string `event` field.
 */
export function parseLiveMessage (
    raw:string
):{ event:string; data:unknown }|null {
    let parsed:unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return null
    }
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as Record<string, unknown>
    if (typeof obj.event !== 'string') return null
    return { event: obj.event, data: obj.data }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx esbuild ./test/live-channel-client.ts --bundle --platform=node --format=esm | node --input-type=module | tap-spec`
Expected: PASS.

- [ ] **Step 5: Register the new test in the runner**

In `test/run-all-tests.mjs`, add this string to the `commands` array, alongside the other `esbuild ... | node ... | tap-spec` node-platform entries:

```js
    [
        'esbuild ./test/live-channel-client.ts --bundle',
        '--platform=node --format=esm',
        '| node --input-type=module | tap-spec'
    ].join(' '),
```

Run: `node test/run-all-tests.mjs` (or just confirm the new command runs green in isolation as in Step 4).
Expected: the new live-channel-client test is executed and passes as part of the suite.

- [ ] **Step 6: Commit**

```bash
git add src/client/live-channel.ts test/live-channel-client.ts test/run-all-tests.mjs
git commit -m "feat(client): add pure live-channel URL and message helpers"
```

---

## Task 6: Client — swap EventSource for a reconnecting WebSocket

Replace the `EventSource` implementation with a `WebSocket`. Preserve every existing behavior: the four event handlers (now reading the already-parsed `data` object instead of re-parsing `ev.data`), the debounced refresh, and the reopen-reconcile logic (`hasOpenedBefore` / `needsReconcile`). Add what EventSource gave us for free: reconnect-with-backoff and a keepalive ping.

**Files:**
- Modify: `src/client/state.ts` (imports near top ~`1-40`; module-scope socket/timer state ~`521-528`; `State.openEventStream` ~`1327-1502`; `State.closeEventStream` ~`1504-1512`)

- [ ] **Step 1a: Import the pure helpers**

Add to the imports at the top of `src/client/state.ts`:

```ts
import {
    liveChannelSocketUrl,
    parseLiveMessage
} from './live-channel.js'
```

- [ ] **Step 1b: Replace the module-scope channel state**

Find `let eventSource:EventSource|null = null` (~`521`) and the related `pendingSseRefresh` declaration (~`528`). Replace the `eventSource` line and add timer handles (keep `pendingSseRefresh` as-is):

```ts
let liveSocket:WebSocket|null = null
let livePingInterval:ReturnType<typeof setInterval>|null = null
let liveReconnectTimer:ReturnType<typeof setTimeout>|null = null
let liveReconnectAttempts = 0
// Closed intentionally by closeEventStream(); suppresses reconnect.
let liveChannelClosed = false
```

Also add a keepalive interval constant near `SSE_REFRESH_DEBOUNCE_MS` (~`120`):

```ts
// Client keepalive cadence. Must be well under Cloudflare's idle
// WebSocket timeout; the runtime answers these without waking the DO.
const LIVE_PING_INTERVAL_MS = 30_000
const LIVE_PING_FRAME = JSON.stringify({ type: 'ping' })
const LIVE_RECONNECT_BASE_MS = 1_000
const LIVE_RECONNECT_MAX_MS = 30_000
```

- [ ] **Step 2: Rewrite `State.openEventStream`**

Replace the entire `State.openEventStream = function (state:AppState):void { ... }` body. The `scheduleRefresh` closure and the four handler bodies are preserved; only the transport and message routing change. Note the handlers now use the already-parsed `data` (no `JSON.parse(ev.data)`).

```ts
State.openEventStream = function (state:AppState):void {
    if (liveSocket) return
    liveChannelClosed = false

    // Reconnect-reconcile bookkeeping (was EventSource open/error):
    // on every reopen *after the first*, refetch authoritative status
    // so events missed during the outage cannot leave the UI stale.
    let hasOpenedBefore = false
    let needsReconcile = false

    const scheduleRefresh = () => {
        if (pendingSseRefresh !== null) return
        pendingSseRefresh = setTimeout(() => {
            pendingSseRefresh = null
            trackRefresh(state, 'sse-feed-updated', async () => {
                await State.refreshAfterSync(state)
            }).catch((err) => {
                debug(
                    'sse-feed-updated refreshAfterSync failed',
                    err instanceof Error ? err.message : err,
                )
            })
        }, SSE_REFRESH_DEBOUNCE_MS)
    }

    const onFeedUpdated = () => {
        debug('live feed-updated')
        scheduleRefresh()
    }

    const onRefreshComplete = () => {
        debug('live refresh-complete')
        clearRefreshFeedsSafetyTimeout()
        State.reconcileAfterRefresh(state).catch((err) => {
            debug('refresh-complete reconcile error:', err)
        }).finally(() => {
            batch(() => {
                releaseRefresh(state)
                state.feedsLoading.value = false
            })
        })
    }

    const onUpdatesAvailable = (data:unknown) => {
        debug('live feed-updates-available', data)
        const parsed = data as {
            feedUpdateCounts?:Record<string, number>
            feedIds?:string[]
        }
        if (
            parsed.feedUpdateCounts &&
            typeof parsed.feedUpdateCounts === 'object'
        ) {
            const known = new Set(
                state.feeds.value.map(f => String(f.id))
            )
            const filteredEntries = Object.entries(
                parsed.feedUpdateCounts
            ).filter(([feedId]) => known.has(feedId))
            if (filteredEntries.length === 0) return
            batch(() => {
                const next = { ...state.feedUpdateCounts.value }
                for (const [feedId, count] of filteredEntries) {
                    if (count === 0) {
                        delete next[feedId]
                    } else {
                        next[feedId] = count
                    }
                }
                state.feedUpdateCounts.value = next
                const total = Object.values(next).reduce(
                    (sum, n) => sum + n,
                    0
                )
                state.feedSyncStatus.value = total > 0 ?
                    'updates' :
                    'synced'
            })
            drainAddFeedAcquires(
                filteredEntries.map(([feedId]) => Number(feedId)),
            )
            return
        }
        if (Array.isArray(parsed.feedIds)) {
            State.loadFeedStatus(state).catch((err) => {
                debug('legacy feedIds reconcile error:', err)
            })
        }
    }

    const onUpdatesCleared = (data:unknown) => {
        debug('live feed-updates-cleared', data)
        const { feedIds } = data as { feedIds:string[] }
        if (!Array.isArray(feedIds)) return
        batch(() => {
            const counts = clearFeedUpdateCounts(
                state.feedUpdateCounts.value,
                feedIds
            )
            state.feedUpdateCounts.value = counts
            if (Object.keys(counts).length === 0) {
                state.feedSyncStatus.value = 'synced'
            }
        })
    }

    const connect = () => {
        if (liveChannelClosed) return
        const socket = new WebSocket(liveChannelSocketUrl(window.location))
        liveSocket = socket

        socket.addEventListener('open', () => {
            debug('live open')
            liveReconnectAttempts = 0
            if (livePingInterval === null) {
                livePingInterval = setInterval(() => {
                    if (liveSocket?.readyState === WebSocket.OPEN) {
                        liveSocket.send(LIVE_PING_FRAME)
                    }
                }, LIVE_PING_INTERVAL_MS)
            }
            if (hasOpenedBefore) {
                if (state.refreshInProgress.value) {
                    clearRefreshFeedsSafetyTimeout()
                    needsReconcile = false
                    State.reconcileAfterRefresh(state).catch((err) => {
                        debug('reconnect reconcileAfterRefresh error:', err)
                    }).finally(() => {
                        batch(() => {
                            releaseRefresh(state)
                            state.feedsLoading.value = false
                        })
                    })
                } else if (needsReconcile) {
                    needsReconcile = false
                    State.loadFeedStatus(state).catch((err) => {
                        debug('reconnect loadFeedStatus error:', err)
                    })
                }
            }
            hasOpenedBefore = true
        })

        socket.addEventListener('message', (ev) => {
            const msg = parseLiveMessage(
                typeof ev.data === 'string' ? ev.data : ''
            )
            if (!msg) return
            switch (msg.event) {
                case 'feed-updated':
                    onFeedUpdated()
                    break
                case 'refresh-complete':
                    onRefreshComplete()
                    break
                case 'feed-updates-available':
                    onUpdatesAvailable(msg.data)
                    break
                case 'feed-updates-cleared':
                    onUpdatesCleared(msg.data)
                    break
                default:
                    debug('live unknown event', msg.event)
            }
        })

        socket.addEventListener('close', () => {
            debug('live close')
            needsReconcile = true
            if (liveSocket === socket) liveSocket = null
            if (livePingInterval !== null) {
                clearInterval(livePingInterval)
                livePingInterval = null
            }
            if (liveChannelClosed) return
            const delay = Math.min(
                LIVE_RECONNECT_BASE_MS * 2 ** liveReconnectAttempts,
                LIVE_RECONNECT_MAX_MS
            )
            liveReconnectAttempts++
            liveReconnectTimer = setTimeout(connect, delay)
        })

        socket.addEventListener('error', (ev) => {
            debug('live error', ev)
            needsReconcile = true
            // Let the close handler drive reconnect; closing here makes
            // the close event fire deterministically.
            try {
                socket.close()
            } catch {
                // already closed
            }
        })
    }

    connect()
}
```

- [ ] **Step 3: Rewrite `State.closeEventStream`**

```ts
State.closeEventStream = function ():void {
    liveChannelClosed = true
    if (pendingSseRefresh !== null) {
        clearTimeout(pendingSseRefresh)
        pendingSseRefresh = null
    }
    if (liveReconnectTimer !== null) {
        clearTimeout(liveReconnectTimer)
        liveReconnectTimer = null
    }
    if (livePingInterval !== null) {
        clearInterval(livePingInterval)
        livePingInterval = null
    }
    liveReconnectAttempts = 0
    if (!liveSocket) return
    liveSocket.close()
    liveSocket = null
}
```

- [ ] **Step 4: Confirm no `EventSource` / `eventSource` references remain**

Run: `rg -n "EventSource|eventSource" src/client`
Expected: no matches. The `State.openEventStream` / `State.closeEventStream` names are intentionally retained to avoid churning the ~6 call sites; only the implementation changed.

- [ ] **Step 5: Lint and run the pure-helper test**

Run: `npm run lint && npx esbuild ./test/live-channel-client.ts --bundle --platform=node --format=esm | node --input-type=module | tap-spec`
Expected: PASS. (The pure helpers are covered; the socket wiring is verified manually in Task 7.)

- [ ] **Step 6: Commit**

```bash
git add src/client/state.ts
git commit -m "feat(client): replace SSE EventSource with reconnecting WebSocket"
```

---

## Task 7: Full suite + manual runtime verification

The hibernation/upgrade behavior only exists in the real Workers runtime, so this task gates completion on a `wrangler dev` smoke test plus the metrics check that the whole change is for.

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated suite and lint**

Run: `npm test && npm run lint`
Expected: PASS — every suite green, including the new `broadcast` and live-channel-helper tests; no lint errors.

- [ ] **Step 2: Start a local dev server**

Run: `npx wrangler dev` (or the project's dev command if different — check `package.json`/`wrangler.jsonc`).
Expected: Worker boots; note the local URL (typically `http://localhost:8787` or `:8888`).

- [ ] **Step 3: Verify the WebSocket connects and pushes**

In a signed-in browser tab (DevTools → Network → WS), confirm:
- A `/api/ws` request shows status `101 Switching Protocols`.
- After adding/refreshing a feed, frames arrive with payloads like `{"event":"feed-updated",...}` and `{"event":"feed-updates-available",...}`.
- Outbound `{"type":"ping"}` frames appear ~every 30s, each answered by `{"type":"pong"}`.

Expected: all three observed; the feed list/pill update live exactly as before.

- [ ] **Step 4: Verify reconnect**

Kill `wrangler dev`, confirm the tab's WS closes, restart `wrangler dev`. Within ~30s the client reconnects (a new 101) and the indicator reconciles without a manual page reload.

Expected: automatic reconnect with backoff; no stuck "refreshing" state.

- [ ] **Step 5: Verify hibernation eligibility (the actual goal)**

With a tab connected but idle (no feed activity), confirm the DO is **not** continuously billing duration:
- Preferred: deploy to a staging/preview environment and watch the Durable Objects **Duration (GB-s)** metric in the Cloudflare dashboard over ~10–15 minutes of an idle-but-connected tab. It should stay flat (modulo the 10-min alarm tick), not climb continuously the way SSE did.
- Local proxy for confidence: confirm there is no per-connection `setInterval` in the DO keeping it awake (`rg -n "setInterval" src/server/durable-objects/index.ts` should show none related to the live channel) and that `broadcast` reads `getWebSockets()`.

Expected: idle connected tabs no longer drive continuous DO duration; the free-tier `Exceeded allowed duration` alarm errors stop recurring.

- [ ] **Step 6: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore: verify websocket hibernation live channel end-to-end"
```

---

## Self-Review notes (verification of this plan against the design)

- **SSE removed, no fallback** — Tasks 1–3 add WS and delete SSE; matches the chosen hard-replace cutover.
- **`getWebSockets()` not in-memory Set** — Task 2 (the named correctness core); Task 3 removes the Set.
- **Runtime keepalive without waking the DO** — Task 1 Step 2 (`setWebSocketAutoResponse`) + Task 6 client ping; verified in Task 7 Step 3.
- **Proxy upgrade branch + preserved headers** — Task 4; non-upgrade proxying regression-checked in Task 4 Step 6.
- **Auth unchanged** — `requireAuth` still runs ahead of `dataRouter.all('*')`; `/ws` is not under `requireEntitlement`, so free users keep live updates (parity with the old `/events`).
- **All four events + reconnect-reconcile preserved** — Task 6 keeps the handler bodies and the `hasOpenedBefore`/`needsReconcile` logic; reconnect/backoff added because raw WebSocket (unlike EventSource) does not auto-reconnect.
- **Test honesty** — pure helpers and `broadcast` are unit-tested in Node; upgrade/hibernation are manually verified because the Workers runtime is absent from the Node harness. No brittle WS-stack stubs, no HTML-text assertions (per project rules).
- **Type consistency** — envelope `{ event, data }` is produced by `broadcast` (Task 2), validated by `parseLiveMessage` (Task 5), and consumed by the `switch` (Task 6); ping/pong strings `{"type":"ping"}`/`{"type":"pong"}` match between DO constants (Task 1) and client frame (Task 6).
