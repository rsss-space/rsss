# Quickstart: Disable Cache Settings Link When Caching Off

Manual + automated verification for the per-feed "Cache settings"
disabled behavior. Per the constitution, UI changes MUST be exercised
in a browser before being claimed complete — type-check/tests alone are
not sufficient.

## Prerequisites

- At least one subscribed feed on the test account.
- A way to toggle device caching on the `/settings` page (the existing
  global cache controls / local-first toggle that drives
  `isLocalFirstActive`).

## Run the app and tests

```bash
npm start          # Vite dev server; open the app and sign in
npm test           # node test/run-all-tests.mjs (tapzero, incl.
                   #   test/settings-route.ts)
npm run lint       # eslint
```

## Manual verification (browser)

1. **Caching OFF — disabled appearance (FR-001, SC-001)**
   Open `/settings` with caching off. Confirm every subscribed feed's
   "Cache settings" disclosure is grayed (reduced opacity), visually
   matching the page's global cache controls (FR-009, SC-006).

2. **Caching OFF — non-interactive (FR-002, SC-002)**
   Click each feed's "Cache settings" summary. Confirm none open — no
   cache mode / max size / keep-for / Clear-cache options are revealed.
   Tab through the page and confirm the disabled summaries are skipped
   (not focusable). With a screen reader, confirm the control is
   announced as disabled/unavailable (FR-008).

3. **Caching OFF — siblings unaffected (FR-006, SC-005)**
   In each row, confirm the feed title, feed URL link, cache-mode label,
   cached-size label, and the "Unfollow" button are full strength and
   the "Unfollow" button still works.

4. **Caching ON — fully usable (FR-003, SC-003)**
   Turn caching on. Confirm every feed's "Cache settings" control is full
   opacity, is focusable, opens on click/Enter, and lets you change the
   per-feed cache options exactly as before.

5. **Toggle reactivity, no reload (FR-005, SC-004)**
   While viewing the Subscribed Feeds list, toggle caching off -> the
   controls gray out immediately; toggle on -> they return to full
   opacity and become usable — all without reloading or leaving the page.

6. **Open-then-disable collapse (FR-007)**
   With caching on, open a feed's "Cache settings". Turn caching off and
   confirm that disclosure collapses and is shown in the disabled state.

## Expected automated coverage (test/settings-route.ts)

- `.feed-cache-controls` gains/loses `is-disabled` as
  `isLocalFirstActive.value` flips.
- When disabled: `<summary>` has `aria-disabled="true"` and
  `tabindex="-1"`; `<details>` is not `open`.
- When enabled: no `is-disabled`, no `aria-disabled`, summary focusable,
  disclosure toggles.
- Flipping `isLocalFirstActive` updates the per-feed control in place
  (reactivity).

Tests assert structure/attributes/behavior only — no assertions on
rendered text content (per project test rules).
