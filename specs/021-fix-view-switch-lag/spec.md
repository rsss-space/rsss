# Feature Specification: Instant Switch Between Starred and All Items Views

**Feature Branch**: `021-fix-view-switch-lag`
**Created**: 2026-05-20
**Status**: Draft
**Input**: User description: "When I am on 'starred' view, then switch back
to 'All Items', there is a long pause where it looks like the app is not
doing anything. It should be instant. We already have all the data
locally."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Switching from Starred back to All Items feels instant (Priority: P1)

A reader is browsing the Starred view (the sidebar entry listing only
items the user has flagged). They click the All Items sidebar entry to
return to the full list. Because every item shown in the All Items view
was already loaded into the app while they were using it, the new list
must appear immediately — no perceptible blank screen, no "Loading…"
placeholder, no spinner, no delay where the previous list is replaced by
nothing.

**Why this priority**: This is the issue the user reported. The current
behaviour makes the app feel broken on a basic navigation action that
should be the cheapest interaction in the product. It is reproducible on
every session and degrades trust in the rest of the app's
responsiveness.

**Independent Test**: With the app loaded and at least one item visible
in both views, navigate from Starred to All Items and observe that the
All Items list renders without any visible loading state and without the
previous list disappearing first.

**Acceptance Scenarios**:

1. **Given** the user is on the Starred view and the All Items list has
   already been fetched at least once this session, **When** the user
   clicks the All Items sidebar entry, **Then** the All Items list
   becomes visible on the next frame the browser paints, with no
   intermediate empty state or loading indicator.
2. **Given** the user is on the All Items view, **When** the user clicks
   the Starred sidebar entry, **Then** the Starred list becomes visible
   on the next frame the browser paints, with no intermediate empty
   state or loading indicator.
3. **Given** the user toggles between Starred and All Items repeatedly,
   **When** each switch occurs, **Then** every switch behaves the same
   way — instant rendering of the destination view's locally known
   items, regardless of how many round trips have happened.
4. **Given** the user is on the Starred view, **When** the user clicks
   All Items, **Then** the previously rendered Starred list is not
   replaced by a blank list or a "No items to show" message at any
   point during the transition.

---

### User Story 2 — Switching views does not block on the network (Priority: P1)

While the destination view appears immediately from local data, the app
is still free to refresh that data from the server in the background.
That background refresh must not delay the visible switch and must not
cause the freshly shown list to flash, jump, or be cleared while the
refresh completes.

**Why this priority**: A common failure mode in fixes like this is to
trade the loading pause for a content flash — the view appears, then
disappears, then re-appears once the server responds. Calling that out
in the spec prevents the same complaint from re-occurring under a
different shape.

**Independent Test**: With the network throttled or temporarily offline,
switch from Starred to All Items. The view still appears instantly. When
the network responds (or is restored), any updates to the list are
applied in place without the list being cleared or replaced wholesale.

**Acceptance Scenarios**:

1. **Given** the network is slow or unreachable, **When** the user
   switches between Starred and All Items, **Then** the destination
   view's locally known items appear immediately from local data.
2. **Given** the destination view has been rendered from local data,
   **When** a background refresh later returns updated data, **Then**
   the existing rendered list is updated in place without being cleared
   first.

---

### User Story 3 — Loading indicators only appear when there is genuinely no local data to show (Priority: P2)

The "Loading items…" placeholder should be reserved for the case where
the app truly has no items to render for the chosen view (e.g. a fresh
sign-in before the first sync completes). Once the app has rendered a
view at least once in the current session, switching away and back must
not re-trigger that placeholder.

**Why this priority**: Establishes the rule that distinguishes
legitimate first-load loading states from the buggy mid-session pauses
the user reported. Without it, future contributors may reintroduce the
same regression.

**Independent Test**: Sign in fresh, observe the loading state on first
render of the items list. Switch to Starred, then back to All Items;
verify that the loading state does not appear on either switch.

**Acceptance Scenarios**:

1. **Given** the items list has never been rendered in this session,
   **When** it first opens, **Then** showing a loading indicator is
   acceptable.
2. **Given** the items list has already been rendered at least once in
   this session, **When** the user switches between Starred and All
   Items, **Then** no loading indicator is shown for that switch.

---

### Edge Cases

- **Starred list is empty**: When the user has not starred any items,
  switching to the Starred view must immediately show the "no starred
  items" empty state — without first flashing a loading indicator or
  the previous list's contents.
- **All Items list is empty**: When the user has zero items across all
  feeds (e.g. brand-new account with no feeds added), switching to All
  Items must immediately show the established empty state, again with
  no loading indicator in the middle.
- **Pagination position**: When the user was on page N of the All Items
  view, navigated to Starred, then returned to All Items, the view
  shows All Items from its natural starting position; users should not
  see a flash of the page-N items being replaced by page-1 items.
- **Pending updates banner**: When background polling has discovered
  new items for the All Items view but the user has not yet refreshed,
  switching back to All Items shows the same locally cached items the
  user was looking at before — the pending-updates state is preserved
  and is not reset by the switch.
- **Switch initiated while a previous switch's background refresh is
  still in flight**: A second view switch must still render
  immediately; any in-flight refresh for the previous view must not be
  allowed to overwrite the new view's content when it eventually
  returns.
- **Switch made from a feed-specific route** (e.g. `/feed/...`): The
  expectation in this spec covers the Starred ⇄ All Items pair only;
  navigation from a specific feed view to All Items or Starred is out
  of scope unless the same root cause incidentally applies.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST render the destination view (Starred or All
  Items) using locally available data on the same frame the user's
  click is processed, whenever that view has been rendered at least
  once during the current session.
- **FR-002**: The app MUST NOT clear, blank, or replace the currently
  rendered items list with an empty state or loading indicator during
  a switch between Starred and All Items when local data for the
  destination view is available.
- **FR-003**: The app MUST NOT show the "Loading items…" placeholder
  for switches between Starred and All Items once either view has been
  rendered at least once in the current session.
- **FR-004**: The app MAY initiate a background refresh of the
  destination view's data from the server after the switch, but that
  refresh MUST NOT block, delay, or visibly interrupt the rendered
  view.
- **FR-005**: When a background refresh completes, the app MUST update
  the rendered list in place rather than re-mounting or wholesale
  replacing the list, so that scroll position and any in-progress user
  interactions (such as item selection) are preserved.
- **FR-006**: When a switch's background refresh completes after a
  subsequent switch has already occurred, the stale refresh MUST NOT
  overwrite the currently visible view.
- **FR-007**: When the destination view has genuinely zero items (e.g.
  no starred items, no feeds), the app MUST show the appropriate empty
  state immediately on switch, without passing through a loading
  indicator.
- **FR-008**: The active state of the sidebar entries (Starred / All
  Items highlighting) MUST update on the same frame as the items list
  changes, so that the highlighted entry and the displayed list never
  appear out of sync.

### Key Entities *(include if feature involves data)*

- **Items list view**: The user-facing list of feed items currently
  shown in the main pane. Has two top-level filter modes addressed by
  this spec — "All Items" and "Starred" — selected via the sidebar.
- **Locally available data**: The set of items the app already holds
  on the user's device for the current account. The spec treats this
  as a black box; what matters is that when the user has been using
  the app, the items needed to render both views are already in hand.
- **Background refresh**: A read of the latest items from the server
  that may run after a view switch. The user does not initiate it
  explicitly and does not have to wait for it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After either view has been rendered once in a session,
  the time from a click on the opposite sidebar entry to the
  destination view being fully painted is under 100 ms on a typical
  user device. (Chosen as the threshold at which interactions feel
  instant to most users.)
- **SC-002**: During such a switch, the user never sees a "Loading
  items…" placeholder or a temporarily empty list — measured as 0
  frames in which the items list is both empty and the destination
  view actually has items.
- **SC-003**: When a background refresh completes after the switch,
  the visible list updates in place; the rendered list element is not
  unmounted and remounted, and scroll position does not jump.
- **SC-004**: 100% of repeated A→B→A switches in a session produce the
  same instant behaviour — none of them re-trigger the first-load
  loading indicator.
- **SC-005**: After this change ships, user reports describing the app
  as "stuck", "slow", or "not doing anything" specifically when
  switching between Starred and All Items go to zero.

## Assumptions

- The user's report applies to the round trip between the two top-level
  sidebar entries "All Items" and "Starred"; it does not implicitly
  extend to switching to or from a specific feed view, even though a
  similar pattern may exist there.
- The app already maintains a local store of items for the signed-in
  account; "we already have all the data locally" is taken at face
  value, and any work needed to make local data available is treated
  as already in place.
- "Instant" is defined for this spec as "indistinguishable from
  immediate to a human eye" — i.e. completed within roughly one
  display frame on a typical device — rather than literally zero
  elapsed time.
- Background refreshes of the items list from the server are desirable
  and should continue; the fix is about decoupling them from the
  visible switch, not removing them.
- Pagination state, scroll position, and any open item-row affordances
  may be reset across a view switch if that is the existing behaviour;
  this spec does not require preserving them, only that nothing in the
  middle of the transition is visibly broken.
