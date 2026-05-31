# Oversize Article Fallback — Test Requirements

Maps each acceptance criterion (`028-oversize-article-fallback.AC1`–`AC7`)
to its verification: automated test(s) with the exact file path, test type,
and run command, plus documented human verification where automation cannot
reach (real publisher pages, final visual polish, screen-reader behavior).

This is derived from the design plan and the three implementation phases.
It honors the project rules: automated tests assert variant / class /
`data-*` / DOM order / presence, **never** literal HTML text content; and no
automated tests are written for documentation (Phase 3 is verified by file
existence plus manual steps).

## Test files and run commands

The phases create or extend exactly these test files. Each `.ts` test is
bundled with `esbuild` and run through `tapout` (real DOM) or `tap-spec`.

1. `test/article-extract.ts` (unit — extractor on inline HTML strings)
   - `esbuild ./test/article-extract.ts --bundle | tapout`
2. `test/article-fetch.ts` (unit — `fetchFullArticle` via injected `fetchFn`
   + `resolveHostname`; no network)
   - `esbuild ./test/article-fetch.ts --bundle | tapout`
3. `test/fetch-full-endpoint.ts` (DO endpoint — `createHarness` over a mock
   `UserDO`; no Miniflare)
   - `esbuild ./test/fetch-full-endpoint.ts --bundle --platform=node`
     `--format=esm`
     `--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts`
     `| node --input-type=module | tap-spec`
4. `test/article-notice.ts` (NEW — three concerns in one file:
   `noticeForStatus` mapping (pure), `ArticleNotice` render (real DOM), and
   `ItemReader` placement render (real DOM))
   - `esbuild ./test/article-notice.ts --bundle --loader:.css=text`
     `--loader:.wasm=dataurl | tapout`
   - Registered in `test/run-all-tests.mjs` alongside the other render tests.

Human verification plan (created in Phase 3, Task 1):
`DOCS/test-plans/2026-05-30-028-oversize-article-fallback.md`.

---

## AC1 — Oversize pages are salvaged

A page whose HTML exceeds `MAX_ARTICLE_FETCH_BYTES` but whose extractable
block lies within the read window stores the extracted body with a
partial-success status, and the reader displays that body.

Automated:

| Layer | Restatement | Type | File |
|---|---|---|---|
| Extractor | Truncation-gated match salvages an opened-but-unclosed `<article>`/`<main>` only when `{ truncated:true }`; complete-doc behavior unchanged | unit | `test/article-extract.ts` |
| Pipeline | `<article>` with real text near the front + > cap of trailing junk → status `succeeded_partial`, `html` non-empty | unit (injected `fetchFn`) | `test/article-fetch.ts` |
| DO write | Stub fetcher returns `succeeded_partial` + html → `POST /items/1/fetch-full` persists non-empty `full_content` and `full_content_status === 'succeeded_partial'` | DO-endpoint (`createHarness`) | `test/fetch-full-endpoint.ts` |
| Reader | `succeeded_partial` item with `full_content` set renders a `.article-body` node (partial body shown). Body is `full_content \|\| content \|\| description`, so the partial body renders | component-render-DOM | `test/article-notice.ts` |

Run: the four commands above (one per file).

Human portion: open the live WIRED item (the original > 3 MiB repro whose
`<article>` is near the front) and confirm the partial body actually renders
in the running app. Documented in the Phase 3 test plan (AC1 / AC4 step).

---

## AC2 — Unsalvageable oversize → clear failure

A page that exceeds the cap whose readable body is not within the read
window stores `failed_too_large`, and the reader shows the "too large"
notice with a publisher CTA.

Automated:

| Layer | Restatement | Type | File |
|---|---|---|---|
| Pipeline | > cap of leading junk before any extractable block → status `failed_too_large` (truncated + extractor errored). The pre-existing `'x'.repeat(cap+1)` filler case is retained, re-described as this path | unit (injected `fetchFn`) | `test/article-fetch.ts` |
| Reader | `failed_too_large` item renders an `error`-variant `.article-notice` with a publisher CTA `<a.article-notice-cta>` and no Retry button | component-render-DOM | `test/article-notice.ts` |

Run: `test/article-fetch.ts` and `test/article-notice.ts` commands.

Human portion: best-effort, find a real page that front-loads megabytes of
inline JSON before the article and confirm the error notice (red left bar,
no Retry, publisher CTA). The deterministic guarantee is the automated
`failed_too_large` pipeline test; the live page is best-effort. Documented in
the Phase 3 test plan (AC2 step).

---

## AC3 — Per-status messaging

Each terminal status maps to its own notice variant and action set; no two
distinct statuses collapse to the same message.

Automated:

| Layer | Restatement | Type | File |
|---|---|---|---|
| Mapping | For each of the 7 terminal statuses (`succeeded_partial`, `failed_too_large`, `failed_network`, `failed_status`, `failed_redirect`, `failed_non_html`, `failed_no_body`), `noticeForStatus` returns the expected `variant` and `retry` flag | unit (pure) | `test/article-notice.ts` |
| Distinctness | Collect the 7 `title` strings; assert a `Set` of them has size 7 (pairwise unique). Proves "no two statuses collapse" **without** asserting specific copy | unit (pure) | `test/article-notice.ts` |
| Non-terminal | `noticeForStatus('succeeded')`, `(null)`, `(undefined)`, and an unknown string all return `null` | unit (pure) | `test/article-notice.ts` |
| Affordances | `error` + `retry:true` (e.g. `failed_network`) renders both CTA and `<button.article-notice-retry>`; `error` + `retry:false` (e.g. `failed_redirect`) renders the CTA and NO Retry | component-render-DOM | `test/article-notice.ts` |

Run: `test/article-notice.ts` command.

Implementation note honored: distinctness is tested via a Set-of-titles
size check, NOT by asserting any specific copy string. Retry-where-it-helps
(`failed_network`/`failed_status` only) is asserted via the `retry` flag and
the presence/absence of the Retry button.

Human portion: AC3's retry-where-it-helps in the live app (trigger a real
network failure to see Retry; confirm a redirect / non-html / no-body
failure shows a distinct message with no Retry). Documented in the Phase 3
test plan (AC3 step).

---

## AC4 — Partial content is labeled

A partially-salvaged article shows the body and a non-error notice (warning
palette, not error palette) telling the reader the page was too large, with
"Read on <publisher>".

Automated:

| Layer | Restatement | Type | File |
|---|---|---|---|
| Model | `noticeForStatus('succeeded_partial')` → `variant:'info'`, `retry:false` (non-failure) | unit (pure) | `test/article-notice.ts` |
| Component | An `info` notice with a valid `link` renders a root with classes `article-notice` and `info` (and NOT `error`) — proves warning palette — plus a `<a.article-notice-cta>` with non-empty `href` | component-render-DOM | `test/article-notice.ts` |
| Reader | `succeeded_partial` item renders BOTH the `info` `.article-notice` and the `.article-body` (body shown alongside the label) | component-render-DOM | `test/article-notice.ts` |

Run: `test/article-notice.ts` command.

Human portion: confirm the partial notice does not visually read as an error
on the live WIRED page (cream background, amber left bar, info icon) — final
visual judgment that DOM assertions cannot make. Documented in the Phase 3
test plan (AC1 / AC4 step).

---

## AC5 — No regression on the happy path

A within-cap clean article stays `succeeded`, shows no notice, renders the
body; cache-hit short-circuit still skips re-fetching already-succeeded
(including partial) rows.

Automated:

| Layer | Restatement | Type | File |
|---|---|---|---|
| Pipeline | Small within-cap cleanly-closed `<article>` → status `succeeded` (unchanged), `html` non-empty; within-cap no-body page → `failed_no_body` (unchanged) | unit (injected `fetchFn`) | `test/article-fetch.ts` |
| Extractor | Complete document with a properly closed `<article>` yields identical result with and without `{ truncated:true }` (gate does not alter closed-tag extraction) | unit | `test/article-extract.ts` |
| Cache hit (partial) | Seed a `succeeded_partial` row with non-empty `full_content`; `POST` without `force` → 200, fetcher call count stays 0 (cache hit). Exercises `isSuccessStatus` treating partial as a hit | DO-endpoint | `test/fetch-full-endpoint.ts` |
| Cache hit (succeeded) | Existing `succeeded` cache-hit + succeeded-write tests still pass; a failure result still writes status and preserves prior `full_content` | DO-endpoint | `test/fetch-full-endpoint.ts` |
| Reader | A `succeeded` item renders NO `.article-notice` and DOES render the bottom `.article-publisher-link` (no-notice path unchanged) | component-render-DOM | `test/article-notice.ts` |

Run: `test/article-fetch.ts`, `test/article-extract.ts`,
`test/fetch-full-endpoint.ts`, `test/article-notice.ts` commands.

Implementation note honored: cache-hit-on-partial is verified through
`isSuccessStatus` (partial counts as success), and the write-branch
discriminant moved to `'html' in result` so both `succeeded` and
`succeeded_partial` persist content.

Human portion: open a normal within-cap article in the app and confirm full
body, no notice, and the bottom publisher link as before. Documented in the
Phase 3 test plan (AC5 step).

---

## AC6 — Notice quality

The notice meets project CSS rules (font ≥ 1rem, tokens only, nested
selectors) and is keyboard-reachable and screen-reader sensible (icon
decorative / `aria-hidden`; meaning in text).

Automated (the machine-checkable slice):

| Layer | Restatement | Type | File |
|---|---|---|---|
| A11y / structure | The icon wrapper `.article-notice-icon` carries `aria-hidden="true"` (decorative); the title text node exists (meaning in text). Text content is NOT asserted | component-render-DOM | `test/article-notice.ts` |
| Keyboard reach | Retry is a real `<button.article-notice-retry>` and the CTA is a real `<a.article-notice-cta>` (both natively focusable). Clicking the Retry button invokes the passed `onRetry` | component-render-DOM | `test/article-notice.ts` |
| CSS rules | `npm run stylelint` over `item-reader.css` (notice ruleset uses `_variables.css` tokens, font-size ≥ 1rem, nested selectors) | lint gate | `npm run stylelint` |

Run: `test/article-notice.ts` command, plus `npm run stylelint`.

Human portion: final visual polish (the `/impeccable craft` pass in Phase 2
Task 4) and actual screen-reader behavior — tab through a live notice to
confirm Retry and CTA are reachable, and that a screen reader announces the
title while skipping the decorative icon. These are visual / assistive-tech
judgments that DOM presence checks cannot fully cover. Documented in the
Phase 3 test plan (AC6 a11y step).

---

## AC7 — Notice placement and failure fallback

Any rendered notice appears above the article body in DOM order; a hard
failure still renders the existing `content`/`description` summary fallback
beneath the notice (summary not suppressed).

Automated:

| Layer | Restatement | Type | File |
|---|---|---|---|
| Order (partial) | For a `succeeded_partial` item with `full_content`, both `.article-notice` (class `info`) and `.article-body` exist, and the notice precedes the body via `notice.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING` | component-render-DOM | `test/article-notice.ts` |
| Order + fallback (failure) | For a `failed_network` item with `content` set and no `full_content`, `.article-notice` (class `error`) exists, `.article-body` exists and is non-empty (`innerHTML.length > 0` / `textContent` non-empty — NOT specific text), and the notice precedes the body | component-render-DOM | `test/article-notice.ts` |
| CTA collapse | For any item that renders a notice, NO `.article-publisher-link` exists (the notice owns the CTA); for a `succeeded` item, `.article-publisher-link` IS present | component-render-DOM | `test/article-notice.ts` |

Run: `test/article-notice.ts` command.

Implementation notes honored: DOM order is asserted with
`compareDocumentPosition` (not by index). The failure fallback body renders
because `articleHtml = full_content || content || description` is always
computed and never gated on status; the test asserts the fallback node's
presence and non-emptiness, never its text. No human portion required —
fully covered by automation.

---

## Human verification summary

| Concern | Why it cannot be automated | Approach | Reference |
|---|---|---|---|
| AC1 / AC4 — live WIRED repro | Real publisher page > 3 MiB; needs network + visual confirmation the partial body renders and the info notice does not read as an error | Open the WIRED item in the running app; confirm partial body + info notice (warning palette) above it; no duplicate bottom link | Phase 3 test plan |
| AC2 — real unsalvageable page | Depends on finding a live page that front-loads megabytes before the article; best-effort only (deterministic guarantee is automated) | Open such a page; confirm error notice (red left bar, no Retry, publisher CTA) | Phase 3 test plan |
| AC3 — retry where it helps | Real network failure to exercise the live `articleFetchError` path | Trigger a network failure; confirm Retry appears; confirm a non-network failure shows a distinct message with no Retry | Phase 3 test plan |
| AC5 — happy path in app | End-to-end visual confirmation in the running app | Open a normal article; confirm body, no notice, bottom link present | Phase 3 test plan |
| AC6 — visual polish + screen reader | `/impeccable craft` final polish and assistive-tech behavior are not DOM-assertable | Tab through a notice; run a screen reader; confirm reachability and that the icon is skipped | Phase 3 test plan |

Phase 3 itself (the test plan and the `specs/002-full-article-fetch` doc
updates) is **not** covered by automated tests, per the project rule against
testing docs. It is verified by file existence (`ls` /
`git diff --stat` / `grep` checks in the phase) and by performing the manual
steps above.

---

## Coverage matrix

| AC | Automated test file(s) | Test type | Human verification |
|---|---|---|---|
| AC1 | `test/article-extract.ts`, `test/article-fetch.ts`, `test/fetch-full-endpoint.ts`, `test/article-notice.ts` | unit, unit, DO-endpoint, component-render-DOM | Yes — live WIRED repro (visual) |
| AC2 | `test/article-fetch.ts`, `test/article-notice.ts` | unit, component-render-DOM | Yes — real front-loaded page (best-effort) |
| AC3 | `test/article-notice.ts` | unit (pure) + component-render-DOM | Yes — live network-failure Retry path |
| AC4 | `test/article-notice.ts` | unit (pure) + component-render-DOM | Yes — partial notice not-an-error visual |
| AC5 | `test/article-fetch.ts`, `test/article-extract.ts`, `test/fetch-full-endpoint.ts`, `test/article-notice.ts` | unit, unit, DO-endpoint, component-render-DOM | Yes — happy path in app |
| AC6 | `test/article-notice.ts` + `npm run stylelint` | component-render-DOM + lint | Yes — polish + screen reader |
| AC7 | `test/article-notice.ts` | component-render-DOM | No — fully automated |

Every AC maps to at least one automated test. AC1, AC4, and AC6 additionally
carry a documented human-verification portion (and AC2/AC3/AC5 carry an
in-app confirmation step). AC7 is fully covered by automation with no human
portion required. No AC lacks a verification path.
