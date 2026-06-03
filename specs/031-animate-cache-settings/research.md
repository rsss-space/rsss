# Phase 0 Research: Animate Cache Settings Disclosure

**Feature**: 031-animate-cache-settings
**Date**: 2026-06-02

This feature is presentation-only and introduces no NEEDS CLARIFICATION
items from the Technical Context. Research focused on one question: what
is the right, lowest-risk mechanism to animate the per-feed cache
disclosure open/close smoothly, cross-browser, while honoring reduced
motion — given what already exists in this codebase.

---

## Current state (grounded in the code)

There are two visually similar "Cache settings" disclosures:

1. **Feed-reader instance** — `src/client/components/cache-settings.ts`,
   rendered by `src/client/routes/feed-reader.ts`. It wraps a native
   `<details>` in the `@substrate-system/details-summary` web component
   (`DetailsSummary.TAG`) and **already animates smoothly**. It honors
   reduced motion by setting `duration='0'` when
   `matchMedia('(prefers-reduced-motion: reduce)')` matches.

2. **Settings instance (THIS feature's target)** —
   `src/client/routes/settings.ts`, the "Subscribed Feeds" list, lines
   ~779–876. It renders a **raw native `<details class="feed-cache-controls">`**
   with `<summary>Cache settings</summary>` and a `.feed-cache-form`
   body. Native `<details>` toggles `open` instantly with no height
   transition — this is the abrupt jump the spec describes.

The `@substrate-system/details-summary` package (v0.0.2) is already a
dependency and its CSS is already imported globally
(`src/client/style.css` line 7:
`@import url("@substrate-system/details-summary/css")`).

### How the web component animates (verified in `dist/index.js`)

- On open: fixes the `<details>` height to its collapsed height, sets
  `open=true`, then on the next animation frame measures
  `summary.offsetHeight + content.offsetHeight` and runs
  `details.animate({ height: [start, end] }, { duration, easing:
  'ease-out' })` (Web Animations API).
- On close: adds `is-closing`, animates height back down to the summary
  height, then clears `open` on finish.
- Rapid toggle: cancels any in-flight animation (`this._animation.cancel()`)
  and retargets from the current height — satisfies SC-005 reversal.
- Accessibility: injects a visually-hidden "expand"/"collapse" label and
  a +/- icon, and toggles the label text — satisfies FR-007.
- Reduced motion: `duration` attribute of `'0'` makes the WAA animation
  run for 0 ms (instant). The package CSS also fades `.details-content`
  opacity/transform over `--details-summary-transition-speed` (0.3s
  default); a `prefers-reduced-motion` rule will neutralize that too.

The component requires this DOM shape: a `<details>` containing a
`<summary>` and a `.details-content` element. The current settings markup
does NOT wrap its body in `.details-content`, so the body must be moved
into a `<div class="details-content">`.

---

## Decision

**Reuse the `@substrate-system/details-summary` web component
(`DetailsSummary.TAG`) for the Settings "Subscribed Feeds" cache
disclosure, mirroring the existing `components/cache-settings.ts`
pattern.**

Concretely:

- Wrap the existing per-feed cache form in
  `<${DetailsSummary.TAG} class="feed-cache-controls" key=${feed.id}
  duration=${prefersReducedMotion ? '0' : '200'}>` containing
  `<details><summary>Cache settings</summary><div class="details-content">
  …existing controls… </div></details>`.
- Add `prefersReducedMotion` state + a `matchMedia` effect to the
  settings component, copied from `cache-settings.ts` (lines 38, 62–73).
- Preserve the disabled semantics: keep `is-disabled` on the host, keep
  `aria-disabled`/`tabindex=-1` on the summary when `cacheDisabled`, and
  add `pointer-events: none` to the disabled summary so neither the
  component's own click listener nor keyboard activation can toggle it
  (FR: disabled disclosure does not animate/expand).
- Force-close any open inner `<details>` when `cacheDisabled` flips true
  (preserves current collapse-on-disable behavior and its test).
- Scope `--details-summary-*` CSS variables on the feed disclosure to
  preserve the current visual design (padding, weight, 1rem font, summary
  color, 0.2s speed), as the feed-reader instance already does.

### Rationale

- **Cross-browser smooth.** The Web Animations API `animate({ height })`
  runs identically on Chromium, Firefox, and WebKit — meeting SC-001 and
  SC-003 everywhere, not just in one engine.
- **Don't reinvent a solved problem.** The exact open/close + reduced
  motion + rapid-toggle reversal + a11y labeling is already implemented,
  shipped, and tested for the feed-reader instance. Reuse keeps one
  animation mechanism for both "Cache settings" disclosures instead of
  two divergent ones.
- **Minimal blast radius.** Confined to `settings.ts`, `settings.css`,
  and the `settings-route.ts` test. No new files, no new dependency, no
  schema/sync/identity surface (Constitution I–V untouched).
- **Honors reduced motion** via the same `duration='0'` lever already in
  use, plus a CSS `prefers-reduced-motion` rule for the content fade
  (FR-006, SC-004).

---

## Alternatives considered

### A. Pure CSS with `interpolate-size` + `::details-content`

Modern CSS can animate a native `<details>` to its intrinsic height:
`interpolate-size: allow-keywords` on `:root` plus
`details::details-content { block-size: 0; transition: block-size … }`
and `details[open]::details-content { block-size: auto }`. Zero JS, zero
markup change, and the existing native-`<details>` tests would pass
unchanged.

**Rejected:** `interpolate-size`/`calc-size()` and `::details-content`
are **Chromium-only** as of 2026 (Chrome/Edge 129+/131+; not in Firefox
or WebKit — confirmed via modern-web-guidance `animate-to-intrinsic-sizes`).
Non-Chromium users would get an instant jump, so SC-001/SC-003 would fail
for a large share of users (WebKit/iOS matters for a PWA). It would also
introduce a *second*, divergent animation mechanism alongside the
feed-reader web component.

### B. `grid-template-rows: 0fr → 1fr` transition

A common cross-browser collapse trick on a wrapper inside the details.

**Rejected:** Native `<details>` removes its content from layout the
instant `open` is cleared, so the close direction cannot transition
without JS that defers `open=false` until the animation ends — i.e.
re-implementing exactly what the web component already does. Not simpler,
and still divergent from the established pattern.

### C. Hand-rolled WAA height animation inline in `settings.ts`

Intercept summary clicks, `preventDefault`, animate height, then set
`open`.

**Rejected:** This is precisely what `@substrate-system/details-summary`
already encapsulates (including rapid-toggle cancel and a11y labels).
Re-implementing inline duplicates tested logic and diverges from the
feed-reader instance.

### D. Extract a shared `CacheSettings` component for both routes

**Rejected (for now):** The two disclosures render *different* control
sets — the feed-reader instance has a "Cache this feed" checkbox with
billing/bootstrap gating; the settings instance does not. Unifying the
forms is a larger refactor that risks changing which controls are shown
(violating FR-010). Out of scope; the shared piece we reuse is the
animation primitive (the web component), not the form.

---

## Open implementation notes (not blockers)

- **Duration:** Set `duration='200'` for the animated case to sit
  comfortably inside the 150–300 ms band (SC-002) and match the
  feed-reader feel; pair with `--details-summary-transition-speed: 0.2s`
  so the height animation and content fade stay in sync. Tunable without
  spec impact.
- **Host border:** The package CSS gives `details-summary` a
  `border-bottom`. Verify in-browser and neutralize if it changes the
  current Subscribed-Feeds card appearance (FR-010). Task-scoped CSS only.
- **Reduced-motion content fade:** Add
  `@media (prefers-reduced-motion: reduce)` scoped to the feed disclosure
  to set the `.details-content` transition to `none` and remove the
  translate offset, so SC-004 ("no animation … 100% of activations") is
  fully met, not just the height portion.
- **Existing latent gap:** The feed-reader instance shares the same
  content-fade-under-reduced-motion gap; fixing it there is out of scope
  for this feature but worth a follow-up note.
