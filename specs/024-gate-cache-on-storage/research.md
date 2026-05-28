# Research: Gate Cache Section On Local Storage

**Feature**: 024-gate-cache-on-storage  
**Date**: 2026-05-27  
**Status**: All NEEDS CLARIFICATION resolved

The feature spec had no explicit NEEDS CLARIFICATION markers, but
two implementation decisions warranted research before committing
to a design: (1) which signal correctly represents "local storage
is set", and (2) how to disable the cache-mode radio group as a
single unit without breaking accessibility or keyboard navigation.

---

## Decision 1: gate on `isLocalFirstActive`, not `syncSubscriptions`

**Decision**: The Cache section is disabled when
`isLocalFirstActive.value === false`. The signal is exported from
`src/client/state.ts` and is already imported in this file for the
read-path gating logic.

**Rationale**:

- `syncSubscriptions` (from `local-first-settings.ts`) reflects only
  the user's toggle preference. It flips true the instant the user
  flicks the switch, before any bootstrap has happened.
- `pendingSyncSubscriptions` reflects "the user toggled but the
  bootstrap hasn't finished yet". It is true during the in-flight
  transition.
- `isLocalFirstActive` flips true only when the local OPFS SQLite
  adapter is genuinely available and the bootstrap has settled. It
  flips back to false on adapter loss, tab-lock loss, or capability
  failure.
- The spec explicitly calls out two edge cases that
  `isLocalFirstActive` handles correctly out of the box:
  - "Free plan or browser without local storage → still disabled":
    in these cases `isLocalFirstActive` never becomes true regardless
    of `syncSubscriptions`.
  - "Mid-bootstrap should not flicker": if we gated on raw
    `syncSubscriptions`, the section would enable as soon as the
    user toggled, then snap back to disabled if the bootstrap
    failed. Gating on `isLocalFirstActive` keeps the section
    disabled through the entire bootstrap and only enables it on
    success — exactly the requested behaviour.

**Alternatives considered**:

- *`syncSubscriptions` alone*: rejected because of the mid-bootstrap
  flicker problem above and because it doesn't account for capability
  fallback (Principle IV requires the UI to react to actual
  capability, not user intent).
- *`syncSubscriptions && !pendingSyncSubscriptions`*: rejected
  because it duplicates logic that `isLocalFirstActive` already
  encodes correctly and would drift if the bootstrap pipeline gains
  a new failure mode in the future.
- *A new dedicated `cacheSectionEnabled` signal*: rejected as
  over-engineering — no other consumer needs it, and minting a new
  signal that mirrors an existing one violates the project's bias
  toward fewer signals.

---

## Decision 2: disable the radio group via `<fieldset disabled>`

**Decision**: Set the `disabled` attribute on the existing
`<fieldset class="cache-mode-group">` element, not on individual
radio inputs. Set `disabled` on each of the three numeric `<input>`
elements directly.

**Rationale**:

- Per the HTML spec, a disabled `<fieldset>` makes every form
  control inside it match the `:disabled` pseudo-class. Browsers
  expose those controls as disabled to assistive technologies and
  skip them in sequential focus navigation — satisfying FR-006 and
  the keyboard-skip edge case with zero custom JS.
- The cache-mode radios are already grouped inside a `<fieldset>`,
  so one attribute toggle replaces what would otherwise be a loop
  over two radios.
- The three numeric inputs are not inside a shared fieldset
  (each is in its own `<div class="cache-setting">`). Adding a
  wrapping fieldset just to disable them would be a layout change
  unrelated to the feature, which Principle "CSS unrelated to the
  current task MUST NOT be modified" forbids. Individual `disabled`
  on each input is the minimal-blast-radius option.

**Alternatives considered**:

- *`aria-disabled="true"` with `pointer-events:none`*: rejected.
  `aria-disabled` does not actually prevent keyboard activation
  (Tab still lands on the element, Enter still fires the change)
  and it is widely treated by screen readers as a hint, not a
  state. The native `disabled` attribute is the only mechanism that
  *also* removes the element from the focus order and stops
  keyboard input.
- *`inert` on the section*: rejected. `inert` makes the entire
  subtree non-focusable but does not announce controls as disabled
  to AT, so FR-006 would fail. It also makes the legend / labels
  inert in a way that could surprise tooling.
- *Re-mounting the section without controls when disabled*:
  rejected as gratuitously destructive — it loses scroll position,
  resets any unsaved input that survives via signal state, and
  makes the toggle-on/off transition more expensive than necessary.

---

## Decision 3: CSS — reduced-opacity treatment

**Decision**: Add exactly one new CSS rule scoped to
`.cache-section.is-disabled` that sets `opacity` to a value in the
0.5–0.6 range and nothing else. Native `:disabled` styling handles
focus / pointer-events for each control individually.

**Rationale**:

- The spec requires "visibly reduced opacity" and "legible text".
  An opacity value between 0.5 and 0.6 against the existing settings
  background meets WCAG AA for the section's heading and body copy
  in both light and dark themes — verified by inspecting current
  contrast ratios and applying the standard `contrast × opacity`
  relationship.
- We deliberately do not add `pointer-events: none` on the section
  root. Native disabled inputs already swallow click events, and
  blocking pointer events on the whole section would defeat link
  navigation if explanatory text later adds links.
- A single class — `is-disabled` — keeps the diff small and the
  CSS surface minimal. No existing cache-section rules are
  modified.

**Alternatives considered**:

- *Setting opacity on the parent and `filter:grayscale`*: rejected
  as visually aggressive and outside what the spec requested.
- *Per-control opacity via `:disabled { opacity }`*: rejected
  because the spec asks for the *whole section* to read as inert,
  not just the controls. The labels, the "Total storage used" line,
  and the explanatory copy all share the dimmed treatment, which
  requires opacity on the section root.

---

## Open questions

None. All NEEDS CLARIFICATION markers from the spec process are
resolved by the above decisions. Proceeding to Phase 1 design.
