# Feature Specification: Instant Render When Navigating from Settings to Home

**Feature Branch**: `022-fix-settings-nav-lag`
**Created**: 2026-05-21
**Status**: Draft
**Input**: User description: "I start on the `/settings` route and I click
to go back to the home route. In the browser, I see the URL change
immediately, but the view doesn't re-render for a few seconds. That
should not happen. The view should change when the URL does."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Leaving Settings for Home updates the view as soon as the URL changes (Priority: P1)

A user is on the Settings page. They click the link that returns them
to the home route (the main feeds / items view). The browser address
bar updates to the home URL immediately, and the visible page content
must change on the same interaction — not several seconds later. The
user should never see the Settings page persist on screen while the URL
already says the user is somewhere else.

**Why this priority**: This is the issue the user reported. A
mismatch between the URL and the rendered view makes the app appear
unresponsive or broken on the most basic navigation in the product —
returning home. It is reproducible on every session and undermines
trust in the rest of the app's responsiveness.

**Independent Test**: Open the app, sign in, navigate to `/settings`,
then click the link that goes back to `/` (e.g. "Back to Feeds" or the
masthead title). Confirm that the URL change and the page-content
change happen together: the Settings content disappears and the home
view appears without any visible pause.

**Acceptance Scenarios**:

1. **Given** the user is on `/settings`, **When** they click the link
   that returns them to `/`, **Then** the visible page content updates
   on the same frame as the URL — within roughly one display frame on
   a typical device.
2. **Given** the user is on `/settings`, **When** they click the link
   that returns them to `/`, **Then** the Settings page content does
   not remain on screen after the URL has changed.
3. **Given** the user is on `/settings`, **When** they navigate to `/`
   and the home view has been rendered at least once earlier in this
   session, **Then** the home view appears immediately using locally
   available data, without a "Loading…" placeholder or a flash of an
   empty list.
4. **Given** the user uses the browser's Back button while on
   `/settings` (assuming the previous entry was `/`), **When** the
   back navigation occurs, **Then** the same instant-update behaviour
   applies — URL and visible view change together.

---

### User Story 2 — The fix does not introduce a content flash (Priority: P1)

A common failure mode when fixing a render delay is to trade the pause
for a flash: the new view paints briefly, then is cleared or replaced
by a loading state, then re-paints. The fix for this report must not
do that. Returning from Settings to Home must produce a single
transition from Settings content to Home content, not multiple
intermediate states.

**Why this priority**: Pre-empting a foreseeable regression. Without
calling this out in the spec, future contributors may "fix" the delay
by introducing a skeleton or empty state that flickers in the gap.

**Independent Test**: Throttle the network or go offline, then
navigate from `/settings` to `/`. The home view must appear once and
stay; it must not be replaced by a loading placeholder, an empty
list, or any intermediate empty state while a background refresh runs.

**Acceptance Scenarios**:

1. **Given** the home view has been rendered at least once this
   session, **When** the user navigates from `/settings` to `/`,
   **Then** the home view's items appear once from local data and are
   not cleared, blanked, or replaced by a placeholder during the
   transition.
2. **Given** a background refresh of the home view's data runs after
   the navigation, **When** it completes, **Then** any updates to the
   list are applied in place without unmounting the list or jumping
   scroll position.

---

### User Story 3 — Other route changes are not made slower by the fix (Priority: P2)

Whatever change resolves the Settings → Home delay must not regress
other navigations. Switching between Starred and All Items (the fix
already shipped under feature 021), opening a feed-specific view, and
navigating into and out of an item must all continue to render as soon
as the URL changes.

**Why this priority**: Prevents the fix from re-introducing the
class of lag this codebase has already invested in eliminating
elsewhere.

**Independent Test**: After the fix, walk through the existing
navigation paths covered by feature 021 (Starred ⇄ All Items), plus
home → feed-view, home → item-detail, and confirm each still renders
on the same interaction as the URL change.

**Acceptance Scenarios**:

1. **Given** the user is anywhere in the app, **When** they navigate
   between any two routes that have been rendered before in the
   session, **Then** the visible view updates on the same frame as
   the URL.
2. **Given** the user has just signed in and a route has never been
   rendered before, **When** they navigate to it, **Then** the
   existing first-load behaviour (e.g. a skeleton until data is
   ready) is preserved — this spec does not require removing genuine
   first-load loading states.

---

### Edge Cases

- **Cold load directly on `/settings`**: When the user opens the app
  directly on `/settings` and then navigates to `/`, the home view
  may legitimately need to wait for initial data to be ready; the
  existing first-load skeleton for `/` is acceptable in that case.
  The bug being fixed is specifically the mid-session case where the
  home view has already been rendered earlier.
- **Navigation from Settings to a non-home route**: The user's report
  is about `/settings` → `/`. The spec's expectations also cover
  `/settings` → any other route the user can reach from Settings
  (e.g. via the masthead), because the same root cause is likely to
  apply.
- **Navigation away from Settings while a Settings-only async
  operation is in flight** (e.g. fetching subscription state or
  saving a setting): The view change must still happen on the URL
  change; the in-flight Settings work must not be allowed to keep the
  Settings view rendered or to write into the new view.
- **Browser Back / Forward**: The fix must apply equally to
  programmatic clicks on in-app links and to Back/Forward navigation
  in the browser.
- **Repeated Settings ⇄ Home navigation**: Every round trip must
  behave the same way; the second and subsequent visits must not get
  progressively slower.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When the route changes from `/settings` to `/` (or any
  other route), the visible page content MUST update on the same
  frame as the URL — within roughly one display frame on a typical
  user device.
- **FR-002**: The Settings page content MUST NOT remain rendered
  after the URL has changed away from `/settings`.
- **FR-003**: When navigating to `/` and the home view has been
  rendered at least once during the current session, the app MUST
  render the home view from locally available data without showing
  a "Loading…" placeholder or an empty list.
- **FR-004**: The app MUST NOT introduce a transitional empty or
  loading state between the Settings view and the home view in
  mid-session navigation; the visible transition is exactly one step
  from one route's content to the other's.
- **FR-005**: Any background refresh triggered by arriving at `/`
  MUST NOT block, delay, or visibly interrupt the rendered home
  view; when it completes it MUST update the list in place rather
  than re-mounting it.
- **FR-006**: In-flight asynchronous work owned by the Settings
  route (e.g. subscription or settings reads/writes) MUST NOT
  re-render the Settings view, prevent the home view from rendering,
  or write into the home view once the user has navigated away.
- **FR-007**: The same instant-update behaviour MUST apply to
  browser Back/Forward navigation between Settings and the home
  route, not only to in-app link clicks.
- **FR-008**: The fix MUST NOT regress instant rendering already
  established by feature 021 for Starred ⇄ All Items, nor for any
  other already-rendered route.

### Key Entities *(include if feature involves data)*

- **Route**: The current URL path the app is showing. The spec
  treats it as the single source of truth for "which view should
  be on screen"; the rendered view must follow it within one frame.
- **Settings view**: The page rendered for `/settings`, including
  its own asynchronous loads (subscription state, payment methods,
  etc.). For this spec it is the "leaving" view whose content must
  not persist after navigation.
- **Home view**: The page rendered for `/`, including the items
  list. For this spec it is the "arriving" view whose content must
  appear immediately from local data when it has been rendered
  earlier in the session.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After the home view has been rendered once in a
  session, the time from the user's click on a Settings-to-home
  link to the home view being fully painted is under 100 ms on a
  typical user device. (Chosen as the threshold at which interactions
  feel instant to most users.)
- **SC-002**: During such a navigation, the user never sees the
  Settings view rendered while the URL is `/` — measured as 0
  frames in which the displayed view and the URL disagree.
- **SC-003**: During such a navigation, the user never sees a
  "Loading…" placeholder or an empty home view — measured as 0
  frames in which the items list is both empty and the home view
  actually has items locally.
- **SC-004**: 100% of repeated `/settings` ⇄ `/` navigations in a
  session produce the same instant behaviour, including the second
  and subsequent visits.
- **SC-005**: After this change ships, user reports describing
  Settings-to-home navigation as "stuck", "slow", "lagging", or
  "the URL changed but the page didn't" go to zero.

## Assumptions

- "The home route" means the route at path `/` (the items list
  view), as that is what the user is returning to from `/settings`
  in the reported scenario.
- The home view's data is already maintained locally for the
  signed-in user during a session; "we already have all the data
  locally" is taken at face value for the mid-session case, and any
  work needed to make local data available is treated as already in
  place.
- "Instant" is defined for this spec as "indistinguishable from
  immediate to a human eye" — i.e. completed within roughly one
  display frame on a typical device — rather than literally zero
  elapsed time.
- The bug applies in production-mode builds as well as in dev; the
  spec is intentionally environment-agnostic.
- The existing first-load skeletons for `/`, item routes, and feed
  routes (visible only when no local data exists yet) are correct
  and out of scope; this spec is only about mid-session route
  changes where the destination view has already been rendered.
