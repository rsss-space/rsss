# Generating the BlurHash string on the Cloudflare backend

Last verified: 2026-07-01

This documents the full server-side pipeline that turns an image URL into a
BlurHash string. The `@substrate-system/blur-hash` package is *not* involved
here — that is a client-only web component that **decodes** the string into a
placeholder canvas. All string **generation** happens in Cloudflare Workers,
and it deliberately avoids `sharp`.

## Why not `sharp`

`sharp` is a native Node addon backed by the libvips binary. The Cloudflare
Workers runtime (`workerd`) has no support for Node native addons, so `sharp`
cannot be bundled or run there at all.

Instead we decode and resize images with `@cf-wasm/photon` — a WebAssembly
build of the Photon image library that runs inside `workerd`. We import its
`/workerd` entrypoint specifically. The BlurHash string itself is produced by
the pure-JS `blurhash` npm package (`encode`).

The decode/resize/encode dependencies are hidden behind a
`BlurhashConsumerDeps` interface so tests can substitute a plain-Node
implementation and never pull the WASM (or a hypothetical `sharp`) into the
test bundle.

## The pieces

| File | Role |
|------|------|
| `src/server/blurhash.ts` | Types, KV cache key (`blurhashCacheKey`), cache-entry parse/guard |
| `src/server/blurhash-body-enqueue.ts` | Enqueues one job per image found in article body HTML |
| `src/server/blurhash-consumer.ts` | Queue consumer: fetch → decode → resize → encode → cache → write back. Runtime-agnostic (`BlurhashConsumerDeps`) |
| `src/server/blurhash-runtime.ts` | Wires `@cf-wasm/photon/workerd` + `blurhash` into `BlurhashConsumerDeps` |
| `src/server/index.ts` | `queue()` handler routes batches; declares `BLURHASH_KV` / `BLURHASH_QUEUE` bindings |
| `src/server/durable-objects/index.ts` | Enqueues thumbnail jobs; short-circuits on a KV cache hit |
| `wrangler.jsonc` | `blurhash-jobs` queue + consumer + DLQ, `BLURHASH_KV` namespace |

## End-to-end flow

### 1. Enqueue a job

A `BlurhashJob` is `{ imageUrl, itemId, objectId, target? }` where `target` is
`'thumbnail'` (default) or `'body'`. Jobs are produced in two places:

- **Thumbnail image** — the per-user DO (`RsssUserDO`), when an item's image
  URL is known. Before enqueuing it checks the KV cache and, on a hit, writes
  the entry straight into the `items` row (COALESCE, so it never clobbers an
  existing value) and skips the queue entirely
  (`durable-objects/index.ts:2955`).
- **Body images** — `enqueueBodyBlurJobs` extracts up to `MAX_BODY_BLUR_IMAGES`
  (30) `<img>` URLs from fetched article HTML and sends one job each with
  `target: 'body'`. Called from the article-fetch consumer and the DO
  (`blurhash-body-enqueue.ts`).

`objectId` is the stringified DO id (`this.ctx.id.toString()`), so the consumer
can route the result back to the exact per-user Durable Object.

### 2. Queue routing

`worker.queue()` (`index.ts:2564`) dispatches by queue name: batches on
`article-fetch-jobs*` go to the article-fetch consumer, everything else
(i.e. `blurhash-jobs*`) goes to `handleBlurhashQueueBatch`, which is handed a
freshly-imported `createBlurhashConsumerDeps()` from the runtime module. The
runtime module is dynamically `import()`-ed so the WASM only loads inside the
queue handler.

### 3. Consume: cache check

For each message (`handleBlurhashMessage`):

1. Validate the message is a `BlurhashJob`; ack and drop if not.
2. Compute the KV cache key: `blurhashCacheKey(imageUrl)` = `blurhash:` +
   first 32 hex chars of `SHA-256(imageUrl)`.
3. `BLURHASH_KV.get(key)`. On a hit, write the cached entry back to the DO and
   ack — no image fetch, no encode.

### 4. Consume: encode (`encodeBlurhashEntry`)

On a cache miss:

1. **Fetch** the image (`fetchBlurhashImageBytes`). A browser `user-agent` is
   sent, the request aborts after `IMAGE_FETCH_TIMEOUT_MS` (10s), 4xx returns
   `null` (skip), other non-2xx throws (retry), and anything over
   `MAX_IMAGE_BYTES` (5 MB) — by `content-length` or actual byte length —
   returns `null`.
2. **Decode** the bytes: `PhotonImage.new_from_byteslice(bytes)`. A decode
   throw returns `null` (unsupported/corrupt image → skip, don't retry).
3. Read the original `get_width()` / `get_height()` — these are stored as the
   item's real dimensions.
4. **Resize** to `BLURHASH_SIZE` × `BLURHASH_SIZE` (32×32) using Photon's
   `resize(..., SamplingFilter.Nearest)`.
5. **Encode**: `encode(pixels, 32, 32, 4, 4)` from the `blurhash` package —
   4×4 components. Photon's raw pixels are coerced to a `Uint8ClampedArray`
   (`toClampedPixels`) as `blurhash` expects RGBA clamped bytes.
6. `free()` both Photon images in a `finally` (WASM memory is manually
   managed) and clear the fetch timeout.

Result is a `BlurhashCacheEntry`: `{ blurhash, image_width, image_height }`
(the dimensions are the *original* size, not 32×32).

### 5. Persist and write back

1. `BLURHASH_KV.put(key, JSON.stringify(entry), { expirationTtl:
   BLURHASH_CACHE_TTL_SECONDS })` — 90-day TTL. Encoding runs at most once per
   unique image URL, globally, across all users.
2. `writeItemBlurhash` POSTs the entry into the owning DO:
   - thumbnail → `POST /internal/blurhash/items/:itemId` (body = the entry)
   - body → `POST /internal/blurhash/body-items/:itemId` (body =
     `{ url, blurhash, width, height }`)
   A non-OK response throws so the message is retried.
3. `message.ack()`.

Failures that throw (transient fetch error, DO write failure) let the message
be retried by the queue; after the configured retries it lands in the
`blurhash-dlq` dead-letter queue.

## Configuration (`wrangler.jsonc`)

- KV namespace bound as `BLURHASH_KV`.
- Producer binding `BLURHASH_QUEUE` → queue `blurhash-jobs`
  (`blurhash-jobs-staging` in staging).
- Consumer on `blurhash-jobs` with `dead_letter_queue: blurhash-dlq`.

## Client side (for contrast)

`@substrate-system/blur-hash` is imported only in the browser
(`src/client/components/item-row.ts`, `src/client/routes/item-reader.ts`). It
registers a `<blur-hash>` custom element (`BlurHash.define()`) that **decodes**
the stored string into a canvas placeholder while the real image loads. It
never generates a string.
