# Feature Specification: Stable Cache Settings Width

**Feature Branch**: `042-fix-cache-settings-width`
**Created**: 2026-06-15
**Status**: Draft
**Input**: User description: "When I expand the cache settings on one feed,
there is some jank when I close the expanded view. The column shrinks to a
smaller size, and the text 'Cache settings' moves to the right. I do not
like that. The column should always be large enough to be expanded, so no
jank on open or close."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Closing cache settings does not shift the layout (Priority: P1)

On the Settings page, each subscribed feed in the "Subscribed Feeds" list has
a "Cache settings" disclosure. When a feed's cache settings are expanded, the
feed column is wide enough to hold the cache controls (cache mode, max size,
keep-for, clear cache, unfollow). Today, closing the expanded view makes the
whole column shrink to a narrower width and snaps the "Cache settings" label
across to a different horizontal position. The user wants the column to keep
the width it needs for the expanded view at all times, so opening or closing
a feed's cache settings never resizes the column or moves the label
sideways.

**Why this priority**: This is the entire request. The horizontal resize and
label jump are the perceived defect; eliminating them is the minimum viable
improvement and stands on its own.

**Independent Test**: On the Settings page, open a feed's "Cache settings",
then close it, and confirm the column width stays constant and the "Cache
settings" label stays in the same horizontal position throughout — no shrink,
grow, or sideways snap.

**Acceptance Scenarios**:

1. **Given** a feed's cache settings are expanded, **When** the user closes
   the panel, **Then** the feed column keeps the same width it had while
   expanded (it does not shrink).
2. **Given** a feed's cache settings are collapsed, **When** the user opens
   the panel, **Then** the feed column does not grow wider to accommodate the
   controls — the controls already fit the established width.
3. **Given** the user opens and then closes a feed's cache settings, **When**
   the panel toggles, **Then** the "Cache settings" label stays at the same
   horizontal position the whole time (no leftward/rightward jump).

---

### User Story 2 - Cache settings remain fully usable at the stable width (Priority: P1)

With the column held at the width needed for the expanded view, the cache
controls — cache mode, max size, keep-for, clear cache, and the unfollow
action — remain fully visible, correctly laid out, and interactive. The
collapsed state still presents cleanly within that same width.

**Why this priority**: Same priority as P1 because reserving the width must
not clip, overflow, or misalign the controls, and must not break the
collapsed presentation. If the controls become unusable or the collapsed view
looks broken, the change is a net loss.

**Independent Test**: With the stable width applied, expand a feed's cache
settings and exercise each control (change cache mode, set max size, set
keep-for, clear cache, unfollow); then collapse and confirm the collapsed
card still reads cleanly. All controls work as they do today.

**Acceptance Scenarios**:

1. **Given** the column is held at the expanded width, **When** a feed's
   cache settings are open, **Then** every control is fully visible within
   the column with no clipping or horizontal overflow.
2. **Given** the column is held at the expanded width, **When** a feed's
   cache settings are closed, **Then** the collapsed card content remains
   legible and correctly aligned within that width.
3. **Given** the stable width is in effect, **When** the user interacts with
   any cache control, **Then** the control behaves exactly as it does today
   (no functional regression).

---

### Edge Cases

- How does the column behave when there are multiple feeds and one is
  expanded while the others are collapsed — do the collapsed feeds share the
  same stable width so the column edge stays straight?
- What happens at narrow viewport widths where the expanded controls would
  otherwise be the widest content — is the reserved width still respected
  without forcing horizontal scrolling of the page?
- What happens when no feed's cache settings have been expanded yet in a
  session — is the column already at the stable width on first render, so the
  very first open does not cause a resize?
- How does this interact with the existing open/close animation (031) — the
  height still animates, but width stays fixed throughout?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The subscribed-feeds column on the Settings page MUST maintain
  the width required to display a feed's expanded cache settings at all
  times, regardless of whether any panel is open or closed.
- **FR-002**: Opening a feed's cache settings MUST NOT increase the column
  width.
- **FR-003**: Closing a feed's cache settings MUST NOT decrease the column
  width.
- **FR-004**: The "Cache settings" label MUST keep a constant horizontal
  position when its panel is opened or closed (no sideways snap or reflow).
- **FR-005**: At the stable width, all cache controls (cache mode, max size,
  keep-for, clear cache, unfollow) MUST remain fully visible, correctly laid
  out, and interactive when expanded, with no clipping or horizontal
  overflow.
- **FR-006**: The collapsed presentation of a feed card MUST remain legible
  and correctly aligned within the stable width.
- **FR-007**: All collapsed and expanded feed cards in the list MUST share
  the same stable width so the column's edge stays straight.
- **FR-008**: The change MUST NOT alter the behavior of any cache control or
  the existing open/close (height) animation; only horizontal resizing/label
  shifting is removed.

### Key Entities

*Not applicable — this is a presentation-only change with no data model.*

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Opening or closing a feed's cache settings produces zero change
  in the feed column's width (0 px horizontal resize).
- **SC-002**: The "Cache settings" label's horizontal position is identical
  in the collapsed and expanded states (0 px horizontal movement).
- **SC-003**: 100% of cache controls remain fully visible and operable when a
  feed's cache settings are expanded at the stable width.
- **SC-004**: In a side-by-side comparison, a user observing the open/close
  toggle reports no perceptible horizontal jank.

## Assumptions

- The reported "column" is the subscribed-feeds list column on the Settings
  page (the same area addressed by features 007 and 031), not a different
  view.
- The desired stable width equals the width the expanded cache settings panel
  already needs today; the fix reserves that width permanently rather than
  introducing a new, larger width.
- The existing vertical open/close animation (feature 031) stays as-is; this
  change concerns horizontal width and label position only.
- No change to cache behavior, cache policy persistence, or the set of
  controls shown is intended.
- Reserving the expanded width does not require the page to introduce
  horizontal scrolling at supported viewport sizes.
