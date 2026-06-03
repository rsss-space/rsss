# Mobile Feeds View (`/feeds` route) Design

## Summary

This feature adds mobile access to feed management controls. On desktop, the
application renders a persistent sidebar listing feeds, unread counts, and
controls for adding, deleting, refreshing, and navigating to feeds. On screens
narrower than 680px the sidebar is hidden and replaced by a hamburger menu,
leaving mobile users with no way to manage their subscriptions. This design
closes that gap by (1) extracting the sidebar's inner content into a shared
`FeedNav` component, (2) creating a new `/feeds` route that renders `FeedNav`
as a full-width, touch-friendly page, and (3) wiring a "Feeds" link into the
existing hamburger menu to reach it.

The central engineering decision is the extract-and-reuse approach: rather than
duplicating the sidebar's markup for mobile, all feed-management controls live
in a single `FeedNav` component consumed by both the desktop `Sidebar` wrapper
and the new mobile `FeedsRoute` wrapper. The two wrappers never appear on screen
at the same time (the sidebar is hidden at mobile widths; `/feeds` is a separate
route), so they can share a component without conflicting. No backend changes,
new signals, or breakpoint adjustments are required — the feature is a pure
frontend refactor and routing addition on top of existing state and helpers.

## Definition of Done

1. The mobile hamburger menu (shown `<680px`, alongside About / Logout) gains a
   **"Feeds"** link.
2. The link opens a new **auth-guarded `/feeds` route**.
3. `/feeds` is a **full-width, touch-friendly** page exposing the **same controls
   as the desktop sidebar**: All Items + Starred (with counts); the Feeds header
   with gear -> `/settings` and the "+" add-feed control (form + error); the feed
   list (All Feeds + per-feed entries with unread counts, pending counts,
   resolving spinner, failed label, retry, delete "X"); and the footer
   Refresh Feeds + Settings.
4. Those controls are backed by **shared components extracted from the desktop
   sidebar** — a single source of truth, so behavior never drifts between the
   desktop sidebar and the mobile `/feeds` page.
5. Tapping All Items / Starred / All Feeds / an individual feed **navigates to the
   article list** (`/` or `/feed/...`), matching desktop selection semantics.
   Add-feed, delete, retry, and refresh act **in place** on `/feeds`.
6. Breakpoints stay as they are (the known 680-768px gap, where the desktop
   sidebar is hidden but the hamburger is not yet shown, is an accepted
   limitation).

### Out of scope

- No changes to the 680px / 768px breakpoint values.
- No backend / Durable Object / SQLite / sync changes — UI + routing only,
  reusing existing signals and `State.*` helpers.
- No new standalone "Settings" entry in the hamburger; Settings remains reachable
  from `/feeds` (gear + footer), as on the desktop sidebar.

## Acceptance Criteria

### `027-mobile-feeds-route.AC1`: Hamburger menu exposes a Feeds entry point
- **027-mobile-feeds-route.AC1.1 Success:** The header's mobile menu
  (`.mobile-nav-menu`) wires a navigation link whose target is `/feeds`.
- **027-mobile-feeds-route.AC1.2 Success:** Activating the Feeds link navigates
  to `/feeds` and the hamburger menu collapses (existing close-on-route-change
  effect).
- **027-mobile-feeds-route.AC1.3 Success:** The Feeds link lives in the same
  mobile menu as the existing About link and Logout control (only surfaced
  where the hamburger is, below 680px).

### `027-mobile-feeds-route.AC2`: `/feeds` is a registered, auth-guarded route
- **027-mobile-feeds-route.AC2.1 Success:** `router.match('/feeds').action(...)`
  returns `FeedsRoute` when the user is authenticated.
- **027-mobile-feeds-route.AC2.2 Failure:** When not authenticated and not
  loading, the action redirects via `_setRoute('/login')` (does not render
  `FeedsRoute`).
- **027-mobile-feeds-route.AC2.3 Edge:** While `authLoading` is true, the guard
  does not redirect (consistent with the `/updates` guard).

### `027-mobile-feeds-route.AC3`: `/feeds` exposes the same controls as the desktop sidebar via a shared component
- **027-mobile-feeds-route.AC3.1 Success:** `FeedsRoute` renders `<FeedNav>`.
- **027-mobile-feeds-route.AC3.2 Success:** `Sidebar` (desktop) renders the same
  `<FeedNav>` — single source of truth.
- **027-mobile-feeds-route.AC3.3 Success:** `FeedNav` contains the full control
  set: All Items + Starred (`SidebarItem`), the Feeds header (gear ->
  `/settings`, "+" add-feed toggle + form), the feed list (per-feed unread
  count, pending count, resolving spinner, failed label, retry, delete), and
  `SidebarFooter` (Refresh Feeds + Settings).
- **027-mobile-feeds-route.AC3.4 Edge:** The `/feeds` wrapper (`.route.feeds`)
  carries no `display:none` breakpoint rule, so it renders at mobile widths
  (unlike `.sidebar`).

### `027-mobile-feeds-route.AC4`: Selection drills in; mutations act in place
- **027-mobile-feeds-route.AC4.1 Success:** Feed entries link to
  `/feed/{path}`, and All Feeds / All Items / Starred link to `/` — so
  selecting one navigates away from `/feeds` to the article list.
- **027-mobile-feeds-route.AC4.2 Success:** Add-feed, delete, retry, and Refresh
  Feeds are non-navigation controls (no `href`), so invoking them keeps the user
  on `/feeds`.

### `027-mobile-feeds-route.AC5`: Desktop behavior and breakpoints are unchanged
- **027-mobile-feeds-route.AC5.1 Success:** After the `FeedNav` extraction, the
  desktop sidebar renders and behaves identically (add/delete/retry/refresh/
  navigation/counts/spinner/failed states).
- **027-mobile-feeds-route.AC5.2 Success:** `sidebar.css` and the existing 680px
  / 768px breakpoints are not modified.

## Glossary

- **`@preact/signals`**: A fine-grained reactivity library for Preact. Mutable
  values are held in `signal()` objects; components re-render only when a signal
  they read changes.
- **`htm/preact`**: A tagged-template-literal alternative to JSX for writing
  Preact component trees. Used throughout the client in place of `.tsx` files.
- **`route-event`**: A small library that intercepts clicks on internal
  `<a href>` links and dispatches a custom route-change event, enabling
  client-side navigation without `onClick` handlers.
- **Auth guard**: A check run when a route is activated that redirects
  unauthenticated users to `/login`. The pattern here mirrors the existing guard
  on the `/updates` route.
- **`authLoading`**: A signal that is `true` while the initial authentication
  state is being resolved; the auth guard must not redirect during this window.
- **`SidebarItem`**: An existing component that renders a single navigation row
  (e.g. "All Items", "Starred") with an active-highlight and an unread count
  badge.
- **`SidebarFooter`**: An existing component that renders the bottom bar of the
  sidebar, containing the "Refresh Feeds" button and a link to Settings.
- **`FeedNav`** (new): The shared presentational component extracted in Phase 1;
  holds all feed-management markup and logic currently embedded in `Sidebar`.
- **`FeedsRoute`** (new): The mobile route component, a thin wrapper that renders
  `<FeedNav>` inside a full-width `<section class="route feeds">`.
- **Drill-in navigation**: The UX pattern where tapping a feed or filter
  navigates away from the current page (here `/feeds`) to the article list,
  rather than loading content in place.
- **`tapzero` / `tapout`**: The project's test runner (TAP-producing assertion
  library) and TAP formatter. Tests are registered in `test/run-all-tests.mjs`.
- **Hamburger menu**: The three-line icon shown at narrow viewports (<680px)
  that expands a mobile navigation drawer (`.mobile-nav-menu`).
- **`_setRoute`**: An internal helper that programmatically changes the active
  client-side route, used by auth guards to redirect to `/login`.

## Architecture

The desktop sidebar and the mobile `/feeds` page share one presentational
component so their controls and behavior can never diverge. The "tailored
look" is purely a matter of the outer wrapper and a scoped CSS file.

**Shared component — `FeedNav` (`src/client/components/feed-nav.ts`, new):**
Holds everything currently inside `Sidebar`'s `<aside>`: the add-feed local
state (`showAddFeed` / `addingFeed` / `addFeedError`) and its `handleAddFeed`
/ `handleDeleteFeed` handlers, the `allFeeds` computed, the `SidebarItem`
rows (All Items / Starred), the Feeds header (gear -> `/settings`, "+"
toggle), the add-feed form, the feed list (per-feed unread + pending counts,
resolving spinner, failed label, retry, delete), and `SidebarFooter`. It
renders the inner markup only — no outer wrapper element. Prop: `state`.

**Desktop wrapper — `Sidebar` (`src/client/components/sidebar.ts`, slimmed):**
Becomes `<aside class="sidebar"><FeedNav state/></aside>`. `feed-reader.ts`
is unchanged and still renders `<Sidebar>`.

**Mobile wrapper — `FeedsRoute` (`src/client/routes/feeds.ts`, new):**
`<section class="route feeds"><FeedNav state/></section>`. Registered at
`/feeds` in `src/client/routes/index.ts` with the same auth-guard pattern as
`/updates`. The App shell (`src/client/index.ts`) already wraps every matched
route with `<Header>` and the `<footer>`, so `/feeds` gets the header
(hamburger + mobile menu) automatically.

**Entry point — `Header` (`src/client/components/header.ts`):**
A `Feeds` link (`<a href="/feeds">`) is added to the `<nav>` inside
`.mobile-nav-menu`, alongside the existing About link. `route-event`
intercepts internal link clicks, so no `onClick` is needed; the existing
"close menu on route change" effect collapses the hamburger after navigation.

**Navigation model (drill-in):** Selection controls are `<a href>` links, so
tapping All Items / Starred / All Feeds (`href="/"`) or a feed
(`href="/feed/{path}"`) leaves `/feeds` for the article list (`FeedReader`),
reusing the desktop handlers verbatim. Mutating controls (add, delete, retry,
refresh) are buttons with no `href`, so they act in place on `/feeds`.

`SidebarItem` and `SidebarFooter` are reused unchanged. The two wrappers never
mount simultaneously (`.sidebar` is `display:none` below 768px; `/feeds` is a
separate route), so each `FeedNav` instance owning its own add-feed `useState`
is safe.

## Existing Patterns

This design follows established codebase conventions:

- **Component + colocated CSS:** every component is a `.ts` with a sibling
  `.css` (e.g. `sidebar.ts` / `sidebar.css`). `feeds.css` follows suit,
  scoped under `.route.feeds`.
- **Route registration:** `routes/index.ts` registers routes via
  `router.addRoute(path, () => Component)`. The auth-guard pattern is copied
  from `/updates` and `/confirm-close`:
  `if (!authLoading.value && !isAuthenticated.value) return _setRoute('/login')`.
- **Route component shape:** route components are `FunctionComponent<{ state;
  params; splats }>` returning an `htm/preact` template wrapped in
  `<div class="route ...">` (e.g. `feed-reader.ts`). `FeedsRoute` matches this.
- **Navigation via `<a href>`:** the project routes through `route-event`'s
  global click interception (per project CLAUDE.md: links, not buttons, for
  navigation). All selection controls already follow this.
- **`@preact/signals` state:** the feature consumes existing signals (`feeds`,
  `counts`, `selectedFeedId`, `showStarredOnly`, `showUnreadOnly`,
  `feedUpdateCounts`, `refreshInProgress`) and existing `State.*` helpers. No
  new signals, no `batch()` writes introduced.
- **Testing:** `tapzero` + `tapout`, registered in `test/run-all-tests.mjs`
  with a matching `test:*` script in `package.json`. Two precedents are
  reused: behavioral/render-state tests (`feed-reader-render-state.ts`) and
  static source-wiring tests (`sidebar-static.mjs`,
  `routes-oauth-callback-static.mjs`).

No new architectural patterns are introduced. This is a refactor-and-compose
on top of existing structure.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Extract shared FeedNav (refactor, no behavior change)

**Goal:** Establish the single source of truth. Move the `Sidebar` body into a
new `FeedNav` component; the desktop sidebar renders and behaves identically.

**Components:**
- `src/client/components/feed-nav.ts` (new) — `FeedNav`, containing all the
  inner markup, add-feed state/handlers, `allFeeds` computed, feed-list map,
  and the `SidebarItem` / `SidebarFooter` usages currently in `sidebar.ts`.
- `src/client/components/sidebar.ts` (modified) — slimmed to
  `<aside class="sidebar"><FeedNav state/></aside>`.
- `src/client/components/sidebar.css` — unchanged (the `.sidebar` selector and
  inner-class rules still apply to the desktop wrapper). Verify no rule depends
  on `FeedNav` not existing.

**Dependencies:** None (first phase).

**Done when:** Desktop sidebar is visually and behaviorally identical (add
feed, delete, retry, refresh, navigation, counts, spinner, failed states).
Build and lint pass. A static parity test asserts `sidebar.ts` renders
`<FeedNav>`; the existing `test/sidebar-static.mjs` is retargeted at
`feed-nav.ts` for whatever inner markup it asserts, and passes. Covers
`027-mobile-feeds-route.AC3.2`, `027-mobile-feeds-route.AC3.3`.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: /feeds route, component, and mobile styling

**Goal:** A full-width, touch-friendly `/feeds` page that renders the shared
`FeedNav`, auth-guarded, reachable by URL at any width.

**Components:**
- `src/client/routes/feeds.ts` (new) — `FeedsRoute`,
  `<section class="route feeds"><FeedNav state/></section>`.
- `src/client/routes/feeds.css` (new) — mobile-tailored styling scoped under
  `.route.feeds` (full width, comfortable page padding, larger touch targets),
  reusing existing spacing/color variables from `_variables.css`; no sub-1rem
  font sizes; no edits to `sidebar.css`. Restates only the inner-class rules
  that `sidebar.css` scopes under `.sidebar` and that `.route.feeds` therefore
  doesn't inherit.
- `src/client/routes/index.ts` (modified) — `router.addRoute('/feeds', ...)`
  with the `/updates` auth-guard pattern, returning `FeedsRoute`.

**Dependencies:** Phase 1 (`FeedNav` must exist).

**Done when:** Navigating to `/feeds` renders the full-width feed nav with all
controls; the unauthenticated guard redirects to `/login`; the page has no
`display:none` breakpoint rule (renders at mobile widths). A behavioral test
verifies `router.match('/feeds').action(...)` returns `FeedsRoute` when
authenticated and calls `_setRoute('/login')` when not; the parity static test
is extended to assert `routes/feeds.ts` renders `<FeedNav>`. Build, lint, and
tests pass. Covers `027-mobile-feeds-route.AC2.1`–`AC2.3`,
`027-mobile-feeds-route.AC3.1`, `AC3.4`, `AC4.1`, `AC4.2`.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Hamburger "Feeds" link

**Goal:** Add the mobile entry point.

**Components:**
- `src/client/components/header.ts` (modified) — add `<a href="/feeds">Feeds</a>`
  to the `<nav>` inside `.mobile-nav-menu`, with the same active-class pattern
  as the existing About link.

**Dependencies:** Phase 2 (the `/feeds` route must exist to navigate to).

**Done when:** The mobile menu wires a link whose target is `/feeds`; tapping
it navigates to `/feeds` and the existing route-change effect closes the
hamburger. A static wiring test asserts `header.ts`'s mobile menu links to
`/feeds`. Build, lint, and `npm test` pass. Covers
`027-mobile-feeds-route.AC1.1`–`AC1.3`.
<!-- END_PHASE_3 -->

## Additional Considerations

**Accepted breakpoint gap:** The desktop sidebar is hidden below 768px but the
hamburger (hence the Feeds link) appears only below 680px. Between 680–768px
there is no Feeds entry point. This is a conscious, accepted limitation — the
breakpoints are left unchanged. If it ever needs closing, the one-line fix is
aligning the hamburger media query in `header.css` to `< 768px`.

**Cosmetic active-state on /feeds (optional polish):** On `/feeds`,
`SidebarItem.isActive` and the All Feeds row's `allFeeds` evaluate truthy
because the path isn't `/feed/*`, so those rows render an "active" highlight.
It is harmless (the user is about to navigate away) and matches no real
selection. Optionally suppress active styling when `route === '/feeds'` for a
cleaner menu. Not required for any AC.

**Desktop access to /feeds:** `/feeds` resolves at any viewport width; only the
*link* is mobile-only. Opening `/feeds` on desktop shows the full-width feed
nav as a standalone page — unlinked and harmless. No desktop nav entry is
added (desktop already has the always-visible sidebar).

**CSS ownership:** Desktop `sidebar.css` is not modified. Whether the shared
inner-class rules are global or `.sidebar`-scoped is verified during Phase 2;
`feeds.css` restates only what `.route.feeds` needs, leaving desktop styling
byte-for-byte unchanged (per the project rule against touching unrelated CSS).
