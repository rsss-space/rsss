# Quickstart: Stable Cache Settings Width

Presentation-only CSS change in `src/client/routes/settings.css` scoped to
`.feed-controls`. Layout is not computed in jsdom, so the constitution's
"exercise the UI in a browser" gate is the primary verification.

## Implement

1. In `src/client/routes/settings.css`, reserve a stable width on
   `.feed-controls` (the right-hand controls column) — a `min-width` equal to
   the open cache form's width (see "Determine the width" below). Keep lines
   ≤80 cols. Do not touch unrelated CSS.

## Determine the width

1. `npm start` and open the Settings page while signed in with at least two
   subscribed feeds (a paid plan / local-first enabled so the cache form is
   interactive).
2. Expand one feed's "Cache settings". In DevTools, inspect `.feed-controls`
   and read its rendered width (the open form, with the 8rem inputs and the
   cache-mode `<select>`, is the widest state).
3. Convert to `rem` and set `min-width` to that value, adding only enough
   headroom to cover bounded hint variations (larger numbers, "days"/"weeks").
   Do not pick a larger "round" width than the panel needs (spec assumption).

## Verify (acceptance)

With the rule in place, on the Settings page with ≥2 subscribed feeds:

1. **No column resize (FR-001/002/003, SC-001).** Expand a feed's "Cache
   settings", then collapse it. The `.feed-controls` column width does not
   change — no shrink on close, no grow on open. (Confirm with DevTools: the
   element's width is identical open vs closed.)
2. **No label shift (FR-004, SC-002).** The "Cache settings" label stays at
   the same horizontal position the entire time (no left/right snap). Watch
   the label's left edge while toggling.
3. **Controls usable, no clipping (FR-005, SC-003).** Expanded, exercise each
   control: change cache mode, set max size, set keep-for, "Clear cache",
   "Unfollow". All fully visible inside the column, nothing clipped or
   overflowing horizontally.
4. **Collapsed reads cleanly (FR-006).** Collapsed, the card content is
   legible and aligned within the reserved width.
5. **Straight edge (FR-007).** With one feed expanded and others collapsed,
   the right column's vertical edge stays straight across all rows.
6. **Animation intact (FR-008).** The open/close height animation still plays
   smoothly; there is no horizontal motion during it.
7. **First-render stability (edge case).** Reload Settings without expanding
   anything; the column is already at the stable width, so the very first
   open causes no resize.
8. **No page H-scroll (assumption).** At supported viewport widths the
   Settings page does not gain a horizontal scrollbar.

## Project checks

- `npm test && npm run lint` pass (no behavior/markup change expected; this
  is a guard against regressions, not the primary evidence).
- Clean up the dev server when done.
