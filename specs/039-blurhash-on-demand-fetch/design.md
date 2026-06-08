# Design: Blur-Hash for On-Demand Article Fetches

**Feature**: `039-blurhash-on-demand-fetch`
**Created**: 2026-06-07
**Status**: Approved (pending implementation)
**Builds on / completes**: `038-article-image-blurhash` (the body
blur-hash pipeline). This is the deferred piece called out in 038's
"Out of scope": *"opening an old article triggers the on-demand fetch
path, which Phase 2 can also enqueue body blur jobs from — noted but not
required for v1."*

## Problem

The 038 body blur-hash pipeline only ever fires from the **eager
pre-fetch** path: when polling detects a *new* summary-only item, the DO
enqueues an `ArticleFetchJob`; the article-fetch consumer stores the body
and enqueues `target:'body'` blur jobs
(`article-fetch-consumer.ts:71-82`).

The **on-demand** path — the one a reader actually hits when opening an
article (`item-reader.ts` `useEffect` → `State.fetchFullArticle` →
`POST items/:id/fetch-full` → DO route at
`durable-objects/index.ts:1489`) — fetches and stores `full_content`
but **never extracts image URLs and never enqueues blur jobs**. So
`full_content_images` stays empty, `addBlurHashPlaceholders` is a no-op,
and every such article renders plain `<img>` tags showing the gray
`var(--color-placeholder)` (the 037 fallback) while the network image
loads.

In practice this means blur hashes almost never appear: only items
*newly polled after the feature shipped* go through the eager path.
Observed in the local DO: of 70 items, only 2 (the two polled post-ship)
have a blur map; the other 68 — every article opened to read, including
the Madonna article that surfaced this — have `full_content_status =
succeeded` but an empty `full_content_images`.

## Goal

Make the body blur-hash work for **every** article a reader opens, not
just the small subset caught by eager polling. Concretely: the on-demand
fetch route must feed the same blur pipeline the eager path already uses,
including a cheap **lazy-fill** when opening an article whose body is
already cached but whose blur map is empty.

## Summary of decisions

- **Wire the on-demand path into the existing pipeline.** After the
  on-demand route writes `full_content`, enqueue one `target:'body'`
  blur job per extracted image — identical to what the article-fetch
  consumer already does. The blur consumer, KV cache, body write-back
  endpoint, schema, sync, and client render are all **unchanged**; this
  feature only adds the missing producer call.
- **Lazy-fill on open (chosen).** When the route is a cache hit (body
  already stored, `force` not set) **and** the stored blur map is empty,
  enqueue blur jobs from the *already-stored* HTML. No article re-fetch —
  it just re-reads the cached body and queues image hashing. This makes
  blur eventually appear for all already-fetched articles (incl. the 68
  existing ones) on a later visit, without a mass migration. This is the
  "no backfill migration, but it should always work" resolution.
- **No mass/eager backfill.** We do not iterate stored items to
  reprocess them; filling is driven entirely by the next open of each
  article (lazy).
- **Failure isolation.** Blur enqueue is best-effort: a queue `send`
  failure must never fail the `fetch-full` response — the article text is
  what the user is waiting for. Wrap enqueue in try/catch + log.
- **De-duplicate the producer.** Extract the "extract image URLs → send
  body blur jobs" logic (currently inline in the consumer) into one
  shared helper used by both the consumer and the on-demand route, so the
  two producers can't drift.

## Context (current code)

- **On-demand route**: `src/server/durable-objects/index.ts`
  `POST /items/:id/fetch-full` (~1489). Flow:
  - selects the row via `ITEM_COLUMNS` (~1510); `ITEM_COLUMNS` (def
    ~137) already includes `full_content`, `full_content_status`, and
    `full_content_images`.
  - **cache-hit early return** (~1524-1531): if `!force` and status is a
    success status and `full_content` is non-empty, returns the row
    as-is. *No enqueue today.* ← lazy-fill hooks in here.
  - throttle claim (~1533-1545).
  - fetch via `doFetchFullArticle(link)` (~1547); on `'html' in result`
    writes `full_content` / `full_content_fetched_at` /
    `full_content_status` (~1553-1562); else writes status only
    (~1563-1572). ← fresh-fetch enqueue hooks into the `'html'` branch.
  - re-selects and returns the updated row (~1574-1577).
- **Eager producer (reference impl)**:
  `src/server/article-fetch-consumer.ts` —
  `MAX_BODY_BLUR_IMAGES = 30` (line 8); after `writeFullContent`, the
  `if ('html' in result && result.html)` block (71-82) does
  `extractImageUrls(result.html).slice(0, MAX_BODY_BLUR_IMAGES)` then
  `BLURHASH_QUEUE.send({ imageUrl, itemId, objectId, target:'body' })`.
- **Extractor**: `extractImageUrls(html):string[]` —
  `src/server/extract-image-urls.ts:8` (finds `<img src>`, dedupes,
  skips non-http(s)/`data:`).
- **Job type**: `BlurhashJob { imageUrl, itemId, objectId, target? }` —
  `src/server/blurhash.ts:7-12` (`target?:'thumbnail'|'body'`).
- **DO bindings**: `Env.BLURHASH_QUEUE:Queue`
  (`durable-objects/index.ts:41`); the DO already enqueues blur jobs
  for thumbnails via `updateBlurhashFromCacheOrQueue` (~2128-2161),
  which uses `this.ctx.id.toString()` as `objectId` and the
  `satisfies BlurhashJob` send shape.
- **Downstream (unchanged)**: blur consumer routes `target:'body'` to
  the body write-back endpoint `POST /internal/blurhash/body-items/:id`
  (~736), which read-merge-writes the `full_content_images` JSON map
  (race-free; DO serializes). Client syncs the column and
  `addBlurHashPlaceholders` (`src/client/blur-hash-swap.ts`) performs the
  `<img>`→`<blur-hash>` swap.

## Architecture / data flow

```
reader opens article
  -> State.fetchFullArticle -> POST /items/:id/fetch-full (DO)

DO route:
  (A) fresh fetch (no cache, or force):
        write full_content
        NEW: enqueueBodyBlurJobs(BLURHASH_QUEUE, html, id, objectId)
  (B) cache hit (body already stored, !force):
        NEW: if full_content_images map is empty:
               enqueueBodyBlurJobs(BLURHASH_QUEUE, stored html, id, ...)
        return stored row (unchanged response shape)
  (both NEW calls are best-effort: try/catch, never fail the response)

BLURHASH_QUEUE -> blur consumer (UNCHANGED)
  -> encode + KV cache
  -> target:'body' -> POST /internal/blurhash/body-items/:id
       -> merge into items.full_content_images

client (UNCHANGED)
  -> next sync picks up full_content_images
  -> addBlurHashPlaceholders swaps eligible <img> -> <blur-hash>
```

The async nature is unchanged from 038: the *first* open of a fresh or
not-yet-hashed article still shows the gray box; blur appears on a later
render once the consumer has written the map back and the client has
re-synced.

## Changes by area

### 1. Shared producer helper (new)

`src/server/blurhash-body-enqueue.ts`:

```ts
import { extractImageUrls } from './extract-image-urls.js'
import type { BlurhashJob } from './blurhash.js'

export const MAX_BODY_BLUR_IMAGES = 30

export interface BlurhashQueueLike {
    send:(message:unknown) => Promise<unknown>
}

export async function enqueueBodyBlurJobs (
    queue:BlurhashQueueLike,
    html:string,
    itemId:number,
    objectId:string
):Promise<number> {
    const urls = extractImageUrls(html).slice(0, MAX_BODY_BLUR_IMAGES)
    for (const imageUrl of urls) {
        await queue.send({
            imageUrl,
            itemId,
            objectId,
            target: 'body'
        } satisfies BlurhashJob)
    }
    return urls.length
}
```

Refactor `article-fetch-consumer.ts` to call this helper in place of its
inline loop (move `MAX_BODY_BLUR_IMAGES` to the helper, import it). Pure
behavior-preserving refactor — the existing consumer tests must still
pass unchanged.

### 2. On-demand route: fresh-fetch enqueue

In `POST /items/:id/fetch-full`, inside the `'html' in result` success
branch (after the `UPDATE items` write, ~1562), best-effort enqueue:

```ts
if ('html' in result && result.html && this.env?.BLURHASH_QUEUE) {
    try {
        await enqueueBodyBlurJobs(
            this.env.BLURHASH_QUEUE,
            result.html,
            id,
            this.ctx.id.toString()
        )
    } catch (err) {
        console.error('body blur enqueue failed (fetch):', err)
    }
}
```

### 3. On-demand route: cache-hit lazy-fill

In the cache-hit branch (~1524-1531), before returning, enqueue from the
stored body **only when the blur map is empty**:

```ts
if (!hasBodyBlurMap(item.full_content_images) &&
    this.env?.BLURHASH_QUEUE) {
    try {
        await enqueueBodyBlurJobs(
            this.env.BLURHASH_QUEUE,
            item.full_content as string,
            id,
            this.ctx.id.toString()
        )
    } catch (err) {
        console.error('body blur enqueue failed (lazy):', err)
    }
}
return c.json({ item })
```

with a small local predicate:

```ts
function hasBodyBlurMap (value:unknown):boolean {
    if (typeof value !== 'string') return false
    const t = value.trim()
    return t !== '' && t !== '{}'
}
```

The empty-map gate makes lazy-fill **self-limiting**: each already-stored
article enqueues at most once (on its first open after this ships); once
the consumer writes any entry back, subsequent opens skip. Briefly, an
article opened twice before the consumer finishes may enqueue twice —
harmless and idempotent (KV cache hit on re-encode; map write is an
overwrite).

### No other changes

Schema, migrations, the blur consumer, the body write-back endpoint,
client sync, `addBlurHashPlaceholders`, and CSS are all untouched —
they already handle whatever the queue produces.

## Testing

Server-side unit tests (tapzero, node bundle). Assertions are on queue
messages and HTTP status, never on article HTML text (per house rules).

- **`enqueueBodyBlurJobs`** (new `test/blurhash-body-enqueue.ts`): with a
  fake queue capturing `send` calls — sends one `target:'body'` job per
  extracted src with correct `itemId`/`objectId`; caps at
  `MAX_BODY_BLUR_IMAGES`; sends none for HTML with no images; returns the
  count.
- **On-demand route** (extend `test/do-handlers.ts` or new
  `test/fetch-full-body-blur.ts`, with a fake `BLURHASH_QUEUE`):
  - fresh fetch returning HTML with images → enqueues N body jobs.
  - fetch returning a failure status → enqueues nothing.
  - cache hit, empty `full_content_images`, stored HTML has images →
    lazy-fill enqueues; response still the stored row.
  - cache hit, non-empty `full_content_images` → enqueues nothing.
  - `BLURHASH_QUEUE.send` throws → route still returns 200 with the item
    (failure isolation).
- **Regression**: existing `test/article-fetch-consumer.ts` and
  `test/blurhash-target-routing.ts` still pass after the helper refactor.

Run: `npm test && npm run lint`.

## Known tradeoffs / risks

- **First-open still gray.** Enqueue is async; the open that triggers it
  won't show blur, only a later visit will. Inherent to the 038 design;
  the gray box is the intended fallback.
- **Lazy-fill burst.** As the reader browses previously-fetched
  articles, each first open enqueues a handful of jobs — a bounded,
  one-time-per-article cost across the ~68 existing items. Within queue
  batch/concurrency limits.
- **Partial maps not reconciled.** If a prior run hashed *some* images of
  an article, the map is non-empty and lazy-fill skips it; the
  un-hashed images keep the gray box. Rare (only on partial consumer
  failure) and harmless. A per-src diff (enqueue only srcs missing from
  the map) is a possible future refinement — out of scope here.
- **Stale entries.** Unchanged from 038: if a body is re-fetched and
  images change, stale map keys are harmless (matched only by exact src;
  unmatched imgs fall back to gray).

## Out of scope

- Mass/eager backfill of stored items (no migration; filling is lazy,
  driven by opens).
- Per-src partial-map reconciliation (see tradeoffs).
- Any change to the eager poll path, the blur consumer, KV cache, schema,
  client render, or the 037 gray-box fallback.
