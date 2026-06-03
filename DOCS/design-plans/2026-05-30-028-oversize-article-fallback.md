# Oversize Article Fallback + Clearer Fetch Errors Design

## Summary

When a publisher's article page is larger than the raw-download cap
(`MAX_ARTICLE_FETCH_BYTES`, currently 3 MiB), the server gives up before
the extractor runs and stores `full_content_status = 'failed_too_large'`.
The reader then shows a single generic line, "Couldn't load the full
article.", for that case and for every other failure mode.

This is wrong twice over:

1. **We throw away usable content.** Real publisher pages put the
   `<article>` near the top and pad the tail with inline JSON/scripts.
   For the WIRED page that triggered this work, `<article>...</article>`
   sits at bytes 398,627–425,010 (30–32% of a 1.31 MiB document);
   truncating to 500 KiB still extracts the identical article body
   (6,964 chars of text). We could have shown the article and didn't.

2. **The message is opaque.** "Couldn't load the full article" tells the
   reader nothing — not that the page was too big, not that they can read
   it on the publisher's site, not whether retrying will help.

This feature does two things:

- **Salvage (server):** stop failing on size. Read up to the cap, keep
  what we have, and run the extractor on the truncated HTML. If a usable
  body comes out, store it (flagged as partial). Only fail when even the
  truncated bytes yield no body.
- **Honest, well-designed messaging (client):** map each terminal
  `full_content_status` to specific copy and a purposeful action, and
  render it as a proper notice (not an italic afterthought). The
  too-large / partial case explicitly tells the reader the page was too
  big and points them to the publisher.

This supersedes raising the byte cap further (the whack-a-mole approach
noted in `2026-05-30` work that bumped the cap from 1 → 3 MiB).

## Resolved Clarifications (2026-05-30)

Confirmed with the decision-maker during fleshing-out:

1. **Partial-notice placement: above the body.** For a salvaged article,
   the `info` notice (and its publisher CTA) renders *above* the partial
   body, so the reader knows up front the article is truncated. (Not
   below, not both.)
2. **Hard failures keep the RSS-summary fallback.** On any `failed_*`
   status, the reader still renders the existing
   `full_content || content || description` fallback (the feed's summary)
   *beneath* the error notice — current behavior is preserved, no
   regression. The notice sits above that fallback body.
3. **All three open decisions accepted** (see Additional Considerations →
   Resolved decisions): add `succeeded_partial`; keep the
   truncation-gated `findFirstTagInner` fallback; leave the cap at 3 MiB.

Scope note verified against the code: `full_content_status` is consumed
on the client **only** in `routes/item-reader.ts` (plus opaque DB
passthrough in `db/pull-sync.ts` / `db/push-sync.ts` and the
`FullContentStatus` type in `db/types.ts`). No sidebar, item-list, or
sync-status-legend component enumerates these statuses, so the new enum
value's client blast radius is the reader alone.

## Definition of Done

- A page that exceeds the download cap but whose `<article>` is within
  the read window renders its (partial) body in the reader, not an error.
- The reader distinguishes "partial — page too large" from a hard
  failure, and from network/status/redirect/non-HTML/no-body failures,
  with distinct, human-readable copy.
- The too-large / partial notice is visually polished: a notice card
  using the existing warning palette, a clear primary action ("Read on
  <publisher>"), and a secondary Retry where retrying could help.
- Server unit tests cover: truncated-but-extractable → succeeded(partial);
  truncated-and-unextractable → failed_too_large; un-truncated paths
  unchanged.
- Client tests assert the **status → notice-variant** mapping and the
  presence of the correct action affordances (not exact copy strings).
- `npm test` passes for all touched suites; lint clean. (Note the
  pre-existing, unrelated `test/deploy-config.mjs` failure about
  `blurhash-jobs-staging` queue naming is out of scope and tracked
  separately.)

### Out of scope

- Headless/JS rendering of SPA-only articles (no DOM in Workers).
- Showing the exact page size to the reader (we stop reading at the cap,
  so we only know "≥ cap" — see Additional Considerations).
- Changing `MAX_ARTICLE_FETCH_BYTES` again. Salvage makes the exact value
  far less load-bearing; leave it at 3 MiB.
- Paywalled-content handling beyond the existing `failed_no_body` path.

## Acceptance Criteria

### `028-oversize-article-fallback.AC1`: Oversize pages are salvaged

Given an article whose HTML exceeds `MAX_ARTICLE_FETCH_BYTES` but whose
extractable `<article>`/`<main>`/densest block lies within the first
`MAX_ARTICLE_FETCH_BYTES` bytes, when the reader fetches the full article,
then the server stores the extracted body and a status indicating partial
success, and the reader displays that body.

### `028-oversize-article-fallback.AC2`: Unsalvageable oversize → clear failure

Given an article that exceeds the cap and whose readable body is **not**
within the read window (e.g. the page front-loads megabytes of inline
JSON before the article), when fetched, then the server stores
`failed_too_large`, and the reader shows the "page too large to download"
notice with a publisher CTA.

### `028-oversize-article-fallback.AC3`: Per-status messaging

Given an item with a terminal `full_content_status`, the reader renders a
status-specific notice variant. Each of `failed_too_large`,
`failed_network`, `failed_status`, `failed_redirect`, `failed_non_html`,
`failed_no_body`, and the new partial-success status maps to its own copy
and action set. No two distinct statuses collapse to the same message.

### `028-oversize-article-fallback.AC4`: Partial content is labeled

Given a partially-salvaged article, the reader shows the body **and** a
non-error notice telling the reader the full page was too large to
download and offering "Read on <publisher>". The notice does not look
like a failure (warning palette, not error palette).

### `028-oversize-article-fallback.AC5`: No regression on the happy path

Given an article within the cap that extracts cleanly, behavior is
unchanged: `full_content_status = 'succeeded'`, no notice, body rendered.
Cache-hit short-circuiting in the Durable Object still avoids re-fetching
already-succeeded (including partial) rows.

### `028-oversize-article-fallback.AC6`: Notice quality

The notice meets the project CSS rules: font-size ≥ 1rem, all colors from
`_variables.css`, nested selectors over class proliferation, and is
keyboard-reachable and screen-reader sensible (the icon is decorative /
`aria-hidden`; meaning lives in text).

### `028-oversize-article-fallback.AC7`: Notice placement and failure fallback

Given any item that renders a notice (partial or any `failed_*`), the
notice appears **above** the article body in DOM order (uniform
placement). Given a hard failure (`failed_*` with no salvaged content),
the reader still renders the existing `content`/`description` summary
fallback beneath the notice — the summary is not suppressed. Tests assert
DOM order and the presence of both the notice and the fallback body node,
not their text content.

## Glossary

- **Read window** — the prefix of the response body the server actually
  reads, bounded by `MAX_ARTICLE_FETCH_BYTES`.
- **Truncated** — the response was longer than the read window; we stopped
  early and kept a prefix.
- **Salvage** — running the extractor on a truncated prefix and accepting
  a usable body from it.
- **Partial success** — salvage succeeded; stored content is the article
  as found in the read window, possibly missing late sections.
- **Terminal status** — a `full_content_status` that is not mid-flight
  (`succeeded`, `succeeded_partial`, or any `failed_*`).

## Architecture

### Current data flow (`src/server/article-fetch.ts`)

```
fetchValidatedResponse(link)        // 200 + text/html verified
  -> readBoundedBody(resp, CAP)
       total > CAP  => { ok:false, reason:'too_large' }   // GIVES UP
       no body      => { ok:false, reason:'no_body' }
       else         => { ok:true, text }
  -> extractArticleBody(text, url)
       error 'too_large' => failed_too_large
       error 'no_body'   => failed_no_body
       ok                => succeeded
```

The first `too_large` (download cap) short-circuits before extraction.
That is the only thing standing between the reader and the WIRED article.

### Target data flow

```
fetchValidatedResponse(link)
  -> readBoundedBody(resp, CAP)
       no body  => { ok:false, reason:'no_body' }          // hard fail
       else     => { ok:true, text, truncated }            // never size-fails
  -> extractArticleBody(text, url, { truncated })
       ok                          => truncated ? succeeded_partial
                                                 : succeeded
       error && truncated          => failed_too_large
       error && !truncated         => failed_no_body | failed_too_large
                                      (extractor's own verdict, unchanged)
```

Key inversion: **size no longer fails the read; it only marks the result
partial.** `failed_too_large` now means "we truncated and still couldn't
find a body," which is the honest meaning.

### Part A — server changes

**A1. `readBoundedBody` stops failing on size.** Return type becomes
`{ ok:true, text:string, truncated:boolean } | { ok:false,
reason:'no_body' }`. When appending a chunk would cross the cap, decode
only the bytes that fit, set `truncated = true`, cancel the reader, and
return the prefix. Sketch:

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
            // Strict overflow: only truncate when this chunk would push
            // PAST the cap. A document whose final chunk lands exactly on
            // the cap is taken in full and reported truncated:false.
            if (total + value.byteLength > maxBytes) {
                const fit = maxBytes - total
                text += decoder.decode(
                    value.subarray(0, fit), { stream: true }
                )
                await reader.cancel()
                return { ok: true, text: text + decoder.decode(),
                    truncated: true }
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

Boundary choice matters: using `>=` (chunk meets-or-exceeds the
remaining space) would falsely flag a *complete* document whose last
chunk happens to land exactly on the cap as `truncated`, mislabeling a
clean `succeeded` as `succeeded_partial`. The strict `>` above tracks the
old `total > maxBytes` semantics — we only declare truncation when bytes
genuinely overflow. A split multibyte codepoint at the boundary becomes
one replacement char in otherwise-discarded trailing markup — harmless.

**A2. `fetchFullArticle` threads `truncated` and chooses the status.**

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

`FetchFullArticleResult`'s success arm widens to allow
`status:'succeeded' | 'succeeded_partial'`.

**Note — `failed_too_large` has two distinct paths.** After this change
it is reached by (a) `truncated && extractor errored` (the download
overflowed the cap *and* no body was salvageable) and (b)
`!truncated && extractor.error === 'too_large'` (the page downloaded
fully but the *extracted* body exceeded `MAX_FULL_CONTENT_BYTES`, 256
KiB — a content-size verdict, not a download-size one). Both keep the
same enum value and share one user-facing message, but the copy must not
assert "we couldn't download this" as fact, since path (b) downloaded
fine. Prefer copy framed around "too large to show in full" rather than
"too large to download." The salvage inversion only removes the
*download-cap* short-circuit; the extractor's own `too_large` verdict is
unchanged.

**A3. `extractArticleBody` gains a truncation-tolerant container match.**
`findFirstTagInner` currently returns `null` when the closing tag is
absent (article-extract.ts:167). That is correct for complete documents
but defeats salvage when truncation lands mid-`<article>`. Gate a
fallback on `truncated` so complete-page behavior is byte-for-byte
unchanged:

```ts
export function extractArticleBody (
    html:string,
    _baseUrl:string,
    opts:{ truncated?:boolean } = {}
):ExtractResult { ... }

// inside findFirstTagInner, when an open tag is found but no close:
//   if (opts.truncated) return rest   // take to end-of-window
//   return null
```

(Plumb `opts.truncated` down to `pickCandidate`/`findFirstTagInner`, or
pass a closure.) Evidence says WIRED does **not** need this — its
`</article>` is at 32% — but front-loaded-bloat layouts do. Keep it; it
is cheap and strictly gated.

**A4. Enum + plumbing for `succeeded_partial`** (`src/shared/schema.ts`):
add to `FullContentStatus` and `ALL_FULL_CONTENT_STATUSES`. In the
Durable Object `/items/:id/fetch-full` handler
(`src/server/durable-objects/index.ts`):

- The success write branch already keys off `result.status ===
  'succeeded'`; broaden the *write* to persist `result.status`
  (`succeeded` or `succeeded_partial`) and `full_content` together when
  the result carries `html`.
- The **cache-hit** short-circuit (index.ts:1411-1419) currently checks
  `item.full_content_status === 'succeeded'`; it must also treat
  `succeeded_partial` as a hit, or a partial article re-fetches on every
  open. Suggest a shared helper `isSuccessStatus(s)`.

### Part B — client changes

**B1. Status → notice model (`src/client/routes/item-reader.ts`).**
Today `fetchFailed = status.startsWith('failed_')` drives one generic
block, and the parenthetical detail only ever shows for thrown
network/throttle errors (`articleFetchError`). Replace with a pure
function from status to a small view-model:

```ts
type NoticeVariant = 'info' | 'error'
interface ReaderNotice {
    variant:NoticeVariant
    title:string
    body?:string
    retry:boolean      // show Retry (only where it can help)
}

function noticeForStatus (
    status:string|null|undefined
):ReaderNotice|null {
    switch (status) {
        case 'succeeded_partial': return {
            variant: 'info', retry: false,
            title: 'This page was too large to download in full.',
            body: 'We’ve shown the part we could read.'
        }
        case 'failed_too_large': return {
            variant: 'error', retry: false,
            // Framed around "show in full", not "download" — this status
            // is also reached when the page downloaded fine but the
            // extracted body exceeded MAX_FULL_CONTENT_BYTES. See A2.
            title: 'This article is too large to show in full.',
            body: 'We couldn’t pull a readable version from this page.'
        }
        case 'failed_network': return {
            variant: 'error', retry: true,
            title: 'We couldn’t reach the publisher.'
        }
        case 'failed_status': return {
            variant: 'error', retry: true,
            title: 'The publisher’s site returned an error.'
        }
        case 'failed_redirect': return {
            variant: 'error', retry: false,
            title: 'This link redirected too many times.'
        }
        case 'failed_non_html': return {
            variant: 'error', retry: false,
            title: 'This link isn’t a readable article page.'
        }
        case 'failed_no_body': return {
            variant: 'error', retry: false,
            title: 'We couldn’t find the article text on this page.'
        }
        default: return null
    }
}
```

Notes:
- `succeeded_partial` is **not** a failure — render the body as normal and
  show the `info` notice **above** the body (resolved: above, not below).
- **Hard failures keep the summary fallback.** For any `failed_*` status,
  the existing `full_content || content || description` body still
  renders beneath the notice (this is the feed's RSS summary, since
  `full_content` is empty on failure). Do not suppress it — current
  behavior is preserved. The notice sits above this fallback body too, so
  notice placement is uniform across partial and failed states.
- The publisher CTA ("Read on <host>") is part of every notice, built
  from the existing `publisherLinkLabel`/`publisherLinkHref` helpers
  (`src/shared/publisher-link.ts`) already used at the bottom of the
  reader. When the notice (now always above the body) carries the CTA,
  hide the duplicate bottom link.
- Keep the thrown-error path: when `articleFetchError.value.itemId ===
  itemId` (network/throttle thrown in `State.fetchFullArticle`), prefer
  that live message in the notice body.

**B2. The notice component + CSS.** See UI / Visual Design below.

## UI / Visual Design

Build-time: run **`/impeccable craft`** on the notice component for the
final polish pass; the spec below is the brief.

Two variants, one structure. Use the warning palette for `info`
(too-large / partial) and the error palette for hard failures. Both are
notice cards with a left accent bar, a title, optional body line, and an
actions row.

```
 info (succeeded_partial / too-large)
┌───────────────────────────────────────────────────────────┐
│▌ (i)  This page was too large to download in full.         │
│▌      We've shown the part we could read.                  │
│▌                                                           │
│▌      [ Read the full article on wired.com → ]             │
└───────────────────────────────────────────────────────────┘
   ^ left bar: --color-warning   bg: --color-warning-bg

 error (failed_network etc.)
┌───────────────────────────────────────────────────────────┐
│▌ (!)  We couldn't reach the publisher.                     │
│▌                                                           │
│▌      [ Retry ]   Read on wired.com →                      │
└───────────────────────────────────────────────────────────┘
   ^ left bar: --color-error    bg: --color-surface
```

CSS (nested, tokens only, ≥ 1rem text) added to
`src/client/routes/item-reader.css`, replacing the thin
`.article-fetch-status.failed` rule:

```css
.route.item-reader {
    & .article-notice {
        display: flex;
        gap: 0.75rem;
        align-items: flex-start;
        margin: 0 0 1.5rem;
        padding: 1rem 1.25rem;
        border-radius: 6px;
        border-left: 3px solid var(--color-border);
        background: var(--color-surface);
        font-size: 1rem;
        line-height: 1.5;

        & .article-notice-icon {
            flex: 0 0 auto;
            margin-top: 0.1rem;
        }

        & .article-notice-title {
            font-weight: 600;
            color: var(--color-text);
        }

        & .article-notice-body {
            color: var(--color-muted);
            margin-top: 0.25rem;
        }

        & .article-notice-actions {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-top: 0.75rem;
        }

        &.info {
            border-left-color: var(--color-warning);
            background: var(--color-warning-bg);
        }

        &.error {
            border-left-color: var(--color-error);
        }
    }
}
```

- Icon: small inline SVG (info circle for `info`, triangle for `error`),
  `aria-hidden="true"`; the title text carries the meaning.
- "Read on <host>" CTA: render as the primary affordance for `info` and
  for retry-less errors, styled like the existing publisher link
  (`--color-primary`). It is an `<a href>` (project rule: links, not
  buttons, for navigation — see memory `feedback_links_not_buttons`).
- Retry stays a `<button>` (`handleRetry`, force-refetch) and only renders
  when `notice.retry` is true.
- "Fetching full article…" in-flight status keeps its existing
  `.article-fetch-status` styling; only the failed/partial path changes.
- **Use `--color-muted` for `.article-notice-body`, not
  `--color-text-secondary`.** The old `.article-fetch-status` rule uses
  `--color-text-secondary`, which is currently defined as `black` in
  `_variables.css` (the muted `#666` is commented out). The notice body
  is meant to be de-emphasized, so it must use `--color-muted` (#606060)
  as the CSS above already does — do not copy the old rule's token.

## Existing Patterns

- **Discriminated status result** — `FetchFullArticleResult` already maps
  1:1 onto `FullContentStatus`; extend the existing union rather than
  inventing a side channel.
- **Server is source of truth** — the DO writes the row, the client
  mirrors it (`pullSyncUpsertItem`) and renders from `item.*`. Partial
  state rides the same rail as every other status; no new field needed
  beyond the enum value.
- **Notice/legend styling** — the sync-status legend and empty-state work
  (`specs/006-sync-status-legend`, `015-empty-state-pending-updates`)
  already use the `_variables.css` warning/error tokens; match them.
- **Publisher link helpers** — reuse `publisher-link.ts`; do not
  reconstruct hostnames inline.

## Implementation Phases

### Phase 1: Server salvage (no client change yet)

1. (TDD) Add `article-fetch.ts` tests:
   - truncated body whose `<article>` is within the window →
     `succeeded_partial` with non-empty html.
   - truncated body with no extractable block → `failed_too_large`.
   - un-truncated oversize-after-extraction → `failed_too_large`
     (extractor verdict, unchanged).
   - existing within-cap success/failure cases stay green.
   Use a real-world-shaped fixture (article block + trailing megabytes of
   `<script>` bloat), mirroring the WIRED layout proven in research.
2. Change `readBoundedBody` (A1), `fetchFullArticle` (A2),
   `extractArticleBody` signature + truncation-gated fallback (A3).
3. `schema.ts`: add `succeeded_partial` to the type and the array (A4).
4. DO handler: persist `succeeded_partial` content; broaden cache-hit and
   any `=== 'succeeded'` checks via `isSuccessStatus` (A4). Add a DO/
   endpoint test (`test/fetch-full-endpoint.ts`) for the partial write +
   cache-hit-on-partial.

### Phase 2: Client messaging + notice UI

1. (TDD) Add `item-reader` tests asserting `noticeForStatus` returns the
   right `variant`/`retry` per status; that a `succeeded_partial` item
   renders the body **and** an `info` notice while a `failed_*` item
   renders the matching variant; that the notice precedes the article
   body in DOM order (AC7); and that a `failed_*` item still renders the
   summary-fallback body node beneath the notice (AC7). Assert on
   variant/`data-*`/action presence and DOM order, **not** copy strings
   (project rule: no HTML-text assertions).
2. Implement `noticeForStatus`, the notice component, and the CSS (B1/B2).
3. Wire `isPartial`/notice into the render; collapse the duplicate bottom
   publisher link when the notice owns the CTA.
4. `/impeccable craft` polish pass on the component.

### Phase 3: Verify + document

1. Manual verification against the live WIRED item (the original repro)
   and at least one un-salvageable oversize page; capture before/after.
2. Add a human test plan under `DOCS/test-plans/` (matches recent
   convention, e.g. the mobile-feeds test plan).
3. Update `specs/002-full-article-fetch` status table to describe
   `succeeded_partial` and the new meaning of `failed_too_large`
   (documentation only — not a test).

## Additional Considerations

### Resolved decisions (confirmed 2026-05-30)

1. **New status vs. silent success → NEW STATUS.** Add `succeeded_partial`
   so we can honestly label partial content (matches the user's "tell them
   it was too big"). The rejected alternative — store salvaged content as
   plain `succeeded` with no partial indicator — was simpler but left the
   reader unable to say the content is partial, conflicting with the goal.
2. **Truncation-tolerant `findFirstTagInner` (A3) → KEEP IT,** strictly
   gated on `truncated`. Front-loaded-bloat layouts need it, and the WIRED
   evidence shows complete-page behavior is untouched. The rejected
   alternative was to defer it until telemetry showed `failed_too_large`
   persisting.
3. **Cap value → LEAVE AT 3 MiB.** With salvage, the article is recovered
   from the first ~500 KiB for WIRED, so the exact cap matters far less.
   Do not re-tune here.

### Risks

- **Truncated HTML fed to the extractor.** The extractor is regex/string
  based and already strips scripts/styles/comments and caps output at
  `MAX_FULL_CONTENT_BYTES`; truncation can only reduce what it sees.
  Worst case is `no_body` → `failed_too_large`, i.e. today's behavior.
- **Status sprawl.** One new enum value touches schema, the DO write +
  cache-hit, client mapping, and any exhaustive `switch`. Grep
  `'succeeded'` across server + client when adding it
  (`isSuccessStatus` helper contains the blast radius).
- **Exact size in copy.** We stop at the cap, so we only know "≥ cap" —
  do not promise a precise size. If a number is wanted later, the server
  would need to read past the cap solely to count bytes (wasteful) or
  read a `Content-Length` header when present (often absent / compressed).
  Left out of scope.

### Testing notes

- Server tests use injected `fetchFn` + `resolveHostname` (existing
  pattern in `test/article-fetch.ts`); no network.
- Client tests assert mapping and affordances, never literal copy
  (global rule: do not test specific HTML text; do not write tests for
  docs).
