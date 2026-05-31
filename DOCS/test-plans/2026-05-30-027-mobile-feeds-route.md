# Human Test Plan — Mobile Feeds View (`/feeds`)

Feature: `027-mobile-feeds-route`
Branch: `mobile-feeds` (base `staging`)
Range: `e224cb2..88eff69`

## Automated coverage (already green)

- `test/sidebar-static.mjs` — 4/4. FeedNav holds the add-feed input +
  empty-state markup; Sidebar wraps FeedNav. (AC3.2, AC3.3)
- `test/feeds-route-static.mjs` — 5/5. `/feeds` registered + auth-guard
  pattern; FeedsRoute renders FeedNav in `.route.feeds`; no `display:none`
  breakpoint. (AC2.1, AC2.2, AC2.3, AC3.1, AC3.4)
- `test/header-feeds-link-static.mjs` — 3/3. Mobile menu links to `/feeds`,
  co-located with About + Logout. (AC1.1, AC1.3)
- `test/sidebar-feed-counts.ts` — 12/0. Renders the real `<Sidebar>` and
  asserts inner DOM (unread/pending counts, feed-select links, order). This
  is the behavioral guard that desktop DOM is preserved post-refactor.
  (AC5.1)
- `npm run build`, `npm run lint`, `npm run stylelint` all pass.

Pre-existing, unrelated failure: `test/deploy-config.mjs` (wrangler staging
blurhash-queue name assertion) fails identically at base `e224cb2`. Out of
scope for this feature.

## Manual verification

These cover behavior that automated source-wiring tests cannot fully assert
(real navigation, viewport-driven visibility, redirect, parity). Run with the
dev server (`npm start`) while logged in unless noted.

### Mobile (viewport width < 680px)

1. Open the app. The hamburger button is visible; the desktop sidebar is
   hidden.
2. Open the hamburger menu. A "Feeds" link appears alongside Home / About /
   Updates / Logout.
3. Tap "Feeds". The URL becomes `/feeds`, the menu closes, and a full-width
   feed-management view renders: All Items + Starred, the Feeds header with
   the gear (-> `/settings`) and the "+" add-feed toggle, the feed list
   (per-feed unread count, any pending count, resolving spinner, failed
   label + retry, delete), and the Refresh Feeds / Settings footer.
4. Selection drills in: tap a feed -> navigates to `/feed/...` (article
   list); tap All Items / Starred / All Feeds -> navigates to `/`.
5. Mutations stay in place: from `/feeds`, use "+" to add a feed, delete a
   feed, retry a failed feed, and Refresh Feeds. Each keeps you on `/feeds`
   (no navigation away) and updates in place.
6. Touch targets on `/feeds` feel comfortably large (feed rows and control
   buttons).

### Auth guard

7. Log out. Navigate directly to `/feeds` (type the URL). You are redirected
   to `/login` (FeedsRoute does not render).
8. While auth is still loading (hard refresh on `/feeds` when logged in), the
   view does not flash a redirect to `/login`.

### Desktop parity (viewport width >= 768px) — AC5

9. At desktop width, the left sidebar renders and behaves exactly as before
   the change: All Items / Starred with counts, Feeds header gear + "+"
   toggle, add a feed, delete a feed, a resolving spinner, a failed feed's
   "Failed to fetch" + retry, Refresh Feeds, and navigation to `/` and
   `/feed/...`. Nothing about the desktop sidebar should look or behave
   differently.
10. The empty-state copy (when there are no feeds / on error) reads with a
    proper typographic apostrophe ("Couldn't load feeds" / "No feeds yet…").

### Direct URL at desktop width

11. At desktop width, navigating directly to `/feeds` shows the same shared
    feed-management controls in the full-width page container (it is reachable
    at any width; it is not desktop-redirected).
