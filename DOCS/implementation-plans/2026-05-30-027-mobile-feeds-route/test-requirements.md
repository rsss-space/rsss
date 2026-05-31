# Test Requirements — Mobile Feeds View (`/feeds` route)

Maps every acceptance criterion (AC1.1–AC5.2) from
`docs/design-plans/2026-05-30-027-mobile-feeds-route.md` to the tests chosen
during planning. Reference doc for the test-analyst and human testers.

## Testing strategy (context)

This is a frontend Preact + `htm/preact` + `@preact/signals` + Vite codebase.
Two test forms are used, both registered in `test/run-all-tests.mjs`:

- **Static source-wiring** (`.mjs`, `node:test` + `node:assert/strict`): read a
  source file as text, regex-match the wiring. Used for the route guard,
  registration, and link wiring.
- **Behavioral** (`.ts`, `@substrate-system/tapzero`, bundled via
  `esbuild | tapout`): render a real component and assert on inner DOM.

The route guard (AC2) and link wiring (AC1, AC3.1/AC3.4, parts of AC4) are
**deliberately** tested with static source-wiring, not behavioral router tests,
because: the router is not exported (only a `_Router(state)` factory is),
importing the real `state` singleton has heavy import-time side effects
(`window`/`location`/`localStorage`, a `route-event` listener, an async
`GET /api/me`), and the project rule is "DO NOT WRITE BRITTLE TESTS" (no
asserting rendered HTML text content). The only route-test precedent
(`test/routes-oauth-callback-static.mjs`) is static. This is the idiomatic
choice; do not substitute behavioral router tests.

AC4.1/AC4.2 and AC5.1 hold **by reuse**: `FeedNav` (extracted from the desktop
sidebar) is rendered by both `Sidebar` and `FeedsRoute`, so the same `<a href>`
selection links and `<button>` mutation controls appear in both. The behavioral
`test/sidebar-feed-counts.ts` renders the real `<Sidebar>` and guards that inner
DOM (feed rows, unread badges, `a.feed-select` links, pending prefixes, signal
re-render); it is the strongest AC5.1 guard and partially covers AC4.1.

---

## 1. Automated tests

| AC (scoped ID) | Test file | Type | What is asserted |
| --- | --- | --- | --- |
| 027-mobile-feeds-route.AC1.1 | `test/header-feeds-link-static.mjs` | static source-wiring | The isolated `.mobile-nav-menu` block in `header.ts` contains `href="/feeds"` (mobile menu wires a link targeting `/feeds`). A regex-isolation guard (`assert.notEqual(menuBlock, header)`) ensures the assertion is scoped to the menu, not the whole file. |
| 027-mobile-feeds-route.AC1.3 | `test/header-feeds-link-static.mjs` | static source-wiring | Within the same isolated `.mobile-nav-menu` block, `href="/about"`, `href="/feeds"`, and `handleLogout` (the Logout control's onClick ref) all co-occur — the Feeds link lives in the same mobile menu as About and Logout. |
| 027-mobile-feeds-route.AC2.1 | `test/feeds-route-static.mjs` | static source-wiring | The isolated `/feeds` `addRoute` block in `routes/index.ts` contains `return FeedsRoute` (authenticated path returns the route component). |
| 027-mobile-feeds-route.AC2.2 | `test/feeds-route-static.mjs` | static source-wiring | The `/feeds` block matches the guard condition `!state.authLoading.value && !state.isAuthenticated.value` and `_setRoute('/login')` (unauthenticated + not loading redirects, returns no component). |
| 027-mobile-feeds-route.AC2.3 | `test/feeds-route-static.mjs` | static source-wiring | Same guard-condition assertion as AC2.2: the `authLoading` half of the `&&` means a true `authLoading` makes the `if` false, so no redirect fires while auth is loading (guard wiring proven statically; matches the `/updates` pattern). |
| 027-mobile-feeds-route.AC3.1 | `test/feeds-route-static.mjs` | static source-wiring | `routes/feeds.ts` references `FeedNav` and uses `class="route feeds"` — `FeedsRoute` renders the shared `FeedNav`. |
| 027-mobile-feeds-route.AC3.2 | `test/sidebar-static.mjs` | static source-wiring | `sidebar.ts` references `FeedNav` and `class="sidebar"` — the desktop `Sidebar` delegates to the shared `FeedNav` (single source of truth). |
| 027-mobile-feeds-route.AC3.3 | `test/sidebar-static.mjs` | static source-wiring | The three retargeted assertions now read `feed-nav.ts`: add-feed input read via `els.namedItem('new-feed-url') as HTMLInputElement`, the empty-state `feedsError.value ? ... : ...` ternary with a "No feeds yet" fallback, and `feedsError` destructured from state — confirming the control set moved into `FeedNav`. (Partial: see Human verification for full control-set rendering at runtime.) |
| 027-mobile-feeds-route.AC3.4 | `test/feeds-route-static.mjs` | static source-wiring | `routes/feeds.css` does NOT match `display\s*:\s*none` — the `.route.feeds` wrapper carries no hide-at-breakpoint rule, so it renders at mobile widths (the `style.css` 768px hide rule targets `.sidebar` only, a different selector). |
| 027-mobile-feeds-route.AC4.1 | `test/sidebar-feed-counts.ts` | behavioral | Renders real `<Sidebar>` (hence real `FeedNav`); asserts each `.feeds-list .feed-item` row contains an `a.feed-select` link — proving feed entries are navigation links, not buttons. (Partial: proves links exist for per-feed rows; the exact `/feed/{path}` and `/` hrefs for All Items / Starred / All Feeds are confirmed by reuse + Human verification.) |
| 027-mobile-feeds-route.AC4.2 | `test/sidebar-feed-counts.ts` | behavioral | Renders real `<Sidebar>`; the feed-item rows expose mutation controls as `<button>` (item-controls retry/delete) with no `href`. (Partial: full add/delete/retry/refresh in-place behavior on `/feeds` confirmed by reuse + Human verification.) |
| 027-mobile-feeds-route.AC5.1 | `test/sidebar-feed-counts.ts` | behavioral | Renders real `<Sidebar>` post-extraction and asserts inner DOM is intact: 3 feed-item rows (All Feeds + 2 feeds), `.feed-unread-count` badge before each `a.feed-select`, literal `0` for feeds missing from perFeed, `(N) ` pending prefix before the name (incl. multi-digit), and signal-driven re-render. Staying green proves the `Fragment` extraction preserved desktop DOM byte-for-byte. (Partial: visual parity is Human verification.) |
| 027-mobile-feeds-route.AC5.2 | `test/feeds-route-static.mjs` (plus git-diff check) | static source-wiring / no-change check | `feeds-route-static.mjs` confirms the new `feeds.css` has no `display:none`/breakpoint; AC5.2 itself ("`sidebar.css` and the 680/768px breakpoints unchanged") is guaranteed by NOT editing those files — verify with `git diff --stat` showing `sidebar.css`, `style.css`, `header.css` breakpoints untouched, not a unit test. |

Notes on partial coverage:
- **AC3.3** is automated for the add-feed/empty-state markup wiring; the
  *complete* control set rendering (counts, gear, spinner, failed label, footer)
  at runtime is covered behaviorally for the desktop path by
  `test/sidebar-feed-counts.ts` and by Human verification for `/feeds`.
- **AC4.1 / AC4.2** are automated at the per-feed-row level by
  `test/sidebar-feed-counts.ts`; the specific selection hrefs and in-place
  mutation outcomes are confirmed by reuse (same `FeedNav`) plus Human
  verification on `/feeds`.
- **AC5.1** is automated for DOM structure; pixel/visual parity is Human
  verification.

---

## 2. Human verification

These cases cannot be reliably automated here: the codebase has no
browser-rendering harness that exercises live client-side navigation, the
hamburger collapse effect, mobile-width rendering, or pixel parity. Each is
verified manually.

### 027-mobile-feeds-route.AC1.2 (Activating Feeds navigates + menu collapses)
**Why manual:** Requires live `route-event` click interception, an actual route
change, and the existing close-on-route-change `useEffect`. There is no DOM/event
harness for client navigation; a static test only proves the link is wired
(AC1.1), not that activating it navigates and collapses the menu.
**Approach:** Run `npm run dev`. In a browser at viewport width < 680px, open the
hamburger menu, tap **Feeds**. Confirm (1) the URL becomes `/feeds` and the
feed-nav page renders, and (2) the hamburger menu closes automatically.

### 027-mobile-feeds-route.AC3.3 (full control set renders on `/feeds`) — partial, also automated
**Why manual:** No browser-rendering harness mounts `FeedsRoute` at mobile width;
the static test proves the add-feed/empty-state wiring moved to `FeedNav`, not
that every control paints on the page.
**Approach:** Logged in, open `/feeds` at viewport width < 680px. Confirm all
controls render: All Items + Starred rows with unread counts; the Feeds header
with the gear (-> `/settings`) and the "+" add-feed toggle + form (+ error on a
bad URL); the feed list with per-feed unread count, `(N)` pending count, a
resolving spinner, a failed-feed label + retry, and per-feed delete "X"; and the
footer Refresh Feeds + Settings.

### 027-mobile-feeds-route.AC3.4 (renders at mobile width) — partial, also automated
**Why manual:** The static test proves no `display:none` rule exists in
`feeds.css`; only a browser at a narrow viewport confirms the page actually
paints full-width and is not hidden by any other rule.
**Approach:** At viewport width < 680px (and again at 680–768px, the accepted
gap), navigate directly to `/feeds`. Confirm the page renders full-width and is
visible (unlike `.sidebar`, which is hidden below 768px).

### 027-mobile-feeds-route.AC4.1 (selection drills in to the article list) — partial, also automated
**Why manual:** The behavioral test proves per-feed rows are `a.feed-select`
links; confirming that tapping each control leaves `/feeds` and lands on the
correct article-list route needs live navigation.
**Approach:** On `/feeds`, tap an individual feed -> expect `/feed/{path}`; tap
All Items, Starred, and All Feeds -> expect `/` (article list). Each tap
navigates away from `/feeds`.

### 027-mobile-feeds-route.AC4.2 (mutations act in place) — partial, also automated
**Why manual:** Confirming add/delete/retry/Refresh-Feeds keep the user on
`/feeds` (no navigation) requires invoking the live handlers.
**Approach:** On `/feeds`: add a feed, delete a feed, retry a failed feed, and
tap Refresh Feeds. After each, confirm the URL stays `/feeds` and the action
takes effect in place.

### 027-mobile-feeds-route.AC5.1 (desktop sidebar visually + behaviorally identical) — partial, also automated
**Why manual:** `test/sidebar-feed-counts.ts` guards desktop DOM structure, but
visual parity and full interactive behavior are not asserted by any test.
**Approach:** At viewport width >= 768px, exercise the desktop sidebar end to
end: All Items / Starred with counts, Feeds header gear + "+" toggle, add a feed,
delete a feed, a resolving spinner, a failed feed's label + retry, Refresh Feeds,
and navigation to `/` and `/feed/...`. Confirm it looks and behaves exactly as
before the `FeedNav` extraction.

### 027-mobile-feeds-route.AC5.2 (CSS / breakpoints unmodified) — also a git no-change check
**Why manual / non-unit:** A unit test cannot prove a file was *not* changed;
the guarantee comes from not editing `sidebar.css`, `style.css`, or any
680/768px media query.
**Approach:** Run `git diff --stat` (and inspect `git diff`) for the feature
branch and confirm `src/client/components/sidebar.css`, `src/client/style.css`,
and the `header.css` breakpoints show no modifications. (Run `npm run stylelint`
as a supporting check.)

---

## Coverage check

Every AC appears at least once:

- Fully automated: AC1.1, AC1.3, AC2.1, AC2.2, AC2.3, AC3.1, AC3.2.
- Automated + Human verification (partial each): AC3.3, AC3.4, AC4.1, AC4.2,
  AC5.1, AC5.2.
- Human verification only: AC1.2.

New test files: `test/feeds-route-static.mjs`,
`test/header-feeds-link-static.mjs`. Modified: `test/sidebar-static.mjs`
(retargeted at `feed-nav.ts` + new Sidebar-wraps-FeedNav assertion),
`test/run-all-tests.mjs` (registers both new `.mjs` tests). Unchanged
load-bearing guard: `test/sidebar-feed-counts.ts` (must stay green).
