# Design: Blur-Hash Placeholders for Article-Body Images

**Feature**: `038-article-image-blurhash`
**Created**: 2026-06-07
**Status**: Approved (pending implementation)
**Builds on**: `037-article-image-placeholders` (the gray-box placeholder,
which becomes the fallback here)

## Goal

Replace the plain gray placeholder for images inside article bodies with
a blur-hash placeholder (the same effect already used for feed-item
thumbnails). Blur hashes are computed ahead of time on the server so that
by the time a user opens an article the placeholders are ready. The gray
box remains as the graceful fallback whenever a blur hash is not yet
available.

## Summary of decisions (from brainstorming)

- **Timing**: eager. When the server notices a new item during polling,
  it pre-fetches the full article body (for **summary-only** items) and
  computes blur hashes for the images in that body. The current
  on-demand fetch path stays as a fallback.
- **Pre-fetch scope**: only summary-only items (the existing
  `isSummaryOnly` heuristic) — the ones whose images come from scraping.
  Full-content feeds already carry their images in `content`/
  `description`.
- **Decoupling**: the poll *enqueues* fetch jobs; it does not fetch
  inline. This keeps polling within Cloudflare Worker/DO CPU and
  subrequest limits.
- **Reuse**: the existing thumbnail blur pipeline (queue, Photon
  decode + `blurhash.encode`, URL-keyed `BLURHASH_KV` cache) is reused
  for body images. Only the write-back target differs.
- **Render**: client-side, **after** DOMPurify, swap eligible `<img>`
  for `<blur-hash>` using a trusted per-item blur-hash map. Gray box
  (037) is the fallback.

## Context (current code)

- **Polling / new items**: `src/server/durable-objects/index.ts`
  `fetchFeed` (~1604) detects new items and calls
  `updateNewItemThumbnails(newItems)` at ~1764. `NewFeedItem` is
  `{ id, link, imageUrl }` (~83-87).
- **Thumbnail blur enqueue**: `updateBlurhashFromCacheOrQueue`
  (~1965-1998) checks `BLURHASH_KV`, else
  `env.BLURHASH_QUEUE.send({ imageUrl, itemId, objectId })`.
- **Blur job + cache**: `src/server/blurhash.ts` —
  `BlurhashJob { imageUrl, itemId, objectId }`, `blurhashCacheKey`
  (SHA-256 of URL, `blurhash:` prefix), `BlurhashCacheEntry
  { blurhash, image_width, image_height }`.
- **Consumer**: `src/server/blurhash-consumer.ts` —
  `handleBlurhashQueueBatch` (~217), `encodeBlurhashEntry` (~137):
  fetch (10s timeout) → Photon decode → resize 32×32 → encode (4×4) →
  KV (90-day TTL) → write-back.
- **Thumbnail write-back**: DO `POST /internal/blurhash/items/:id`
  (~631-664) sets `blurhash`, `image_width`, `image_height` on the item.
- **Article fetch (on-demand)**: `fetchFullArticle(link)` in
  `src/server/article-fetch.ts` (returns `{ status, html, fetchedAt }`
  or a failure status); DO `POST /items/:id/fetch-full` (~1368-1457)
  wraps `doFetchFullArticle` (~1597) and writes `full_content`,
  `full_content_fetched_at`, `full_content_status`; throttle
  `FETCH_FULL_MIN_INTERVAL_MS = 5_000`.
- **Extraction**: `extractArticleBody` /  `sanitiseExtractedHtml` in
  `src/server/article-extract.ts` preserve `<img src>` (only dangerous
  attrs/URLs stripped).
- **Schema**: `items` table in `src/shared/schema.ts` (~60-85);
  `USER_DO_MIGRATION_VERSION = 6` (`index.ts:115`); migration list
  ~410-419; pattern `migrateAddItemFullContent` (~500-520).
- **Queue registration**: `worker.queue()` in `src/server/index.ts`
  (~2061) currently routes every batch to `handleBlurhashQueueBatch`.
- **Bindings**: `wrangler.jsonc` — `BLURHASH_QUEUE` → `blurhash-jobs`
  (prod) / `blurhash-jobs-staging`; `BLURHASH_KV`; consumer batch
  config + `blurhash-dlq`.
- **Client render (037)**: `item-reader.ts` ~62-69
  `articleHtml = useMemo(() => sanitizeHtml(addImageLoadingHints(rawHtml)),
  [rawHtml])`, injected via `dangerouslySetInnerHTML` into `.article-body`
  (~201-206). `sanitizeHtml` (`util.ts:47-53`) uses DOMPurify with
  `USE_PROFILES:{html:true}`, `FORBID_TAGS:['style','form']`,
  `FORBID_ATTR:['style']` — **strips unknown custom elements**.
- **Thumbnail `<blur-hash>`**: `src/client/components/item-row.ts` —
  `import { BlurHash } from '@substrate-system/blur-hash'`,
  `BlurHash.define()`, element attrs `placeholder/src/width/height/alt/
  loading`; `blurhashDecodeSize(w,h)` bounded by `BLURHASH_DECODE_MAX=32`;
  `isValidImageSize`. Package `^0.0.40`.
- **Client sync**: `src/client/db/pull-sync.ts` —
  `ensureItemFullContentColumns` (~116-150), `upsertItem` (~189-273),
  `itemImageMetadataColumns` (~109-114).
- **Client type**: `src/client/db/types.ts` `Item` (~22-45).

## Architecture / data flow

```
poll: fetchFeed
  -> updateNewItemThumbnails (existing thumbnail blur)
  -> NEW: for each new summary-only item with a link:
        ARTICLE_FETCH_QUEUE.send({ itemId, link, objectId })

article-fetch consumer (Worker)
  -> fetchFullArticle(link)
  -> DO POST /internal/full-content/items/:id   (store full_content)
  -> parse <img src> from stored body
  -> for each src: BLURHASH_QUEUE.send({ imageUrl: src, itemId,
        objectId, target: 'body' })

blurhash consumer (Worker, existing, extended)
  -> encode (unchanged) + KV cache (unchanged)
  -> if target === 'body':
        DO POST /internal/blurhash/body-items/:id
           { url, blurhash, width, height }   (merge into JSON map)
     else: existing thumbnail write-back

DO (single-threaded -> merges are race-free)
  -> items.full_content_images  (JSON: { "<src>": {blurhash,w,h} })
  -> synced to client like other item columns

client (item-reader)
  -> articleHtml = addBlurHashPlaceholders(
        sanitizeHtml(addImageLoadingHints(raw)),
        imageMap)
  -> eligible <img> -> <blur-hash>; others keep <img> + gray box
```

## Changes by area

### Phase 1 — Eager pre-fetch + queue routing

1. **`wrangler.jsonc`**: add producer `ARTICLE_FETCH_QUEUE` →
   `article-fetch-jobs` (+ `-staging`); add a consumer for
   `article-fetch-jobs` mirroring the blurhash consumer config, with
   `article-fetch-dlq`.
2. **New job type** (`src/server/article-fetch-queue.ts` or alongside
   `blurhash.ts`): `ArticleFetchJob { itemId:number; link:string;
   objectId:string }`.
3. **Poll hook** (`durable-objects/index.ts`, after
   `updateNewItemThumbnails`): a new method, e.g.
   `enqueueArticleFetches(newItems)` — for each item whose feed body is
   summary-only (reuse `isSummaryOnly` against the item's stored
   `content`/`description` + `link`) and lacks `full_content`, send an
   `ArticleFetchJob`. Skip when offline-equivalent conditions or no
   link. Guard with a small per-poll cap if needed.
4. **Internal store endpoint** (`durable-objects/index.ts`):
   `POST /internal/full-content/items/:id` writing `full_content`,
   `full_content_fetched_at`, `full_content_status` (same SQL shape as
   `/items/:id/fetch-full`'s success/failure branches). Idempotent:
   if already populated, no-op success.
5. **Article-fetch consumer** (`src/server/article-fetch-consumer.ts`):
   `handleArticleFetchQueueBatch(batch, env, deps)` — per message call
   `fetchFullArticle(link)`, POST the result to the store endpoint.
   (Body-image blur enqueue is added in Phase 2.)
6. **Queue routing** (`src/server/index.ts` `worker.queue()`): branch on
   `batch.queue`: names starting `blurhash-jobs` →
   `handleBlurhashQueueBatch`; starting `article-fetch-jobs` →
   `handleArticleFetchQueueBatch`.

### Phase 2 — Body-image blur compute + storage/sync

1. **Schema column**: add `full_content_images TEXT` to the `items`
   CREATE TABLE in `src/shared/schema.ts`; bump
   `USER_DO_MIGRATION_VERSION` 6 → 7; add `migrateAddFullContentImages`
   (ALTER TABLE if missing) and call it in the migration list.
2. **Extend `BlurhashJob`**: add `target?: 'thumbnail' | 'body'`
   (absent/`'thumbnail'` = existing behavior).
3. **Body write-back endpoint** (`durable-objects/index.ts`):
   `POST /internal/blurhash/body-items/:id` with
   `{ url, blurhash, width, height }`. Read `full_content_images`, parse
   JSON (default `{}`), set `map[url] = { blurhash, w, h }`, write back.
   Safe to read-merge-write because the DO serializes requests.
4. **Consumer write-back routing** (`blurhash-consumer.ts`): when
   `job.target === 'body'`, POST the body endpoint with the URL; else
   the existing thumbnail endpoint. Encode + KV cache unchanged.
5. **Body-image enqueue** (`article-fetch-consumer.ts`, after store):
   parse `<img src>` from the stored HTML (server-side; a small pure
   helper `extractImageUrls(html)` using a tolerant parser), dedupe,
   cap to a sane max per article, and for each send a `BlurhashJob`
   with `target:'body'`.
6. **Client column + sync**: add `full_content_images` to
   `ensureItemFullContentColumns` (client migration) and to the
   `upsertItem` INSERT/UPDATE column list + bindings in
   `src/client/db/pull-sync.ts`; add `full_content_images?:string|null`
   to the `Item` type. Respect the existing `keepContent` cache policy.

### Phase 3 — Client blur-hash render

1. **Register** `BlurHash.define()` in `item-reader.ts` (import from
   `@substrate-system/blur-hash`).
2. **New transform** (`src/client/util.ts` or a focused new module):
   `addBlurHashPlaceholders(html:string, imageMap:Record<string,
   {blurhash:string; w:number; h:number}>):string`. Parse the
   already-sanitized HTML with `DOMParser`; for each `<img>` whose `src`
   has an entry with a valid blurhash + positive dims, replace it with a
   `<blur-hash>` element: `placeholder` = blurhash; `src`/`alt` copied
   from the (sanitized) img; `width`/`height` = `blurhashDecodeSize(w,h)`
   (decode canvas); `loading="lazy"`. Leave other `<img>` untouched
   (they keep the 037 gray box). Pure `string -> string`; returns input
   unchanged when the map is empty or there are no eligible imgs.
   Security: only injects `<blur-hash>` built from our trusted map +
   already-sanitized attributes — runs after DOMPurify by design.

   **src-matching contract**: the map is keyed by the exact `src` string
   and lookup is exact-string against each img's `src`. Both sides derive
   from the same stored `full_content` — the server extractor reads the
   post-`sanitiseExtractedHtml` body, the client reads the post-DOMPurify
   body — and DOMPurify preserves http(s) `src` verbatim, so exact match
   is correct for v1. Both the server extractor and the client lookup
   normalize the key identically (trim; skip non-http(s) and `data:`
   srcs, which never get a blur hash); no relative-URL resolution is done
   on either side. A non-matching src falls back to the gray box.
3. **Wire** (`item-reader.ts`): parse the synced map once
   (`JSON.parse(item.full_content_images || '{}')`, guarded) and
   compute `articleHtml = useMemo(() => addBlurHashPlaceholders(
   sanitizeHtml(addImageLoadingHints(rawHtml)), imageMap),
   [rawHtml, item.full_content_images])`.
4. **CSS** (`item-reader.css`): style `.article-body blur-hash` to size
   responsively — `display:block; max-width:100%; height:auto;
   margin:1rem 0`, and reserve the box via `aspect-ratio` from the real
   dims (set as an inline custom property on the element during the
   swap, e.g. `style="aspect-ratio:<w>/<h>"`, since this element is
   trusted and not passed through DOMPurify). Keep the gray
   `background-color` underneath for the pre-decode instant.

## Testing

Pure-function / unit tests (tapzero; browser bundle where `DOMParser`
is needed). No brittle DOM-text assertions on article content.

- `extractImageUrls(html)`: finds img srcs, dedupes, ignores
  non-`<img>`, handles none/empty.
- `addBlurHashPlaceholders`: swaps to `<blur-hash>` when a valid hash is
  present; leaves `<img>` (gray box) when absent or dims invalid;
  copies `src`/`alt`; sets decode size + aspect-ratio; idempotent;
  injects only from the trusted map (an `<img>` whose src is not in the
  map is untouched).
- Body write-back merge: merging two images into the JSON map keeps both
  (and the DO-serialized model means no special concurrency test
  needed, but unit-test the merge function).
- Blur consumer `target` routing: `target:'body'` hits the body
  endpoint; default hits the thumbnail endpoint.
- Poll enqueue: only summary-only items with a link and no
  `full_content` are enqueued; full-content items are skipped.
- Article-fetch consumer: stores content via the endpoint and (Phase 2)
  enqueues one body blur job per extracted image.
- Queue routing: `worker.queue()` dispatches by `batch.queue` to the
  correct handler.

## Known tradeoffs / risks

- **First-open latency**: a freshly polled article opened before its
  pre-fetch + blur jobs finish shows the gray box, then blur on the next
  render/open. Acceptable; the gray box is the designed fallback.
- **Cost**: pre-fetching summary-only bodies and decoding their images
  increases fetches, Worker CPU, KV writes, and DO storage
  (`full_content` up to 256KB each + a small JSON map). Bounded by
  summary-only scope and per-article image caps. Accepted in
  brainstorming.
- **Publisher load**: more outbound fetches; mitigated by the queue's
  batch/concurrency limits and reusing cached content.
- **Map staleness**: if `full_content` is re-fetched and images change,
  stale map entries are harmless (only matched by exact src; unmatched
  imgs fall back to gray).

## Out of scope

- Recomputing blur hashes for images that lack usable dimensions by any
  means other than the existing decode (no new heuristics).
- Changing the thumbnail pipeline behavior.
- A general image proxy / rewriting publisher image URLs.
- Removing the 037 gray box (it stays as the fallback).
- Backfilling blur hashes for already-stored articles (new/polled items
  going forward get them; opening an old article triggers the on-demand
  fetch path, which Phase 2 can also enqueue body blur jobs from — noted
  but not required for v1).
