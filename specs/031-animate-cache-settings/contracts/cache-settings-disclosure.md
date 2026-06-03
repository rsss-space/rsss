# UI Contract: Settings Per-Feed Cache Settings Disclosure

**Feature**: 031-animate-cache-settings
**Surface**: `src/client/routes/settings.ts` — "Subscribed Feeds" list,
one disclosure per subscribed feed.

This is the contract the implementation and its DOM tests
(`test/settings-route.ts`) must satisfy. It is a UI/behavior contract;
there is no network or data contract for this feature.

## DOM shape

After the change, each feed's disclosure uses the
`@substrate-system/details-summary` web component (matching the
feed-reader instance in `test/feed-reader-cache-disclosure.ts`):

```html
<details-summary class="feed-cache-controls" duration="200">
  <details>
    <summary>Cache settings<!-- + injected icon + a11y label --></summary>
    <div class="details-content">
      <div class="feed-cache-form">
        <label class="cache-field-label"> Cache mode <select …/></label>
        <label class="cache-field-label"> Max size … <input …/></label>
        <label class="cache-field-label"> Keep for … <input …/></label>
      </div>
      <button class="btn-clear-cache">Clear cache</button>
    </div>
  </details>
</details-summary>
```

- **Host**: the `.feed-cache-controls` element is the
  `<details-summary>` custom element (NOT a native `<details>`).
- **Inner**: a native `<details>` is reachable via
  `.feed-cache-controls details`.
- **Content wrapper**: the controls live inside
  `.feed-cache-controls .details-content`.
- **Controls unchanged** (FR-010): the select
  (`select[name="feed-cache-mode-<id>"]`) keeps options `""`, `text`,
  `text_images`; inputs `feed-max-size-<id>` and `feed-max-age-<id>`;
  and the `.btn-clear-cache` button — same names, values, and handlers.

## Behavior

| ID | Requirement | Observable contract |
|----|-------------|---------------------|
| C1 | Animate open (FR-001) | Activating a collapsed disclosure runs a height animation from collapsed to expanded; controls are fully visible and interactive when it finishes (FR-005). |
| C2 | Animate close (FR-002) | Activating an expanded disclosure animates height back down; only the summary remains afterward. |
| C3 | Smooth, no jank (FR-003, SC-001, SC-003) | Continuous height transition (WAA), no single-frame jump, no flicker/overshoot; ~60 fps. |
| C4 | Brief (FR-004, SC-002) | Non-reduced-motion `duration` attribute resolves to a value in the ~150–300 ms band (implementation uses `200`). |
| C5 | Reduced motion (FR-006, SC-004) | When `matchMedia('(prefers-reduced-motion: reduce)')` matches, the `duration` attribute is `"0"` and the content fade is disabled via CSS; the panel toggles instantly. |
| C6 | A11y state (FR-007) | Open/closed state is conveyed (native `open` on the inner `<details>` + the component's visually-hidden expand/collapse label); keyboard (Enter/Space on summary) produces the same animation when enabled. |
| C7 | Rapid toggle (FR-008, SC-005) | Repeated activation cancels the in-flight animation and ends in the state matching the most recent activation — no stuck/clipped partial state. |
| C8 | Isolation (FR-009) | Animating one feed's disclosure does not animate or shift any other feed's disclosure. Each host is keyed by `feed.id`. |
| C9 | Disabled (edge case) | When `cacheDisabled` (`!isLocalFirstActive`): host has `is-disabled`; summary has `aria-disabled="true"` and `tabindex="-1"`; activation does not animate/expand (summary `pointer-events: none`); inner `<details>` stays collapsed (`open === false`), including when the disable flips on while open. |
| C10 | Stable instance (regression) | Flipping `isLocalFirstActive` updates the existing disclosure in place (same host element instance, keyed by `feed.id`) rather than re-mounting it. |

## Out of scope / non-goals

- No change to which controls appear, their values, or their handlers
  (FR-010).
- No change to the feed-reader cache disclosure
  (`components/cache-settings.ts`) — it already animates.
- No new dependency, no network call, no schema/sync change.

## Test mapping

`test/settings-route.ts` updates (mirror
`test/feed-reader-cache-disclosure.ts`):

- Replace selector `.settings-feed-item details.feed-cache-controls`
  with the host `.settings-feed-item .feed-cache-controls`
  (a `<details-summary>`) and reach the inner details via
  `.feed-cache-controls details` where `details.open` /
  collapse assertions are made (C9, C10).
- Keep assertions for the select options, size/age inputs (DOM presence,
  not text content — per project test rules).
- Keep `is-disabled` / `aria-disabled` / `tabindex` disabled-state
  assertions, now targeting the host + inner summary (C9).
- Keep the "updates in place (same element instance)" assertion against
  the host (C10).
- Add coverage that the host `duration` attribute is `"0"` under a
  mocked reduced-motion preference and a numeric value otherwise (C4,
  C5).
