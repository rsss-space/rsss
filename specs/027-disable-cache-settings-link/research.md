# Phase 0 Research: Disable Cache Settings Link When Caching Off

All Technical Context items were resolvable from the existing codebase;
there were no open NEEDS CLARIFICATION items. The research below records
the decisions that shape Phase 1, the rationale, and the alternatives
considered.

## Decision 1: Reuse `cacheDisabled` (`!isLocalFirstActive`) as the gate

- **Decision**: Drive the per-feed control's disabled state from the
  existing computed signal `cacheDisabled` in
  `src/client/routes/settings.ts:132-134`
  (`useComputed(() => !isLocalFirstActive.value)`), which derives from
  `isLocalFirstActive` in `src/client/db/sync-status.ts:15`.
- **Rationale**: The spec (Assumptions) requires reusing the *same*
  device-level condition that already governs the global cache controls,
  not introducing a new one. `cacheDisabled` is exactly that condition
  and already controls the global `.cache-section.is-disabled` block and
  the cache-mode fieldset's `disabled` attribute. Reuse guarantees
  FR-004 (uniform across all feeds — it is one signal) and SC-006 (one
  coherent "caching unavailable" state). Because it is a signal-backed
  `useComputed`, FR-005/SC-004 (update without reload) come for free.
- **Alternatives considered**:
  - *New per-feed capability flag* — rejected: violates the spec
    assumption, risks divergence from the global control, and adds state
    with no behavioral difference (caching is device-level, not
    per-feed).
  - *Reading `isLocalFirstActive` directly in the row* — rejected in
    favor of the already-defined `cacheDisabled` computed for
    consistency with the global controls' code path.

## Decision 2: Disabling a native `<details>`/`<summary>` disclosure

- **Context**: The per-feed control is a native `<details>` with a
  `<summary>Cache settings</summary>` (`settings.ts:778-854`). `<details>`
  has **no native `disabled` attribute**, and `<summary>` is not a form
  control, so the `disabled`-attribute pattern used for the global
  `<fieldset>`/`<input>` controls does not apply directly.
- **Decision**: When `cacheDisabled.value` is true, render the disclosure
  disabled by combining four mechanisms:
  1. Add an `is-disabled` class to `.feed-cache-controls` for the visual
     treatment (see Decision 3).
  2. Force the disclosure collapsed: `open=${cacheDisabled.value ? false
     : undefined}`. Passing `false` controls the DOM property and
     collapses an already-open panel (FR-007 edge case); passing
     `undefined` leaves the disclosure uncontrolled (native toggle) when
     enabled, preserving today's behavior exactly (FR-003, US2).
  3. Block the native toggle: an `onClick` handler on `<summary>` that
     calls `e.preventDefault()` when `cacheDisabled.value` (prevents
     mouse activation from opening it — FR-002).
  4. Remove from the accessibility/interaction surface: set
     `aria-disabled="true"` and `tabindex="-1"` on `<summary>` when
     disabled. `tabindex="-1"` removes it from the tab order so keyboard
     users cannot focus and Space/Enter-toggle it; `aria-disabled`
     announces it as unavailable (FR-008).
- **Rationale**: `preventDefault()` on the summary's click is the
  documented way to suppress native disclosure toggling. Combined with
  `tabindex="-1"`, both pointer and keyboard activation are closed off
  without needing a brittle `pointer-events: none` (which would not stop
  keyboard). Controlling `open` only in the disabled branch keeps the
  enabled path uncontrolled and unchanged, minimizing regression risk.
- **Alternatives considered**:
  - *Swap `<details>` for a `<button aria-expanded>` + panel* — rejected:
    a much larger rewrite of working markup for no user-visible benefit;
    higher regression risk against US2.
  - *`pointer-events: none` only* — rejected: does not block keyboard
    activation and conveys nothing to assistive tech (fails FR-008).
  - *Conditionally not rendering the `<details>` at all* — rejected: the
    spec requires the control to remain *visible* but grayed (FR-001,
    SC-001), not removed.
  - *Native `disabled` on `<summary>`* — rejected: not a valid/supported
    attribute on `<summary>`; no cross-browser effect.

## Decision 3: Visual treatment matches the global controls

- **Decision**: Add a nested rule
  `.feed-cache-controls.is-disabled { opacity: 0.55; }` and set the
  summary cursor to a non-interactive cursor in that state, mirroring the
  global `.cache-section.is-disabled { opacity: 0.55; }`
  (`settings.css:276-278`). Reuse the literal `0.55` value already used
  by the global treatment.
- **Rationale**: FR-009 and SC-006 require the per-feed disabled
  appearance to match the global cache controls' disabled appearance so
  the page reads as one coherent "caching unavailable" state. There is no
  existing opacity CSS variable; the project's convention is to reuse the
  same value rather than invent one, and the colors are untouched
  (opacity only), so no `_variables.css` change is needed. Nested
  selectors under `.feed-cache-controls` follow the CSS style rule.
- **Alternatives considered**:
  - *Introduce a `--disabled-opacity` variable and refactor the global
    rule to use it* — rejected for this feature: the constitution forbids
    modifying CSS unrelated to the task, and the global rule is unrelated
    surface; a shared token can be a separate refactor. Matching the
    literal value satisfies SC-006 today.
  - *Graying via color change on the summary text* — rejected: would
    require a new/!muted color and diverge from the global opacity
    approach.

## Decision 4: Testing approach

- **Decision**: Extend `test/settings-route.ts` with `@substrate-system/
  tapzero` tests that mirror the existing global-cache disabled tests
  (`~346-438`). Assert, by toggling `isLocalFirstActive.value`:
  - disabled: `.feed-cache-controls` has the `is-disabled` class, its
    `<summary>` has `aria-disabled="true"` and `tabindex="-1"`, and the
    `<details>` is not `open`;
  - enabled: no `is-disabled` class, no `aria-disabled`, summary is
    focusable (no `-1` tabindex), and the disclosure toggles as before;
  - reactivity: flipping `isLocalFirstActive` updates the per-feed
    control state without re-mounting (FR-005).
- **Rationale**: Mirrors the proven pattern already in the repo and
  asserts structure/attributes/behavior, not rendered text — satisfying
  the "no brittle tests" rule (no assertions on specific HTML text
  content, no doc tests).
- **Alternatives considered**:
  - *Asserting on the literal "Cache settings" string* — rejected:
    brittle text-content assertion, against project rules.
