# Phase 0 Research: Stable Cache Settings Width

All Technical Context items are known; there are no NEEDS CLARIFICATION
markers. This document records the root-cause analysis and the approach
decision that drive Phase 1.

## Root cause

The Settings page renders each feed as:

```text
li.settings-feed-item            display:flex; justify-content:space-between;
                                 align-items:flex-start; gap:1rem
├── div.feed-info                flex:1; min-width:0  (title/url/etc, left)
└── div.feed-controls            flex-shrink:0; column; align-items:flex-start
    ├── details-summary.feed-cache-controls
    │   └── details > summary "Cache settings"
    │              + div.details-content (the cache form: 8rem inputs)
    └── button.btn-delete "Unfollow"
```

`src/client/routes/settings.css`:
- `.feed-controls` is `flex-shrink:0` with no explicit width, so it is sized
  to its widest **rendered** content (max-content).
- `.feed-info` is `flex:1; min-width:0`, so it absorbs whatever width
  `.feed-controls` does not take.

The disclosure is `@substrate-system/details-summary`, which wraps a native
`<details>`. Confirmed from the package source (`dist/index.js`,
`dist/index.css`):
- Open/close is driven by toggling the native `<details open>` attribute.
- The animation runs on the `details` element's **`height`** only
  (`element.animate({ height: [...] })`), setting an inline height during the
  tween and clearing it on finish. **Width is never set by the component.**
- When `<details>` is not `open`, the user-agent removes the non-`summary`
  flow content (`.details-content`) from layout.

Therefore, when collapsed, the cache form contributes **zero width**, and
`.feed-controls` shrinks to fit only "Cache settings" + "Unfollow". When
expanded, the 8rem-wide inputs (and the cache-mode `<select>` / field labels)
make `.feed-controls` wider. Because the row is `space-between` and the
controls column is left-aligned (`align-items:flex-start`), the column's left
edge — and the "Cache settings" label sitting on it — moves rightward on
collapse and leftward on expand. That horizontal shift is the reported jank
(SC-001/SC-002 quantify it as the px deltas to eliminate).

## Decision: reserve the expanded width with `min-width` on `.feed-controls`

Set a stable `min-width` on `.feed-controls` equal to the width the open
cache form needs. Then:
- Collapsed: natural content is narrower, so `min-width` holds the column at
  the expanded width (FR-001, FR-003).
- Expanded: natural content equals the reserved width, so the column does not
  grow (FR-002).
- The left-aligned "Cache settings" label keeps a constant left edge in both
  states (FR-004).
- Every `.feed-controls` gets the same `min-width`, so all rows share one
  straight column edge regardless of which feed is open (FR-007).

**Rationale**: This is the minimal change that satisfies the spec's stated
intent — "reserve the width the expanded panel already needs, not a new larger
width." It is compatible with the 031 height animation (the component only
animates `height`; `min-width` is orthogonal), needs no TS/markup change, and
keeps `.feed-info` (`flex:1; min-width:0`, ellipsis on title/url) free to
absorb the remaining row width so no page-level horizontal scroll is
introduced at supported widths (spec assumption; verify in quickstart).

### Determining the reserved width value

The reserved width must be ≥ the open form's max-content width so the column
never grows on expand **and** controls never clip/overflow (FR-005), but no
larger than necessary (spec assumption). The form's intrinsic width is the
widest of: the `<select>` (longest option "Text + images"), the field labels
including their dynamic hint text ("Max size (NN MB)", "Keep for (NN days)";
the hint unit/number is data-driven and bounded), the 8rem number inputs, and
the "Clear cache" button.

Approach: measure the expanded `.feed-controls` max-content width in the
browser (DevTools), express it in `rem`, and set `min-width` to that value
with only enough headroom to cover the bounded hint variations (e.g. larger
numbers, "days"/"weeks" wording). The 8rem input width is the current
dominant constraint, so the reserved column is expected to land around the
low-teens of `rem`. The exact value is fixed during implementation against
the rendered panel — no guessed magic number is committed without browser
confirmation (constitution: UI exercised in a browser before completion).

### Why `min-width` rather than a fixed `width`

A fixed `width` would clip the form if any dynamic hint string is wider than
the chosen value (FR-005 risk). `min-width` floors the column at the reserved
width while still allowing the (bounded) content to define the box, so the
collapsed and expanded widths coincide at the reserved value with no clipping.

## Alternatives considered

1. **Hidden width-reserving mirror of the form, always in the DOM.** Keep an
   invisible copy of the form contributing width even when collapsed. Rejected:
   duplicates markup, risks drift between the real and mirror forms, and is far
   more complex than a single `min-width` for the same result.

2. **Override the UA to keep `.details-content` in layout (width) while
   collapsing only its height.** Fragile across browsers (closed-`<details>`
   hiding is UA-defined and interacts with the component's `offsetHeight`
   measurement used to drive the animation). Rejected as brittle for no gain
   over `min-width`.

3. **CSS Grid "stacked states" so the column sizes to the max state.** There is
   only one rendered state at a time (the same `<details>` element), so there is
   no second cell to size against without re-introducing a mirror element.
   Rejected: more machinery than the problem needs.

4. **Fixed `width` on `.feed-controls`.** Simpler to reason about but clips
   controls if a dynamic hint exceeds the value (FR-005). Rejected in favor of
   `min-width`.

## Out-of-scope confirmations

- `components/cache-settings.ts` is a different disclosure (reader surface),
  not the Settings feeds list. Not edited.
- No change to cache behavior, cache-policy persistence, control set, or the
  031 open/close (height) animation (FR-008).
