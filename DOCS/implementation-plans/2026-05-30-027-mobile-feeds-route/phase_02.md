# Mobile Feeds View (`/feeds`) Implementation Plan — Phase 2

**Goal:** Add a full-width, touch-friendly, auth-guarded `/feeds` route that
renders the shared `FeedNav`, reachable by URL at any viewport width.

**Architecture:** New `FeedsRoute`
(`src/client/routes/feeds.ts`) renders
`<section class="route feeds"><FeedNav state/></section>`. It is registered in
`src/client/routes/index.ts` with the same auth-guard pattern as `/updates`.
New `feeds.css` provides the page-level layout under `.route.feeds`; the inner
feed-management styling is inherited from the app-wide CSS bundle
(`sidebar.css` + `style.css`), which is already loaded. No backend, signal, or
breakpoint changes.

**Tech Stack:** TypeScript (browser, ES2022 via Vite), Preact,
`@preact/signals`, `htm/preact`, `@substrate-system/routes`, `route-event`.
Tests via `node:test` + `node:assert/strict` (`.mjs` static source-wiring).

**Scope:** Phase 2 of 3 from
`docs/design-plans/2026-05-30-027-mobile-feeds-route.md`.

**Codebase verified:** 2026-05-30 (via codebase-investigator agents).

**Dependencies:** Phase 1 (`FeedNav` must exist at
`src/client/components/feed-nav.ts`).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### 027-mobile-feeds-route.AC2: `/feeds` is a registered, auth-guarded route
- **027-mobile-feeds-route.AC2.1 Success:** `router.match('/feeds').action(...)`
  returns `FeedsRoute` when the user is authenticated.
- **027-mobile-feeds-route.AC2.2 Failure:** When not authenticated and not
  loading, the action redirects via `_setRoute('/login')` (does not render
  `FeedsRoute`).
- **027-mobile-feeds-route.AC2.3 Edge:** While `authLoading` is true, the guard
  does not redirect (consistent with the `/updates` guard).

### 027-mobile-feeds-route.AC3: `/feeds` exposes the same controls as the desktop sidebar via a shared component
- **027-mobile-feeds-route.AC3.1 Success:** `FeedsRoute` renders `<FeedNav>`.
- **027-mobile-feeds-route.AC3.4 Edge:** The `/feeds` wrapper (`.route.feeds`)
  carries no `display:none` breakpoint rule, so it renders at mobile widths
  (unlike `.sidebar`).

### 027-mobile-feeds-route.AC4: Selection drills in; mutations act in place
- **027-mobile-feeds-route.AC4.1 Success:** Feed entries link to
  `/feed/{path}`, and All Feeds / All Items / Starred link to `/` — so
  selecting one navigates away from `/feeds` to the article list.
- **027-mobile-feeds-route.AC4.2 Success:** Add-feed, delete, retry, and
  Refresh Feeds are non-navigation controls (no `href`), so invoking them keeps
  the user on `/feeds`.

### 027-mobile-feeds-route.AC5: Desktop behavior and breakpoints are unchanged
- **027-mobile-feeds-route.AC5.2 Success:** `sidebar.css` and the existing
  680px / 768px breakpoints are not modified.

---

## Context for the implementing engineer

**Route registration API (verified, `src/client/routes/index.ts`):** Routes
are defined inside a default-exported factory
`export default function _Router (state:AppState)` that does
`const router = new Router()` (from `@substrate-system/routes`), registers
routes with `router.addRoute(path, () => Component)`, and `return router`. The
`router` is NOT a module export. The app calls the factory once in
`src/client/index.ts` (`const router = Router(state)`).

The existing `/updates` and `/confirm-close` guards (lines 59–71) are the
pattern to copy:
```ts
router.addRoute('/updates', () => {
    if (!state.authLoading.value && !state.isAuthenticated.value) {
        return state._setRoute('/login')
    }
    return UpdatesRoute
})
```
`state._setRoute('/login')` returns `undefined`; returning it means the
action returns no component, so `FeedsRoute` is not rendered (the app shell
treats a falsy action result as "no child"). The `authLoading` half of the
condition is what makes AC2.3 hold: while `authLoading.value` is `true`, the
`if` is false, so no redirect occurs.

**Imports block (verified, lines 1–13):** route components are imported at the
top, e.g. `import { UpdatesRoute } from './updates.js'`. Add the `FeedsRoute`
import alongside these.

**App shell (verified, `src/client/index.ts:117-126`):** every matched route is
automatically wrapped with `<${Header} state/>` and a `<footer>`, and the
matched component receives `state`, `params`, `splats`. So `/feeds` gets the
header (hamburger + mobile menu) and footer for free — `FeedsRoute` only needs
to render its own `<section>`.

**Route component shape (verified, e.g. `routes/updates.ts`):** a route
component is `FunctionComponent<{ state:AppState }>` (static routes omit
`splats`), returns one `html\`...\`` template wrapped in
`<div class="route NAME">` (we will use `<section class="route feeds">` per the
design), and imports its colocated CSS as a side effect
(`import './feeds.css'`).

**CSS facts (verified):** The mobile-hide rule
`@media (width < 768px) { .sidebar { display: none } }` lives in `style.css`
and targets `.sidebar` only — `.route.feeds` is a different selector and is
NOT hidden (this satisfies AC3.4 without any extra rule). The inner
feed-management classes (`.sidebar-section`, `.sidebar-header`,
`.feeds-controls`, `.item-controls`, `.feeds-list .feed-item` + children,
`.badge`, `.feed-select`, `.add-feed-form`, `.form-error`, `.empty-state`,
`.loading-text`) are GLOBAL (not `.sidebar`-scoped) and already in the app-wide
CSS bundle (loaded via `feed-nav.ts` -> `sidebar.css`, plus `style.css`). So
`feeds.css` does NOT need to restate them; it only supplies the page-level
container layout and touch-target tweaks. The CSS variables file is
`src/client/_variables.css` (tokens are `--color-*` and `--sidebar-width`;
the codebase uses raw `rem` values for spacing — there are no spacing tokens).

**Testing decision (deviation from the design — read this):** The design's AC2
is phrased behaviorally ("`router.match('/feeds').action(...)` returns
`FeedsRoute` ..."). Investigation showed a runtime test would be brittle: the
`router` is not exported (only the `_Router(state)` factory is), and importing
the real `state` singleton triggers heavy import-time side effects
(`window`/`location`/`localStorage`, a `route-event` listener, and an async
`GET /api/me`). The codebase has NO precedent for runtime route-guard tests;
its only route test (`test/routes-oauth-callback-static.mjs`) is a STATIC
source-wiring test. Per the project rule "DO NOT WRITE BRITTLE TESTS," this
phase verifies AC2 with a static source-wiring test that asserts the `/feeds`
registration contains the exact guard pattern and returns `FeedsRoute`. This
matches `routes-oauth-callback-static.mjs` and is the idiomatic choice here.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create the `FeedsRoute` component

**Verifies:** 027-mobile-feeds-route.AC3.1 (renders `<FeedNav>`), and is the
component returned by the AC2.1 guard.

**Files:**
- Create: `src/client/routes/feeds.ts`

**Implementation:**

```ts
import { html } from 'htm/preact/index.js'
import { type FunctionComponent } from 'preact'
import { type AppState } from '../state.js'
import { FeedNav } from '../components/feed-nav.js'
import './feeds.css'

export const FeedsRoute:FunctionComponent<{
    state:AppState
}> = function FeedsRoute ({ state }) {
    return html`
        <section class="route feeds">
            <${FeedNav} state=${state} />
        </section>
    `
}
```

Notes:
- Import path to the shared component is `../components/feed-nav.js` (this file
  is under `routes/`).
- The outer element is `<section class="route feeds">` (per the design), which
  matches the `.route.NAME` convention used by sibling routes.
- No selection/mutation logic here — `FeedNav` already carries the desktop
  handlers verbatim, which is why AC4.1/AC4.2 hold by reuse (the feed links are
  `<a href="/feed/...">` / `<a href="/">`; add/delete/retry/refresh are
  `<button>`s with no `href`).

**Testing:** Covered by Task 4 (static parity assertion that `feeds.ts`
renders `FeedNav` and uses `class="route feeds"`).

**Verification:**
Run: `npm run build`
Expected: Type-checks/builds (the route is not yet registered, but must
compile).

**Commit:** `feat: add FeedsRoute rendering shared FeedNav`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add `feeds.css` page-level styling

**Verifies:** 027-mobile-feeds-route.AC3.4 (no `display:none` breakpoint on
`.route.feeds`); supports the full-width/touch-friendly goal.

**Files:**
- Create: `src/client/routes/feeds.css`

**Implementation:**

Scope everything under `.route.feeds`. Provide full-width page layout,
comfortable padding, and roomier touch targets — reusing existing `--color-*`
variables from `src/client/_variables.css` and `rem` spacing consistent with
`sidebar.css`/`style.css`. Do NOT restate the inner feed-management class rules
(they are global and already applied). Do NOT add any `display:none` /
breakpoint rule. Keep all font sizes >= 1rem and use variables for any colors.

Starting point (the implementing engineer should open `_variables.css` to
confirm token names and adjust to taste, keeping within these constraints):

```css
.route.feeds {
    width: 100%;
    max-width: 40rem;
    margin: 0 auto;
    padding: 1rem;
    box-sizing: border-box;

    /* The shared FeedNav's `.sidebar-section` blocks already carry their
       borders/padding from the global rules; widen touch targets for the
       feed rows and controls on this page. */
    & .sidebar-item {
        min-height: 2.75rem;
    }

    & .item-controls button {
        min-height: 2.5rem;
        min-width: 2.5rem;
    }
}
```

Notes:
- These selectors are nested under `.route.feeds`, so they only affect the
  mobile page and cannot alter the desktop sidebar (AC5 protection).
- Because `.route.feeds` is not `.sidebar`, the `style.css` 768px hide rule
  never applies (AC3.4) — verify there is no `display:none`/`@media` rule in
  this new file.

**Testing:** No standalone test; the absence of a `display:none` breakpoint is
asserted in Task 4 (read `feeds.css`, assert it does not match
`display\s*:\s*none`).

**Verification:**
Run: `npm run build && npm run stylelint`
Expected: Build and stylelint pass. (Confirm the exact stylelint script name
in `package.json` — it is `npm run stylelint`.)

**Commit:** `feat: add mobile page styling for the /feeds route`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Register the auth-guarded `/feeds` route

**Verifies:** 027-mobile-feeds-route.AC2.1, AC2.2, AC2.3.

**Files:**
- Modify: `src/client/routes/index.ts`

**Implementation:**

1. Add the import alongside the other route imports (after the
   `import { UpdatesRoute } from './updates.js'` line, ~line 13):
   ```ts
   import { FeedsRoute } from './feeds.js'
   ```
2. Register the route immediately after the `/updates` block (after ~line 64),
   copying the `/updates` guard pattern exactly:
   ```ts
   router.addRoute('/feeds', () => {
       if (!state.authLoading.value && !state.isAuthenticated.value) {
           return state._setRoute('/login')
       }
       return FeedsRoute
   })
   ```

This guard satisfies AC2.1 (authenticated -> returns `FeedsRoute`), AC2.2
(unauthenticated & not loading -> `state._setRoute('/login')`, no component),
and AC2.3 (`authLoading` true -> condition false -> no redirect).

**Testing:** Covered by Task 4 (static assertion of the registration + guard).

**Verification:**
Run: `npm run build && npm run lint`
Expected: Build and lint pass.

Manual smoke test: with the dev server running and logged in, navigate to
`/feeds` directly (type the URL) at a narrow viewport — the full-width feed nav
renders with all controls; tapping a feed navigates to `/feed/...`; tapping
"All Items"/"Starred"/"All Feeds" navigates to `/`; add/delete/retry/refresh
stay on `/feeds`. Logged out, navigating to `/feeds` redirects to `/login`.

**Commit:** `feat: register auth-guarded /feeds route`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Static source-wiring test for the `/feeds` route

**Verifies:** 027-mobile-feeds-route.AC2.1, AC2.2, AC2.3, AC3.1, AC3.4
(and AC5.2 by asserting `sidebar.css` is untouched is out of scope — AC5.2 is
guaranteed by not editing the file).

**Files:**
- Create: `test/feeds-route-static.mjs`
- Modify: `test/run-all-tests.mjs` (register the new test)

**Implementation:**

Follow the `test/routes-oauth-callback-static.mjs` structure (`node:test` +
`node:assert/strict`, read source as text, regex-match). Create
`test/feeds-route-static.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const routes = readFileSync(
    new URL('../src/client/routes/index.ts', import.meta.url),
    'utf8'
)
const feedsRouteFile = readFileSync(
    new URL('../src/client/routes/feeds.ts', import.meta.url),
    'utf8'
)
const feedsCss = readFileSync(
    new URL('../src/client/routes/feeds.css', import.meta.url),
    'utf8'
)

// Isolate the /feeds registration block.
const feedsBlock = routes.match(
    /router\.addRoute\('\/feeds', \(\) => \{[\s\S]*?\n {4}\}\)/
)?.[0] ?? ''

test('/feeds route is registered', () => {
    assert.ok(feedsBlock, '/feeds route block exists')
})

test('/feeds returns FeedsRoute when authenticated (AC2.1)', () => {
    assert.match(feedsBlock, /return FeedsRoute/)
})

test('/feeds guards via _setRoute(/login) when not authed (AC2.2/AC2.3)',
    () => {
        assert.match(
            feedsBlock,
            /!state\.authLoading\.value && !state\.isAuthenticated\.value/
        )
        assert.match(feedsBlock, /_setRoute\('\/login'\)/)
    }
)

test('FeedsRoute renders shared FeedNav in .route.feeds (AC3.1)', () => {
    assert.match(feedsRouteFile, /\bFeedNav\b/)
    assert.match(feedsRouteFile, /class="route feeds"/)
})

test('/feeds page has no display:none breakpoint rule (AC3.4)', () => {
    assert.doesNotMatch(feedsCss, /display\s*:\s*none/)
})
```

Then register it in `test/run-all-tests.mjs` next to the other static `.mjs`
entries (e.g. right after the `'node test/routes-oauth-callback-static.mjs',`
line), as:
```js
'node test/feeds-route-static.mjs',
```

**Testing:** This task IS the test.

**Verification:**
Run: `node test/feeds-route-static.mjs`
Expected: All assertions pass.

Run: `npm test`
Expected: Full suite passes (the new test is included via `run-all-tests.mjs`).

**Commit:** `test: static wiring test for /feeds route + guard`
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_A -->

---

## Phase 2 Done When

- `src/client/routes/feeds.ts` exports `FeedsRoute` rendering
  `<section class="route feeds"><FeedNav state/></section>`.
- `src/client/routes/feeds.css` provides `.route.feeds` page layout with no
  `display:none`/breakpoint rule, no sub-1rem fonts, colors via variables.
- `src/client/routes/index.ts` registers `/feeds` with the `/updates`
  auth-guard pattern, importing `FeedsRoute`.
- `test/feeds-route-static.mjs` exists, is registered in `run-all-tests.mjs`,
  and passes.
- `npm run build`, `npm run lint`, `npm run stylelint`, and `npm test` pass.
- `sidebar.css`, `style.css`, and all 680px/768px breakpoints are unchanged
  (AC5.2).
