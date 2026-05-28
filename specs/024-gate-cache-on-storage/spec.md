# Feature Specification: Gate Cache Section On Local Storage

**Feature Branch**: `024-gate-cache-on-storage`
**Created**: 2026-05-27
**Status**: Draft
**Input**: User description: "When 'local storage' is not set in `/settings`, then the 'cache' section should be disabled. All inputs should be disabled, and the whole section should have reduced opacity."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cache section is visibly inactive when local storage is off (Priority: P1)

A user opens `/settings` while the "Sync subscriptions and read state to
this device" toggle in the Local Storage section is off (the default
state for new sessions, free-plan users, unsupported browsers, or users
who have explicitly turned it off). The Cache section directly below
appears visibly de-emphasized — the whole section renders with reduced
opacity, and every control inside it (cache mode radios and the three
numeric inputs for max cache size per feed, total cache size, and
retention days) is non-interactive. The user immediately understands
that the Cache settings do not apply until local storage is turned on,
and cannot waste time changing values that will have no effect.

**Why this priority**: Today the Cache section looks fully active even
when there is no local cache to govern. Users who change values in this
state are silently mis-informed about whether their settings are taking
effect. Making the section visibly inert is the entire point of the
feature; everything else is a refinement.

**Independent Test**: Open `/settings` in a state where the local
storage toggle is off. Confirm that (a) the Cache section is rendered
with reduced opacity relative to the other sections, (b) clicking,
focusing, or attempting to change any control inside the Cache section
has no effect, and (c) the section remains legible (still readable as
text). Toggle local storage on and confirm the Cache section returns to
its normal appearance and all controls become interactive again.

**Acceptance Scenarios**:

1. **Given** a user is viewing `/settings` and the local-storage sync
   toggle is off, **When** the page renders, **Then** the global Cache
   section is shown with reduced opacity and every control inside it
   (cache mode radios, max cache size per feed, total cache size, keep
   cached items for days) is disabled and not focusable as a control.
2. **Given** the local-storage sync toggle is off, **When** the user
   attempts to click a cache mode radio or type into one of the numeric
   inputs in the Cache section, **Then** nothing changes — no value is
   persisted, no toast appears, and the section's visual state remains
   the same.
3. **Given** the Cache section is currently disabled because local
   storage is off, **When** the user turns the local-storage sync
   toggle on, **Then** the Cache section returns to full opacity in the
   same render and every control becomes interactive again, with the
   currently-saved default values shown.
4. **Given** the local-storage sync toggle is on, **When** the user
   turns it off, **Then** the Cache section transitions back into the
   disabled, reduced-opacity state without requiring a page reload.

---

### Edge Cases

- The reduced-opacity treatment must not make the section unreadable —
  text should still meet readable contrast against the page background.
- Keyboard users tabbing through the page must skip past the disabled
  controls cleanly (no focus traps, no controls that appear focusable
  but reject input).
- Assistive technologies must perceive the controls as disabled, not
  merely styled — the controls themselves must be in a disabled state,
  not only visually dimmed.
- The "Total storage used" line and the explanatory text inside the
  Cache section are not interactive controls and do not need to be
  separately disabled, but they share the section's reduced-opacity
  treatment so the whole block reads as a single inactive group.
- When local storage is off because the user is on the Free plan or
  the browser does not support local storage, the Cache section is
  still disabled in the same way — the trigger is "sync is not active",
  regardless of why.
- During an in-progress local-storage bootstrap (sync is being turned
  on but not yet complete), the Cache section continues to behave as if
  sync is off until the bootstrap finishes. The user should not see the
  section flicker between enabled and disabled states during this
  transition.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When local-storage sync is not active, the global Cache
  section on `/settings` MUST render with visibly reduced opacity
  relative to other sections on the same page so that it reads as
  inactive at a glance.
- **FR-002**: When local-storage sync is not active, every interactive
  control inside the Cache section MUST be in a disabled state,
  including the cache mode radio group, the "Max cache size per feed"
  input, the "Total cache size" input, and the "Keep cached items for
  (days)" input.
- **FR-003**: While in the disabled state, attempting to change any
  Cache section control via mouse, touch, or keyboard MUST have no
  effect on the underlying default-cache settings.
- **FR-004**: The disabled state of the Cache section MUST update
  reactively when the local-storage sync state changes — no page reload
  or manual refresh required.
- **FR-005**: When local-storage sync becomes active, every control in
  the Cache section MUST return to its normal interactive state and the
  section's opacity MUST return to normal.
- **FR-006**: The disabled state MUST be communicated to assistive
  technologies (controls reported as disabled), not only visually.
- **FR-007**: The Cache section's heading and explanatory text MUST
  remain legible (sufficient contrast for reading) while the section is
  in the reduced-opacity state.

### Key Entities

- **Local-storage sync state**: Existing client-side signal that
  reflects whether the user has the "Sync subscriptions and read state
  to this device" toggle on. Not modified by this feature; only read.
- **Default cache settings (cache mode, per-feed max size, account max
  size, retention)**: Existing settings displayed in the Cache section.
  Not modified by this feature; their controls' enabled/disabled state
  is what changes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a quick usability check, at least 4 of 5 users who
  open `/settings` with local-storage sync off correctly identify the
  Cache section as currently inactive without being told.
- **SC-002**: 100% of the controls in the Cache section (cache mode
  radios and three numeric inputs) reject user input while
  local-storage sync is off, with no values persisting and no
  user-visible feedback suggesting a change occurred.
- **SC-003**: Toggling local-storage sync on and off updates the Cache
  section's enabled/disabled state within the same render cycle (no
  visible delay or flicker for the user).
- **SC-004**: No regression in the existing behaviour when local-storage
  sync is on — every Cache section control continues to save and
  display values exactly as it does today.
- **SC-005**: Assistive-technology users perceive the Cache section
  controls as disabled when sync is off (verified by a screen-reader
  pass: each disabled control announces its disabled state).

## Assumptions

- "Local storage is set" maps to the existing client signal that
  represents the "Sync subscriptions and read state to this device"
  toggle being on. The secondary "Store article content locally"
  toggle does not gate the Cache section on its own.
- The feature is scoped to the **global** Cache section on `/settings`
  (the section under the "Cache" heading, with the default cache mode
  and three numeric inputs). The per-feed cache controls that appear
  inside each row of the "Subscribed Feeds" list further down the page
  are out of scope for this change and will be addressed separately if
  needed.
- The Cache section is not hidden when local storage is off — it
  remains visible (so users can see what they would get by enabling
  local storage) but is rendered as visibly inactive.
- The existing copy in the Cache section (the "Total storage used"
  line and the "These are the defaults..." explanatory text) is kept
  as-is; this feature does not add new copy explaining why the section
  is disabled. If user testing later shows this is needed, that copy
  will be added in a follow-up.
