# Human Test Plan — Oversize Article Fallback

Feature: `028-oversize-article-fallback`
Branch: `article-load-error` (base `staging`)
Range: `7489164..add2e9a` (through the docs commits on this branch)

## Automated coverage (already green)

- `test/article-extract.ts` — truncation-gated extraction salvages an
  unclosed `<article>` only when `truncated`; complete-doc extraction
  unchanged. (AC1)
- `test/article-fetch.ts` — oversize-but-salvageable yields
  `succeeded_partial`; oversize-unsalvageable yields `failed_too_large`;
  within-cap clean yields `succeeded`. (AC1, AC2, AC5)
- `test/fetch-full-endpoint.ts` — DO persists `succeeded_partial` content
  and treats partial rows as cache hits; `succeeded` path unchanged. (AC1, AC5)
- `test/article-notice.ts` — status-to-variant and status-to-retry mapping
  with distinct messages; `ArticleNotice` variant, CTA, Retry, and aria
  affordances; reader renders the notice above the body, preserves the summary
  fallback on failure, collapses the duplicate publisher link. (AC3, AC4, AC6, AC7)
- `npm run build`, `npm run lint`, `npm run stylelint` all pass.

Pre-existing, unrelated failure: `test/deploy-config.mjs` (wrangler staging
blurhash-jobs-staging queue naming assertion) fails identically at the branch
base. Out of scope for this feature.

## Manual verification

These cover behavior that automated unit tests cannot fully assert (real
publisher pages, visual quality, a11y). Run with the dev server (`npm start`)
while logged in.

### Original WIRED repro and salvage behavior (AC1, AC4)

1. Add the WIRED article that triggered this work (a page > 3 MiB whose
   `<article>` tag is near the front) to your feeds and open it in the reader.
2. The reader displays the article body.
3. Above the body, confirm an info-palette notice appears: cream background,
   amber left border, info icon (not a warning or error icon).
4. The notice text states the page was too large to download in full; below
   it is a "Read the full article on wired.com" link.
5. The notice does not visually resemble an error state.
6. At the bottom of the reader, there is no duplicate publisher link (the
   "Read the full article on wired.com" link appears only in the notice).

### Unsalvageable oversize (AC2)

7. Find a page that front-loads megabytes of inline JSON or script before any
   article (best effort; the deterministic guarantee is covered by automated
   tests). Open it in the reader.
8. An error-palette notice appears: red left border, warning icon.
9. The notice text says the article is too large to show in full.
10. A "Read the full article on {publisher}" CTA link is present.
11. There is no Retry button (because the truncated prefix had no extractable
    body).

### Retry where it helps (AC3)

12. Trigger a network failure by opening an article whose link host is
    unreachable, or by going offline mid-fetch.
13. An error notice appears with a Retry button that re-attempts the fetch.
14. For non-network failures (redirect loop, non-HTML response, response with
    no body), the notice shows a distinct message and does not offer Retry.

### Happy path — within-cap article (AC5)

15. Open a normal article (full HTML within the fetch cap).
16. The reader displays the complete article body without any notice.
17. The bottom "Read the full article on {publisher}" link is present as
    before this feature.

### Keyboard and screen-reader accessibility (AC6)

18. Navigate to a reader with an active notice. Tab through the page.
19. The Retry button (if present) and the publisher link are keyboard-reachable
    and correctly focused in tab order.
20. Using a screen reader, navigate through the notice. The screen reader
    announces the title text and the link destination, but does not announce
    the decorative icon separately.

### Before/after artifacts

21. Capture a before-and-after screenshot of the WIRED case (the original
    repro with salvaged body and info notice) for the PR.
