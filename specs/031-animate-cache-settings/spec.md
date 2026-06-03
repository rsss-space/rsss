# Feature Specification: Animate Cache Settings Disclosure

**Feature Branch**: `031-animate-cache-settings`  
**Created**: 2026-06-02  
**Status**: Draft  
**Input**: User description: "The 'cache settings' on each blog -- when you
click it, it adds content to the feed item. That's fine, but it should
animate open smoothly, and there should not be any jank"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Expanding cache settings animates smoothly (Priority: P1)

On the Settings page, each subscribed feed in the "Subscribed Feeds" list
has a "Cache settings" disclosure. Today, activating it reveals the cache
controls (cache mode, max size, keep-for, clear cache) instantly, so the
feed card's height jumps abruptly and the content below shifts in a single
jarring step. The user wants the disclosure to grow open smoothly so the
reveal feels intentional and the surrounding layout settles gracefully.

**Why this priority**: This is the entire point of the request — the abrupt
expansion is the perceived defect. Delivering a smooth open is the minimum
viable improvement and stands on its own.

**Independent Test**: On the Settings page, click "Cache settings" on any
feed and observe the panel grow open over a short, smooth transition with no
sudden height jump or flicker, and the controls fully visible and usable
once the animation completes.

**Acceptance Scenarios**:

1. **Given** a feed's cache settings are collapsed, **When** the user
   activates the "Cache settings" disclosure, **Then** the panel expands
   with a smooth height transition rather than appearing instantly.
2. **Given** the panel is animating open, **When** the animation completes,
   **Then** all cache controls are fully visible, correctly laid out, and
   immediately interactive.
3. **Given** the panel has expanded, **When** the user looks at the feed
   card, **Then** the card and any content below it have settled into their
   final position without a visible jump or overshoot.

---

### User Story 2 - Collapsing cache settings animates smoothly (Priority: P2)

When the user closes an open cache settings disclosure, the panel should
shrink closed with the same smooth motion, rather than the content vanishing
instantly and the card snapping shut.

**Why this priority**: A smooth open paired with an instant snap-shut would
feel inconsistent and still read as janky. Symmetry completes the polished
feel, but the open animation (P1) already delivers the core value.

**Independent Test**: With a feed's cache settings expanded, activate the
disclosure again and observe the panel shrink closed over a smooth
transition that mirrors the opening motion.

**Acceptance Scenarios**:

1. **Given** a feed's cache settings are expanded, **When** the user
   collapses the disclosure, **Then** the panel shrinks closed with a smooth
   height transition rather than disappearing instantly.
2. **Given** the panel is animating closed, **When** the animation
   completes, **Then** only the "Cache settings" summary remains and the
   feed card has returned to its collapsed height.

---

### User Story 3 - Motion respects user accessibility preference (Priority: P3)

A user who has asked their operating system to reduce motion should not be
subjected to the expand/collapse animation; for them the panel should open
and close immediately without transition.

**Why this priority**: Honoring reduced-motion preferences is important for
accessibility and is the project's established pattern, but it affects a
subset of users and does not block the primary improvement for everyone
else.

**Independent Test**: With the OS "reduce motion" setting enabled, activate
a "Cache settings" disclosure and confirm the panel opens and closes
instantly with no animation, while controls remain fully functional.

**Acceptance Scenarios**:

1. **Given** the user has enabled a reduced-motion preference, **When** they
   open or close cache settings, **Then** the panel appears and disappears
   immediately with no animated transition.
2. **Given** reduced motion is enabled, **When** the panel is open, **Then**
   the controls are fully visible and usable, identical to the animated
   case's end state.

---

### Edge Cases

- **Rapid toggling**: If the user activates the disclosure repeatedly before
  an animation finishes, the panel must reverse or retarget cleanly and end
  in the state matching the user's final action, with no stuck partial-open
  state, no flicker, and no leftover clipped content.
- **Multiple disclosures**: Opening or closing one feed's cache settings
  must not visibly disturb, re-animate, or shift other feeds' disclosures in
  the list.
- **Tall content / small viewport**: When the cache controls are taller than
  the visible area, the open animation must still complete smoothly and
  leave all controls reachable (e.g. via scrolling) without clipping.
- **Keyboard and assistive activation**: Activating the disclosure via
  keyboard (Enter/Space on the summary) produces the same smooth animation
  and the expanded/collapsed state is correctly conveyed to assistive
  technology.
- **Disabled disclosure**: When cache settings are unavailable for a feed
  (the disclosure is shown in a disabled state), activation does not trigger
  an animation or expansion.
- **Mid-animation interaction**: Controls inside the panel should not be
  activatable in a way that produces a wrong result while the panel is still
  clipped/partially revealed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The "Cache settings" disclosure on each subscribed feed MUST
  animate from its collapsed height to its fully expanded height when opened,
  instead of revealing content instantly.
- **FR-002**: The disclosure MUST animate from expanded back to collapsed
  when closed, mirroring the opening motion.
- **FR-003**: The expand/collapse animation MUST be visually smooth, with no
  abrupt height jump, flicker, content flash, or overshoot of surrounding
  layout.
- **FR-004**: The animation duration MUST be brief enough that opening the
  panel never feels slow or obstructs access to the controls.
- **FR-005**: Once the open animation completes, all cache controls (cache
  mode, max size, keep-for, clear cache) MUST be fully visible, correctly
  positioned, and immediately interactive.
- **FR-006**: When a reduced-motion preference is active, the system MUST
  skip the animation and open/close the panel immediately.
- **FR-007**: The disclosure's open/closed state MUST remain correctly
  represented for assistive technology and keyboard users throughout and
  after the animation.
- **FR-008**: Repeated or rapid activation MUST resolve to the state
  matching the user's most recent action without leaving the panel stuck in
  a partial state or with clipped content.
- **FR-009**: Animating one feed's disclosure MUST NOT cause other feeds'
  disclosures or list items to animate or shift unexpectedly.
- **FR-010**: The change MUST NOT alter which cache controls are shown, their
  values, or their behavior — only the manner in which they are revealed and
  hidden.

### Key Entities

This feature is presentation-only and introduces no new data entities. It
affects the reveal/hide behavior of the existing per-feed cache settings
disclosure in the Subscribed Feeds list.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Opening or closing a feed's cache settings produces a
  continuous height transition with no single-frame jump; the surrounding
  layout reaches its final position only at the end of the transition.
- **SC-002**: The open and close transitions each complete within roughly
  150–300 ms, so the controls become usable promptly.
- **SC-003**: The animation runs smoothly without perceptible stutter on a
  typical device, holding a steady frame rate (target ~60 fps) for the
  duration of the transition.
- **SC-004**: With a reduced-motion preference enabled, no animation occurs
  and the panel toggles instantly in 100% of activations.
- **SC-005**: Across rapid repeated toggles, the panel always ends in the
  state matching the user's final action, with no observed stuck, clipped,
  or partially-open end states.
- **SC-006**: The set of cache controls, their values, and their behavior are
  unchanged from before this feature (no functional regression).

## Assumptions

- The disclosure in scope is the per-feed "Cache settings" control in the
  "Subscribed Feeds" list on the Settings page (one instance per subscribed
  feed). The visually similar cache disclosure rendered elsewhere is out of
  scope unless it shares the same implementation.
- "No jank" is interpreted as: a smooth, continuous height animation with a
  steady frame rate and no abrupt layout shift — not a specific numeric
  performance budget supplied by the user.
- Both opening and closing should animate; the user described opening, but a
  symmetric close is assumed for consistency.
- The animation should honor the operating system's reduced-motion
  preference, consistent with the project's existing accessibility behavior.
- The expand/collapse interaction model (a click/keyboard-activated
  disclosure that toggles a single panel) stays the same; only the visual
  transition between states changes.
- An assumed animation duration of approximately 150–300 ms reflects a
  standard disclosure feel; the exact value can be tuned during
  implementation without changing the spec's intent.
