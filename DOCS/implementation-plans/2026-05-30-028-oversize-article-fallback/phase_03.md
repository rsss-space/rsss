# Oversize Article Fallback — Phase 3: Verify + Document

**Goal:** Capture the manual verification procedure (the original WIRED
repro plus an unsalvageable oversize page) as a human test plan, and update
the `specs/002-full-article-fetch` documentation to describe the new
`succeeded_partial` status and the revised meaning of `failed_too_large`.

**Architecture:** Documentation + manual verification only. No production
code changes, no automated tests (project rule: do not write tests for
docs). The automated guarantees live in Phases 1–2; this phase records what
those tests cover and what a human should eyeball.

**Tech Stack:** Markdown docs under `DOCS/test-plans/` and
`specs/002-full-article-fetch/`.

**Scope:** Phase 3 of 3 from
`DOCS/design-plans/2026-05-30-028-oversize-article-fallback.md`. Depends on
Phases 1 and 2 being complete and green.

**Codebase verified:** 2026-05-30. `specs/002-full-article-fetch/` exists;
the Fetch Status enum table + state machine are in `data-model.md`
(table rows ~60–65, state machine ~71–78, invariant ~97); the endpoint
algorithm + cache-hit prose are in `contracts/fetch-full-article.md`
(cache-hit ~44/165, algorithm steps ~165–184, response statuses ~69–75).
The most recent test-plan format is
`DOCS/test-plans/2026-05-30-027-mobile-feeds-route.md`.

---

## Acceptance Criteria Coverage

**Verifies: None (documentation + manual verification).** The acceptance
criteria are implemented and automatically tested in Phases 1–2. This phase
documents the manual verification steps (notably AC1's live WIRED repro,
AC2's unsalvageable case, AC4/AC6's visual/a11y quality) and updates the
feature spec. No new automated tests are added (global rule: do not write
tests for docs).

---

## Context for the implementing engineer

This phase writes two Markdown documents and edits a third. Match the
existing house conventions.

**Test-plan format (from `DOCS/test-plans/2026-05-30-027-mobile-feeds-route
.md`, verified):** a top header with `Feature:`, `Branch:`, and a commit
`Range:`; an "Automated coverage (already green)" section listing each test
file, its pass count, what it proves, and the AC ids; a note about the
pre-existing unrelated `test/deploy-config.mjs` failure; then a "Manual
verification" section with plain numbered steps (prose, not nested lists)
describing what to do in the running app and what to observe.

**The branch for this work is `article-load-error`** (base `staging`).

**Status docs to update (verified locations):**
- `specs/002-full-article-fetch/data-model.md` — the "Fetch Status" enum
  table (one row per status) and the textual state machine below it, plus
  the invariant line listing allowed values.
- `specs/002-full-article-fetch/contracts/fetch-full-article.md` — the
  cache-hit condition (`full_content_status === "succeeded"`), the
  response-status list, and the algorithm steps that today say a read over
  `MAX_ARTICLE_FETCH_BYTES` fails as `failed_too_large`.

**Project rules:** no emojis in files; prose over deep nesting; do not write
automated tests for docs; do not assert specific HTML text anywhere.

---

<!-- START_TASK_1 -->
### Task 1: Write the human test plan

**Files:**
- Create: `DOCS/test-plans/2026-05-30-028-oversize-article-fallback.md`

**Implementation:**

Write the test plan following the `027-mobile-feeds-route` format. Include:

1. Header: `Feature: 028-oversize-article-fallback`, `Branch:
   article-load-error` (base `staging`), and a commit `Range:` (fill in the
   first/last commit of this branch's work; the executor can read it from
   `git log` at write time).

2. "Automated coverage (already green)" — list the Phase 1–2 tests and the
   ACs they cover (do NOT quote their internal assertions verbatim; describe
   what they prove):
   - `test/article-extract.ts` — truncation-gated extraction salvages an
     unclosed `<article>` only when `truncated`; complete-doc extraction
     unchanged. (AC1)
   - `test/article-fetch.ts` — oversize-but-salvageable →
     `succeeded_partial`; oversize-unsalvageable → `failed_too_large`;
     within-cap clean → `succeeded`. (AC1, AC2, AC5)
   - `test/fetch-full-endpoint.ts` — DO persists `succeeded_partial` content
     and treats partial rows as cache hits; `succeeded` path unchanged.
     (AC1, AC5)
   - `test/article-notice.ts` — status→variant/retry mapping with distinct
     messages; `ArticleNotice` variant/CTA/Retry/aria affordances; reader
     renders the notice above the body, preserves the summary fallback on
     failure, and collapses the duplicate publisher link. (AC3, AC4, AC6,
     AC7)
   - `npm run build`, `npm run lint`, `npm run stylelint` pass.
   - Note the pre-existing, unrelated `test/deploy-config.mjs` failure
     (`blurhash-jobs-staging` queue naming) as out of scope, failing
     identically at the branch base.

3. "Manual verification" — numbered steps run against the app
   (`npm start` / the dev server) while logged in. Cover the cases automated
   tests can't fully assert (real publisher pages, visual quality, a11y):
   - **AC1 / AC4 (the original repro):** open the WIRED item that triggered
     this work (a page > 3 MiB whose `<article>` is near the front).
     Confirm the reader shows the article body AND, **above it**, an info
     notice (warning palette — cream background, amber left bar, info icon)
     stating the page was too large to download in full, with a "Read the
     full article on wired.com" link. Confirm it does NOT look like an
     error, and there is no duplicate publisher link at the bottom.
   - **AC2:** open a page that front-loads megabytes of inline JSON/script
     before any article (best-effort to find one; the deterministic
     guarantee is the automated `failed_too_large` test). Confirm an error
     notice (red left bar, warning icon) saying the article is too large to
     show in full, with a publisher CTA and no Retry.
   - **AC3 (retry where it helps):** trigger a network failure (e.g. open an
     item whose link host is unreachable, or go offline mid-fetch). Confirm
     the error notice offers a Retry button; confirm a redirect/non-html/
     no-body failure shows a distinct message with NO Retry.
   - **AC5 (happy path):** open a normal within-cap article. Confirm the
     full body renders, no notice appears, and the bottom "Read the full
     article on …" link is present as before.
   - **AC6 (a11y):** tab through a notice — the Retry button and publisher
     link are keyboard-reachable; a screen reader announces the title text
     and does not announce the decorative icon.
   - Capture before/after screenshots of the WIRED case for the PR.

**Verification:**
Run: `ls DOCS/test-plans/2026-05-30-028-oversize-article-fallback.md`
Expected: file exists.
Run: `npm run lint`
Expected: clean (Markdown is not linted by eslint, but confirm nothing else
regressed).

**Commit:** `docs: add human test plan for oversize article fallback`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update the `002-full-article-fetch` status documentation

**Files:**
- Modify: `specs/002-full-article-fetch/data-model.md`
- Modify: `specs/002-full-article-fetch/contracts/fetch-full-article.md`

**Implementation:**

Documentation only — bring the feature spec in line with the new behavior.
Do not change any code or tests in this task.

In `data-model.md`:
1. Add a `succeeded_partial` row to the "Fetch Status" enum table, between
   `succeeded` and the `failed_*` rows. Describe it as: salvaged from a
   truncated (oversize) download — `full_content` holds the article as found
   within the read window, possibly missing late sections; the reader shows
   the body plus a non-error "info" notice.
2. Revise the `failed_too_large` row so its meaning matches the new code: we
   no longer fail on download size alone. `failed_too_large` now means the
   read was truncated at `MAX_ARTICLE_FETCH_BYTES` AND no usable body could
   be extracted from the prefix, OR the extracted body exceeded
   `MAX_FULL_CONTENT_BYTES` and could not be truncated to a clean boundary.
3. Update the state machine block to include `succeeded_partial` as a
   success outcome (e.g. `NULL --(salvaged truncated)--> succeeded_partial`,
   and `succeeded_partial` is treated as a cache hit like `succeeded`), and
   update the invariant line that enumerates allowed `full_content_status`
   values to include `succeeded_partial`.

In `contracts/fetch-full-article.md`:
4. Update the cache-hit description so a row with `full_content_status ===
   "succeeded"` **or** `"succeeded_partial"` (and non-empty `full_content`)
   is served from cache without re-fetching.
5. Add `"succeeded_partial"` to the list of response statuses the endpoint
   can return (alongside `"succeeded"`), noting `full_content` is non-empty
   for it too.
6. Update the algorithm steps that currently say exceeding
   `MAX_ARTICLE_FETCH_BYTES` while reading → `failed_too_large`: the read now
   stops at the cap and marks the result truncated; extraction then runs on
   the prefix, yielding `succeeded_partial` on success or `failed_too_large`
   only when the prefix has no usable body.

**Verification:**
Run: `git diff --stat specs/002-full-article-fetch/`
Expected: both files modified.

Confirm there are no dangling references to the old "size fails the read"
behavior:
Run: `grep -n "succeeded_partial" specs/002-full-article-fetch/data-model.md specs/002-full-article-fetch/contracts/fetch-full-article.md`
Expected: matches in both files.

**Commit:** `docs: document succeeded_partial and revised failed_too_large`
<!-- END_TASK_2 -->

---

## Phase 3 Done When

- `DOCS/test-plans/2026-05-30-028-oversize-article-fallback.md` exists,
  listing the Phase 1–2 automated coverage (with AC ids) and the manual
  verification steps, including the live WIRED repro (AC1/AC4), an
  unsalvageable oversize case (AC2), retry-where-it-helps (AC3), the happy
  path (AC5), and a11y (AC6), plus the out-of-scope `deploy-config.mjs` note.
- `specs/002-full-article-fetch/data-model.md` describes `succeeded_partial`
  in the Fetch Status table + state machine + invariant, and the revised
  `failed_too_large` meaning.
- `specs/002-full-article-fetch/contracts/fetch-full-article.md` reflects the
  partial-aware cache hit, the `succeeded_partial` response status, and the
  truncate-then-salvage algorithm.
- No production code or automated tests changed in this phase.
