# Phase 0 Research: Show Article Source URL

All open questions from the spec's Assumptions section are resolved
below. There were no NEEDS CLARIFICATION markers in Technical Context.

## Decision 1 — Data source for the URL

**Decision**: Render `item.link` (existing `Item.link:string|null`).

**Rationale**: `src/client/db/types.ts` already defines
`link:string|null` on `Item`, and `item-row.ts` already reads it for
the "open in new tab" action (`href="${item.link}"`). It is populated
by both the local and remote adapters and is the article's own post
URL — exactly what FR-002 asks for. No new field, schema column,
sync-payload key, or migration is needed, which keeps the change off
the Principle II "coupled schema change" path entirely.

**Alternatives considered**:
- Derive a host-only label from `feed.site_url` — rejected: it is the
  *feed's* site, not the *item's* link, and FR-002 requires the
  article's own URL so generic feeds ("latest") can be told apart.
- Add a new normalized/cleaned URL field — rejected: out of scope; the
  spec says show the stored URL as-is (query params included).

## Decision 2 — Full URL vs. bare domain/host

**Decision**: Display the full `item.link` string verbatim (protocol,
host, path, query all intact). Constrain it visually with CSS only;
never mutate the value.

**Rationale**: The original request literally says "the full URL for
the post", and the spec Assumptions resolve "full URL" as the link
displayed in full rather than host-only. The edge case "URL containing
query parameters or tracking tokens" states the stored URL is shown
as-is with no rewriting. Truncation for very long URLs is a display
concern handled by CSS (Decision 4), not by trimming the string.

**Alternatives considered**: Show only the hostname (e.g.
`example.com`) — rejected against the explicit "full URL" wording;
could be revisited later as a refinement without data changes.

## Decision 3 — Plain text vs. clickable link

**Decision**: Render the URL as plain text in a `<span class="item-url">`,
not as a new `<a>` element.

**Rationale**: The `.item-meta` block already lives inside the row's
main `.item-link` anchor. Nesting a second `<a>` inside an `<a>` is
invalid HTML and would create a nested-interactive accessibility
problem. A `<span>` adds no new link — it is part of the existing
clickable row (which navigates to the reader route), matching the
spec assumption that this feature does not add a separate clickable
link. The dedicated "open original in new tab" action already exists
in `.item-actions` and is unchanged.

**Alternatives considered**: A real `<a target="_blank">` to the
source — rejected: nested anchors + duplicates the existing new-tab
action.

## Decision 4 — Long-URL layout safety (FR-005)

**Decision**: Single-line truncation with ellipsis:
`display:block; max-width:100%; overflow:hidden; text-overflow:ellipsis;
white-space:nowrap;` on `.item-url`. The enclosing `.item-main` already
sets `min-width:0`, which is what lets a flex child actually shrink and
truncate instead of forcing overflow.

**Rationale**: Guarantees no horizontal overflow at any viewport width
(SC-003) while keeping the start of the URL — including the host —
readable. Truncation is purely visual; the full URL stays in the DOM
text node (and can carry a `title` attribute for hover, optional).

**Alternatives considered**: Wrapping with `overflow-wrap:anywhere` —
acceptable and layout-safe, but multi-line URLs add vertical noise to a
dense list; single-line ellipsis reads more uniformly (FR-006). Either
satisfies FR-005; ellipsis is the chosen default.

## Decision 5 — Placement within `.item-meta` (column-reverse gotcha)

**Decision**: Insert `.item-url` as the **first** DOM child of
`.item-meta`, before `.item-feed`.

**Rationale**: `feed-reader.css` styles `.item-meta` with
`display:flex; flex-direction:column-reverse`. Under `column-reverse`
the first DOM child renders at the **bottom**. Current children in DOM
order are `[.item-feed, .item-date]`, which display visually as
`date` (top) over `feed` (bottom). To place the URL visually *beneath*
the feed title (FR-001/FR-003), it must be the first DOM child so the
reverse layout pushes it to the bottom: visual order becomes
`date` / `feed` / `url`.

**Alternatives considered**: Append `.item-url` last (simplest DOM) —
rejected: column-reverse would render it at the *top*, above the date,
contradicting "beneath the feed title". Removing/overriding
column-reverse — rejected: that is unrelated CSS for other elements and
the constitution forbids touching CSS unrelated to the task.

## Decision 6 — Styling (color + size)

**Decision**: `.item-url` uses `color:var(--color-muted)` and inherits
the row font-size (>= 1rem). Subordination is conveyed by muted color
and position, not by a smaller font.

**Rationale**: The global CSS rule forbids font sizes below 1rem, so
"visually subordinate" (FR-003) is achieved with `--color-muted`
(an existing variable, reused per the colors-from-variables rule) and
the below-title placement rather than shrinking the text.

**Alternatives considered**: A sub-1rem font — rejected by the global
font-size floor. A new color variable — rejected; reuse the existing
`--color-muted` already used for `.item-date`-adjacent muted text.

## Decision 7 — Test approach (avoid brittle tests)

**Decision**: Extend `test/item-row.ts` with two structural cases:
(a) with `link` set, assert a `.item-url` element exists and its text
reflects `item.link`; (b) with `link: null`, assert no `.item-url`
element is rendered.

**Rationale**: Matches the existing tapzero DOM-query style in that
file and verifies the two behaviors that matter (FR-001 presence,
FR-004 omission) without asserting static copy or layout geometry —
consistent with the "no brittle tests" rule. Visual ordering from
column-reverse is a CSS concern verified manually in-browser
(quickstart), not asserted in jsdom where layout does not run.

**Alternatives considered**: Asserting computed visual order or pixel
overflow — rejected: not meaningful in the test DOM and brittle.
