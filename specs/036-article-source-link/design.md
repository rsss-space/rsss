# Design: Source Link in Article Top Bar

**Feature**: `036-article-source-link`
**Created**: 2026-06-06
**Status**: Approved (pending implementation)

## Goal

Add a prominent link centered in the article view's top bar (the
`.reader-header`, between "< Back" and the star / "Mark read" actions)
that reads **"Read this article on \<host\>"** and links to the article
source. The existing bottom-of-article publisher link is kept.

## Context

The article view is `src/client/routes/item-reader.ts`. Its
`.reader-header` is a flex row (`justify-content: space-between`) with
`.btn-back` on the left and `.reader-actions` (star + Mark read/unread)
on the right.

Feature `030-article-source-url` already introduced a shared helper
`src/shared/publisher-link.ts` exposing:

- `publisherLinkLabel(link)` -> `"Read the full article on <host>"`
- `publisherLinkHref(link)` -> the parsed URL string

Both return `null` for empty, malformed, or non-http(s) links. That
helper drives the link rendered at the *bottom* of the article body
(`.article-publisher-link`), which is shown only when there is no
notice. Host normalization strips a leading `www.` and lowercases.

## Decisions

- **Wording**: `"Read this article on <host>"` (distinct from the
  bottom link's "Read the full article on <host>").
- **Bottom link**: kept unchanged. Same destination appears in two
  places (top bar + end of article).
- **Visibility**: the top-bar link is shown whenever the item has a
  valid http(s) link. Unlike the bottom link, it is NOT gated on the
  absence of a notice; it is a persistent header affordance.
- **Centering**: flex centering within the space between the two button
  groups (`flex: 1; text-align: center`), not absolute pixel-centering.
  Absolute centering risks overlapping the buttons on narrow widths.

## Changes

### 1. Shared helper - `src/shared/publisher-link.ts`

Add one pure sibling function, reusing the existing internal
`tryParse` + `publisherHost`:

```ts
export function sourceLinkLabel (link:string):string|null {
    const url = tryParse(link)
    if (!url) return null
    return 'Read this article on ' + publisherHost(url)
}
```

The href reuses the existing `publisherLinkHref` unchanged.

### 2. Render - `src/client/routes/item-reader.ts`

Insert a middle child in `.reader-header`, between `.btn-back` and
`.reader-actions`, rendered only when both helpers return non-null:

```ts
${(() => {
    const label = sourceLinkLabel(item.link)
    const href = publisherLinkHref(item.link)
    if (!label || !href) return null
    return html`<a
        class="reader-source-link"
        href=${href}
        target="_blank"
        rel="noopener noreferrer"
    >${label}</a>`
})()}
```

External link, opens in a new tab (mirrors the bottom link;
route-event leaves cross-origin links alone). When `item.link` is
missing or non-http(s), nothing renders and the bar looks as it does
today.

### 3. CSS - `src/client/routes/item-reader.css`

The `.reader-header` is already `display: flex; align-items: center;
justify-content: space-between`. Add the middle child:

- `flex: 1; text-align: center; min-width: 0`
- `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`
  (graceful truncation when cramped)

Style `.reader-source-link` prominently using existing tokens:

- `color: var(--color-primary)`
- `font-weight: 500`
- `font-size` inherits (>= 1rem per project rule)
- no underline by default, underline on `:hover`

```
+--------------------------------------------------------+
| < Back   Read this article on wired.com      *  Mark.. |
+--------------------------------------------------------+
   left          flex:1, centered            right actions
```

## Testing

Add `sourceLinkLabel` unit tests to `test/publisher-link.ts`, mirroring
the existing `publisherLinkLabel` cases:

- basic host appears verbatim
- strips leading `www.`
- keeps non-www subdomain
- empty / malformed / non-http(s) -> null
- host lower-cased
- label starts with `"Read this article on "`

Pure-function string-contract tests only - no HTML-text assertions
(consistent with the project's no-brittle-tests rule).

## Out of Scope

- Bottom `.article-publisher-link` - kept as-is.
- The dead `.header-link` CSS rule under `.item-reader` - unrelated,
  left untouched.
- No state/signals/server changes; no eslint or unrelated CSS changes.
