# Blur-Hash for On-Demand Article Fetches — Phase 1: Shared producer helper + consumer refactor

**Goal:** Extract the "find image URLs in body HTML → enqueue one
`target:'body'` blur job per image" logic into one shared helper, and
refactor the eager article-fetch consumer to use it — a pure,
behavior-preserving refactor that gives Phase 2 a single producer to call.

**Architecture:** A new pure-ish module `src/server/blurhash-body-enqueue.ts`
exports `enqueueBodyBlurJobs(queue, html, itemId, objectId)` and the
`MAX_BODY_BLUR_IMAGES` cap. The article-fetch consumer
(`src/server/article-fetch-consumer.ts`) drops its inline loop and calls the
helper instead. No queue/consumer/schema/client changes — same messages on
the wire, so the existing consumer and target-routing tests stay green.

**Tech Stack:** TypeScript (Cloudflare Workers runtime, ES2022 lib),
ESM/NodeNext imports (`.js` specifiers). Tests: `@substrate-system/tapzero`
bundled with esbuild and run on node (`tap-spec` reporter), registered in
`test/run-all-tests.mjs`.

**Scope:** Phase 1 of 2 from `specs/039-blurhash-on-demand-fetch/design.md`
("Changes by area > 1. Shared producer helper").

**Codebase verified:** 2026-06-07

---

## Acceptance Criteria Coverage

This phase implements and tests:

### 039-blurhash-on-demand-fetch.AC1: Shared helper enqueues body blur jobs
- **039-blurhash-on-demand-fetch.AC1.1 Success:** For body HTML containing
  N distinct http(s) `<img src>` URLs, `enqueueBodyBlurJobs` sends exactly
  one queue message per URL, each of shape
  `{ imageUrl, itemId, objectId, target:'body' }` carrying the given
  `itemId` and `objectId`.
- **039-blurhash-on-demand-fetch.AC1.2 Cap:** For HTML with more than
  `MAX_BODY_BLUR_IMAGES` (30) images, it sends exactly `MAX_BODY_BLUR_IMAGES`
  messages (the first 30).
- **039-blurhash-on-demand-fetch.AC1.3 No images:** For HTML with no http(s)
  images, it sends zero messages.
- **039-blurhash-on-demand-fetch.AC1.4 Returns count:** It returns the number
  of messages enqueued.

### 039-blurhash-on-demand-fetch.AC2: Consumer refactor is behavior-preserving
- **039-blurhash-on-demand-fetch.AC2.1 Consumer unchanged behavior:** After
  the refactor, the eager article-fetch consumer still enqueues one
  `target:'body'` job per body image on fetch success and none on fetch
  failure — verified by the existing `test/article-fetch-consumer.ts` passing
  unchanged.
- **039-blurhash-on-demand-fetch.AC2.2 Target routing unchanged:** The
  existing `test/blurhash-target-routing.ts` continues to pass unchanged.

---

## Context the executor needs (verified current state)

- `src/server/article-fetch-consumer.ts` today:
  - line 4: `import { extractImageUrls } from './extract-image-urls.js'`
  - line 8: `const MAX_BODY_BLUR_IMAGES = 30` (private; **not exported**;
    used only in the block below)
  - lines 72-82: the inline enqueue block inside
    `handleArticleFetchMessage`:
    ```ts
    if ('html' in result && result.html) {
        const urls = extractImageUrls(result.html).slice(0, MAX_BODY_BLUR_IMAGES)
        for (const imageUrl of urls) {
            await env.BLURHASH_QUEUE.send({
                imageUrl,
                itemId: job.itemId,
                objectId: job.objectId,
                target: 'body'
            })
        }
    }
    ```
  - `ArticleFetchConsumerEnv.BLURHASH_QUEUE` is typed
    `{ send:(message:unknown) => Promise<unknown> }` (lines 20-22) — this is
    structurally compatible with the helper's `BlurhashQueueLike`, so the
    consumer can pass `env.BLURHASH_QUEUE` directly with no cast.
- `src/server/extract-image-urls.ts` line 8:
  `export function extractImageUrls (html:string):string[]` — regex-based,
  dedupes, keeps only `^https?://` URLs, returns `[]` for empty HTML.
- `src/server/blurhash.ts` lines 7-12:
  ```ts
  export interface BlurhashJob {
      imageUrl:string
      itemId:number
      objectId:string
      target?:'thumbnail'|'body'
  }
  ```
- `src/server/blurhash-body-enqueue.ts` does **not** exist yet.
- `test/run-all-tests.mjs`: node-platform server tests are **inlined
  esbuild blocks** (NOT npm scripts). The pattern for blur-related tests is
  the `blurhash-target-routing.ts` block at lines 68-73:
  ```js
  [
      'esbuild ./test/blurhash-target-routing.ts --bundle',
      '--platform=node --format=esm',
      '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
      '| node --input-type=module | tap-spec'
  ].join(' '),
  ```
- House style (match surrounding code): `interface` for object shapes,
  no space before the colon in type annotations (`html:string`), `.js`
  import specifiers, 4-space indent, no semicolons at statement ends in
  these files, lines ≤ 80 columns.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Write the failing unit test for `enqueueBodyBlurJobs`

**Verifies:** 039-blurhash-on-demand-fetch.AC1.1,
039-blurhash-on-demand-fetch.AC1.2, 039-blurhash-on-demand-fetch.AC1.3,
039-blurhash-on-demand-fetch.AC1.4

**Files:**
- Create: `test/blurhash-body-enqueue.ts` (unit)
- Modify: `test/run-all-tests.mjs` (register the new bundle)

**Implementation (test):**
Use a fake queue that captures `send()` payloads into an array. Import the
helper and the cap from the module that does not exist yet. The test must
exercise: one job per image with the correct payload shape and ids; the
30-image cap; the empty-HTML case; and the returned count. Do not assert on
any article HTML text — only on queue payloads and counts (house rule: no
brittle HTML-text assertions).

```ts
import { test } from '@substrate-system/tapzero'
import {
    enqueueBodyBlurJobs,
    MAX_BODY_BLUR_IMAGES
} from '../src/server/blurhash-body-enqueue.js'

function fakeQueue () {
    const sent:unknown[] = []
    return {
        sent,
        async send (message:unknown) {
            sent.push(message)
        }
    }
}

test('enqueueBodyBlurJobs sends one body job per image', async t => {
    const queue = fakeQueue()
    const html =
        '<img src="https://img.example.com/a.jpg">' +
        '<img src="https://img.example.com/b.png">'

    const count = await enqueueBodyBlurJobs(queue, html, 42, 'do-id')

    t.equal(count, 2, 'returns number of jobs enqueued')
    t.equal(queue.sent.length, 2, 'one job per image')
    const first = queue.sent[0] as {
        imageUrl:string
        itemId:number
        objectId:string
        target:string
    }
    t.equal(first.imageUrl, 'https://img.example.com/a.jpg', 'imageUrl set')
    t.equal(first.itemId, 42, 'itemId matches')
    t.equal(first.objectId, 'do-id', 'objectId matches')
    t.equal(first.target, 'body', 'target is body')
})

test('enqueueBodyBlurJobs caps at MAX_BODY_BLUR_IMAGES', async t => {
    const queue = fakeQueue()
    const imgs:string[] = []
    for (let i = 0; i < MAX_BODY_BLUR_IMAGES + 10; i++) {
        imgs.push(`<img src="https://img.example.com/${i}.jpg">`)
    }

    const count = await enqueueBodyBlurJobs(queue, imgs.join(''), 1, 'do-id')

    t.equal(count, MAX_BODY_BLUR_IMAGES, 'caps the returned count')
    t.equal(queue.sent.length, MAX_BODY_BLUR_IMAGES, 'caps jobs enqueued')
})

test('enqueueBodyBlurJobs sends nothing when html has no images', async t => {
    const queue = fakeQueue()

    const count = await enqueueBodyBlurJobs(queue, '<p>no images</p>', 1, 'd')

    t.equal(count, 0, 'returns 0')
    t.equal(queue.sent.length, 0, 'no jobs enqueued')
})
```

**Register the test** in `test/run-all-tests.mjs`. Insert this block
immediately after the `blurhash-target-routing.ts` block (currently lines
68-73), so blur tests stay grouped:

```js
    [
        'esbuild ./test/blurhash-body-enqueue.ts --bundle',
        '--platform=node --format=esm',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '| node --input-type=module | tap-spec'
    ].join(' '),
```

**Step: Run the test, expect it to FAIL**

Run:
```bash
esbuild ./test/blurhash-body-enqueue.ts --bundle --platform=node \
  --format=esm \
  --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts \
  | node --input-type=module | tap-spec
```
Expected: esbuild fails to resolve
`../src/server/blurhash-body-enqueue.js` (the module does not exist yet).
This is the expected "red" — the test cannot pass without the helper.

**No commit** in this task (red state). Commit happens in Task 2 once green.
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement the shared helper `enqueueBodyBlurJobs`

**Verifies:** 039-blurhash-on-demand-fetch.AC1.1,
039-blurhash-on-demand-fetch.AC1.2, 039-blurhash-on-demand-fetch.AC1.3,
039-blurhash-on-demand-fetch.AC1.4

**Files:**
- Create: `src/server/blurhash-body-enqueue.ts`

**Implementation:**
Export `MAX_BODY_BLUR_IMAGES` and `enqueueBodyBlurJobs`. The helper takes a
minimal `BlurhashQueueLike` (so both the consumer's env queue and the DO's
`BLURHASH_QUEUE` binding satisfy it structurally), extracts up to
`MAX_BODY_BLUR_IMAGES` image URLs, sends one `target:'body'` job per URL, and
returns the count. Use `satisfies BlurhashJob` on the payload so the message
shape stays type-checked against the canonical job type.

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

**Step: Run the test, expect it to PASS**

Run:
```bash
esbuild ./test/blurhash-body-enqueue.ts --bundle --platform=node \
  --format=esm \
  --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts \
  | node --input-type=module | tap-spec
```
Expected: all three test blocks pass, together covering AC1.1-AC1.4 (the
first block — one-job-per-image — also asserts the returned count, AC1.4;
the others are the cap and no-images cases).

**Step: Commit**
```bash
git add src/server/blurhash-body-enqueue.ts test/blurhash-body-enqueue.ts \
  test/run-all-tests.mjs
git commit -m "feat: add enqueueBodyBlurJobs shared body-blur producer helper"
```
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (task 3) -->

<!-- START_TASK_3 -->
### Task 3: Refactor the article-fetch consumer to use the helper

**Verifies:** 039-blurhash-on-demand-fetch.AC2.1,
039-blurhash-on-demand-fetch.AC2.2

**Files:**
- Modify: `src/server/article-fetch-consumer.ts`

**Implementation:** Three edits, all behavior-preserving.

1. Replace the `extract-image-urls` import (line 4) with the helper import:
   ```ts
   import { enqueueBodyBlurJobs } from './blurhash-body-enqueue.js'
   ```
   (`extractImageUrls` is used nowhere else in this file, so its import is
   removed; `enqueueBodyBlurJobs` is the only new import.)

2. Delete the now-unused module-scope constant (line 8):
   ```ts
   const MAX_BODY_BLUR_IMAGES = 30
   ```
   The cap now lives in (and is owned by) `blurhash-body-enqueue.ts`.

3. Replace the inline enqueue block (lines 72-82) inside
   `handleArticleFetchMessage` with a single helper call:
   ```ts
   if ('html' in result && result.html) {
       await enqueueBodyBlurJobs(
           env.BLURHASH_QUEUE,
           result.html,
           job.itemId,
           job.objectId
       )
   }
   ```

No other changes — the function signature, the `writeFullContent` call,
`message.ack()`, and the `ArticleFetchConsumerEnv` type all stay as-is.

**Testing:** No new tests. The two existing tests are the regression guard
and must pass unchanged:
- `test/article-fetch-consumer.ts` — asserts 2 images → 2 `target:'body'`
  jobs with matching `itemId`/`objectId`, and 0 jobs on failure
  (AC2.1).
- `test/blurhash-target-routing.ts` — asserts thumbnail vs body routing
  (AC2.2).

**Step: Run both regression tests, expect PASS**

Run:
```bash
esbuild ./test/article-fetch-consumer.ts --bundle --platform=node \
  --format=esm \
  --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts \
  | node --input-type=module | tap-spec
esbuild ./test/blurhash-target-routing.ts --bundle --platform=node \
  --format=esm \
  --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts \
  | node --input-type=module | tap-spec
```
Expected: both suites pass with no edits to the test files.

**Step: Lint the changed files**

Run:
```bash
npx eslint src/server/blurhash-body-enqueue.ts \
  src/server/article-fetch-consumer.ts test/blurhash-body-enqueue.ts
```
Expected: no errors.

**Step: Commit**
```bash
git add src/server/article-fetch-consumer.ts
git commit -m "refactor: consumer uses enqueueBodyBlurJobs helper"
```
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_B -->

---

## Phase 1 done when

- `src/server/blurhash-body-enqueue.ts` exists and exports
  `enqueueBodyBlurJobs` + `MAX_BODY_BLUR_IMAGES`.
- `test/blurhash-body-enqueue.ts` passes (AC1.1-AC1.4) and is registered in
  `test/run-all-tests.mjs`.
- `article-fetch-consumer.ts` calls the helper; no inline extract/loop and no
  local `MAX_BODY_BLUR_IMAGES` remain.
- `test/article-fetch-consumer.ts` and `test/blurhash-target-routing.ts` pass
  unchanged (AC2.1, AC2.2).
- `npm run lint` is clean for the changed files.
