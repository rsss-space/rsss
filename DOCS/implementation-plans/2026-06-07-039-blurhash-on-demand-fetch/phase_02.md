# Blur-Hash for On-Demand Article Fetches — Phase 2: On-demand route wiring

**Goal:** Make the on-demand `POST /items/:id/fetch-full` route feed the same
body-blur pipeline the eager path uses — enqueue body blur jobs on a fresh
fetch, and lazy-fill from already-stored HTML on a cache hit whose blur map
is still empty — so blur eventually appears for every article a reader opens.

**Architecture:** Two best-effort `enqueueBodyBlurJobs` calls inside the
existing route handler in `src/server/durable-objects/index.ts`, reusing the
Phase 1 helper. The fresh-fetch call runs after the `full_content` UPDATE; the
lazy-fill call runs inside the cache-hit early-return branch, gated on an
empty blur map via a new module-scope `hasBodyBlurMap` predicate that reuses
the existing `parseImageMap`. Both calls are wrapped in try/catch and mirror
the DO's existing `const env:Env|undefined = this.env` enqueue idiom — a
queue `send` failure never fails the response. No queue/consumer/schema/
client changes.

**Tech Stack:** TypeScript (Cloudflare Workers runtime, ES2022 lib),
Hono router inside a Durable Object, ESM/NodeNext (`.js` imports). Tests:
`@substrate-system/tapzero` bundled with esbuild, run on node via `tap-spec`,
registered in `test/run-all-tests.mjs`.

**Scope:** Phase 2 of 2 from `specs/039-blurhash-on-demand-fetch/design.md`
("Changes by area > 2. fresh-fetch enqueue" and "3. cache-hit lazy-fill").
Depends on Phase 1 (`enqueueBodyBlurJobs` helper must already exist).

**Codebase verified:** 2026-06-07

---

## Acceptance Criteria Coverage

This phase implements and tests:

### 039-blurhash-on-demand-fetch.AC3: On-demand route — fresh-fetch enqueue
- **039-blurhash-on-demand-fetch.AC3.1 Success:** A fresh fetch (no cache, or
  `force`) that returns HTML containing N images enqueues one `target:'body'`
  blur job per image (capped at `MAX_BODY_BLUR_IMAGES`), each carrying the
  item id and the DO object id.
- **039-blurhash-on-demand-fetch.AC3.2 Failure:** A fetch that returns a
  failure status (no HTML) enqueues nothing.
- **039-blurhash-on-demand-fetch.AC3.3 Failure isolation:** If
  `BLURHASH_QUEUE.send` throws during enqueue, the route still returns 200
  with the item (the article text is what the user is waiting for).

### 039-blurhash-on-demand-fetch.AC4: On-demand route — cache-hit lazy-fill
- **039-blurhash-on-demand-fetch.AC4.1 Lazy-fill:** A cache hit (body already
  stored, `force` not set) whose `full_content_images` map is empty, with
  stored HTML containing images, enqueues body blur jobs from the stored HTML;
  the response is still the stored row (200).
- **039-blurhash-on-demand-fetch.AC4.2 Skip when populated:** A cache hit whose
  `full_content_images` map is non-empty enqueues nothing.

---

## Context the executor needs (verified current state)

All line numbers are in `src/server/durable-objects/index.ts` as of
2026-06-07.

- **Imports (lines 5-35).** Line 35 is:
  `import { mergeFullContentImage } from '../full-content-images.js'`.
  `parseImageMap` is exported from that same module but not yet imported here.
  `enqueueBodyBlurJobs` (Phase 1) is in `../blurhash-body-enqueue.js` and is
  not imported here yet. `BlurhashJob` is already imported (lines 28-32).
- **`ITEM_COLUMNS` (lines 137-146)** already selects `full_content`,
  `full_content_status`, and `full_content_images`. `ITEM_SYNC_COLUMNS`
  follows at lines 147-150.
- **Route handler `POST /items/:id/fetch-full` (lines 1489-1578).** Relevant
  regions, verbatim:
  - Cache-hit early return (lines 1522-1531):
    ```ts
            // Cache hit: row already has content (succeeded or partial) and
            // force not set.
            if (
                !force &&
                isSuccessStatus(item.full_content_status as string|null) &&
                typeof item.full_content === 'string' &&
                item.full_content.length > 0
            ) {
                return c.json({ item })
            }
    ```
    The selected row variable is `item` (`Record<string, unknown>`).
  - Fresh-fetch success UPDATE (lines 1553-1562):
    ```ts
            if ('html' in result) {
                this.sql.exec(
                    'UPDATE items SET full_content = ?, ' +
                    'full_content_fetched_at = ?, ' +
                    'full_content_status = ? WHERE id = ?',
                    result.html,
                    result.fetchedAt,
                    result.status,
                    id
                )
            } else {
    ```
  - Final re-select + return (lines 1574-1577): `updated` →
    `return c.json({ item: updated })`.
- **DO env/ctx access.** `RsssUserDO extends DurableObject<Env>`; inside the
  route closures `this.env` (type `Env`) and `this.ctx.id.toString()` resolve
  correctly. The DO's canonical enqueue idiom (from
  `updateBlurhashFromCacheOrQueue`, lines 2132-2160) is:
  ```ts
        const env:Env|undefined = this.env
        if (!env?.BLURHASH_KV || !env.BLURHASH_QUEUE) return
        ...
        await env.BLURHASH_QUEUE.send({
            imageUrl,
            itemId,
            objectId: this.ctx.id.toString()
        } satisfies BlurhashJob)
  ```
  Mirror this `const env:Env|undefined = this.env` widening so the
  `env?.BLURHASH_QUEUE` guard is a legitimate condition (it also makes the
  code safe in tests where `this.env` is undefined).
- **`Env.BLURHASH_QUEUE` (line 41):** typed `Queue`.
- **Test harness `test/fetch-full-endpoint.ts`** builds the DO via
  `Object.create(RsssUserDO.prototype)` and assigns `sql`, `ctx` (storage +
  `waitUntil`), and `doFetchFullArticle`. It sets **neither `userDo.env` nor
  `userDo.ctx.id`**, and its `ItemRow`/`makeItem` omit `full_content_images`.
  Because the new enqueue code is gated on `this.env?.BLURHASH_QUEUE`, those
  12 existing tests keep passing unchanged (env undefined → no enqueue). The
  new Phase 2 tests need their own harness that *does* set `env` + `ctx.id`.
- **House style (match surrounding code):** `interface` for shapes,
  no space before the colon in type annotations, `.js` import specifiers,
  4-space indent, no statement-end semicolons in these files, lines ≤ 80
  columns. In *test* files match the existing test style (e.g. `ItemRow[]`,
  `unknown[]`). Per house rules and the design, **assert only on queue
  messages and HTTP status — never on article HTML text.**

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Add imports and the `hasBodyBlurMap` predicate

**Verifies:** (enabling change; no standalone test — exercised by Tasks 2-3
and their tests)

**Files:**
- Modify: `src/server/durable-objects/index.ts`

**Edit 1 — extend the `full-content-images` import (line 35).** Replace:
```ts
import { mergeFullContentImage } from '../full-content-images.js'
```
with:
```ts
import { mergeFullContentImage, parseImageMap } from '../full-content-images.js'
```

**Edit 2 — add the Phase 1 helper import.** Immediately after that line, add:
```ts
import { enqueueBodyBlurJobs } from '../blurhash-body-enqueue.js'
```

**Edit 3 — add the `hasBodyBlurMap` module-scope predicate.** Insert it
immediately after the `ITEM_SYNC_COLUMNS` definition (the block at lines
147-150 ending with a backtick on its own line). Anchor:
```ts
const ITEM_SYNC_COLUMNS = `
    ${ITEM_COLUMNS},
    feeds.title AS feed_title
`
```
Add after it:
```ts

// True when the stored body blur map already holds at least one entry.
// Reuses parseImageMap so a null/whitespace/malformed/`{}` value counts as
// empty and lazy-fill proceeds; any real entry makes lazy-fill skip.
function hasBodyBlurMap (value:unknown):boolean {
    if (typeof value !== 'string') return false
    return Object.keys(parseImageMap(value)).length > 0
}
```

**Note on the design's predicate:** the design sketched a string-only
predicate (`t !== '' && t !== '{}'`). We deliberately reuse the existing,
tested `parseImageMap` instead — it is DRY and correctly treats malformed
JSON as empty. Behavior for the real data shape (a JSON object map) is
identical to the design's intent: skip lazy-fill only when the map already
has entries.

**Step: Verify it compiles (no behavior yet).**

Run:
```bash
npx tsc --noEmit
```
Expected: exit code 0 and no `error TS…` lines. Note: `tsconfig.json` sets
`listFiles:true`, so tsc prints the full file list on every run — that is
expected noise; scan the output for `error TS` (e.g.
`npx tsc --noEmit 2>&1 | grep -E 'error TS' || echo 'no type errors'`).
`parseImageMap`/`enqueueBodyBlurJobs`/`hasBodyBlurMap` are imported/defined
but as-yet-unused here; that is fine — `tsconfig.json` has no
`noUnusedLocals` (unused-vars is an eslint rule, and eslint isn't run until
end of Task 3, by which point all three are used). Tasks 1-3 commit together,
so the tree is never half-wired.

**No commit yet** — commit at the end of Task 3 with the two call sites and
tests, so the tree is never in a half-wired state.
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Fresh-fetch enqueue in the success branch

**Verifies:** 039-blurhash-on-demand-fetch.AC3.1,
039-blurhash-on-demand-fetch.AC3.2, 039-blurhash-on-demand-fetch.AC3.3

**Files:**
- Modify: `src/server/durable-objects/index.ts`

**Edit — extend the `'html' in result` success branch (lines 1553-1562).**
Replace:
```ts
            if ('html' in result) {
                this.sql.exec(
                    'UPDATE items SET full_content = ?, ' +
                    'full_content_fetched_at = ?, ' +
                    'full_content_status = ? WHERE id = ?',
                    result.html,
                    result.fetchedAt,
                    result.status,
                    id
                )
            } else {
```
with:
```ts
            if ('html' in result) {
                this.sql.exec(
                    'UPDATE items SET full_content = ?, ' +
                    'full_content_fetched_at = ?, ' +
                    'full_content_status = ? WHERE id = ?',
                    result.html,
                    result.fetchedAt,
                    result.status,
                    id
                )

                // Fresh fetch: enqueue body blur jobs for the newly-stored
                // HTML. Best-effort — a queue failure must never fail the
                // fetch-full response.
                if (result.html) {
                    const env:Env|undefined = this.env
                    if (env?.BLURHASH_QUEUE) {
                        try {
                            await enqueueBodyBlurJobs(
                                env.BLURHASH_QUEUE,
                                result.html,
                                id,
                                this.ctx.id.toString()
                            )
                        } catch (err) {
                            console.error(
                                'body blur enqueue failed (fetch):', err
                            )
                        }
                    }
                }
            } else {
```
(Only the success branch grows; the `else` failure branch and everything
after it are unchanged. The failure branch writes no `full_content` and
reaches no enqueue, satisfying AC3.2.)

**Testing:** Covered by the test written in Task 3 (cases: fresh fetch with
images → N jobs; failure status → 0 jobs; `send` throws → still 200).

**Step: Type-check.**
```bash
npx tsc --noEmit
```
Expected: exit 0, no `error TS…` lines (the `listFiles` file dump is
expected noise — `npx tsc --noEmit 2>&1 | grep -E 'error TS'` should print
nothing). `result.html` is `string` inside `'html' in result` (the
discriminated union member), so no cast is needed.
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Cache-hit lazy-fill + tests + registration

**Verifies:** 039-blurhash-on-demand-fetch.AC4.1,
039-blurhash-on-demand-fetch.AC4.2 (and proves AC3.1-AC3.3 from Task 2)

**Files:**
- Modify: `src/server/durable-objects/index.ts`
- Create: `test/fetch-full-body-blur.ts` (integration; DO route)
- Modify: `test/run-all-tests.mjs`

**Edit — lazy-fill inside the cache-hit branch (lines 1522-1531).** Replace:
```ts
            // Cache hit: row already has content (succeeded or partial) and
            // force not set.
            if (
                !force &&
                isSuccessStatus(item.full_content_status as string|null) &&
                typeof item.full_content === 'string' &&
                item.full_content.length > 0
            ) {
                return c.json({ item })
            }
```
with:
```ts
            // Cache hit: row already has content (succeeded or partial) and
            // force not set.
            if (
                !force &&
                isSuccessStatus(item.full_content_status as string|null) &&
                typeof item.full_content === 'string' &&
                item.full_content.length > 0
            ) {
                // Lazy-fill: a previously-fetched body whose blur map is
                // still empty enqueues body blur jobs from the stored HTML
                // on this open. Best-effort — never fail the cache-hit
                // response. Self-limiting: once the consumer writes any map
                // entry back, later opens see a non-empty map and skip.
                const fullContent = item.full_content
                const env:Env|undefined = this.env
                if (
                    env?.BLURHASH_QUEUE &&
                    !hasBodyBlurMap(item.full_content_images)
                ) {
                    try {
                        await enqueueBodyBlurJobs(
                            env.BLURHASH_QUEUE,
                            fullContent,
                            id,
                            this.ctx.id.toString()
                        )
                    } catch (err) {
                        console.error(
                            'body blur enqueue failed (lazy):', err
                        )
                    }
                }
                return c.json({ item })
            }
```
(`const fullContent = item.full_content` captures the value while it is
narrowed to `string` by the condition above — this avoids relying on
property-narrowing surviving the intervening calls. The response shape
`c.json({ item })` is unchanged.)

**Create the test** `test/fetch-full-body-blur.ts`. Self-contained harness
modeled on `test/fetch-full-endpoint.ts` but with `env.BLURHASH_QUEUE`,
`ctx.id`, and `full_content_images` added. Assert only on queue messages and
HTTP status — never on HTML text.

```ts
import { test } from '@substrate-system/tapzero'
import { RsssUserDO } from '../src/server/durable-objects/index.js'
import type { FetchFullArticleResult } from '../src/server/article-fetch.js'

interface ItemRow {
    id:number
    feed_id:number
    guid:string
    title:string|null
    link:string|null
    description:string|null
    content:string|null
    author:string|null
    pub_date:string|null
    thumbnail_url:string|null
    is_read:number
    is_starred:number
    created_at:string
    updated_at:string
    full_content:string|null
    full_content_fetched_at:string|null
    full_content_status:string|null
    full_content_images:string|null
}

interface QueryResult {
    toArray:() => unknown[]
    one:() => unknown | null
}

function result (rows:unknown[]):QueryResult {
    return {
        toArray () { return rows },
        one () { return rows[0] || null }
    }
}

function makeItem (overrides:Partial<ItemRow> = {}):ItemRow {
    return {
        id: 1,
        feed_id: 1,
        guid: 'g1',
        title: 't',
        link: 'https://example.com/post',
        description: 'd',
        content: null,
        author: null,
        pub_date: null,
        thumbnail_url: null,
        is_read: 0,
        is_starred: 0,
        created_at: '2026-04-26 00:00:00',
        updated_at: '2026-04-26 00:00:00',
        full_content: null,
        full_content_fetched_at: null,
        full_content_status: null,
        full_content_images: null,
        ...overrides
    }
}

function createSql (items:ItemRow[]) {
    return {
        items,
        exec (query:string, ...params:unknown[]) {
            const q = query.replace(/\s+/g, ' ').trim()

            if (q.startsWith('SELECT') && q.includes('FROM items WHERE id = ?')) {
                const id = params[0] as number
                return result(items.filter(i => i.id === id))
            }

            const updateMatch = q.match(/^UPDATE items SET (.+) WHERE id = \?$/)
            if (updateMatch) {
                const setClause = updateMatch[1]
                const id = params[params.length - 1] as number
                const item = items.find(i => i.id === id)
                if (!item) return result([])

                const assignments = setClause.split(',').map(s => s.trim())
                let pIdx = 0
                for (const a of assignments) {
                    const m = a.match(/^(\w+)\s*=\s*(\?|datetime\('now'\))$/)
                    if (!m) continue
                    const col = m[1]
                    const valuePart = m[2]
                    let value:unknown
                    if (valuePart === "datetime('now')") {
                        value = '2026-05-01 12:00:00'
                    } else {
                        value = params[pIdx++]
                    }
                    ;(item as unknown as Record<string, unknown>)[col] = value
                }
                return result([])
            }

            throw new Error(`Unexpected SQL: ${q}`)
        }
    }
}

interface FakeQueue {
    calls:number
    sent:unknown[]
    send:(message:unknown) => Promise<unknown>
}

function captureQueue ():FakeQueue {
    const q:FakeQueue = {
        calls: 0,
        sent: [],
        async send (message:unknown) {
            q.calls++
            q.sent.push(message)
        }
    }
    return q
}

function throwingQueue ():FakeQueue {
    const q:FakeQueue = {
        calls: 0,
        sent: [],
        async send () {
            q.calls++
            throw new Error('queue down')
        }
    }
    return q
}

function createHarness (
    items:ItemRow[],
    fetchResult:FetchFullArticleResult|null,
    queue:FakeQueue = captureQueue()
) {
    const sql = createSql(items)
    const storage = new Map<string, unknown>()
    const fetcher = { calls: 0, next: fetchResult }
    const userDo = Object.create(RsssUserDO.prototype) as {
        sql:ReturnType<typeof createSql>
        env:{ BLURHASH_QUEUE:FakeQueue }
        ctx:{
            id:{ toString:() => string }
            storage:{
                get:<T>(key:string) => Promise<T|undefined>
                put:(key:string, value:unknown) => Promise<void>
                delete:(key:string) => Promise<void>
            }
            waitUntil:(promise:Promise<unknown>) => void
        }
        doFetchFullArticle:(link:string) => Promise<FetchFullArticleResult>
        createRouter:() => {
            request:(path:string, init?:RequestInit) => Promise<Response>
        }
    }

    userDo.sql = sql
    userDo.env = { BLURHASH_QUEUE: queue }
    userDo.ctx = {
        id: { toString: () => 'test-do-id' },
        storage: {
            async get<T> (key:string) {
                return storage.get(key) as T|undefined
            },
            async put (key:string, value:unknown) {
                storage.set(key, value)
            },
            async delete (key:string) {
                storage.delete(key)
            }
        },
        waitUntil () {}
    }
    userDo.doFetchFullArticle = async (_link:string) => {
        fetcher.calls++
        if (!fetcher.next) {
            throw new Error('no fetch result configured')
        }
        return fetcher.next
    }

    return {
        app: userDo.createRouter(),
        items,
        fetcher,
        queue,
        storage
    }
}

interface BodyBlurMessage {
    imageUrl:string
    itemId:number
    objectId:string
    target:string
}

test('fetch-full fresh fetch enqueues one body blur job per image',
    async t => {
        const items = [makeItem()]
        const { app, queue, fetcher } = createHarness(items, {
            status: 'succeeded',
            html: '<img src="https://img.example.com/a.jpg">' +
                '<img src="https://img.example.com/b.png">',
            fetchedAt: '2026-05-01 12:00:00'
        })

        const r = await app.request('/items/1/fetch-full', { method: 'POST' })

        t.equal(r.status, 200, '200 OK')
        t.equal(fetcher.calls, 1, 'fetched once')
        t.equal(queue.sent.length, 2, 'one blur job per image')
        const first = queue.sent[0] as BodyBlurMessage
        t.equal(first.imageUrl, 'https://img.example.com/a.jpg', 'imageUrl')
        t.equal(first.itemId, 1, 'itemId is the route id')
        t.equal(first.objectId, 'test-do-id', 'objectId is the DO id')
        t.equal(first.target, 'body', 'target is body')
    }
)

test('fetch-full failure status enqueues nothing', async t => {
    const items = [makeItem()]
    const { app, queue, fetcher } = createHarness(items, {
        status: 'failed_status'
    })

    const r = await app.request('/items/1/fetch-full', { method: 'POST' })

    t.equal(r.status, 200, '200 OK (failure recorded inline)')
    t.equal(fetcher.calls, 1, 'fetch attempted')
    t.equal(queue.sent.length, 0, 'no blur jobs on failure')
})

test('fetch-full cache hit with empty blur map lazy-fills', async t => {
    const items = [makeItem({
        full_content: '<img src="https://img.example.com/a.jpg">',
        full_content_status: 'succeeded',
        full_content_fetched_at: '2026-04-30 10:00:00',
        full_content_images: null
    })]
    const { app, queue, fetcher } = createHarness(items, null)

    const r = await app.request('/items/1/fetch-full', { method: 'POST' })

    t.equal(r.status, 200, '200 OK')
    t.equal(fetcher.calls, 0, 'no re-fetch on cache hit')
    t.equal(queue.sent.length, 1, 'lazy-fill enqueues from stored html')
    const msg = queue.sent[0] as BodyBlurMessage
    t.equal(msg.itemId, 1, 'itemId is the route id')
    t.equal(msg.objectId, 'test-do-id', 'objectId is the DO id')
    t.equal(msg.target, 'body', 'target is body')
})

test('fetch-full cache hit with populated blur map enqueues nothing',
    async t => {
        const populated = JSON.stringify({
            'https://img.example.com/a.jpg': {
                blurhash: 'LEHV6nWB',
                width: 100,
                height: 100
            }
        })
        const items = [makeItem({
            full_content: '<img src="https://img.example.com/a.jpg">',
            full_content_status: 'succeeded',
            full_content_fetched_at: '2026-04-30 10:00:00',
            full_content_images: populated
        })]
        const { app, queue, fetcher } = createHarness(items, null)

        const r = await app.request('/items/1/fetch-full', { method: 'POST' })

        t.equal(r.status, 200, '200 OK')
        t.equal(fetcher.calls, 0, 'no re-fetch on cache hit')
        t.equal(queue.sent.length, 0, 'no lazy-fill when map populated')
    }
)

test('fetch-full returns 200 even if blur enqueue throws', async t => {
    const items = [makeItem()]
    const { app, queue, fetcher } = createHarness(
        items,
        {
            status: 'succeeded',
            html: '<img src="https://img.example.com/a.jpg">',
            fetchedAt: '2026-05-01 12:00:00'
        },
        throwingQueue()
    )

    const r = await app.request('/items/1/fetch-full', { method: 'POST' })
    const body = await r.json() as { item:{ id:number } }

    t.equal(r.status, 200, '200 OK despite enqueue failure')
    t.equal(body.item.id, 1, 'item still returned')
    t.equal(fetcher.calls, 1, 'fetched once')
    t.ok(queue.calls >= 1, 'enqueue was attempted')
})
```

**Register the test** in `test/run-all-tests.mjs`. Insert this block
immediately after the `fetch-full-endpoint.ts` block (currently lines 44-49):
```js
    [
        'esbuild ./test/fetch-full-body-blur.ts --bundle',
        '--platform=node --format=esm',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '| node --input-type=module | tap-spec'
    ].join(' '),
```

**Step: Run the new test, expect PASS.**
```bash
esbuild ./test/fetch-full-body-blur.ts --bundle --platform=node \
  --format=esm \
  --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts \
  | node --input-type=module | tap-spec
```
Expected: all five tests pass.

**Step: Run the existing route tests, expect PASS unchanged (regression).**
```bash
esbuild ./test/fetch-full-endpoint.ts --bundle --platform=node \
  --format=esm \
  --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts \
  | node --input-type=module | tap-spec
```
Expected: all 12 existing tests pass with no edits (env undefined → no
enqueue).

**Step: Type-check and lint.**
```bash
npx tsc --noEmit
npx eslint src/server/durable-objects/index.ts test/fetch-full-body-blur.ts
```
Expected: both clean (no `error TS…` lines from tsc — ignore the `listFiles`
dump; no eslint errors).

**Step: Commit** (Tasks 1-3 together — the route is only fully wired now).
```bash
git add src/server/durable-objects/index.ts test/fetch-full-body-blur.ts \
  test/run-all-tests.mjs
git commit -m "feat: enqueue body blur jobs from on-demand fetch-full route"
```
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

---

## Phase 2 done when

- `durable-objects/index.ts` imports `parseImageMap` and `enqueueBodyBlurJobs`
  and defines `hasBodyBlurMap`.
- The fresh-fetch success branch enqueues body blur jobs (best-effort) for the
  newly-stored HTML (AC3.1); failure status enqueues nothing (AC3.2); a
  throwing queue still yields a 200 (AC3.3).
- The cache-hit branch lazy-fills only when the blur map is empty (AC4.1) and
  skips when populated (AC4.2); the response shape is unchanged.
- `test/fetch-full-body-blur.ts` passes (5 cases) and is registered in
  `test/run-all-tests.mjs`.
- `test/fetch-full-endpoint.ts` passes unchanged (regression).
- `npm test && npm run lint` is green.

## Final full-suite check (end of feature)

After both phases, run the whole gate once:
```bash
npm test && npm run lint
```
Expected: the full suite passes, including the new `blurhash-body-enqueue`
and `fetch-full-body-blur` bundles.
