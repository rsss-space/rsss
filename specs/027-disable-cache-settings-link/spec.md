# Feature Specification: Disable Cache Settings Link When Caching Off

**Feature Branch**: `027-disable-cache-settings-link`  
**Created**: 2026-05-31  
**Status**: Draft  
**Input**: User description: "In `/settings` page, the 'cache settings' link on each subscribed feed should be disabled (gray, reduced opacity) if caching is not enabled for this machine"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Per-feed cache settings reflect caching availability (Priority: P1)

A person who has not turned on caching for the current device opens the
Settings page and looks at their list of subscribed feeds. Each feed row
shows a "Cache settings" control next to "Unfollow". Because caching is
not available on this device, the "Cache settings" control appears grayed
out with reduced opacity and cannot be opened. This signals that there is
nothing to configure until caching is enabled, and prevents the person
from changing per-feed cache options that would have no effect.

**Why this priority**: This is the core behavior the feature delivers. It
removes a misleading affordance — today the control looks fully active even
when caching is off, inviting the person to configure settings that cannot
take effect. Making it match the device's caching state is the entire value
of the feature.

**Independent Test**: With caching not enabled on the device, open the
Settings page and confirm that every subscribed feed's "Cache settings"
control is visibly grayed (reduced opacity) and does not open or respond
when activated.

**Acceptance Scenarios**:

1. **Given** caching is not enabled on the current device, **When** the
   person views the Subscribed Feeds list, **Then** each feed's "Cache
   settings" control is shown grayed out with reduced opacity.
2. **Given** caching is not enabled on the current device, **When** the
   person attempts to open a feed's "Cache settings" control, **Then** it
   does not open and no cache configuration options are revealed.
3. **Given** caching is not enabled, **When** the person views any feed
   row, **Then** the feed title, feed URL, cache-mode label, cached-size
   label, and the "Unfollow" button remain fully visible and usable.

---

### User Story 2 - Cache settings remain usable when caching is enabled (Priority: P2)

A person who has turned on caching for the current device opens the
Settings page. Each subscribed feed's "Cache settings" control appears at
full strength (normal color, full opacity) and opens normally to reveal the
per-feed cache options, exactly as it does today.

**Why this priority**: The feature must not regress the working case. People
who rely on per-feed cache configuration must retain full access whenever
caching is enabled.

**Independent Test**: With caching enabled on the device, open the Settings
page and confirm every subscribed feed's "Cache settings" control is at full
opacity and opens to show its cache options.

**Acceptance Scenarios**:

1. **Given** caching is enabled on the current device, **When** the person
   views the Subscribed Feeds list, **Then** each feed's "Cache settings"
   control appears at full opacity (not grayed).
2. **Given** caching is enabled, **When** the person opens a feed's "Cache
   settings" control, **Then** the per-feed cache options are revealed and
   can be changed as before.

---

### User Story 3 - State updates immediately when caching is toggled (Priority: P3)

A person is on the Settings page and turns caching on or off for the device.
The per-feed "Cache settings" controls update their appearance and
availability right away — becoming enabled when caching turns on and grayed
when caching turns off — without the person needing to reload or leave the
page.

**Why this priority**: Consistency and responsiveness. The page already
reflects the device caching state elsewhere; the per-feed controls should
stay coherent with it in the same view, but this is a refinement on top of
the core P1 behavior.

**Independent Test**: On the Settings page, toggle caching off and confirm
the per-feed "Cache settings" controls become grayed without reload; toggle
caching on and confirm they return to full opacity and become usable.

**Acceptance Scenarios**:

1. **Given** the person is viewing the Subscribed Feeds list with caching
   enabled, **When** they turn caching off, **Then** each feed's "Cache
   settings" control becomes grayed and non-interactive without a reload.
2. **Given** the person is viewing the list with caching disabled, **When**
   they turn caching on, **Then** each feed's "Cache settings" control
   becomes full opacity and interactive without a reload.

---

### Edge Cases

- **A feed's cache settings are open when caching is turned off**: the
  control collapses and is presented in the disabled (grayed) state.
- **Multiple subscribed feeds**: every feed's "Cache settings" control
  reflects the same single device-level caching state — all enabled or all
  disabled together, never a mix.
- **No subscribed feeds**: there are no per-feed controls to disable; the
  Subscribed Feeds section behaves as it does today.
- **People using assistive technology**: the disabled state is conveyed
  through more than color/opacity alone, so the control is announced as
  unavailable rather than appearing active.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When caching is not enabled for the current device, the system
  MUST present each subscribed feed's "Cache settings" control in a disabled
  visual state (grayed out, reduced opacity).
- **FR-002**: When caching is not enabled, the system MUST prevent the person
  from opening or interacting with each feed's "Cache settings" control, so
  no per-feed cache options can be revealed or changed.
- **FR-003**: When caching is enabled for the current device, the system MUST
  present each feed's "Cache settings" control at full opacity and allow it to
  open and be used as it does today.
- **FR-004**: The enabled/disabled state MUST be applied uniformly across all
  subscribed feeds, reflecting the single device-level caching state.
- **FR-005**: The system MUST update each feed's "Cache settings" control
  between enabled and disabled states in response to caching being turned on
  or off, without requiring a page reload.
- **FR-006**: The disabled state MUST NOT alter or disable other parts of the
  feed row, including the feed title, feed URL, cache-mode label, cached-size
  label, and the "Unfollow" button.
- **FR-007**: If a feed's "Cache settings" control is open when caching
  becomes disabled, the system MUST collapse it and present it in the disabled
  state.
- **FR-008**: The disabled state MUST be communicated to assistive
  technologies (not by color/opacity alone), so the control is recognizable as
  unavailable.
- **FR-009**: The disabled visual treatment MUST be consistent with the
  existing disabled treatment used for the page's global cache controls, so
  the page presents a single coherent "caching unavailable" appearance.

### Key Entities *(include if feature involves data)*

- **Device caching state**: A single on/off condition describing whether
  caching is enabled for the current device. Drives whether per-feed cache
  controls are enabled or disabled. (Same condition already governing the
  page's global cache controls.)
- **Subscribed feed (in Settings)**: A row in the Subscribed Feeds list that
  exposes a "Cache settings" control whose availability is governed by the
  device caching state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With caching disabled, 100% of subscribed feeds display their
  "Cache settings" control in the grayed/disabled state.
- **SC-002**: With caching disabled, the person cannot open any per-feed
  "Cache settings" control (zero successful opens across all feeds).
- **SC-003**: With caching enabled, 100% of per-feed "Cache settings"
  controls are interactive and open to reveal their options.
- **SC-004**: Turning caching on or off updates the per-feed controls'
  appearance and availability immediately, with no page reload required.
- **SC-005**: Other per-feed information and the "Unfollow" button remain
  usable in 100% of feed rows regardless of caching state.
- **SC-006**: The disabled appearance of per-feed controls matches the
  disabled appearance of the page's global cache controls, so people perceive
  one consistent "caching unavailable" state.

## Assumptions

- "Caching is enabled for this machine" refers to the same device-level
  condition that already controls whether the page's global cache controls are
  active. This feature reuses that condition rather than introducing a new one.
- "Disabled" means both visually grayed (reduced opacity) and non-interactive
  — the control cannot be opened while caching is off.
- The disabled appearance matches the existing reduced-opacity treatment used
  by the global cache controls, for visual consistency.
- The per-feed controls react to caching being toggled within the same view,
  matching how the global cache controls already behave.
- Disabling applies only to the per-feed "Cache settings" control; the
  "Unfollow" action and all feed information remain available because they are
  unrelated to caching.
- Although the control is described as a "link", its disabled behavior is the
  same regardless of how it is presented (link, button, or disclosure): grayed
  and non-interactive.
