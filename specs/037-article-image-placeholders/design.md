# Design: Article Image Dimension Placeholders

**Feature**: `037-article-image-placeholders`
**Created**: 2026-06-07
**Status**: Approved (pending implementation)

## Goal

Reduce layout shift and improve perceived load quality for images
*inside* article bodies. Where an article image declares its
`width`/`height`, reserve the correct box and show a light-gray
placeholder until the image paints. All article images also get
`loading="lazy"` and `decoding="async"`.

This is the deliberately cheap alternative to per-image blurhash:
purely client-side at render time, using the dimensions already present
in the source HTML. No image fetch/decode, no DO/SQLite changes, no
new storage, no `/api/sync` changes.

## Context

The article view is `src/client/routes/item-reader.ts`. The body HTML
is chosen and sanitized at render time:

```ts
const articleHtml = sanitizeHtml(
    item.full_content ||
    item.content ||
    item.description ||
    ''
)
```

and injected via `dangerouslySetInnerHTML` into `.article-body`.

`sanitizeHtml` (`src/client/util.ts`) runs DOMPurify with
`FORBID_TAGS: ['style','form']` and `FORBID_ATTR: ['style']`. It does
**not** forbid `loading` or `decoding` (standard `<img>` attributes),
so those survive sanitization. Inline `style` would be stripped, which
is why box reservation must come from CSS, not inline styles.

`item-reader.css` already styles article images:

```css
& img {
    max-width: 100%;
    height: auto;
    margin: 1rem 0;
}
```

With `height: auto` plus `width`/`height` attributes on an `<img>`,
the browser already derives an implicit `aspect-ratio` and reserves the
correct space **today**. So box reservation is effectively free for
images that carry dimensions; the only missing pieces are the gray
placeholder color and lazy-loading.

`--color-placeholder: #dcdcdc` already exists in
`src/client/_variables.css` and is the project's existing light-gray
placeholder token. We reuse it (no new color).

## Decisions

- **Dimension source**: only the `width`/`height` already present on
  each `<img>` in the source HTML. No per-image fetch or decode.
- **Images without dimensions**: load normally. They stay zero-height
  until loaded, so no reserved box and no visible gray box. This is
  intentional — a guessed default ratio would itself cause shift.
- **Placeholder**: CSS `background-color: var(--color-placeholder)` on
  `.article-body img`. Visible only where the box has reserved size
  (i.e. images with dimensions), which is exactly the desired behavior.
- **Lazy-loading**: applied to *all* article images via a string
  transform (see below). It must be present in the HTML *before* the
  browser parses the `<img>`, so it cannot be added post-mount — by
  then the fetch has already started.
- **Scope of HTML sources**: the transform and CSS apply to whichever
  source is rendered (`full_content`, `content`, or `description`),
  because they act on the final article HTML, not on stored content.

## Known Tradeoff

A transparent PNG (e.g. a logo or diagram) will show the gray behind it
permanently, because CSS cannot detect "image finished loading." Most
article images are opaque photos, so we accept this rather than add
runtime `load` listeners. Revisit only if it proves objectionable.

## Changes

### 1. New client util — `src/client/util.ts`

Add a pure string transform that adds loading hints to every `<img>`:

```ts
export function addImageLoadingHints (html:string):string {
    if (!html) return html
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const imgs = doc.body.querySelectorAll('img')
    if (imgs.length === 0) return html
    imgs.forEach((img) => {
        img.setAttribute('loading', 'lazy')
        img.setAttribute('decoding', 'async')
    })
    return doc.body.innerHTML
}
```

Pure `string -> string`. Idempotent (re-setting the same attributes is
a no-op). Leaves non-`<img>` markup untouched. Returns the input
unchanged when there are no images or the input is empty.

### 2. Wire into render — `src/client/routes/item-reader.ts`

Apply the transform before sanitization so DOMPurify remains the final
gate, and memoize so it does not re-run on unrelated re-renders:

```ts
const rawHtml = item.full_content ||
    item.content ||
    item.description ||
    ''
const articleHtml = useMemo(
    () => sanitizeHtml(addImageLoadingHints(rawHtml)),
    [rawHtml]
)
```

(`item-reader.ts` already imports `{ useCallback, useEffect } from
'preact/hooks'` — add `useMemo` to that import. Import
`addImageLoadingHints` alongside the existing `sanitizeHtml` import.)

### 3. CSS — `src/client/routes/item-reader.css`

Add the placeholder color to the existing `.article-body img` rule.
Nothing else changes; `max-width`, `height: auto`, and `margin` stay.

```css
& img {
    max-width: 100%;
    height: auto;
    margin: 1rem 0;
    background-color: var(--color-placeholder);
}
```

## Testing

Unit-test `addImageLoadingHints` only, in a new `test/article-images.ts`
(tests live flat under `test/`, e.g. `article-extract.ts`):

- adds `loading="lazy"` and `decoding="async"` to an `<img>`
- preserves existing attributes (`src`, `width`, `height`, `alt`)
- applies to multiple images
- no-op / returns input when there are no images
- empty string returns empty string
- idempotent: running twice yields the same result

Pure-function tests only — no assertions on article text content and no
DOM-text assertions on the reader (consistent with the project's
no-brittle-tests rule). The CSS change is visual and has no unit test.

## Out of Scope

- Blurhash for article images (the more expensive alternative we chose
  not to build now). The per-image-URL blurhash pipeline and KV cache
  remain thumbnail-only.
- Any server / Durable Object / SQLite / `/api/sync` change.
- Per-image fetching or decoding to recover dimensions for images that
  lack `width`/`height` in the source.
- Runtime handling of the transparent-PNG placeholder tradeoff.
- No eslint changes; no unrelated CSS changes.
