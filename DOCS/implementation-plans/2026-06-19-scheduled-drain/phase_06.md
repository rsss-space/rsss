# Scheduled-drain ingestion — Phase 6: Minimal HTTP read API

**Goal:** Serve the indexed `space.rsss.*` records to the frontend over HTTP —
filtered by collection and/or did, newest first — and, by constructing the
singleton on first read, provide the production cold-start arming path.

**Architecture:** A `GET /internal/index/feed` route on `RsssIndexerDO` that
SELECTs from `items` with optional `collection`/`did` filters, a clamped
`limit`, ordered `time_us DESC`, returning rows with `record` parsed to JSON. A
worker route `GET /api/index/feed` (behind `requireAuth`) forwards the query to
the indexer singleton. The worker route is registered on `app` BEFORE the
`/api` dataRouter mount (which proxies to the per-user DO), exactly like
`poll-now`.

**Tech Stack:** TypeScript (Cloudflare Workers runtime), Hono, Durable Object
SQLite, `@substrate-system/tapzero` (DO route via fake `sql`; worker wiring via
the `dev-poll-now` test pattern).

**Scope:** Phase 6 of 6 (scheduled-drain ingestion).

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

Implements and tests `scheduled-drain.AC5` (read API). Derived from
`specs/scheduled-drain.md` "How it works" (frontend HTTP read serves the feed
from the index) and "Storage model". Auth (approved): the read route is behind
`requireAuth` — the frontend is already authenticated, and the route doubles as
the cold-start arming path (first authenticated read constructs+arms the
singleton, per Phase 5).

### scheduled-drain.AC5: Read API
- **scheduled-drain.AC5.1 read returns items:** the DO feed route returns
  `{ items: [...] }` where each item's `record` is parsed to an object, ordered
  by `time_us DESC`.
- **scheduled-drain.AC5.2 collection filter:** `?collection=X` constrains with
  `collection = ?` bound to `X`.
- **scheduled-drain.AC5.3 did filter:** `?did=Y` constrains with `did = ?`
  bound to `Y`.
- **scheduled-drain.AC5.4 limit:** default 50; `?limit=500` clamps to 200;
  `?limit=abc` falls back to 50; the limit is the final bind.
- **scheduled-drain.AC5.5 worker wiring:** `GET /api/index/feed` requires auth,
  forwards the query string to the indexer singleton's `/internal/index/feed`,
  and returns 404 when `INDEXER_DO` is unbound.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: DO feed route + helpers

**Verifies:** scheduled-drain.AC5.1–AC5.4

**Files:**
- Modify: `src/server/durable-objects/indexer.ts`

**Implementation:**

Add two module-local helpers near the top of the file:

```ts
function clampLimit (raw:string|undefined):number {
    const n = Number.parseInt(raw ?? '', 10)
    if (!Number.isFinite(n) || n <= 0) return 50
    return Math.min(n, 200)
}

function safeParse (json:string):unknown {
    try { return JSON.parse(json) } catch { return null }
}
```

Add the route inside `createRouter()`:

```ts
        app.get('/internal/index/feed', (c) => {
            const collection = c.req.query('collection')
            const did = c.req.query('did')
            const limit = clampLimit(c.req.query('limit'))
            const conds:string[] = []
            const binds:unknown[] = []
            if (collection) {
                conds.push('collection = ?')
                binds.push(collection)
            }
            if (did) {
                conds.push('did = ?')
                binds.push(did)
            }
            const where = conds.length ?
                `WHERE ${conds.join(' AND ')}` :
                ''
            const rows = this.sql.exec(
                `SELECT uri, did, collection, rkey, cid, record,
                        time_us, indexed_at
                 FROM items ${where}
                 ORDER BY time_us DESC
                 LIMIT ?`,
                ...binds,
                limit
            ).toArray() as unknown as IndexItem[]
            const items = rows.map((r) => ({
                ...r,
                record: safeParse(r.record)
            }))
            return c.json({ items })
        })
```

Notes:
- `IndexItem` is the interface created in Phase 1; `record` is stored as a JSON
  string and returned parsed.
- The `${where}` interpolation contains only the fixed strings built above
  (never user input) — all values are positional binds, so there is no
  injection surface.

**Verify:** `npm run typecheck` && `npm run lint`.

**Commit:** `feat: serve indexed records from the indexer DO feed route`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Worker read route

**Verifies:** scheduled-drain.AC5.5

**Files:**
- Modify: `src/server/index.ts`

**Implementation:**

Register on `app` BEFORE the `app.route('/api', dataRouter)` mount (alongside
the dev routes, so the specific path wins over the dataRouter catch-all that
proxies to the per-user DO):

```ts
app.get('/api/index/feed', requireAuth, async (c) => {
    const stub = getIndexerDO(c.env)
    if (!stub) return c.notFound()
    const doUrl = new URL('http://do/internal/index/feed')
    doUrl.search = new URL(c.req.url).search   // forward filters + limit
    return stub.fetch(new Request(doUrl.toString()))
})
```

Notes:
- `getIndexerDO` (Phase 1) returns `null` when `INDEXER_DO` is unbound → 404.
- The forwarded request method is GET; only the query string is carried over.
- This route is the production cold-start path: the first authenticated read
  constructs the singleton, whose constructor arms the alarm (Phase 5); the
  alarm then self-perpetuates.

**Verify:** `npm run typecheck` && `npm run lint`.

**Commit:** `feat: expose GET /api/index/feed read route (authed)`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Read-API tests

**Verifies:** scheduled-drain.AC5.1–AC5.5

**Files:**
- Create: `test/indexer-feed.ts` (DO route logic, unit)
- Create: `test/index-feed-route.ts` (worker wiring, integration) — OR add a
  case to an existing app-route test; a dedicated file is cleaner
- Modify: `test/run-all-tests.mjs` (register both)

**Testing:**

DO route (`test/indexer-feed.ts`) — construct `RsssIndexerDO` with a fake `ctx`
(as in Phase 5) whose `sql.exec` captures `(query, binds)` and returns
`fakeResult([...])` of canned `items` rows (with `record` as a JSON string).
Type the fake `sql.exec` to return a SINGLE `FakeQueryResult` type — not a union
of differently-shaped return values — to avoid the `TS2322` that the existing
`test/dev-poll-now.ts` fake exhibits on the baseline (a union `sql.exec` return
is what trips it). Drive it through
`do.fetch(new Request('http://do/internal/index/feed?…'))` and assert the JSON
body + the captured query/binds:

- AC5.1: a request with no filters → query has `ORDER BY time_us DESC` and no
  `WHERE`; response `items[i].record` is the parsed object (not the string);
  rows are returned in the order `sql` yielded them.
- AC5.2: `?collection=space.rsss.graph.follow` → query contains
  `collection = ?` and binds include that value.
- AC5.3: `?did=did:plc:abc` → query contains `did = ?` and binds include it.
  Also test both filters together → `WHERE collection = ? AND did = ?`.
- AC5.4: no `limit` → final bind is `50`; `?limit=500` → final bind `200`;
  `?limit=abc` → final bind `50`.

Worker wiring (`test/index-feed-route.ts`) — mirror `test/dev-poll-now.ts`:
build a worker `app`/route with a mock env where `INDEXER_DO` is a namespace
whose `.get().fetch()` records the requested DO path + search and returns a
canned `Response`. Inject a session (authed). Assert:

- AC5.5a: `GET /api/index/feed?collection=X` (authed) calls the indexer stub
  with path `/internal/index/feed` and search `?collection=X`, and returns the
  stub's body.
- AC5.5b: with `INDEXER_DO` absent from env → 404.
- AC5.5c: without a session → `requireAuth` returns 401 (no stub call).

Register both in `test/run-all-tests.mjs`. `test/indexer-feed.ts` needs the
`cloudflare:workers` alias (DO import); match `test/index-feed-route.ts`'s
aliases to whatever `test/dev-poll-now.ts` uses (it bundles the worker entry, so
it likely needs `cloudflare:workers`, `@sentry/cloudflare`, and the
`./src/server/blurhash-runtime.js` / `stripe` externals — copy that command's
flags verbatim, changing only the entry file):

```js
    [
        'esbuild ./test/indexer-feed.ts --bundle',
        '--platform=node --format=esm',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '| node --input-type=module | tap-spec'
    ].join(' '),
    [
        'esbuild ./test/index-feed-route.ts --bundle',
        '--platform=node --format=esm',
        '--external:./src/server/blurhash-runtime.js',
        '--external:stripe',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '--alias:@sentry/cloudflare=./test/sentry-cloudflare-stub.ts',
        '| node --input-type=module | tap-spec'
    ].join(' '),
```

(If the worker-entry bundle needs the `--loader:.wasm=dataurl` flag like the
billing tests, add it — follow whatever `test/dev-poll-now.ts` does.)

**Verify:** `npm test` (both suites green; whole run green; no console.error) +
`npm run typecheck` + `npm run lint`.

**Commit:** `test: cover indexer read API and worker wiring (scheduled-drain.AC5)`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

---

## Phase 6 done when

- `RsssIndexerDO` serves `GET /internal/index/feed` with collection/did filters,
  clamped limit, `time_us DESC` ordering, and parsed `record`.
- `GET /api/index/feed` (authed) forwards to the singleton and 404s when
  unbound; it is registered before the `/api` dataRouter mount.
- `test/indexer-feed.ts` (AC5.1–AC5.4) and `test/index-feed-route.ts` (AC5.5)
  pass and are registered.
- `npm test`, `npm run typecheck`, `npm run lint` all pass.

---

## Feature complete (end of Phase 6)

With all six phases merged, rsss has an App View for `space.rsss.*`: a global
singleton `RsssIndexerDO` that, once first constructed (by an authenticated
read), drains Jetstream every ~60s into a validated SQLite index and serves it
over `GET /api/index/feed`. Out of scope (per the spec): full history backfill
(`com.atproto.repo.listRecords` / Hubble), string-format validation, host
failover, and pagination beyond a simple limit.
