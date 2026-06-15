# UI Contract: Settings feed-controls column width

This feature exposes no API. Its only external interface is the rendered
layout of the Settings page subscribed-feeds list. This file states the
layout contract the change must satisfy.

## Surface

Route: Settings (`src/client/routes/settings.ts`).
List item: `li.settings-feed-item` →
`div.feed-info` (left) + `div.feed-controls` (right).
`div.feed-controls` contains the "Cache settings" disclosure
(`details-summary.feed-cache-controls`) and the "Unfollow" button.

## Contract

1. **Stable column width (FR-001/002/003, SC-001).** The rendered width of
   `.feed-controls` is identical whether the feed's "Cache settings"
   disclosure is open or closed. Toggling produces 0 px horizontal resize of
   the column.

2. **Stable label position (FR-004, SC-002).** The left edge / horizontal
   position of the "Cache settings" summary text is identical in the
   collapsed and expanded states. 0 px horizontal movement on toggle.

3. **No clipping at the reserved width (FR-005, SC-003).** When expanded,
   every control — cache-mode `<select>`, max-size input, keep-for input,
   "Clear cache", "Unfollow" — is fully visible inside `.feed-controls` with
   no horizontal overflow or clipping, for the bounded range of hint text
   (e.g. "Max size (NN MB)", "Keep for (NN days)").

4. **Legible collapsed state (FR-006).** When collapsed, `.feed-controls`
   content ("Cache settings", "Unfollow") remains legible and correctly
   aligned within the reserved width (no awkward gaps that break the card).

5. **Straight column edge (FR-007).** All `.settings-feed-item` rows share
   the same `.feed-controls` width, so the column's vertical edge is straight
   whether a given row is open or closed.

6. **Animation unchanged (FR-008).** The 031 open/close height animation
   still runs; width stays fixed throughout (no horizontal motion during the
   height tween). No cache control changes behavior.

7. **No new page scroll (spec assumption).** Reserving the width does not
   introduce horizontal scrolling of the Settings page at supported viewport
   widths; `.feed-info` (`flex:1; min-width:0`, ellipsised title/url) absorbs
   the remaining row width.

## Non-goals

- No change to `components/cache-settings.ts` (separate reader surface).
- No change to cache policy data, persistence, or the set of controls shown.
