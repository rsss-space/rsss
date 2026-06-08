# Human Test Plan: 039-blurhash-on-demand-fetch

Blur-hash for on-demand article fetches.

This feature's automated tests fully cover the producer side (which queue
messages get enqueued). What they deliberately do not exercise — and what
needs a human — is the end-to-end async swap: blur consumer encode → KV
cache → write-back to `full_content_images` → client re-sync → `<img>` to
`<blur-hash>` swap in the rendered article. The plan below operationalizes
that.

## Prerequisites

- `npm test && npm run lint` passing (verified: full suite, 0 failures).
- A deployed/dev environment with the `BLURHASH_QUEUE`, `BLURHASH_KV`, and
  blurhash consumer worker all bound and running. The producer-only path is
  what the automated tests cover; the consumer must be live for end-to-end
  confirmation.
- A logged-in account with at least one feed whose items have full-article
  bodies containing multiple `http(s)` `<img>` tags.
- Browser DevTools open (Network tab) to observe `/items/:id/fetch-full` and
  the subsequent sync of the `full_content_images` column.

## Phase 1: Fresh on-demand fetch produces blur placeholders

| Step | Action | Expected |
|------|--------|----------|
| 1 | Pick an article that has never had its full body fetched (no stored `full_content`). | Item shows summary/description only, no full body yet. |
| 2 | Trigger the full-article fetch (open the reader / "fetch full" action that POSTs `/items/:id/fetch-full`). | Network shows one `POST /items/:id/fetch-full` returning 200. Body images render first as gray `var(--color-placeholder)` boxes (expected first-open state). |
| 3 | Wait for the blur consumer to process the queued jobs (queue + encode + KV + write-back). Watch for the client to re-sync the `full_content_images` column. | After the write-back syncs, re-render/re-open the same article. Eligible body images now show their blur-hash placeholder before the network image finishes loading. |
| 4 | Open an article whose body has more than 30 images (if available). | At most 30 of the body images receive a blur-hash placeholder (the per-image cap); remaining images stay gray. No errors in console. |

## Phase 2: Cache-hit lazy-fill

| Step | Action | Expected |
|------|--------|----------|
| 1 | Find an article fetched before this feature shipped: it has stored `full_content` but an empty `full_content_images` map, so its body images currently render gray. | Body images render as gray placeholders, no blur. |
| 2 | Open the article (POST `/items/:id/fetch-full`, no `force`). | Network shows 200 with NO upstream article re-fetch (returns the cached row quickly). The lazy-fill enqueues body blur jobs from the stored HTML. |
| 3 | Wait for the consumer to process and write back, then re-open / let the client re-sync. | Body images now show blur-hash placeholders. |
| 4 | Open the same article a second time after the map is populated. | No new blur jobs enqueued; placeholders already present. No duplicate processing, no console errors. |

## End-to-End: Fresh fetch → visible blur swap

Purpose: validate the full producer→consumer→client chain that the
unit/integration tests cannot reach.

1. Clear the article's cached body (or pick a brand-new item).
2. Trigger fetch-full; confirm 200 and gray placeholders on first paint.
3. Observe the blur queue jobs being consumed (consumer logs or eventual
   write-back).
4. Re-open the article; confirm each eligible body image transitions gray
   placeholder → blur-hash → loaded network image, in that order, with no
   layout shift.

## End-to-End: Queue-failure isolation (resilience)

Purpose: confirm a degraded blur pipeline never breaks article reading
(mirrors AC3.3 at the real-system level).

1. With the blur queue temporarily unavailable (or under load), trigger
   fetch-full on a fresh article.
2. Confirm the article body still loads and renders at 200 — images simply
   stay gray placeholders.
3. Confirm no user-facing error and the reader remains fully usable.

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| Async blur swap (end-to-end) | Spans consumer encode, KV cache, DO write-back, client re-sync, and the `<img>`→`<blur-hash>` DOM swap — none of which the producer-layer tests exercise (per the requirements' "Known async tradeoff"). | Phase 1 steps 2–3 and Phase 2 steps 2–3 above. |
| First-open gray placeholder is expected, not a bug | Visual/timing judgment: the gray box on first open is the intended fallback, not a regression. | Phase 1 step 2; confirm gray-then-blur ordering, no flash of broken image. |
| No layout shift during swap | Requires human visual judgment on CLS during placeholder→image transition. | End-to-End "Fresh fetch" step 4. |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 Success | `enqueueBodyBlurJobs sends one body job per image` | — |
| AC1.2 Cap | `enqueueBodyBlurJobs caps at MAX_BODY_BLUR_IMAGES` | Phase 1 step 4 (cap observed visually) |
| AC1.3 No images | `enqueueBodyBlurJobs sends nothing when html has no images` | — |
| AC1.4 Returns count | `enqueueBodyBlurJobs sends one body job per image` + cap case | — |
| AC2.1 Consumer unchanged | `article-fetch consumer enqueues body blur jobs on success` / `...does not enqueue blur jobs on failure` | End-to-End "Fresh fetch" (eager path also exercised when items arrive via background fetch) |
| AC2.2 Target routing | `writeItemBlurhash routes thumbnail/body target ...` | — |
| AC3.1 Fresh-fetch success | `fetch-full fresh fetch enqueues one body blur job per image` | Phase 1 steps 1–3 |
| AC3.2 Fresh-fetch failure | `fetch-full failure status enqueues nothing` | End-to-End "Queue-failure isolation" (failure-path read-through) |
| AC3.3 Failure isolation | `fetch-full returns 200 even if blur enqueue throws` | End-to-End "Queue-failure isolation" |
| AC4.1 Lazy-fill | `fetch-full cache hit with empty blur map lazy-fills` | Phase 2 steps 1–3 |
| AC4.2 Skip when populated | `fetch-full cache hit with populated blur map enqueues nothing` | Phase 2 step 4 |
