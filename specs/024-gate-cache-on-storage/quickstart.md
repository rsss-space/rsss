# Quickstart: Verify the Cache Section Gating

**Feature**: 024-gate-cache-on-storage  
**Audience**: Engineer verifying the implementation manually before
review.

This quickstart maps directly to the four acceptance scenarios in
`spec.md`. Run it with `npm start` and a browser at the local dev
URL. Sign in with a Bluesky test account that has access to free
and local-first toggling.

## Prerequisites

1. `npm install` and `npm start` running cleanly.
2. Signed in to the app with a known test account.
3. DevTools open with the **Elements** and **Accessibility** panels
   visible.

## Scenario A — disabled on first paint (sync off)

Maps to Acceptance Scenario 1.

1. From a fresh tab, sign in.
2. Make sure the "Sync subscriptions and read state to this device"
   toggle is **off** (the default for new sessions, free plans, or
   any browser without OPFS).
3. Navigate to `/settings`.
4. Verify:
   - The `<section class="settings-section cache-section">` element
     has the `is-disabled` class.
   - Computed `opacity` on that section is `0.55` (or whatever the
     final implementation chose — value is visibly reduced relative
     to the sections above and below it).
   - The `<fieldset class="cache-mode-group">` element has the
     `disabled` attribute. Each of its two radios reports
     `disabled: true` in the Accessibility panel.
   - Each of the three numeric `<input>` elements (max per feed,
     total cache size, retention days) has `disabled` set and
     reports as disabled to AT.
   - Tabbing through the page does not stop on any cache-section
     control.

## Scenario B — clicks and keystrokes are no-ops while disabled

Maps to Acceptance Scenario 2.

1. With the page in the Scenario A state, click the "Text and
   Images" radio. Confirm:
   - No DOM update on the radio's `checked` state.
   - No toast or visible feedback.
   - The `defaultCacheMode` signal value (inspect via the React/
     Preact devtools or by logging it from a console snippet) is
     unchanged.
2. Click into the "Max cache size per feed" input. Confirm focus
   does not land in the field. Press a digit; nothing happens.
3. Repeat for the other two numeric inputs.

## Scenario C — turning sync on enables the section in the same render

Maps to Acceptance Scenario 3.

1. With the page in the Scenario A state, toggle "Sync
   subscriptions and read state to this device" **on**.
2. Wait for the bootstrap to complete (the "Local storage" section
   reports it as active; `isLocalFirstActive` becomes true).
3. Verify:
   - The cache section's `is-disabled` class is gone.
   - The `<fieldset>` no longer has `disabled`.
   - Each numeric input is interactive — click and type a new value;
     it updates and persists.
   - No layout shift, no visible flicker between the toggle flip
     and the section enabling.

## Scenario D — turning sync off disables the section reactively

Maps to Acceptance Scenario 4.

1. With the page in the Scenario C end state (sync on, cache
   section interactive), toggle "Sync subscriptions and read state
   to this device" **off**.
2. Verify the cache section returns to the disabled, reduced-
   opacity state without a page reload — same final state as
   Scenario A.

## Edge case verification

- **No mid-bootstrap flicker**: in Scenario C, watch the cache
  section while the toggle flips and the bootstrap runs. The
  section must remain in the disabled state for the entire
  duration of the bootstrap and only enable once it completes. If
  you see the section briefly enable then re-disable, gating was
  done on the wrong signal — go back to research.md Decision 1.
- **Free plan**: sign in as a free-plan account. The cache
  section is disabled in the same way (capability is unavailable,
  not just toggled off).
- **Screen reader pass**: enable VoiceOver / NVDA / Narrator and
  Tab through the settings page in Scenario A. Each cache-section
  control, when reached *via direct focus assignment*, must
  announce its disabled state. Tab navigation should skip past
  them entirely.

## What "done" looks like

All four scenarios above behave as described. `npm test` and
`npm run lint` are green. No CSS unrelated to the Cache section
has changed.
