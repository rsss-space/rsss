# Oversize Article Fallback — Phase 1: Server Salvage

**Goal:** Stop failing the full-article fetch when a publisher page exceeds
the download cap. Read up to the cap, keep the prefix, run the extractor on
it, and store a usable body flagged `succeeded_partial`. Only fail
(`failed_too_large`) when even the truncated prefix yields no body.

**Architecture:** Invert the size check. `readBoundedBody` no longer
size-fails — it returns the prefix plus a `truncated` flag.
`fetchFullArticle` threads `truncated` into the extractor and picks
`succeeded_partial` vs `succeeded`. `extractArticleBody` gains a
truncation-gated fallback so a mid-`<article>` truncation can still salvage
the open block. A new `succeeded_partial` enum value rides the existing
`full_content_status` rail; the Durable Object persists it like `succeeded`
and treats it as a cache hit. No client changes in this phase.

**Tech Stack:** TypeScript (Cloudflare Workers runtime, ES2022 lib), Hono
(server router), Durable Object SQLite. Tests via
`@substrate-system/tapzero`, bundled with `esbuild` and piped to `tapout`
(or `tap-spec` for the DO endpoint test).

**Scope:** Phase 1 of 3 from
`DOCS/design-plans/2026-05-30-028-oversize-article-fallback.md`.

**Codebase verified:** 2026-05-30 (via codebase-investigator + direct
reads of the exact regions edited below).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### 028-oversize-article-fallback.AC1: Oversize pages are salvaged
Given an article whose HTML exceeds `MAX_ARTICLE_FETCH_BYTES` but whose
extractable `<article>`/`<main>`/densest block lies within the first
`MAX_ARTICLE_FETCH_BYTES` bytes, when the reader fetches the full article,
then the server stores the extracted body and a status indicating partial
success, and the reader displays that body. *(Server half here: stores the
body + `succeeded_partial`. Reader display is Phase 2.)*

### 028-oversize-article-fallback.AC2: Unsalvageable oversize → clear failure
Given an article that exceeds the cap and whose readable body is **not**
within the read window (e.g. the page front-loads megabytes of inline JSON
before the article), when fetched, then the server stores
`failed_too_large`. *(Reader notice is Phase 2.)*

### 028-oversize-article-fallback.AC5: No regression on the happy path
Given an article within the cap that extracts cleanly, behavior is
unchanged: `full_content_status = 'succeeded'`, body stored. Cache-hit
short-circuiting in the Durable Object still avoids re-fetching
already-succeeded (including partial) rows.

---

## Context for the implementing engineer

You are editing a Cloudflare Workers server. The full-article pipeline lives
in three files plus the Durable Object:

- `src/server/article-fetch.ts` — `fetchFullArticle(link, opts)` is the
  entry point. It calls `fetchValidatedResponse` (200 + redirect/host
  validation), then the module-private `readBoundedBody`, then
  `extractArticleBody`, and returns a `FetchFullArticleResult` whose
  `status` is written verbatim to `items.full_content_status`.
- `src/server/article-extract.ts` — `extractArticleBody(html, baseUrl)`
  is a regex/string extractor (no DOM). `pickCandidate` tries
  `<article>` → `<main>` → densest `<div>`/`<section>`.
- `src/shared/schema.ts` — the `FullContentStatus` union,
  `ALL_FULL_CONTENT_STATUSES` array, and the byte caps.
- `src/server/durable-objects/index.ts` — the `POST /items/:id/fetch-full`
  handler (lines 1378–1466): cache-hit short-circuit, throttle, call the
  pipeline, write the row.

**Two distinct "too large" notions (do not conflate):**
1. **Download cap** — `MAX_ARTICLE_FETCH_BYTES` (3 MiB, `schema.ts:12`).
   This is the one we are inverting: it currently aborts the read; after
   this phase it only sets `truncated`.
2. **Extracted-content cap** — `MAX_FULL_CONTENT_BYTES` (256 KiB,
   `schema.ts:11`), enforced inside `extractArticleBody` via
   `truncateAtBoundary` (`article-extract.ts:264–270`). This is **unchanged**.
   When it can't truncate the extracted body to a clean boundary under the
   cap it returns `{ error:'too_large' }`. That verdict still maps to
   `failed_too_large`. So `failed_too_large` legitimately has two sources;
   that is expected (see the design's A2 note).

**TypeScript style (match the existing files and the project rule):** no
space between a colon and its type (`status:string`), ternaries with the
`?`/`:` on their own lines, lines ≤ 80 columns.

**Testing conventions (verified):**
- Tests use `@substrate-system/tapzero`: `test('desc', async t => { ... })`
  with `t.equal(actual, expected, msg)` and `t.ok(cond, msg)`.
- `test/article-fetch.ts` injects fakes through the `fetchFullArticle`
  options object: `fetchFn` (returns a `Response`) and `resolveHostname`
  (returns an IP array). It has a local `htmlResponse(html)` helper that
  builds a `text/html` `Response`, and an `okResolve` hostname resolver.
  Fixtures are inline strings. **No real network.**
- `test/article-extract.ts` calls `extractArticleBody` directly with inline
  HTML strings.
- `test/fetch-full-endpoint.ts` exercises the DO route WITHOUT Miniflare:
  a `createHarness(items, fetcherResult)` helper builds the router via
  `createRouter()` over a mock DO (`Object.create(RsssUserDO.prototype)`), a
  mock `sql` that parses the UPDATE/SELECT strings against an in-memory
  item array, mock storage `Map`, and a stub fetcher
  (`{ calls, next:FetchFullArticleResult|null }`). It returns `{ app,
  fetcher, ... }`; tests call `app.request('/items/1/fetch-full', { method:
  'POST' })`. There is a `makeItem()` fixture factory.
- Do NOT mock at a finer grain than these existing harnesses; reuse them.

**Verification commands (run from repo root):**
- `esbuild ./test/article-extract.ts --bundle | tapout`
- `esbuild ./test/article-fetch.ts --bundle | tapout`
- `esbuild ./test/fetch-full-endpoint.ts --bundle --platform=node --format=esm --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts | node --input-type=module | tap-spec`
- `npm test` (full suite) and `npm run lint`

> Note: `test/deploy-config.mjs` has a pre-existing, unrelated failure
> (`blurhash-jobs-staging` queue naming) that is out of scope and tracked
> separately. Do not try to fix it; just confirm your touched suites pass.

---

<!-- START_TASK_1 -->
### Task 1: Add `succeeded_partial` status + `isSuccessStatus` helper

**Verifies:** Foundation for 028-oversize-article-fallback.AC1 and AC5. The
helper's behavior (partial counts as success) is exercised by Task 4's
cache-hit test; this task is a type/enum + pure-helper addition verified by
build + lint.

**Files:**
- Modify: `src/shared/schema.ts` (`FullContentStatus` type,
  `ALL_FULL_CONTENT_STATUSES` array — lines 18–35; add helper near them)

**Implementation:**

1. Add `'succeeded_partial'` as the second member of the `FullContentStatus`
   union (immediately after `'succeeded'`), grouping it with the success
   states:
   ```ts
   export type FullContentStatus =
       | 'succeeded'
       | 'succeeded_partial'
       | 'failed_network'
       | 'failed_status'
       | 'failed_redirect'
       | 'failed_non_html'
       | 'failed_too_large'
       | 'failed_no_body'
   ```
2. Add `'succeeded_partial'` as the second element of the
   `ALL_FULL_CONTENT_STATUSES` array (same order), keeping the array in
   lockstep with the type. The array's declared type already constrains
   members to `FullContentStatus`, so this stays exhaustive.
3. Add a pure helper next to the array so server and (later) client share
   one definition of "this status means we have content":
   ```ts
   export function isSuccessStatus (
       status:string|null|undefined
   ):boolean {
       return status === 'succeeded' || status === 'succeeded_partial'
   }
   ```

**Testing:** No standalone test — this is an enum + pure helper. Its
behavior is covered by Task 4 (cache-hit on a `succeeded_partial` row). The
TypeScript compiler verifies the type/array shape.

**Verification:**
Run: `npm run build && npm run lint`
Expected: Both pass. (Adding an enum member does not force any existing
return site to produce it, so nothing else breaks yet.)

**Commit:** `feat: add succeeded_partial status + isSuccessStatus helper`
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->

<!-- START_TASK_2 -->
### Task 2: Truncation-tolerant extraction in `extractArticleBody`

**Verifies:** 028-oversize-article-fallback.AC1 (salvage when truncation
lands mid-`<article>`, i.e. front-loaded-bloat layouts).

**Files:**
- Modify: `src/server/article-extract.ts`
  (`extractArticleBody` 251–254, `pickCandidate` 194–198,
  `findFirstTagInner` 158–169)
- Test: `test/article-extract.ts` (unit)

**Implementation:**

Thread an opt-in `truncated` flag down to the container matcher. Gate the
new behavior strictly on `truncated` so complete-document behavior is
byte-for-byte unchanged.

1. Widen the signature (third param, defaulted) and pass the flag down:
   ```ts
   export function extractArticleBody (
       html:string,
       _baseUrl:string,
       opts:{ truncated?:boolean } = {}
   ):ExtractResult {
       const stripped = stripStructuralNoise(html)
       const candidate = pickCandidate(stripped, opts.truncated === true)
       // ...rest unchanged...
   }
   ```
2. `pickCandidate` forwards the flag to the tag matchers (the densest-block
   fallback does not need it — it already matches complete `<div>`/
   `<section>` pairs):
   ```ts
   function pickCandidate (
       html:string,
       truncated:boolean
   ):string|null {
       return findFirstTagInner(html, 'article', truncated) ||
           findFirstTagInner(html, 'main', truncated) ||
           findDensestBlock(html)
   }
   ```
3. In `findFirstTagInner`, when an open tag is found but no closing tag
   exists in the window, return the remainder of the window if `truncated`,
   else keep the current `null` (complete-doc behavior):
   ```ts
   function findFirstTagInner (
       html:string,
       tag:string,
       truncated:boolean
   ):string|null {
       const open = new RegExp(`<${tag}\\b[^>]*>`, 'i')
       const openMatch = open.exec(html)
       if (!openMatch) return null
       const start = openMatch.index + openMatch[0].length
       const closeRe = new RegExp(`<\\/${tag}\\s*>`, 'i')
       closeRe.lastIndex = start
       const rest = html.slice(start)
       const closeMatch = closeRe.exec(rest)
       if (!closeMatch) {
           // Truncation cut off the close tag: take everything from the
           // open tag to the end of the read window. Gated on truncated so
           // complete documents are unaffected.
           if (truncated) return rest
           return null
       }
       return rest.slice(0, closeMatch.index)
   }
   ```

**Testing:** Tests must verify behavior, not internals:
- AC1: an HTML string with an opened-but-unclosed `<article>` containing
  ≥ `EXTRACTED_MIN_TEXT` (500) chars of text → `extractArticleBody(html,
  url, { truncated:true })` returns a `{ html, plainTextLength }` success
  whose html contains the article text. **The fixture MUST use an unclosed
  `<article>` (or `<main>`) — not a `<div>`/`<section>`.** Only the
  `findFirstTagInner` tag matchers are truncation-aware; the
  `findDensestBlock` fallback deliberately is not, so a `<div>` fixture
  would not exercise the new branch.
- The same opened-but-unclosed HTML with default opts (or
  `{ truncated:false }`) → `{ error:'no_body' }` (complete-doc behavior
  preserved — no false salvage when we did not truncate).
- A complete document with a properly closed `<article>` → identical result
  with and without `{ truncated:true }` (the gate must not change closed-tag
  extraction).

**Verification:**
Run: `esbuild ./test/article-extract.ts --bundle | tapout`
Expected: All assertions pass.

**Commit:** `feat: truncation-gated container match in extractArticleBody`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Invert the size check in `readBoundedBody` + `fetchFullArticle`

**Verifies:** 028-oversize-article-fallback.AC1 (oversize-but-salvageable →
`succeeded_partial`), AC2 (oversize-unsalvageable → `failed_too_large`),
AC5 (within-cap clean → `succeeded`, unchanged).

**Files:**
- Modify: `src/server/article-fetch.ts`
  (`FetchFullArticleResult` 23–25, `readBoundedBody` 33–63,
  `classifyFetchError` return type 73–75,
  `fetchFullArticle` tail 122–141)
- Test: `test/article-fetch.ts` (unit, via injected `fetchFn`)

**Implementation:**

1. Widen `FetchFullArticleResult` so the success arm carries
   `succeeded_partial` (with html) and the failure arm excludes both
   success values:
   ```ts
   export type FetchFullArticleResult =
       | {
           status:'succeeded'|'succeeded_partial',
           html:string,
           fetchedAt:string
       }
       | {
           status:Exclude<
               FullContentStatus, 'succeeded'|'succeeded_partial'
           >
       }
   ```
2. Update `classifyFetchError`'s return type so it cannot claim to produce
   `succeeded_partial` (it only ever returns network/status/redirect). Add
   `'succeeded_partial'` to its `Exclude` list and reflow to ≤ 80 cols:
   ```ts
   function classifyFetchError (
       err:unknown
   ):Exclude<
       FullContentStatus,
       'succeeded' | 'succeeded_partial' | 'failed_non_html' |
       'failed_too_large' | 'failed_no_body'
   > {
       // ...body unchanged...
   }
   ```
3. Rewrite `readBoundedBody` so size never fails the read — it returns the
   prefix and a `truncated` flag. Use a **strict** overflow boundary
   (`total + value.byteLength > maxBytes`) so a complete document whose
   final chunk lands exactly on the cap is reported `truncated:false`
   (mirrors the old `total > maxBytes` semantics; avoids mislabeling a clean
   `succeeded` as `succeeded_partial`):
   ```ts
   async function readBoundedBody (
       response:Response,
       maxBytes:number
   ):Promise<
       { ok:true, text:string, truncated:boolean } |
       { ok:false, reason:'no_body' }
   > {
       if (!response.body) return { ok: false, reason: 'no_body' }

       const reader = response.body.getReader()
       const decoder = new TextDecoder()
       let total = 0
       let text = ''

       try {
           while (true) {
               const { done, value } = await reader.read()
               if (done) break
               if (!value) continue

               if (total + value.byteLength > maxBytes) {
                   const fit = maxBytes - total
                   text += decoder.decode(
                       value.subarray(0, fit), { stream: true }
                   )
                   await reader.cancel()
                   return {
                       ok: true,
                       text: text + decoder.decode(),
                       truncated: true
                   }
               }

               total += value.byteLength
               text += decoder.decode(value, { stream: true })
           }
       } finally {
           reader.releaseLock()
       }

       return { ok: true, text: text + decoder.decode(), truncated: false }
   }
   ```
   (A multibyte codepoint split at the `fit` boundary becomes one
   replacement char in otherwise-discarded trailing markup — harmless.)
4. Update the `fetchFullArticle` tail (current lines 122–141) to thread
   `truncated` and choose the status. The earlier fetch/validation and
   non-HTML guard (96–121) stay as-is:
   ```ts
   const read = await readBoundedBody(response, MAX_ARTICLE_FETCH_BYTES)
   if (!read.ok) return { status: 'failed_no_body' }

   const extracted = extractArticleBody(read.text, url, {
       truncated: read.truncated
   })
   if ('error' in extracted) {
       if (read.truncated) return { status: 'failed_too_large' }
       if (extracted.error === 'too_large') {
           return { status: 'failed_too_large' }
       }
       return { status: 'failed_no_body' }
   }

   return {
       status: read.truncated ? 'succeeded_partial' : 'succeeded',
       html: extracted.html,
       fetchedAt: nowSqlite()
   }
   ```

**Testing:** Drive `fetchFullArticle` with an injected `fetchFn` (reuse the
`htmlResponse`/`okResolve` helpers). To exceed the 3 MiB download cap, pad a
fixture's tail with trailing `<script>`/markup junk past
`MAX_ARTICLE_FETCH_BYTES` (mirrors the real WIRED layout). Verify:
- AC1: an `<article>` with real text near the **front**, followed by
  > `MAX_ARTICLE_FETCH_BYTES` of trailing junk → status
  `'succeeded_partial'`, `html` non-empty and containing the article text.
- AC2: > `MAX_ARTICLE_FETCH_BYTES` of leading junk **before** any
  extractable block (article never appears inside the window) → status
  `'failed_too_large'`.
- AC5: a small, within-cap, cleanly-closed `<article>` → status
  `'succeeded'` (unchanged), `html` non-empty.
- A within-cap page with no extractable body → `'failed_no_body'`
  (unchanged). Keep/confirm the existing `failed_*` cases still pass.

> **Pre-existing test whose meaning changes (keep, do not delete; update its
> description):** `test/article-fetch.ts` already has a case (around lines
> 67–76) that feeds `'x'.repeat(MAX_ARTICLE_FETCH_BYTES + 1)` — pure filler
> with no extractable block — and expects `failed_too_large`. Under the new
> logic this is the `truncated && extractor-errors → failed_too_large` path,
> so it still passes, but its *meaning* shifts from "download-cap
> short-circuit" (removed) to "truncated-and-unsalvageable". Update only its
> test description/comment to document the new path; do not remove it and do
> not leave it misleadingly named.

**Verification:**
Run: `esbuild ./test/article-fetch.ts --bundle | tapout`
Expected: All assertions pass, including pre-existing ones.

**Commit:** `feat: salvage oversize articles instead of size-failing`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Persist + cache-hit `succeeded_partial` in the DO handler

**Verifies:** 028-oversize-article-fallback.AC1 (DO stores the partial body
+ status), 028-oversize-article-fallback.AC5 (a partial row is a cache hit —
no re-fetch on every open; `succeeded` path unchanged).

**Files:**
- Modify: `src/server/durable-objects/index.ts`
  (import line ~11; cache-hit 1411–1419; write branch 1441–1460)
- Test: `test/fetch-full-endpoint.ts` (DO endpoint, via `createHarness`)

**Implementation:**

1. Import the helper. The file already imports `ALL_FULL_CONTENT_STATUSES`
   from `../shared/schema.js` (around line 11); add `isSuccessStatus` to
   that same import.
2. Broaden the cache-hit short-circuit so a `succeeded_partial` row counts
   as a hit (otherwise a salvaged article re-fetches on every open). Replace
   the `item.full_content_status === 'succeeded'` clause (line 1414) and
   update the comment:
   ```ts
   // Cache hit: row already has content (succeeded or partial) and
   // force not set.
   if (
       !force &&
       isSuccessStatus(item.full_content_status as string | null) &&
       typeof item.full_content === 'string' &&
       item.full_content.length > 0
   ) {
       return c.json({ item })
   }
   ```
3. Persist `succeeded_partial` like `succeeded`. Change the write-branch
   discriminant from `result.status === 'succeeded'` to `'html' in result`
   (this narrows to the success arm, which carries html + fetchedAt for
   BOTH `succeeded` and `succeeded_partial`), and write `result.status`
   instead of the hardcoded literal `'succeeded'`. The `else` (failure)
   branch — which writes `result.status` and preserves prior
   `full_content` — is unchanged:
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
       // Preserve any prior full_content on failure.
       this.sql.exec(
           'UPDATE items SET ' +
           "full_content_fetched_at = datetime('now'), " +
           'full_content_status = ? WHERE id = ?',
           result.status,
           id
       )
   }
   ```
   The defensive `ALL_FULL_CONTENT_STATUSES.includes(result.status)` guard
   at 1436–1439 now passes for `succeeded_partial` because Task 1 added it
   to the array.

**Testing:** Use `createHarness`/`makeItem` (no Miniflare). Verify:
- AC1: stub fetcher returns `{ status:'succeeded_partial', html:'<p>...
  </p>', fetchedAt:'2026-05-01 12:00:00' }`; `POST /items/1/fetch-full`
  → 200, and the persisted row has non-empty `full_content` **and**
  `full_content_status === 'succeeded_partial'`.
- AC5 (partial cache-hit): seed an item whose `full_content_status` is
  `'succeeded_partial'` with non-empty `full_content`; `POST` without
  `force` → 200, fetcher call count stays 0 (cache hit, no re-fetch), row
  unchanged.
- AC5 (regression): the existing `succeeded` cache-hit and
  succeeded-write tests still pass; a failure result (e.g.
  `failed_too_large`) still writes the status and preserves prior
  `full_content`.

**Verification:**
Run: `esbuild ./test/fetch-full-endpoint.ts --bundle --platform=node --format=esm --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts | node --input-type=module | tap-spec`
Expected: All assertions pass.

Then run the full gate:
Run: `npm test && npm run lint`
Expected: All touched suites pass; lint clean. (The unrelated
`test/deploy-config.mjs` queue-naming failure may remain — it is out of
scope.)

**Commit:** `feat: persist and cache-hit succeeded_partial in fetch-full`
<!-- END_TASK_4 -->

---

## Phase 1 Done When

- `FullContentStatus` and `ALL_FULL_CONTENT_STATUSES` include
  `succeeded_partial`; `isSuccessStatus` exists in `src/shared/schema.ts`.
- `readBoundedBody` never size-fails — it returns
  `{ ok:true, text, truncated }` or `{ ok:false, reason:'no_body' }`.
- `fetchFullArticle` returns `succeeded_partial` for a salvaged truncated
  read, `succeeded` for a clean within-cap read, `failed_too_large` for a
  truncated-and-unextractable read (and still for the extractor's own
  content-cap `too_large` verdict), and `failed_no_body` otherwise.
- `extractArticleBody` accepts `{ truncated }` and only salvages an
  unclosed container when `truncated` is true; complete-document extraction
  is unchanged.
- The DO `fetch-full` handler persists `succeeded_partial` (with content)
  and treats `succeeded`/`succeeded_partial` rows as cache hits.
- `esbuild ./test/article-extract.ts --bundle | tapout`,
  `esbuild ./test/article-fetch.ts --bundle | tapout`, and the
  `fetch-full-endpoint` command all pass; `npm test` and `npm run lint`
  pass (modulo the pre-existing out-of-scope `deploy-config.mjs` failure).
- No client changes in this phase.
