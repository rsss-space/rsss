# Test Requirements: Blur-Hash for On-Demand Article Fetches

**Feature:** `039-blurhash-on-demand-fetch`
**Source design:** `specs/039-blurhash-on-demand-fetch/design.md`
**Phase plans:** `phase_01.md`, `phase_02.md` (same directory)

This document maps every acceptance criterion to its verifying
automated test (or, where automation is not possible, a documented
manual step). AC ids and text are taken verbatim from the two phase
plans' "Acceptance Criteria Coverage" sections.

Assertions are on queue messages, returned counts, and HTTP status
only. No test asserts on article HTML text (house rule).

---

## Test files

Automated tests created or relied on by this feature:

- New (Phase 1, unit): `test/blurhash-body-enqueue.ts` — covers the
  `enqueueBodyBlurJobs` helper with a fake queue.
- New (Phase 2, integration): `test/fetch-full-body-blur.ts` — covers
  the `POST /items/:id/fetch-full` DO route with a fake
  `BLURHASH_QUEUE` and a fake DO `ctx.id`.
- Regression guards that must keep passing unchanged:
  - `test/article-fetch-consumer.ts` — eager consumer behavior.
  - `test/blurhash-target-routing.ts` — thumbnail vs body routing.
  - `test/fetch-full-endpoint.ts` — existing fetch-full route behavior
    (env undefined in this harness, so no enqueue path runs).

---

## AC1: Shared helper enqueues body blur jobs (Phase 1)

### 039-blurhash-on-demand-fetch.AC1.1 Success

For body HTML containing N distinct http(s) `<img src>` URLs,
`enqueueBodyBlurJobs` sends exactly one queue message per URL, each of
shape `{ imageUrl, itemId, objectId, target:'body' }` carrying the
given `itemId` and `objectId`.

- Coverage: automated, unit.
- File: `test/blurhash-body-enqueue.ts`.
- Test case: `enqueueBodyBlurJobs sends one body job per image`.
- Asserts: two srcs produce two `send` calls; first payload's
  `imageUrl`, `itemId` (42), `objectId` (`do-id`), and `target`
  (`body`) all match.

### 039-blurhash-on-demand-fetch.AC1.2 Cap

For HTML with more than `MAX_BODY_BLUR_IMAGES` (30) images, it sends
exactly `MAX_BODY_BLUR_IMAGES` messages (the first 30).

- Coverage: automated, unit.
- File: `test/blurhash-body-enqueue.ts`.
- Test case: `enqueueBodyBlurJobs caps at MAX_BODY_BLUR_IMAGES`.
- Asserts: with `MAX_BODY_BLUR_IMAGES + 10` images, both the returned
  count and `queue.sent.length` equal `MAX_BODY_BLUR_IMAGES`.

### 039-blurhash-on-demand-fetch.AC1.3 No images

For HTML with no http(s) images, it sends zero messages.

- Coverage: automated, unit.
- File: `test/blurhash-body-enqueue.ts`.
- Test case: `enqueueBodyBlurJobs sends nothing when html has no
  images`.
- Asserts: HTML with no images returns 0 and makes zero `send` calls.

### 039-blurhash-on-demand-fetch.AC1.4 Returns count

It returns the number of messages enqueued.

- Coverage: automated, unit.
- File: `test/blurhash-body-enqueue.ts`.
- Test case: `enqueueBodyBlurJobs sends one body job per image` (also
  asserted by the cap case).
- Asserts: the success case checks `count === 2`; the cap case checks
  `count === MAX_BODY_BLUR_IMAGES`; the no-images case checks
  `count === 0`. Together these prove the return value tracks the
  enqueue count across all branches.

---

## AC2: Consumer refactor is behavior-preserving (Phase 1)

### 039-blurhash-on-demand-fetch.AC2.1 Consumer unchanged behavior

After the refactor, the eager article-fetch consumer still enqueues one
`target:'body'` job per body image on fetch success and none on fetch
failure — verified by the existing `test/article-fetch-consumer.ts`
passing unchanged.

- Coverage: automated, integration (regression guard, no test edits).
- File: `test/article-fetch-consumer.ts`.
- Test cases:
  - `article-fetch consumer enqueues body blur jobs on success`.
  - `article-fetch consumer does not enqueue blur jobs on failure`.
- Asserts: 2 images produce 2 `target:'body'` jobs with matching
  `itemId`/`objectId`; a failure result produces 0 jobs. Must pass with
  no edits after the consumer is refactored to call the helper.

### 039-blurhash-on-demand-fetch.AC2.2 Target routing unchanged

The existing `test/blurhash-target-routing.ts` continues to pass
unchanged.

- Coverage: automated, integration (regression guard, no test edits).
- File: `test/blurhash-target-routing.ts`.
- Test cases:
  - `writeItemBlurhash routes thumbnail target to
    /internal/blurhash/items/:id`.
  - `writeItemBlurhash routes body target to
    /internal/blurhash/body-items/:id`.
- Asserts: thumbnail vs body jobs route to their respective write-back
  endpoints; the helper refactor does not change message shape on the
  wire.

---

## AC3: On-demand route — fresh-fetch enqueue (Phase 2)

### 039-blurhash-on-demand-fetch.AC3.1 Success

A fresh fetch (no cache, or `force`) that returns HTML containing N
images enqueues one `target:'body'` blur job per image (capped at
`MAX_BODY_BLUR_IMAGES`), each carrying the item id and the DO object id.

- Coverage: automated, integration.
- File: `test/fetch-full-body-blur.ts`.
- Test case: `fetch-full fresh fetch enqueues one body blur job per
  image`.
- Asserts: a two-image fetch result yields 200, one fetch call, two
  queued jobs, and a first payload whose `imageUrl`, `itemId` (route
  id 1), `objectId` (`test-do-id`), and `target` (`body`) match. The
  per-image cap itself is covered for the helper by AC1.2.

### 039-blurhash-on-demand-fetch.AC3.2 Failure

A fetch that returns a failure status (no HTML) enqueues nothing.

- Coverage: automated, integration.
- File: `test/fetch-full-body-blur.ts`.
- Test case: `fetch-full failure status enqueues nothing`.
- Asserts: a `failed_status` fetch result yields 200, one fetch
  attempt, and zero queued jobs (the failure branch writes no
  `full_content` and reaches no enqueue).

### 039-blurhash-on-demand-fetch.AC3.3 Failure isolation

If `BLURHASH_QUEUE.send` throws during enqueue, the route still returns
200 with the item.

- Coverage: automated, integration.
- File: `test/fetch-full-body-blur.ts`.
- Test case: `fetch-full returns 200 even if blur enqueue throws`.
- Asserts: with a throwing queue, the route returns 200, the item
  (id 1) is still returned, the fetch ran once, and at least one
  enqueue was attempted — proving the try/catch isolates the failure.

---

## AC4: On-demand route — cache-hit lazy-fill (Phase 2)

### 039-blurhash-on-demand-fetch.AC4.1 Lazy-fill

A cache hit (body already stored, `force` not set) whose
`full_content_images` map is empty, with stored HTML containing images,
enqueues body blur jobs from the stored HTML; the response is still the
stored row (200).

- Coverage: automated, integration.
- File: `test/fetch-full-body-blur.ts`.
- Test case: `fetch-full cache hit with empty blur map lazy-fills`.
- Asserts: with a stored body, `succeeded` status, and a null blur map,
  the route returns 200, performs no re-fetch (`fetcher.calls === 0`),
  and enqueues one job from the stored HTML with matching `itemId`,
  `objectId`, and `target:'body'`.

### 039-blurhash-on-demand-fetch.AC4.2 Skip when populated

A cache hit whose `full_content_images` map is non-empty enqueues
nothing.

- Coverage: automated, integration.
- File: `test/fetch-full-body-blur.ts`.
- Test case: `fetch-full cache hit with populated blur map enqueues
  nothing`.
- Asserts: with a non-empty `full_content_images` map, the route
  returns 200, performs no re-fetch, and enqueues zero jobs (the
  `hasBodyBlurMap` gate skips lazy-fill).

---

## Coverage summary

| AC    | Type        | File                              | Status        |
|-------|-------------|-----------------------------------|---------------|
| AC1.1 | unit        | test/blurhash-body-enqueue.ts     | automated     |
| AC1.2 | unit        | test/blurhash-body-enqueue.ts     | automated     |
| AC1.3 | unit        | test/blurhash-body-enqueue.ts     | automated     |
| AC1.4 | unit        | test/blurhash-body-enqueue.ts     | automated     |
| AC2.1 | integration | test/article-fetch-consumer.ts    | regression    |
| AC2.2 | integration | test/blurhash-target-routing.ts   | regression    |
| AC3.1 | integration | test/fetch-full-body-blur.ts      | automated     |
| AC3.2 | integration | test/fetch-full-body-blur.ts      | automated     |
| AC3.3 | integration | test/fetch-full-body-blur.ts      | automated     |
| AC4.1 | integration | test/fetch-full-body-blur.ts      | automated     |
| AC4.2 | integration | test/fetch-full-body-blur.ts      | automated     |

Every acceptance criterion maps to at least one automated test.

---

## How to run the tests

The full gate is:

```bash
npm test && npm run lint
```

Node-server tests are not npm scripts; they are inlined esbuild blocks
registered in `test/run-all-tests.mjs`. The two new bundles are
registered there (the `blurhash-body-enqueue.ts` block after the
`blurhash-target-routing.ts` block, and the `fetch-full-body-blur.ts`
block after the `fetch-full-endpoint.ts` block).

To run a single bundle in isolation, mirror the inlined command, e.g.:

```bash
esbuild ./test/blurhash-body-enqueue.ts --bundle --platform=node \
  --format=esm \
  --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts \
  | node --input-type=module | tap-spec
```

```bash
esbuild ./test/fetch-full-body-blur.ts --bundle --platform=node \
  --format=esm \
  --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts \
  | node --input-type=module | tap-spec
```

The regression guards run the same way against
`test/article-fetch-consumer.ts`, `test/blurhash-target-routing.ts`,
and `test/fetch-full-endpoint.ts`.

---

## Known async tradeoff (manual end-to-end observation, not unit-tested)

Enqueue is asynchronous and decoupled from the response. The first open
of a fresh or not-yet-hashed article still shows the gray
`var(--color-placeholder)` box; the blur appears only on a later render,
once the blur consumer has encoded the images and written the map back
into `full_content_images`, and the client has re-synced that column.

This timing behavior is inherent to the 038 design (the gray box is the
intended fallback) and is out of scope for this feature, which only adds
the missing producer call. It is not unit-testable at the layer these
tests cover — the unit and integration tests verify that the correct
queue messages are produced; they do not exercise the consumer encode,
KV cache, write-back, sync, and client `<img>` to `<blur-hash>` swap.

If end-to-end confirmation is wanted, verify it manually:

1. Open a previously-fetched article whose `full_content_images` is
   empty. Confirm the body images render as gray placeholders on this
   first open (expected).
2. Wait for the blur consumer to process the queued jobs and write the
   map back, then re-open (or let the client re-sync) the same article.
3. Confirm the eligible body images now render with their blur-hash
   placeholder before the network image loads.

The producer side of that flow (steps that enqueue the jobs) is the
part this feature adds and is fully covered by the automated tests
above.
