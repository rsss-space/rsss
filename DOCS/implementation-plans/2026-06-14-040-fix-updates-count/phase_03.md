# "N updates" Count Accuracy + Freshness — Phase 3

**Goal:** Add a dev-only `POST /api/dev/poll-now` endpoint that runs the real
feed-discovery path over all feeds — inserting new items and firing the
`feed-updates-available` broadcast — WITHOUT advancing `last_pulled_at`, so the
pending count can be observed growing in local dev (decoupling discovery from
consumption). The endpoint is 404 outside development.

**Architecture:** A worker route on `app` (gated by `NODE_ENV` before auth)
that forwards to a new internal DO route `/internal/dev/poll-now`. The DO route
reuses the existing `runFeedPool` + `fetchFeed` discovery code (the same path
the alarm uses) but deliberately omits the `advanceFeedCursor()` call that the
two manual-refresh endpoints make.

**Tech Stack:** TypeScript (Cloudflare Workers + DO, ES2022), Hono router,
`@substrate-system/tapzero` (node-platform test).

**Scope:** Phase 3 of 4.

**Codebase verified:** 2026-06-14

**Skills to activate (executor):** `ed3d-house-style:howto-code-in-typescript`,
`durable-objects`, `ed3d-house-style:defense-in-depth`,
`superpowers:test-driven-development`, `ed3d-house-style:writing-good-tests`.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### 040-fix-updates-count.AC3: Dev discovery endpoint exercises discovery without pulling
- **040-fix-updates-count.AC3.1 Success:** in dev, `POST /api/dev/poll-now`
  runs discovery and inserts new items (when the source has them) without
  changing `last_pulled_at`, so the pending count grows.
- **040-fix-updates-count.AC3.2 Failure:** when `NODE_ENV !== 'development'`,
  the endpoint returns 404.
- **040-fix-updates-count.AC3.3 Edge:** a feed returning 304 yields no new
  items and does not error; the response still reports
  `{ polledFeeds, newItems, counts }`.

---

## Verified codebase facts (read before starting)

`src/server/index.ts` (worker), line numbers as of 2026-06-14:

- Dev-gate precedent — `src/server/index.ts:1030`:
  ```ts
  if (c.env.NODE_ENV !== 'development') {
      return c.notFound()
  }
  ```
  `NODE_ENV` is declared `string` in the Env interface (~line 106), set to
  `"development"` in `.dev.vars`, `"staging"`/`"production"` in
  `wrangler.jsonc`.
- `requireAuth` middleware defined at `index.ts:855`; handlers read the session
  with `const session = c.get('session')!` (see
  `app.post('/api/account/delete', requireAuth, ...)` at 1350-1370, which also
  shows the `getRsssUserDO(c.env, session.did)` + `stub.fetch(...)` pattern).
- `getRsssUserDO(env, did)` at `index.ts:971-978` returns the per-user DO stub.
- **CSRF guard runs before any route.** `rejectCrossOriginStateChanges`
  (defined `index.ts:437`, applied globally via `app.use('*', ...)` at
  `index.ts:487`) rejects state-changing methods (POST is in
  `STATE_CHANGING_METHODS`, `index.ts:323-328`) on non-exempt paths: a POST
  with neither `origin` nor `sec-fetch-site` returns `403 { error:
  'Cross-origin request rejected' }` (`index.ts:402,456`), and a POST without a
  matching `csrf_token` cookie + `x-csrf-token` header returns `403 { error:
  'CSRF token mismatch' }` (`index.ts:459-468`). Only the four `/api/auth/*`
  paths are CSRF-exempt (`isCsrfExemptPath`, `index.ts:359-364`) —
  `/api/dev/poll-now` is NOT exempt. So real callers (and the AC3.2 test) MUST
  send same-origin CSRF headers; this is why the `dev-login` precedent works
  header-less (it is exempt) but `poll-now` will not. This guard runs BEFORE
  the `poll-now` NODE_ENV gate, so a header-less test request gets 403, not the
  404 we want to assert.
- `dataRouter` is created at `index.ts:2107`; `dataRouter.use('*', requireAuth)`
  at 2112 authenticates ALL dataRouter routes; `dataRouter.all('*', ...)` at
  2151 proxies every other `/api/*` request to the DO; the router is mounted
  with `app.route('/api', dataRouter)` at **2202**.
  - **Routing precedence:** register the new `app.post('/api/dev/poll-now',
    ...)` on `app` ABOVE line 2202 so it is matched before the dataRouter
    catch-all proxy. Putting the gate on `app` (not inside dataRouter) also
    lets the gate run before `requireAuth`, so production returns 404 (not 401)
    even without a session — required by AC3.2.

`src/server/durable-objects/index.ts`:
- DO router built in `createRouter()`; internal routes use the `/internal/...`
  prefix (e.g. `/internal/account/deletion`).
- Manual batch refresh `POST /feeds/refresh` (1873-1888) shows the discovery
  pool pattern — `this.runFeedPool(feeds, async feed => { await
  this.fetchFeed(feed); this.advanceFeedCursor(feed.id) })`. The dev route is
  this MINUS `advanceFeedCursor` and run synchronously (awaited) so the
  response can report results.
- `fetchFeed(feed)` (2566-2792): inserts new items, broadcasts
  `feed-updates-available` only when `newItems.length > 0`, handles 304 (no
  insert, no broadcast, no throw), and catches its own per-feed errors
  (per-feed backoff at ~2792) so one failing feed does not abort the pool.
- `advanceFeedCursor()` (761-777) is the SOLE runtime writer of
  `last_pulled_at` (only callers: 1853, 1880). Not calling it ⇒ cursor
  untouched ⇒ pending count not zeroed. This is the testable core of AC3.1.
- `getFeedUpdateCounts()` returns `Record<string, number>` (Phase 1).

Test wiring: a new file `test/dev-poll-now.ts` must be registered in
`test/run-all-tests.mjs` (node-platform section). Model the esbuild command on
a worker-importing node test such as `oauth-credential-persistence.ts`
(run-all-tests.mjs:160-168).

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: DO internal route `POST /internal/dev/poll-now`

**Verifies:** 040-fix-updates-count.AC3.1, .AC3.3

**Files:**
- Modify: `src/server/durable-objects/index.ts` — add a route inside
  `createRouter()`, near the other `/internal/...` and `/feeds/refresh` routes.

**Implementation:**

Add to the DO router:
```ts
// Dev-only discovery trigger. Runs the real per-feed discovery path
// (insert items + feed-updates-available broadcast) over ALL feeds,
// ignoring per-feed nextDueAt, WITHOUT advancing last_pulled_at — so the
// pending count grows and can be observed. Reachable only via the
// dev-gated, authenticated worker route POST /api/dev/poll-now.
app.post('/internal/dev/poll-now', async (c) => {
    const feeds = this.sql.exec('SELECT * FROM feeds')
        .toArray() as unknown as Feed[]
    const before = Number(
        (this.sql.exec('SELECT COUNT(*) AS c FROM items')
            .one() as { c:number|string }).c
    )
    await this.runFeedPool(feeds, feed => this.fetchFeed(feed))
    const after = Number(
        (this.sql.exec('SELECT COUNT(*) AS c FROM items')
            .one() as { c:number|string }).c
    )
    return c.json({
        polledFeeds: feeds.length,
        newItems: after - before,
        counts: this.getFeedUpdateCounts()
    })
})
```

Notes:
- `.one()` on `SELECT COUNT(*)` is allowed (exactly one row) per the project's
  no-bare-`.one()` convention.
- Do NOT call `advanceFeedCursor()` here — that omission is the whole point.
- Confirm the exact helper name `runFeedPool` and the `Feed` type are the ones
  used by `/feeds/refresh`; reuse them rather than introducing new names.
- `newItems` is computed by an items-count delta so `fetchFeed` need not change
  its `void` signature.

**Testing:** covered in Task 3 (AC3.1, AC3.3).

**Commit:** `feat: add internal DO dev poll-now discovery route (040 AC3)`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Worker route `POST /api/dev/poll-now` (dev-gated, authed)

**Verifies:** 040-fix-updates-count.AC3.1, .AC3.2

**Files:**
- Modify: `src/server/index.ts` — add the route on `app` ABOVE
  `app.route('/api', dataRouter)` (line ~2202).

**Implementation:**
```ts
// Dev-only: force a discovery pass over all feeds without advancing the
// read cursor, so the "N updates" count can be observed growing locally.
// Gated to development; 404 elsewhere. Gate runs before requireAuth so
// production returns 404 (not 401) regardless of session.
app.post(
    '/api/dev/poll-now',
    async (c, next) => {
        if (c.env.NODE_ENV !== 'development') return c.notFound()
        return next()
    },
    requireAuth,
    async (c) => {
        const session = c.get('session')!
        const stub = getRsssUserDO(c.env, session.did)
        return stub.fetch(new Request(
            'http://do/internal/dev/poll-now',
            { method: 'POST' }
        ))
    }
)
```
Match the surrounding handlers' Context generic typing (copy the signature
shape from `app.post('/api/account/delete', requireAuth, ...)`).

**Testing:** covered in Task 3 (AC3.2 at the worker level).

**Commit:** `feat: add dev-gated /api/dev/poll-now worker route (040 AC3.2)`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Tests for the dev endpoint + register the test file

**Verifies:** 040-fix-updates-count.AC3.1, .AC3.2, .AC3.3

**Files:**
- Create: `test/dev-poll-now.ts`
- Modify: `test/run-all-tests.mjs` (register the new file).

**Implementation (test design):**

**Worker-level (AC3.2):** import the worker `app` and the env helper
(`makeEnv` from `test/signup-helpers.ts`, as used by other worker tests).

The request MUST satisfy the global CSRF guard (see Verified codebase facts),
otherwise it returns 403 before reaching the NODE_ENV gate and the 404
assertion is meaningless. Mirror the header + 4-arg shape of
`test/account-deletion.ts:114-143` (which passes its 401 auth gate the same
way): send `cookie: csrf_token=test-csrf`, `x-csrf-token: test-csrf`,
`sec-fetch-site: same-origin`, and pass `executionCtx` as the 4th `app.request`
argument.

```ts
const res = await app.request(
    'https://rsss.space/api/dev/poll-now',
    {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            cookie: 'csrf_token=test-csrf',
            'x-csrf-token': 'test-csrf',
            'sec-fetch-site': 'same-origin'
        }
    },
    makeEnv({ NODE_ENV: 'production' }),
    executionCtx
)
t.equal(res.status, 404, 'poll-now is 404 in production')
```
- Repeat with `NODE_ENV: 'staging'` → assert `404`.
- No session/DO interaction is reached: the NODE_ENV gate returns 404 before
  `requireAuth` and before any DO call. Provide whatever minimal bindings
  `makeEnv` requires (and an `executionCtx` like the account-deletion test
  uses).

**DO-level (AC3.1, AC3.3):** build a DO instance with the
`Object.create(RsssUserDO.prototype)` harness (model on `test/feed-cursor.ts`
and `test/account-deletion-alarm.ts`). Drive it through
`userDo.createRouter().request('/internal/dev/poll-now', { method: 'POST' })`.

Set up the fake so:
- `sql.exec('SELECT * FROM feeds')` returns a fixed list of feeds.
- a closure `itemCount` backs `sql.exec('SELECT COUNT(*) AS c FROM items')`
  via `fakeResult([{ c: itemCount }])`.
- stub `userDo.fetchFeed` to record each call (`fetched.push(feed.id)`) and, in
  the AC3.1 case, increment `itemCount` to simulate inserted items.
- spy `userDo.advanceFeedCursor` to record calls (it must record ZERO).
- `userDo.getFeedUpdateCounts` may run against faked rows or be stubbed to a
  known map.

Assertions:
- **AC3.1:** response status 200; body `polledFeeds` === number of feeds;
  `fetchFeed` called once per feed; `body.newItems` === simulated inserts
  (> 0); `body.counts` is an object; **`advanceFeedCursor` was never called**
  (cursor untouched — the core guarantee).
- **AC3.3:** with `fetchFeed` stubbed to insert nothing (304 simulation:
  `itemCount` unchanged) and resolve without error → `body.newItems` === 0, no
  thrown error / no `console.error`, and the response still contains all three
  fields `{ polledFeeds, newItems, counts }`.

Do NOT assert on HTML/DOM. Assert on the JSON response and recorded calls.

**Register in `test/run-all-tests.mjs`** (node-platform tests section,
alongside the other `esbuild ... | node | tap-spec` entries). Start from the
`oauth-credential-persistence.ts` flags:
```js
[
    'esbuild ./test/dev-poll-now.ts --bundle',
    '--platform=node --format=esm',
    '--external:./src/server/blurhash-runtime.js',
    '--external:stripe',
    '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
    '--alias:@sentry/cloudflare=./test/sentry-cloudflare-stub.ts',
    '| node --input-type=module | tap-spec'
].join(' '),
```
If the bundle fails on a `.wasm` import pulled in by the DO module, add
`--loader:.wasm=dataurl` (as `billing-management.ts` does).

**Verification:**
```bash
esbuild ./test/dev-poll-now.ts --bundle --platform=node --format=esm \
  --external:./src/server/blurhash-runtime.js --external:stripe \
  --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts \
  --alias:@sentry/cloudflare=./test/sentry-cloudflare-stub.ts \
  | node --input-type=module | tap-spec
```
Expected: all assertions pass.

**Commit:** `test: cover dev poll-now gate + discovery-without-pull (040 AC3)`
<!-- END_TASK_3 -->

---

## Phase Done When

- `POST /api/dev/poll-now` returns 404 when `NODE_ENV !== 'development'`.
- In dev it runs `fetchFeed` over all feeds and does NOT call
  `advanceFeedCursor` (cursor unchanged); the response is
  `{ polledFeeds, newItems, counts }`.
- A 304 (no inserts) yields `newItems: 0` with no error and the full response
  shape.
- `test/dev-poll-now.ts` is registered and passing.
- `npm test && npm run lint` is green.

**Covers:** 040-fix-updates-count.AC3.1, .AC3.2, .AC3.3
