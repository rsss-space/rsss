# Quickstart: Show Article Source URL

How to implement and verify this feature.

## What changes

1. `src/client/components/item-row.ts` — inside `.item-meta`, add a
   `<span class="item-url">` as the **first** child (before
   `.item-feed`), rendered only when `item.link` has a non-empty
   trimmed value.
2. `src/client/components/item-row.css` — add an `.item-url` rule
   (muted color, single-line ellipsis truncation).
3. `test/item-row.ts` — add present/absent cases.

Nothing in `src/server/**`, `src/client/db/**`, `src/client/routes/**`,
or any schema/sync code changes.

## Implementation sketch

In `item-row.ts`, the current meta block is:

```ts
<div class="item-meta">
    <span class="item-feed">${item.feed_title}</span>
    ${item.pub_date && html`<time class="item-date" ...>...</time>`}
</div>
```

Compute a guarded value near the other derived fields:

```ts
const sourceUrl = item.link?.trim()
```

Then render the URL as the FIRST child of `.item-meta` (column-reverse
puts the first DOM child at the bottom, i.e. beneath the feed title):

```ts
<div class="item-meta">
    ${sourceUrl && html`
        <span class="item-url" title=${sourceUrl}>${sourceUrl}</span>
    `}
    <span class="item-feed">${item.feed_title}</span>
    ${item.pub_date && html`<time class="item-date" ...>...</time>`}
</div>
```

CSS (`item-row.css`), reusing existing variables, font-size >= 1rem:

```css
& .item-url {
    color: var(--color-muted);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
```

(Add it inside the existing `.item-row { ... }` nested block, near
`.item-meta`, so no unrelated selectors are touched.)

## Automated verification

```sh
npm test && npm run lint
```

Add to `test/item-row.ts`:

- **URL present**: render `item({ link: 'https://example.com/a/b' })`,
  assert `root.querySelector('.item-url')` exists and its
  `textContent` reflects the link.
- **URL absent**: render `item({ link: null })`, assert
  `root.querySelector('.item-url')` is `null` (FR-004 — no placeholder).

Keep assertions structural (presence/absence + the bound value); do not
assert layout geometry or static copy.

## Manual verification (Constitution: in-browser before "done")

1. `npm start`, sign in, open the home page (feed-reader route) with
   articles from at least two different sites.
2. Confirm each item shows its post URL beneath the feed title
   ("culture latest"), and the host is visible (FR-001, FR-002, SC-001).
3. Find or simulate an item with no link — confirm no URL line and no
   blank gap appears (FR-004, US2).
4. Confirm a very long URL truncates with an ellipsis and the list does
   not scroll horizontally at desktop and mobile widths (FR-005,
   SC-003).
5. Confirm two items sharing a feed title are distinguishable by their
   URLs (US1 scenario 3, SC-004).

## Acceptance mapping

- FR-001 / FR-003 — URL beneath feed title in `.item-meta` (step 2).
- FR-002 — value is `item.link` (the article's own URL).
- FR-004 — omitted when `link` is empty/null (step 3, absent test).
- FR-005 / SC-003 — CSS ellipsis truncation (step 4).
- FR-006 — same rendering for every linked item (uniform component).
