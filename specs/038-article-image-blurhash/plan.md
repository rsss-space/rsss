# Blur-Hash Placeholders for Article Images — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute blur hashes ahead of time for images inside article
bodies (by eagerly pre-fetching summary-only article bodies at poll
time) and render them as `<blur-hash>` placeholders, falling back to the
037 gray box.

**Architecture:** A new `article-fetch-jobs` queue is enqueued during DO
polling for summary-only new items. Its consumer fetches the body,
stores it via a new internal DO endpoint, then enqueues body-image blur
jobs on the existing `BLURHASH_QUEUE` (extended with `target:'body'`).
Blur results merge into a new `items.full_content_images` JSON column,
synced to the client, which swaps `<img>`→`<blur-hash>` after DOMPurify.

**Tech Stack:** Cloudflare Workers + DO (TypeScript, ES2022), Hono,
Cloudflare Queues + KV, `@cf-wasm/photon` + `blurhash` (existing),
Preact + `@preact/signals`, `@substrate-system/blur-hash`,
`@substrate-system/tapzero` tests via `tapout` (headless browser) and
node-platform (`tap-spec`).

**Spec:** `specs/038-article-image-blurhash/design.md`

**Branch:** work continues on `038-article-image-blurhash` (already based
on `037`).

---

## Conventions (apply to every task)

- Max 80 columns. TS annotation style: no space before colon
  (`html:string`).
- Server (Worker/DO) code must NOT use `DOMParser` — it does not exist in
  the Workers runtime. Use regex (match `article-extract.ts` style).
  Client code may use `DOMParser`.
- Run `npm run lint` before each commit; it must exit 0.
- Single browser unit test during dev:
  `esbuild ./test/<file>.ts --bundle | tapout`
- Node-platform unit test during dev:
  `esbuild ./test/<file>.ts --bundle --platform=node --format=esm | node --input-type=module | tap-spec`
- Register browser unit tests by adding `import './<file>.js'` to
  `test/browser-tests.ts`.

---

# PHASE 1 — Eager pre-fetch + queue routing

## Task 1.1: Add the `article-fetch-jobs` queue binding + Env type

**Files:**
- Modify: `wrangler.jsonc` (root, staging env, production env queue blocks)
- Modify: `src/server/index.ts:57-77` (Env interface)

- [ ] **Step 1: Add the producer + consumer to the root `queues` block**

In `wrangler.jsonc`, change the root `queues` block to:

```jsonc
"queues": {
    "producers": [
        {
            "binding": "BLURHASH_QUEUE",
            "queue": "blurhash-jobs"
        },
        {
            "binding": "ARTICLE_FETCH_QUEUE",
            "queue": "article-fetch-jobs"
        }
    ],
    "consumers": [
        {
            "queue": "blurhash-jobs",
            "max_batch_size": 10,
            "max_batch_timeout": 30,
            "max_retries": 3,
            "dead_letter_queue": "blurhash-dlq"
        },
        {
            "queue": "article-fetch-jobs",
            "max_batch_size": 10,
            "max_batch_timeout": 30,
            "max_retries": 3,
            "dead_letter_queue": "article-fetch-dlq"
        }
    ]
},
```

- [ ] **Step 2: Mirror in the staging queues block**

In the staging env `queues` block, add the staging producer/consumer:

```jsonc
"queues": {
    "producers": [
        { "binding": "BLURHASH_QUEUE", "queue": "blurhash-jobs-staging" },
        {
            "binding": "ARTICLE_FETCH_QUEUE",
            "queue": "article-fetch-jobs-staging"
        }
    ],
    "consumers": [
        {
            "queue": "blurhash-jobs-staging",
            "max_batch_size": 10,
            "max_batch_timeout": 30,
            "max_retries": 3,
            "dead_letter_queue": "blurhash-dlq-staging"
        },
        {
            "queue": "article-fetch-jobs-staging",
            "max_batch_size": 10,
            "max_batch_timeout": 30,
            "max_retries": 3,
            "dead_letter_queue": "article-fetch-dlq-staging"
        }
    ]
}
```

If the production env block (around lines 220-253) also declares a
`queues` block, mirror the root form there (queue names without
`-staging`). If it inherits the root, leave it.

- [ ] **Step 3: Add the binding to the Env interface**

In `src/server/index.ts`, add to the `Env` interface (after
`BLURHASH_QUEUE:Queue;`):

```ts
    ARTICLE_FETCH_QUEUE:Queue;
```

Then check `src/server/durable-objects/index.ts:33-43` for the DO's
local `Env`/bindings type. If it declares `BLURHASH_QUEUE`, add
`ARTICLE_FETCH_QUEUE:Queue;` there too (the typecheck in Step 4 will
fail if it's needed and missing).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). If it reports `ARTICLE_FETCH_QUEUE` missing
on the DO env, add it to that type and re-run.

- [ ] **Step 5: Commit**

```bash
git add wrangler.jsonc src/server/index.ts src/server/durable-objects/index.ts
git commit -m "feat: add article-fetch-jobs queue binding

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.2: `ArticleFetchJob` type + guard (TDD)

**Files:**
- Create: `src/server/article-fetch-job.ts`
- Create: `test/article-fetch-job.ts`
- Modify: `test/browser-tests.ts`

- [ ] **Step 1: Write the failing test**

Create `test/article-fetch-job.ts`:

```ts
import { test } from '@substrate-system/tapzero'
import { isArticleFetchJob } from '../src/server/article-fetch-job.js'

test('isArticleFetchJob - accepts a valid job', t => {
    t.ok(isArticleFetchJob({
        itemId: 1,
        link: 'https://example.com/a',
        objectId: 'abc'
    }), 'valid job accepted')
})

test('isArticleFetchJob - rejects missing/!=type fields', t => {
    t.ok(!isArticleFetchJob(null), 'null rejected')
    t.ok(!isArticleFetchJob({}), 'empty rejected')
    t.ok(!isArticleFetchJob({
        itemId: '1', link: 'x', objectId: 'y'
    }), 'string itemId rejected')
    t.ok(!isArticleFetchJob({
        itemId: 1, link: 2, objectId: 'y'
    }), 'non-string link rejected')
    t.ok(!isArticleFetchJob({
        itemId: 1, link: 'x'
    }), 'missing objectId rejected')
})
```

- [ ] **Step 2: Run it; verify it fails**

Run: `esbuild ./test/article-fetch-job.ts --bundle | tapout`
Expected: FAIL — no matching export `isArticleFetchJob`.

- [ ] **Step 3: Implement**

Create `src/server/article-fetch-job.ts`:

```ts
export interface ArticleFetchJob {
    itemId:number
    link:string
    objectId:string
}

export function isArticleFetchJob (value:unknown):value is ArticleFetchJob {
    if (!value || typeof value !== 'object') return false
    const job = value as Partial<ArticleFetchJob>
    return typeof job.itemId === 'number' &&
        Number.isInteger(job.itemId) &&
        typeof job.link === 'string' &&
        typeof job.objectId === 'string'
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `esbuild ./test/article-fetch-job.ts --bundle | tapout`
Expected: PASS.

- [ ] **Step 5: Register the test**

In `test/browser-tests.ts`, add after `import './article-fetch.js'`:

```ts
import './article-fetch-job.js'
```

- [ ] **Step 6: Commit**

```bash
git add src/server/article-fetch-job.ts test/article-fetch-job.ts test/browser-tests.ts
git commit -m "feat: ArticleFetchJob type and guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.3: DO internal store endpoint `/internal/full-content/items/:id`

**Files:**
- Modify: `src/server/durable-objects/index.ts` (add a route next to
  `/internal/blurhash/items/:id`, ~line 664)

- [ ] **Step 1: Add the route**

Immediately after the existing `app.post('/internal/blurhash/items/:id',
...)` handler, add:

```ts
app.post('/internal/full-content/items/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id < 1) {
        return c.json({ error: 'Invalid item id' }, 400)
    }

    const body = await c.req.json<{
        html?:unknown
        fetchedAt?:unknown
        status?:unknown
    }>()

    if (
        typeof body.status !== 'string' ||
        !ALL_FULL_CONTENT_STATUSES.includes(
            body.status as FullContentStatus
        )
    ) {
        return c.json({ error: 'Invalid status' }, 400)
    }

    if (typeof body.html === 'string' && body.html.length > 0) {
        const fetchedAt = typeof body.fetchedAt === 'string' ?
            body.fetchedAt :
            new Date().toISOString()
        this.sql.exec(
            'UPDATE items SET full_content = ?, ' +
            'full_content_fetched_at = ?, ' +
            'full_content_status = ? WHERE id = ?',
            body.html,
            fetchedAt,
            body.status,
            id
        )
    } else {
        // Failure / no html: preserve any prior full_content.
        this.sql.exec(
            'UPDATE items SET ' +
            "full_content_fetched_at = datetime('now'), " +
            'full_content_status = ? WHERE id = ?',
            body.status,
            id
        )
    }
    this.bumpFeedVersion()

    return new Response(null, { status: 204 })
})
```

`ALL_FULL_CONTENT_STATUSES` and `FullContentStatus` are already imported
in this file (used by `/items/:id/fetch-full`). If the typecheck shows
otherwise, add them to the existing import from `../shared/schema.js`.

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server/durable-objects/index.ts
git commit -m "feat: internal endpoint to store pre-fetched full content

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.4: Article-fetch queue consumer (fetch + store)

**Files:**
- Create: `src/server/article-fetch-consumer.ts`
- Create: `test/article-fetch-consumer.ts`

- [ ] **Step 1: Write the failing test (node-platform)**

Create `test/article-fetch-consumer.ts`. It injects a fake
`fetchFullArticle` and a fake `USER_DO` to assert the consumer stores
the fetched body via the internal endpoint.

```ts
import { test } from '@substrate-system/tapzero'
import {
    handleArticleFetchQueueBatch
} from '../src/server/article-fetch-consumer.js'

function fakeEnv (calls:Request[]) {
    return {
        ARTICLE_FETCH_QUEUE: { send: async () => {} },
        BLURHASH_QUEUE: { send: async () => {} },
        USER_DO: {
            idFromString: (s:string) => ({ toString: () => s }),
            get: () => ({
                fetch: async (req:Request) => {
                    calls.push(req)
                    return new Response(null, { status: 204 })
                }
            })
        }
    } as never
}

test('article-fetch consumer stores fetched body', async t => {
    const calls:Request[] = []
    const acked:boolean[] = []
    const batch = {
        queue: 'article-fetch-jobs',
        messages: [{
            body: { itemId: 7, link: 'https://x/a', objectId: 'obj' },
            ack: () => acked.push(true),
            retry: () => {}
        }]
    }
    await handleArticleFetchQueueBatch(batch as never, fakeEnv(calls), {
        fetchArticle: async () => ({
            status: 'succeeded',
            html: '<p>hi</p><img src="https://x/i.jpg">',
            fetchedAt: '2026-06-07T00:00:00.000Z'
        })
    })
    t.equal(calls.length, 1, 'one DO write')
    t.equal(
        new URL(calls[0].url).pathname,
        '/internal/full-content/items/7',
        'posts to full-content store endpoint'
    )
    t.equal(acked.length, 1, 'message acked')
})

test('article-fetch consumer acks invalid job', async t => {
    const acked:boolean[] = []
    const batch = {
        queue: 'article-fetch-jobs',
        messages: [{ body: { nope: true }, ack: () => acked.push(true),
            retry: () => {} }]
    }
    await handleArticleFetchQueueBatch(batch as never, fakeEnv([]), {
        fetchArticle: async () => ({ status: 'failed_network' })
    })
    t.equal(acked.length, 1, 'invalid job acked, not retried forever')
})
```

- [ ] **Step 2: Run it; verify it fails**

Run: `esbuild ./test/article-fetch-consumer.ts --bundle --platform=node --format=esm | node --input-type=module | tap-spec`
Expected: FAIL — module/exports not found.

- [ ] **Step 3: Implement the consumer**

Create `src/server/article-fetch-consumer.ts`:

```ts
import { isArticleFetchJob } from './article-fetch-job.js'
import type { ArticleFetchJob } from './article-fetch-job.js'
import { fetchFullArticle } from './article-fetch.js'
import type { FetchFullArticleResult } from './article-fetch.js'

export interface ArticleFetchConsumerEnv {
    USER_DO:{
        idFromString:(id:string) => DurableObjectId
        get:(id:DurableObjectId) => { fetch:(request:Request) =>
            Promise<Response> }
    }
}

export interface ArticleFetchConsumerDeps {
    fetchArticle:(link:string) => Promise<FetchFullArticleResult>
}

export function createArticleFetchConsumerDeps ():ArticleFetchConsumerDeps {
    return { fetchArticle: (link) => fetchFullArticle(link) }
}

interface QueueMessageLike {
    body:unknown
    ack:() => void
    retry:() => void
}
interface QueueBatchLike {
    messages:QueueMessageLike[]
}

async function storeFullContent (
    env:ArticleFetchConsumerEnv,
    job:ArticleFetchJob,
    result:FetchFullArticleResult
):Promise<void> {
    const id = env.USER_DO.idFromString(job.objectId)
    const stub = env.USER_DO.get(id)
    const payload = 'html' in result ?
        {
            html: result.html,
            fetchedAt: result.fetchedAt,
            status: result.status
        } :
        { status: result.status }
    const response = await stub.fetch(new Request(
        `http://do/internal/full-content/items/${job.itemId}`,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload)
        }
    ))
    if (!response.ok) {
        throw new Error(`Full-content store failed: ${response.status}`)
    }
}

async function handleMessage (
    message:QueueMessageLike,
    env:ArticleFetchConsumerEnv,
    deps:ArticleFetchConsumerDeps
):Promise<void> {
    if (!isArticleFetchJob(message.body)) {
        message.ack()
        return
    }
    const job = message.body
    const result = await deps.fetchArticle(job.link)
    await storeFullContent(env, job, result)
    // Phase 2 adds: enqueue body-image blur jobs here.
    message.ack()
}

export async function handleArticleFetchQueueBatch (
    batch:QueueBatchLike,
    env:ArticleFetchConsumerEnv,
    deps:ArticleFetchConsumerDeps
):Promise<void> {
    for (const message of batch.messages) {
        await handleMessage(message, env, deps)
    }
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `esbuild ./test/article-fetch-consumer.ts --bundle --platform=node --format=esm | node --input-type=module | tap-spec`
Expected: PASS (both tests).

- [ ] **Step 5: Register the node test in run-all-tests**

In `test/run-all-tests.mjs`, add to the node-platform group (alongside
the other `esbuild ... --platform=node ... | tap-spec` entries):

```js
[
    'esbuild ./test/article-fetch-consumer.ts --bundle',
    '--platform=node --format=esm',
    '| node --input-type=module | tap-spec'
].join(' '),
```

- [ ] **Step 6: Commit**

```bash
git add src/server/article-fetch-consumer.ts test/article-fetch-consumer.ts test/run-all-tests.mjs
git commit -m "feat: article-fetch queue consumer (fetch + store)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.5: Enqueue article fetches for summary-only new items (TDD predicate)

**Files:**
- Create: `src/server/article-prefetch-eligible.ts`
- Create: `test/article-prefetch-eligible.ts`
- Modify: `test/browser-tests.ts`
- Modify: `src/server/durable-objects/index.ts` (call site + new method)

- [ ] **Step 1: Write the failing test for the eligibility predicate**

Create `test/article-prefetch-eligible.ts`:

```ts
import { test } from '@substrate-system/tapzero'
import {
    isPrefetchEligible
} from '../src/server/article-prefetch-eligible.js'

const longBody = '<p>' + 'word '.repeat(600) + '</p>'

test('eligible: short body + link + no full_content', t => {
    t.ok(isPrefetchEligible({
        link: 'https://x/a', content: '<p>teaser</p>',
        description: null, full_content: null
    }), 'summary-only item is eligible')
})

test('not eligible: no link', t => {
    t.ok(!isPrefetchEligible({
        link: null, content: '<p>teaser</p>',
        description: null, full_content: null
    }), 'no link -> not eligible')
})

test('not eligible: full content already present in feed body', t => {
    t.ok(!isPrefetchEligible({
        link: 'https://x/a', content: longBody,
        description: null, full_content: null
    }), 'long feed body -> not summary-only -> not eligible')
})

test('not eligible: already has full_content', t => {
    t.ok(!isPrefetchEligible({
        link: 'https://x/a', content: '<p>teaser</p>',
        description: null, full_content: '<p>stored</p>'
    }), 'already fetched -> not eligible')
})
```

- [ ] **Step 2: Run it; verify it fails**

Run: `esbuild ./test/article-prefetch-eligible.ts --bundle | tapout`
Expected: FAIL — no matching export.

- [ ] **Step 3: Implement the predicate (reuse `isSummaryOnly`)**

Create `src/server/article-prefetch-eligible.ts`:

```ts
import { isSummaryOnly } from '../shared/article-detect.js'

export interface PrefetchCandidate {
    link:string|null
    content:string|null
    description:string|null
    full_content:string|null
}

export function isPrefetchEligible (item:PrefetchCandidate):boolean {
    if (item.full_content && item.full_content.length > 0) return false
    return isSummaryOnly({
        link: item.link,
        content: item.content,
        description: item.description
    })
}
```

(Verify `isSummaryOnly`'s exact param shape in
`src/shared/article-detect.ts`; it accepts `{ link, content,
description }`. Adjust the call if the field names differ.)

- [ ] **Step 4: Run it; verify it passes**

Run: `esbuild ./test/article-prefetch-eligible.ts --bundle | tapout`
Expected: PASS.

- [ ] **Step 5: Register the test**

In `test/browser-tests.ts`, add after `import './article-fetch-job.js'`:

```ts
import './article-prefetch-eligible.js'
```

- [ ] **Step 6: Add the enqueue method + call it from the poll**

In `src/server/durable-objects/index.ts`, add a private method (near
`updateNewItemThumbnails`):

```ts
private async enqueueArticleFetches (
    items:NewFeedItem[]
):Promise<void> {
    const env:Env|undefined = this.env
    if (!env?.ARTICLE_FETCH_QUEUE || items.length === 0) return

    for (const item of items) {
        if (!item.link) continue
        const row = this.sql.exec(
            `SELECT content, description, full_content
                FROM items WHERE id = ?`,
            item.id
        ).one() as {
            content:string|null
            description:string|null
            full_content:string|null
        } | null
        if (!row) continue
        if (!isPrefetchEligible({
            link: item.link,
            content: row.content,
            description: row.description,
            full_content: row.full_content
        })) continue

        await env.ARTICLE_FETCH_QUEUE.send({
            itemId: item.id,
            link: item.link,
            objectId: this.ctx.id.toString()
        } satisfies ArticleFetchJob)
    }
}
```

Add the imports at the top of the file:

```ts
import { isPrefetchEligible } from '../article-prefetch-eligible.js'
import type { ArticleFetchJob } from '../article-fetch-job.js'
```

(Match the existing relative-import depth used for other
`../server/...` siblings in this file; these live in `src/server/`, so
from `src/server/durable-objects/index.ts` the path is `../`.)

Then, at the call site right after `await
this.updateNewItemThumbnails(newItems)` (~line 1764), add:

```ts
    await this.enqueueArticleFetches(newItems)
```

- [ ] **Step 7: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server/article-prefetch-eligible.ts test/article-prefetch-eligible.ts test/browser-tests.ts src/server/durable-objects/index.ts
git commit -m "feat: enqueue body pre-fetch for summary-only new items

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.6: Route queue batches by queue name

**Files:**
- Modify: `src/server/index.ts` (`worker.queue()`, ~2060-2071)

- [ ] **Step 1: Branch on `batch.queue`**

Replace the `worker.queue` handler body with:

```ts
const worker = Object.assign(app, {
    async queue (batch:MessageBatch<unknown>, env:Env):Promise<void> {
        if (batch.queue.startsWith('article-fetch-jobs')) {
            const mod = await import('./article-fetch-consumer.js')
            await mod.handleArticleFetchQueueBatch(
                batch,
                env,
                mod.createArticleFetchConsumerDeps()
            )
            return
        }
        const runtime = await import(
            './blurhash-runtime.js'
        ) as typeof BlurhashRuntime
        await handleBlurhashQueueBatch(
            batch,
            env,
            runtime.createBlurhashConsumerDeps()
        )
    }
})
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 3: Run the broader suite to confirm no regressions**

Run: `npm test`
Expected: PASS (exit 0), including the new node + browser unit tests.

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: route queue batches by queue name

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# PHASE 2 — Body-image blur compute + storage/sync

## Task 2.1: Add `full_content_images` column (schema + DO migration + client)

**Files:**
- Modify: `src/shared/schema.ts` (items CREATE TABLE)
- Modify: `src/server/durable-objects/index.ts`
  (`USER_DO_MIGRATION_VERSION`, migration runner, new migrate method,
  `ITEM_COLUMNS`)
- Modify: `src/client/db/pull-sync.ts` (`ensureItemFullContentColumns`,
  `upsertItem`)
- Modify: `src/client/db/types.ts` (`Item`)

- [ ] **Step 1: Add the column to the canonical schema**

In `src/shared/schema.ts`, in the `items` CREATE TABLE, add after
`full_content_status TEXT,`:

```sql
    full_content_images TEXT,
```

- [ ] **Step 2: Bump migration version + add migrate method (DO)**

In `src/server/durable-objects/index.ts`:

Change `const USER_DO_MIGRATION_VERSION = 6` to `= 7`.

Add to the migration runner block (after
`this.migrateAddItemFullContent()`):

```ts
    this.migrateAddFullContentImages()
```

Add the method (mirroring `migrateAddItemFullContent`):

```ts
private migrateAddFullContentImages () {
    const cols = this.sql.exec('PRAGMA table_info(items)').toArray()
    const has = (name:string) => cols.some(
        (col:unknown) => (col as { name:string }).name === name
    )
    if (!has('full_content_images')) {
        this.sql.exec(
            'ALTER TABLE items ADD COLUMN full_content_images TEXT'
        )
    }
}
```

Add `items.full_content_images` to the `ITEM_COLUMNS` constant (so the
sync SELECT returns it):

```ts
const ITEM_COLUMNS = `
    items.id, items.feed_id, items.guid, items.title, items.link,
    items.description, items.content, items.author, items.pub_date,
    items.thumbnail_url, items.og_image_url, items.blurhash,
    items.image_width, items.image_height, items.is_read,
    items.is_starred, items.created_at, items.updated_at,
    items.full_content, items.full_content_fetched_at,
    items.full_content_status, items.full_content_images
`
```

- [ ] **Step 3: Add the column to the client migration**

In `src/client/db/pull-sync.ts`, in `ensureItemFullContentColumns`,
after the `full_content_status` block:

```ts
    if (!has('full_content_images')) {
        await execDb(
            db,
            'ALTER TABLE items ADD COLUMN full_content_images TEXT'
        )
    }
```

- [ ] **Step 4: Add the column to `upsertItem`**

In `src/client/db/pull-sync.ts` `upsertItem`:
- Add `full_content_images` to the INSERT column list and one more `?`
  to the VALUES tuple.
- In the `ON CONFLICT ... DO UPDATE SET`, add (it is not body-cached
  content, so set it unconditionally like the other image columns):
  `full_content_images = excluded.full_content_images,`
- Add to the `bind` array, after the `full_content_status` bind:
  `(item.full_content_images as string|null) ?? null,`

The resulting INSERT column list:

```sql
(id, feed_id, guid, title, link, description, content,
 author, pub_date, thumbnail_url, og_image_url, blurhash,
 image_width, image_height, is_read, is_starred, created_at,
 updated_at,
 full_content, full_content_fetched_at, full_content_status,
 full_content_images)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?)
```

- [ ] **Step 5: Add the field to the client `Item` type**

In `src/client/db/types.ts`, add after `full_content_status?:...`:

```ts
    full_content_images?:string|null
```

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/schema.ts src/server/durable-objects/index.ts src/client/db/pull-sync.ts src/client/db/types.ts
git commit -m "feat: add full_content_images column + migration v7

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.2: Extend `BlurhashJob` with `target`

**Files:**
- Modify: `src/server/blurhash.ts`

- [ ] **Step 1: Add the optional field**

In `src/server/blurhash.ts`, change `BlurhashJob` to:

```ts
export interface BlurhashJob {
    imageUrl:string
    itemId:number
    objectId:string
    target?:'thumbnail'|'body'
}
```

(Absent/`'thumbnail'` keeps existing behavior. The `isBlurhashJob`
guard lives in `blurhash-consumer.ts`; do not tighten it to require
`target` — it stays optional.)

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server/blurhash.ts
git commit -m "feat: add optional target to BlurhashJob

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.3: Server-side `extractImageUrls(html)` (TDD, regex)

**Files:**
- Create: `src/server/extract-image-urls.ts`
- Create: `test/extract-image-urls.ts`
- Modify: `test/run-all-tests.mjs`

- [ ] **Step 1: Write the failing test (node-platform; regex, no DOM)**

Create `test/extract-image-urls.ts`:

```ts
import { test } from '@substrate-system/tapzero'
import { extractImageUrls } from '../src/server/extract-image-urls.js'

test('extractImageUrls - finds http(s) img srcs', t => {
    const urls = extractImageUrls(
        '<p>x</p><img src="https://x/a.jpg"> ' +
        "<img src='http://y/b.png' alt='b'>"
    )
    t.deepEqual(urls, ['https://x/a.jpg', 'http://y/b.png'], 'both found')
})

test('extractImageUrls - dedupes', t => {
    const urls = extractImageUrls(
        '<img src="https://x/a.jpg"><img src="https://x/a.jpg">'
    )
    t.deepEqual(urls, ['https://x/a.jpg'], 'deduped')
})

test('extractImageUrls - skips data: and non-http srcs', t => {
    const urls = extractImageUrls(
        '<img src="data:image/png;base64,AAA">' +
        '<img src="/relative.jpg">' +
        '<img src="https://x/a.jpg">'
    )
    t.deepEqual(urls, ['https://x/a.jpg'], 'only absolute http(s) kept')
})

test('extractImageUrls - none', t => {
    t.deepEqual(extractImageUrls('<p>no images</p>'), [], 'empty array')
})
```

- [ ] **Step 2: Run it; verify it fails**

Run: `esbuild ./test/extract-image-urls.ts --bundle --platform=node --format=esm | node --input-type=module | tap-spec`
Expected: FAIL — no matching export.

- [ ] **Step 3: Implement (regex; Workers-safe)**

Create `src/server/extract-image-urls.ts`:

```ts
const IMG_SRC = /<img\b[^>]*?\ssrc\s*=\s*("([^"]*)"|'([^']*)')/gi

export function extractImageUrls (html:string):string[] {
    if (!html) return []
    const seen = new Set<string>()
    const out:string[] = []
    let m:RegExpExecArray | null
    while ((m = IMG_SRC.exec(html)) !== null) {
        const raw = (m[2] ?? m[3] ?? '').trim()
        if (!/^https?:\/\//i.test(raw)) continue
        if (seen.has(raw)) continue
        seen.add(raw)
        out.push(raw)
    }
    return out
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `esbuild ./test/extract-image-urls.ts --bundle --platform=node --format=esm | node --input-type=module | tap-spec`
Expected: PASS.

- [ ] **Step 5: Register the node test**

In `test/run-all-tests.mjs`, add to the node-platform group:

```js
[
    'esbuild ./test/extract-image-urls.ts --bundle',
    '--platform=node --format=esm',
    '| node --input-type=module | tap-spec'
].join(' '),
```

- [ ] **Step 6: Commit**

```bash
git add src/server/extract-image-urls.ts test/extract-image-urls.ts test/run-all-tests.mjs
git commit -m "feat: regex extractImageUrls for article bodies

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.4: DO endpoint `/internal/blurhash/body-items/:id` (merge map)

**Files:**
- Create: `src/server/full-content-images.ts` (pure merge helper)
- Create: `test/full-content-images.ts`
- Modify: `test/browser-tests.ts`
- Modify: `src/server/durable-objects/index.ts` (new route)

- [ ] **Step 1: Write the failing test for the pure merge helper**

Create `test/full-content-images.ts`:

```ts
import { test } from '@substrate-system/tapzero'
import {
    mergeFullContentImage
} from '../src/server/full-content-images.js'

test('mergeFullContentImage - into empty/null', t => {
    const out = mergeFullContentImage(null, 'https://x/a.jpg', {
        blurhash: 'LEHV6n', w: 640, h: 480
    })
    t.deepEqual(JSON.parse(out), {
        'https://x/a.jpg': { blurhash: 'LEHV6n', w: 640, h: 480 }
    }, 'creates map')
})

test('mergeFullContentImage - adds without clobbering', t => {
    const first = mergeFullContentImage(null, 'https://x/a.jpg', {
        blurhash: 'A', w: 1, h: 2
    })
    const second = mergeFullContentImage(first, 'https://x/b.jpg', {
        blurhash: 'B', w: 3, h: 4
    })
    t.deepEqual(JSON.parse(second), {
        'https://x/a.jpg': { blurhash: 'A', w: 1, h: 2 },
        'https://x/b.jpg': { blurhash: 'B', w: 3, h: 4 }
    }, 'both entries present')
})

test('mergeFullContentImage - tolerates corrupt prior json', t => {
    const out = mergeFullContentImage('{not json', 'https://x/a.jpg', {
        blurhash: 'A', w: 1, h: 2
    })
    t.deepEqual(JSON.parse(out), {
        'https://x/a.jpg': { blurhash: 'A', w: 1, h: 2 }
    }, 'resets to a fresh map')
})
```

- [ ] **Step 2: Run it; verify it fails**

Run: `esbuild ./test/full-content-images.ts --bundle | tapout`
Expected: FAIL — no matching export.

- [ ] **Step 3: Implement the merge helper**

Create `src/server/full-content-images.ts`:

```ts
export interface BodyImageEntry {
    blurhash:string
    w:number
    h:number
}

export type FullContentImageMap = Record<string, BodyImageEntry>

export function parseImageMap (value:string|null):FullContentImageMap {
    if (!value) return {}
    try {
        const parsed = JSON.parse(value) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as FullContentImageMap
        }
        return {}
    } catch {
        return {}
    }
}

export function mergeFullContentImage (
    prior:string|null,
    url:string,
    entry:BodyImageEntry
):string {
    const map = parseImageMap(prior)
    map[url] = entry
    return JSON.stringify(map)
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `esbuild ./test/full-content-images.ts --bundle | tapout`
Expected: PASS.

- [ ] **Step 5: Register the test**

In `test/browser-tests.ts`, add:

```ts
import './full-content-images.js'
```

- [ ] **Step 6: Add the DO route (uses the merge helper)**

In `src/server/durable-objects/index.ts`, after the
`/internal/full-content/items/:id` route, add:

```ts
app.post('/internal/blurhash/body-items/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id < 1) {
        return c.json({ error: 'Invalid item id' }, 400)
    }
    const body = await c.req.json<{
        url?:unknown
        blurhash?:unknown
        width?:unknown
        height?:unknown
    }>()
    if (
        typeof body.url !== 'string' ||
        typeof body.blurhash !== 'string' ||
        typeof body.width !== 'number' ||
        typeof body.height !== 'number'
    ) {
        return c.json({ error: 'Invalid body image metadata' }, 400)
    }

    const row = this.sql.exec(
        'SELECT full_content_images FROM items WHERE id = ?', id
    ).one() as { full_content_images:string|null } | null
    if (!row) return c.json({ error: 'Item not found' }, 404)

    const merged = mergeFullContentImage(
        row.full_content_images,
        body.url,
        { blurhash: body.blurhash, w: body.width, h: body.height }
    )
    this.sql.exec(
        'UPDATE items SET full_content_images = ? WHERE id = ?',
        merged,
        id
    )
    this.bumpFeedVersion()
    return new Response(null, { status: 204 })
})
```

Add the import at the top of the file:

```ts
import { mergeFullContentImage } from '../full-content-images.js'
```

- [ ] **Step 7: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server/full-content-images.ts test/full-content-images.ts test/browser-tests.ts src/server/durable-objects/index.ts
git commit -m "feat: internal endpoint to merge body-image blurhashes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.5: Route blur write-back by `target`

**Files:**
- Modify: `src/server/blurhash-consumer.ts` (`writeItemBlurhash`)
- Create: `test/blurhash-target-routing.ts`
- Modify: `test/run-all-tests.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/blurhash-target-routing.ts`. It drives
`handleBlurhashQueueBatch` with a cache-hit (so no Photon decode runs)
and a fake `USER_DO`, asserting the write-back path depends on
`target`.

```ts
import { test } from '@substrate-system/tapzero'
import {
    handleBlurhashQueueBatch
} from '../src/server/blurhash-consumer.js'

function env (calls:string[]) {
    const entry = JSON.stringify({
        blurhash: 'A', image_width: 10, image_height: 20
    })
    return {
        BLURHASH_KV: {
            get: async () => entry,   // cache hit -> no decode needed
            put: async () => {}
        },
        USER_DO: {
            idFromString: (s:string) => ({ toString: () => s }),
            get: () => ({
                fetch: async (req:Request) => {
                    calls.push(new URL(req.url).pathname)
                    return new Response(null, { status: 204 })
                }
            })
        }
    } as never
}
const noDeps = {} as never

test('thumbnail target -> /internal/blurhash/items/:id', async t => {
    const calls:string[] = []
    await handleBlurhashQueueBatch({
        messages: [{
            body: { imageUrl: 'https://x/a.jpg', itemId: 5,
                objectId: 'o' },
            ack: () => {}, retry: () => {}
        }]
    } as never, env(calls), noDeps)
    t.deepEqual(calls, ['/internal/blurhash/items/5'], 'thumbnail path')
})

test('body target -> /internal/blurhash/body-items/:id', async t => {
    const calls:string[] = []
    await handleBlurhashQueueBatch({
        messages: [{
            body: { imageUrl: 'https://x/a.jpg', itemId: 5,
                objectId: 'o', target: 'body' },
            ack: () => {}, retry: () => {}
        }]
    } as never, env(calls), noDeps)
    t.deepEqual(calls, ['/internal/blurhash/body-items/5'], 'body path')
})
```

- [ ] **Step 2: Run it; verify it fails**

Run: `esbuild ./test/blurhash-target-routing.ts --bundle --platform=node --format=esm | node --input-type=module | tap-spec`
Expected: FAIL — body target currently posts to the thumbnail endpoint.

- [ ] **Step 3: Update `writeItemBlurhash` to branch on target**

In `src/server/blurhash-consumer.ts`, replace `writeItemBlurhash` with:

```ts
async function writeItemBlurhash (
    env:BlurhashConsumerEnv,
    job:BlurhashJob,
    entry:BlurhashCacheEntry
):Promise<void> {
    const id = env.USER_DO.idFromString(job.objectId)
    const stub = env.USER_DO.get(id)

    const isBody = job.target === 'body'
    const url = isBody ?
        `http://do/internal/blurhash/body-items/${job.itemId}` :
        `http://do/internal/blurhash/items/${job.itemId}`
    const payload = isBody ?
        {
            url: job.imageUrl,
            blurhash: entry.blurhash,
            width: entry.image_width,
            height: entry.image_height
        } :
        entry

    const response = await stub.fetch(new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
    }))

    if (!response.ok) {
        throw new Error(`BlurHash item update failed: ${response.status}`)
    }
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `esbuild ./test/blurhash-target-routing.ts --bundle --platform=node --format=esm | node --input-type=module | tap-spec`
Expected: PASS (both tests).

- [ ] **Step 5: Register the node test**

In `test/run-all-tests.mjs`, add to the node-platform group:

```js
[
    'esbuild ./test/blurhash-target-routing.ts --bundle',
    '--platform=node --format=esm',
    '| node --input-type=module | tap-spec'
].join(' '),
```

- [ ] **Step 6: Commit**

```bash
git add src/server/blurhash-consumer.ts test/blurhash-target-routing.ts test/run-all-tests.mjs
git commit -m "feat: route blur write-back by target (thumbnail vs body)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.6: Article-fetch consumer enqueues body blur jobs

**Files:**
- Modify: `src/server/article-fetch-consumer.ts`
- Modify: `test/article-fetch-consumer.ts`

- [ ] **Step 1: Extend the test to assert body blur jobs are enqueued**

Add to `test/article-fetch-consumer.ts`:

```ts
test('article-fetch consumer enqueues body blur jobs', async t => {
    const sent:unknown[] = []
    const env = {
        ARTICLE_FETCH_QUEUE: { send: async () => {} },
        BLURHASH_QUEUE: { send: async (j:unknown) => { sent.push(j) } },
        USER_DO: {
            idFromString: (s:string) => ({ toString: () => s }),
            get: () => ({ fetch: async () =>
                new Response(null, { status: 204 }) })
        }
    } as never
    await handleArticleFetchQueueBatch({
        queue: 'article-fetch-jobs',
        messages: [{
            body: { itemId: 9, link: 'https://x/a', objectId: 'o' },
            ack: () => {}, retry: () => {}
        }]
    } as never, env, {
        fetchArticle: async () => ({
            status: 'succeeded',
            html: '<img src="https://x/1.jpg"><img src="https://x/2.jpg">',
            fetchedAt: '2026-06-07T00:00:00.000Z'
        })
    })
    t.equal(sent.length, 2, 'one blur job per image')
    t.deepEqual(sent[0], {
        imageUrl: 'https://x/1.jpg', itemId: 9, objectId: 'o',
        target: 'body'
    }, 'job carries target body')
})

test('article-fetch consumer enqueues nothing on failure', async t => {
    const sent:unknown[] = []
    const env = {
        ARTICLE_FETCH_QUEUE: { send: async () => {} },
        BLURHASH_QUEUE: { send: async (j:unknown) => { sent.push(j) } },
        USER_DO: {
            idFromString: (s:string) => ({ toString: () => s }),
            get: () => ({ fetch: async () =>
                new Response(null, { status: 204 }) })
        }
    } as never
    await handleArticleFetchQueueBatch({
        queue: 'article-fetch-jobs',
        messages: [{
            body: { itemId: 9, link: 'https://x/a', objectId: 'o' },
            ack: () => {}, retry: () => {}
        }]
    } as never, env, {
        fetchArticle: async () => ({ status: 'failed_network' })
    })
    t.equal(sent.length, 0, 'no blur jobs when fetch failed')
})
```

Also update the `ArticleFetchConsumerEnv` in the FIRST two tests'
`fakeEnv` to include `BLURHASH_QUEUE: { send: async () => {} }` (it now
needs that binding).

- [ ] **Step 2: Run it; verify the new tests fail**

Run: `esbuild ./test/article-fetch-consumer.ts --bundle --platform=node --format=esm | node --input-type=module | tap-spec`
Expected: FAIL — no body blur jobs are enqueued yet.

- [ ] **Step 3: Implement the enqueue in the consumer**

In `src/server/article-fetch-consumer.ts`:

Add to `ArticleFetchConsumerEnv`:

```ts
    BLURHASH_QUEUE:{ send:(message:unknown) => Promise<void> }
```

Add the import:

```ts
import { extractImageUrls } from './extract-image-urls.js'
```

Replace the Phase-1 comment in `handleMessage` with the enqueue, and
cap per-article images:

```ts
async function handleMessage (
    message:QueueMessageLike,
    env:ArticleFetchConsumerEnv,
    deps:ArticleFetchConsumerDeps
):Promise<void> {
    if (!isArticleFetchJob(message.body)) {
        message.ack()
        return
    }
    const job = message.body
    const result = await deps.fetchArticle(job.link)
    await storeFullContent(env, job, result)

    if ('html' in result) {
        const urls = extractImageUrls(result.html).slice(
            0,
            MAX_BODY_BLUR_IMAGES
        )
        for (const imageUrl of urls) {
            await env.BLURHASH_QUEUE.send({
                imageUrl,
                itemId: job.itemId,
                objectId: job.objectId,
                target: 'body'
            })
        }
    }
    message.ack()
}
```

Add the cap constant near the top of the file:

```ts
const MAX_BODY_BLUR_IMAGES = 30
```

- [ ] **Step 4: Run it; verify all pass**

Run: `esbuild ./test/article-fetch-consumer.ts --bundle --platform=node --format=esm | node --input-type=module | tap-spec`
Expected: PASS (all four tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/article-fetch-consumer.ts test/article-fetch-consumer.ts
git commit -m "feat: enqueue body-image blur jobs after pre-fetch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# PHASE 3 — Client blur-hash render

## Task 3.0: Extract `blurhashDecodeSize` into a shared module

So the client swap can reuse the decode-size math without importing the
whole `item-row` Preact component.

**Files:**
- Create: `src/client/blurhash-decode-size.ts`
- Modify: `src/client/components/item-row.ts`

- [ ] **Step 1: Create the shared module**

Create `src/client/blurhash-decode-size.ts` by moving the existing
definitions out of `item-row.ts` verbatim:

```ts
export const BLURHASH_DECODE_MAX = 32

export function blurhashDecodeSize (
    width:number,
    height:number
):{ width:number; height:number } {
    if (width >= height) {
        return {
            width: BLURHASH_DECODE_MAX,
            height: Math.max(
                1,
                Math.round(BLURHASH_DECODE_MAX * height / width)
            )
        }
    }
    return {
        width: Math.max(
            1,
            Math.round(BLURHASH_DECODE_MAX * width / height)
        ),
        height: BLURHASH_DECODE_MAX
    }
}
```

- [ ] **Step 2: Update `item-row.ts` to import + re-export**

In `src/client/components/item-row.ts`, delete the local
`BLURHASH_DECODE_MAX` const and `blurhashDecodeSize` function, and add an
import + re-export so existing importers keep working:

```ts
import {
    BLURHASH_DECODE_MAX,
    blurhashDecodeSize
} from '../blurhash-decode-size.js'

export { BLURHASH_DECODE_MAX, blurhashDecodeSize }
```

(Place the import with the other imports; keep the re-export near where
the definitions used to be.)

- [ ] **Step 3: Typecheck + lint + reader/item-row browser tests**

Run: `npx tsc --noEmit && npm run lint && npm run test:browser`
Expected: PASS — `item-row`/`feed-reader-render-state` unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/client/blurhash-decode-size.ts src/client/components/item-row.ts
git commit -m "refactor: extract blurhashDecodeSize to shared module

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3.1: `addBlurHashPlaceholders(html, map)` (TDD, DOMParser)

**Files:**
- Create: `src/client/blur-hash-swap.ts`
- Create: `test/blur-hash-swap.ts`
- Modify: `test/browser-tests.ts`

- [ ] **Step 1: Write the failing test (browser; DOMParser)**

Create `test/blur-hash-swap.ts`:

```ts
import { test } from '@substrate-system/tapzero'
import {
    addBlurHashPlaceholders
} from '../src/client/blur-hash-swap.js'

const map = {
    'https://x/a.jpg': { blurhash: 'LEHV6n', w: 640, h: 480 }
}

test('swaps img with a known hash to blur-hash', t => {
    const out = addBlurHashPlaceholders(
        '<img src="https://x/a.jpg" alt="cat">', map
    )
    const doc = new DOMParser().parseFromString(out, 'text/html')
    const bh = doc.querySelector('blur-hash')
    t.ok(bh, 'blur-hash element present')
    t.equal(bh?.getAttribute('placeholder'), 'LEHV6n', 'placeholder set')
    t.equal(bh?.getAttribute('src'), 'https://x/a.jpg', 'src copied')
    t.equal(bh?.getAttribute('alt'), 'cat', 'alt copied')
    t.equal(bh?.getAttribute('loading'), 'lazy', 'lazy set')
    t.equal(doc.querySelector('img'), null, 'original img replaced')
})

test('leaves img without a hash untouched', t => {
    const html = '<img src="https://y/none.jpg">'
    const out = addBlurHashPlaceholders(html, map)
    const doc = new DOMParser().parseFromString(out, 'text/html')
    t.ok(doc.querySelector('img'), 'img kept')
    t.equal(doc.querySelector('blur-hash'), null, 'no blur-hash')
})

test('empty map returns input unchanged', t => {
    const html = '<img src="https://x/a.jpg">'
    t.equal(addBlurHashPlaceholders(html, {}), html, 'unchanged')
})

test('idempotent', t => {
    const once = addBlurHashPlaceholders('<img src="https://x/a.jpg">', map)
    const twice = addBlurHashPlaceholders(once, map)
    t.equal(twice, once, 'second pass identical')
})

test('sets decode size + aspect-ratio from real dims', t => {
    const out = addBlurHashPlaceholders('<img src="https://x/a.jpg">', map)
    const doc = new DOMParser().parseFromString(out, 'text/html')
    const bh = doc.querySelector('blur-hash')
    // 640x480 -> decode width capped at 32, height 24
    t.equal(bh?.getAttribute('width'), '32', 'decode width')
    t.equal(bh?.getAttribute('height'), '24', 'decode height')
    t.ok(
        (bh?.getAttribute('style') || '').includes('aspect-ratio: 640 / 480'),
        'aspect-ratio from real dims'
    )
})
```

- [ ] **Step 2: Run it; verify it fails**

Run: `esbuild ./test/blur-hash-swap.ts --bundle | tapout`
Expected: FAIL — no matching export.

- [ ] **Step 3: Implement**

Create `src/client/blur-hash-swap.ts`:

```ts
import { blurhashDecodeSize } from './blurhash-decode-size.js'

export interface BodyImageEntry {
    blurhash:string
    w:number
    h:number
}

function isValid (e:BodyImageEntry|undefined):e is BodyImageEntry {
    return Boolean(
        e &&
        typeof e.blurhash === 'string' &&
        e.blurhash.length > 0 &&
        Number.isFinite(e.w) && e.w > 0 &&
        Number.isFinite(e.h) && e.h > 0
    )
}

export function addBlurHashPlaceholders (
    html:string,
    imageMap:Record<string, BodyImageEntry>
):string {
    if (!html) return html
    if (!imageMap || Object.keys(imageMap).length === 0) return html

    const doc = new DOMParser().parseFromString(html, 'text/html')
    const imgs = Array.from(doc.body.querySelectorAll('img'))
    let changed = false

    for (const img of imgs) {
        const src = (img.getAttribute('src') || '').trim()
        const entry = imageMap[src]
        if (!isValid(entry)) continue

        const decode = blurhashDecodeSize(entry.w, entry.h)
        const el = doc.createElement('blur-hash')
        el.setAttribute('placeholder', entry.blurhash)
        el.setAttribute('src', src)
        const alt = img.getAttribute('alt')
        if (alt !== null) el.setAttribute('alt', alt)
        el.setAttribute('width', String(decode.width))
        el.setAttribute('height', String(decode.height))
        el.setAttribute('loading', 'lazy')
        el.setAttribute('style', `aspect-ratio: ${entry.w} / ${entry.h}`)
        img.replaceWith(el)
        changed = true
    }

    return changed ? doc.body.innerHTML : html
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `esbuild ./test/blur-hash-swap.ts --bundle | tapout`
Expected: PASS (all five tests).

- [ ] **Step 5: Register the test**

In `test/browser-tests.ts`, add:

```ts
import './blur-hash-swap.js'
```

- [ ] **Step 6: Commit**

```bash
git add src/client/blur-hash-swap.ts test/blur-hash-swap.ts test/browser-tests.ts
git commit -m "feat: client transform swapping img to blur-hash

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3.2: Wire the swap into the article reader

**Files:**
- Modify: `src/client/routes/item-reader.ts`

- [ ] **Step 1: Add imports + register the element**

In `src/client/routes/item-reader.ts`:

Add the imports (top of file, with the other imports):

```ts
import { BlurHash } from '@substrate-system/blur-hash'
import { addBlurHashPlaceholders } from '../blur-hash-swap.js'
```

Register the custom element once at module scope (after imports,
mirroring `item-row.ts`):

```ts
BlurHash.define()
```

- [ ] **Step 2: Parse the map and extend the memo pipeline**

Replace the current article-HTML block (~lines 62-69):

```ts
    const rawHtml = item.full_content ||
        item.content ||
        item.description ||
        ''
    const articleHtml = useMemo(
        () => sanitizeHtml(addImageLoadingHints(rawHtml)),
        [rawHtml]
    )
```

with:

```ts
    const rawHtml = item.full_content ||
        item.content ||
        item.description ||
        ''
    const imagesJson = item.full_content_images || ''
    const articleHtml = useMemo(() => {
        const sanitized = sanitizeHtml(addImageLoadingHints(rawHtml))
        let map = {}
        try {
            map = imagesJson ? JSON.parse(imagesJson) : {}
        } catch {
            map = {}
        }
        return addBlurHashPlaceholders(sanitized, map)
    }, [rawHtml, imagesJson])
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 4: Confirm the reader browser tests still pass**

Run: `npm run test:browser`
Expected: PASS — `item-reader-render-state` and the new swap tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/routes/item-reader.ts
git commit -m "feat: render blur-hash placeholders in article bodies

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3.3: Style `.article-body blur-hash`

**Files:**
- Modify: `src/client/routes/item-reader.css`

- [ ] **Step 1: Add the rule**

In `src/client/routes/item-reader.css`, inside the `.article-body`
nested block, directly after the existing `& img { ... }` rule, add:

```css
        & blur-hash {
            display: block;
            max-width: 100%;
            height: auto;
            margin: 1rem 0;
            background-color: var(--color-placeholder);
        }
```

The `aspect-ratio` is set inline per element by the swap transform, so
the box is reserved at the real image ratio; the gray
`--color-placeholder` shows for the instant before the blur paints.

- [ ] **Step 2: Confirm the build compiles the CSS**

Run: `npm run build`
Expected: PASS (Vite + lightningcss, no CSS errors).

- [ ] **Step 3: Manual visual check**

Run `npm start`, open a previously-polled summary-only article that has
body images (e.g. a Wired post). Confirm: a blurred placeholder shows at
the correct box size, then resolves to the image; images without a hash
still show the 037 gray box; no layout jump.

- [ ] **Step 4: Commit**

```bash
git add src/client/routes/item-reader.css
git commit -m "feat: style article-body blur-hash placeholders

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Full verification

- [ ] **Step 1: Run the full suite + lint**

Run: `npm test && npm run lint`
Expected: PASS (exit 0), including every new unit test.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Scope check**

Run: `git diff --stat 037-article-image-placeholders...HEAD`
Expected: only the files touched by Phases 1-3 (wrangler.jsonc, the new
`src/server/*` and `src/client/*` modules, the DO/index/schema/pull-sync
edits, the CSS, and the new `test/*` files + `test/browser-tests.ts` +
`test/run-all-tests.mjs`). No eslint config, no unrelated changes.

---

## Self-Review Notes

- **Spec coverage:** Phase 1 = eager pre-fetch (queue 1.1, job 1.2, store
  endpoint 1.3, consumer 1.4, poll enqueue 1.5, routing 1.6). Phase 2 =
  storage column + migration + sync (2.1), `target` (2.2), server image
  extractor (2.3), body write-back endpoint + merge (2.4), consumer
  write-back routing (2.5), body-blur enqueue (2.6). Phase 3 = client
  swap (3.1), wiring (3.2), CSS (3.3). Gray-box fallback preserved
  (3.1/3.2 only swap eligible imgs; 3.3 keeps `--color-placeholder`).
  src-matching contract honored (server `extractImageUrls` + client
  exact-src lookup both skip non-http(s)).
- **Server vs browser runtime:** every server module (1.2-1.6, 2.x) is
  regex/string-only — no `DOMParser`. Only the client swap (3.1) uses
  `DOMParser`, and it runs after DOMPurify.
- **Type consistency:** `ArticleFetchJob`, `BlurhashJob.target`,
  `BodyImageEntry { blurhash, w, h }`, and the `full_content_images`
  JSON shape are used identically across server merge (2.4), consumer
  (2.5/2.6), and client swap (3.1).
- **No placeholders:** every code/command step is concrete. Integration
  tests that touch the DO use fakes (no live DO needed); the live wiring
  is covered by `npm test` + manual check.
