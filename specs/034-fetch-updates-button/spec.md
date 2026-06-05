# Feature Specification: Fetch Updates Button

**Feature Branch**: `034-fetch-updates-button`
**Created**: 2026-06-05
**Status**: Draft
**Input**: User description: "when there are updates available, a button
should appear to the right on the \"6 updates\" text. Button text should be
\"fetch updates\" and it does the same thing as the \"refresh feeds\" button
below"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Fetch updates from the header indicator (Priority: P1)

A reader is looking at their feeds and notices the header indicator say
something like "6 updates" with a colored dot, telling them new items are
waiting to be fetched. Today, to actually pull those items in they have to
look away from the indicator and find the "Refresh Feeds" control elsewhere
in the layout. With this feature, a "fetch updates" button appears directly
to the right of the "N updates" text, so the reader can act on the
notification in the same place they read it, with a single click.

**Why this priority**: This is the entire feature. It puts the action next
to the information that prompts it, removing the gap between "I see updates
are available" and "I can fetch them." Without it there is nothing to build.

**Independent Test**: Put the app into a state where updates are available
(the indicator shows "N updates"). Confirm a button labeled "fetch updates"
is visible immediately to the right of that text, and that clicking it pulls
in the waiting items exactly as the existing "Refresh Feeds" control does.

**Acceptance Scenarios**:

1. **Given** updates are available and the indicator shows "6 updates",
   **When** the reader looks at the indicator, **Then** a button labeled
   "fetch updates" is shown immediately to the right of the "6 updates" text.
2. **Given** the "fetch updates" button is visible, **When** the reader
   clicks it, **Then** the application fetches the available updates with the
   same outcome as clicking the existing "Refresh Feeds" control.
3. **Given** no updates are available (the indicator shows "up to date" or no
   count), **When** the reader looks at the indicator, **Then** the "fetch
   updates" button is not shown.
4. **Given** exactly one update is available (the indicator shows "1
   update"), **When** the reader looks at the indicator, **Then** the "fetch
   updates" button is still shown to the right of that text.

---

### User Story 2 - Clear feedback without duplicate fetches (Priority: P2)

When the reader clicks "fetch updates", they should get the same in-progress
feedback the existing refresh control gives, and a stray second click while
the fetch is already running should not kick off a redundant fetch.

**Why this priority**: It is a refinement of the P1 action rather than a
separate capability. P1 is usable on its own; this story makes the
interaction feel correct and prevents accidental duplicate work.

**Independent Test**: Click "fetch updates" and observe that the interface
communicates a fetch is underway (matching the existing refresh feedback),
then click again before it finishes and confirm no second fetch is started.

**Acceptance Scenarios**:

1. **Given** the reader clicks "fetch updates", **When** the fetch is
   underway, **Then** the interface signals that a fetch is in progress in
   the same way it does for the existing "Refresh Feeds" control.
2. **Given** a fetch triggered by "fetch updates" is already in progress,
   **When** the reader clicks "fetch updates" again, **Then** no additional
   fetch is started.
3. **Given** a fetch was triggered from the existing "Refresh Feeds" control
   and is in progress, **When** the reader clicks "fetch updates", **Then**
   no additional fetch is started.
4. **Given** a fetch completes and the feeds are up to date, **When** the
   indicator updates, **Then** the updates count and the "fetch updates"
   button are no longer shown.

---

### Edge Cases

- When the feed status is in an error state (the indicator shows a failure
  message rather than a count), the "fetch updates" button is not shown; the
  button is tied to the "updates available" state only.
- When the feed status is actively syncing/updating (not yet "N updates"),
  the button follows the indicator: it is not shown for the plain syncing
  state, and reappears only if the status returns to "updates available".
- When new updates arrive while the reader is viewing the page, the button
  appears as soon as the indicator switches to showing a count, without a
  manual page reload.
- The button must not introduce its own separate fetch behavior; its result
  must always match the existing "Refresh Feeds" control so the two cannot
  diverge.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST display a button labeled "fetch updates"
  immediately to the right of the "N updates" indicator text whenever feed
  updates are available.
- **FR-002**: The system MUST NOT display the "fetch updates" button when no
  feed updates are available (e.g., the "up to date" state, the syncing
  state, or the error state).
- **FR-003**: Activating the "fetch updates" button MUST trigger the same
  fetch behavior as the existing "Refresh Feeds" control, producing an
  equivalent outcome.
- **FR-004**: The system MUST show the "fetch updates" button for both the
  singular ("1 update") and plural ("N updates") forms of the indicator.
- **FR-005**: While a fetch is in progress, the system MUST give the same
  in-progress feedback for a fetch started via "fetch updates" as it does for
  a fetch started via "Refresh Feeds".
- **FR-006**: The system MUST ignore activations of the "fetch updates"
  button while a fetch is already in progress, regardless of whether that
  fetch was started from "fetch updates" or from "Refresh Feeds".
- **FR-007**: Once a fetch completes and the feeds are up to date, the system
  MUST stop showing the updates count and the "fetch updates" button.
- **FR-008**: The "fetch updates" button MUST be operable by both pointer and
  keyboard, and MUST expose an accessible name conveying its purpose.
- **FR-009**: The button's appearance and disappearance MUST react to changes
  in update availability without requiring a manual page reload.

### Key Entities

- **Feed update indicator**: The header element that communicates whether
  feed updates are available and, when they are, how many. Its state drives
  whether the "fetch updates" button is shown.
- **Fetch updates action**: The user-initiated request to pull in available
  feed updates. It is the same action exposed by the existing "Refresh Feeds"
  control; the new button is an additional entry point to it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of states where the indicator shows a count of
  available updates, the "fetch updates" button is present to the right of
  that text.
- **SC-002**: In 100% of states where no updates are available, the "fetch
  updates" button is absent.
- **SC-003**: Fetching via the "fetch updates" button produces the same
  result as fetching via "Refresh Feeds" in 100% of trials, with no
  observable difference in what gets fetched.
- **SC-004**: A reader can fetch available updates from the moment they
  notice the indicator in a single action (one click or one keyboard
  activation) without navigating elsewhere.
- **SC-005**: Repeated activations during an in-progress fetch result in
  zero additional fetches.

## Assumptions

- The "N updates" indicator referenced in the request is the existing header
  feed-status indicator that shows a count and a colored dot when updates are
  available; this feature attaches the button to that indicator.
- The "fetch updates" button reuses the existing refresh action rather than
  defining new fetch logic, so the two entry points stay behaviorally
  identical by construction.
- The button is surfaced in the same context where the updates indicator is
  already shown (the desktop header). The existing "Refresh Feeds" control is
  not removed or changed by this feature.
- Button label text is exactly "fetch updates" as specified; no count is
  embedded in the button label (the count remains in the adjacent indicator
  text).
- In-progress feedback and re-entrancy protection are inherited from the
  existing refresh action's established behavior.
