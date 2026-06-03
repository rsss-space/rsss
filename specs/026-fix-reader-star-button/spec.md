# Feature Specification: Fix Reader Star Button Appearance

**Feature Branch**: `026-fix-reader-star-button`
**Created**: 2026-05-29
**Status**: Draft
**Input**: User description: "The star button on the feed item route looks
bad. It should look like the one on the home route -- just an icon that
changes color when you hover."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Star an article from the reader (Priority: P1)

A reader opens an individual article (the feed item route) and wants to
star it for later. The star control should read as a plain icon — not a
boxed button — matching the star already shown in the home feed list, so
the article actions feel consistent across the app.

**Why this priority**: This is the entire scope of the request. The star
control already works functionally; only its appearance is wrong, and the
inconsistency is visible on every article the user opens.

**Independent Test**: Open any article on the feed item route and observe
the star control. It can be fully verified visually and by interaction
without any other change: the icon appears borderless, changes color on
hover, and reflects starred / unstarred state.

**Acceptance Scenarios**:

1. **Given** an unstarred article open on the feed item route, **When**
   the reader views the action area, **Then** the star appears as a plain
   outline icon with no surrounding box, border, or button background.
2. **Given** the star control on the feed item route, **When** the reader
   hovers over it, **Then** the icon changes color to indicate it is
   interactive (the same accent color used on the home route).
3. **Given** an unstarred article, **When** the reader activates the star,
   **Then** the icon switches to its filled state and adopts the starred
   (accent) color, and activating it again returns it to the outline,
   unstarred appearance.
4. **Given** the home feed list and the feed item route shown
   side by side, **When** comparing the two star controls, **Then** they
   present the same visual treatment (borderless icon, same hover and
   starred coloring).

### Edge Cases

- The neighboring "Mark read" / "Mark unread" control on the feed item
  route keeps its existing boxed-button appearance; only the star control
  changes, so the two controls are now visually distinct from each other.
- A keyboard user must still be able to focus and activate the star, with
  a visible focus indication, even though the resting state has no box.
- The control retains an accessible name / hover label so its purpose is
  clear without relying on the icon alone.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The star control on the feed item route MUST be presented as
  a plain icon with no border, box outline, or button-style background in
  its resting state.
- **FR-002**: The star control MUST change color on hover to signal
  interactivity, using the same accent color as the home route star.
- **FR-003**: The star control MUST visually distinguish starred from
  unstarred state (filled vs. outline icon, with the starred state using
  the accent color), consistent with the home route.
- **FR-004**: The star control on the feed item route MUST match the
  visual treatment of the star control in the home feed list.
- **FR-005**: The star control MUST remain keyboard-focusable and
  activatable, with a visible focus indication.
- **FR-006**: The star control MUST retain an accessible name / hover
  label conveying its star / unstar purpose.
- **FR-007**: The change MUST be limited to the star control's appearance;
  the adjacent read/unread control and the rest of the reader header MUST
  be unchanged.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the feed item route, the star control displays no border,
  box, or button background in its resting state.
- **SC-002**: Hovering the star control changes its color, matching the
  home route's hover behavior.
- **SC-003**: A side-by-side comparison of the home route star and the
  feed item route star shows no perceptible difference in their visual
  treatment (resting, hover, and starred states).
- **SC-004**: The star control's existing star / unstar behavior continues
  to work, and it remains operable by keyboard with visible focus.

## Assumptions

- The home feed list star control is the reference design and is
  considered correct; this work makes the feed item route match it rather
  than redesigning the star.
- The accent color and icon glyphs already used by the home route star are
  the intended target and are reused as-is.
- No change to starring behavior, data, or persistence is in scope — this
  is an appearance-only fix.
- The read/unread control on the feed item route intentionally keeps its
  boxed-button style and is out of scope.
