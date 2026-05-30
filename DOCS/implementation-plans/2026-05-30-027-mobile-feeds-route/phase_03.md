# Mobile Feeds View (`/feeds`) Implementation Plan — Phase 3

**Goal:** Add the mobile entry point — a "Feeds" link in the hamburger menu
that navigates to `/feeds`.

**Architecture:** Add a single `<a href="/feeds">Feeds</a>` link into the
`<nav>` inside `.mobile-nav-menu` in `src/client/components/header.ts`, next to
the existing About link, using the same active-class pattern. `route-event`
already intercepts internal `<a href>` clicks for client-side navigation, and
the existing "close menu on route change" effect collapses the hamburger after
navigation — so no `onClick` and no new effect are needed.

**Tech Stack:** TypeScript (browser, ES2022 via Vite), Preact, `htm/preact`,
`route-event`. Test via `node:test` + `node:assert/strict` (`.mjs` static
source-wiring).

**Scope:** Phase 3 of 3 from
`docs/design-plans/2026-05-30-027-mobile-feeds-route.md`.

**Codebase verified:** 2026-05-30 (via codebase-investigator agents).

**Dependencies:** Phase 2 (the `/feeds` route must exist to navigate to).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### 027-mobile-feeds-route.AC1: Hamburger menu exposes a Feeds entry point
- **027-mobile-feeds-route.AC1.1 Success:** The header's mobile menu
  (`.mobile-nav-menu`) wires a navigation link whose target is `/feeds`.
- **027-mobile-feeds-route.AC1.2 Success:** Activating the Feeds link navigates
  to `/feeds` and the hamburger menu collapses (existing close-on-route-change
  effect).
- **027-mobile-feeds-route.AC1.3 Success:** The Feeds link lives in the same
  mobile menu as the existing About link and Logout control (only surfaced
  where the hamburger is, below 680px).

---

## Context for the implementing engineer

**Mobile menu markup (verified, `src/client/components/header.ts:108-135`):**
```ts
<div class="mobile-nav-menu${
    menuOpen ? ' open' : ''
}">
    <nav>
        <a
            href="/about"
            class="header-link${
                route.value === '/about' ?
                    ' active' :
                    ''
            }"
        >
            About
        </a>
    </nav>

    <div class="mobile-user">
        <${UserIcon} state=${state} />
        ${user.value && html`
            <button
                class="btn btn-small"
                onClick=${handleLogout}
            >
                Logout
            </button>
        `}
    </div>
</div>
```

Facts that make this phase trivial and safe:
- `route` is `state.route` (a `Signal<string>`), already destructured at the
  top of `Header` (`const { user, route } = state`). The Feeds link reuses it
  for its active class — no new state.
- `route-event` is initialized in `state.ts` (`const onRoute = Route()`) and
  globally intercepts internal `<a href>` clicks, so a plain
  `<a href="/feeds">` navigates with no `onClick` (AC1.2 navigation).
- The "close menu on route change" effect already exists in `header.ts`
  (`useEffect(..., [route.value])` — closes the menu when `route.value`
  changes). Adding a link does not touch it, so the menu collapses on
  navigation (AC1.2 collapse).
- The hamburger / `.mobile-nav-menu` only appear below 680px (`header.css`
  `@media (width < 680px)`), so the Feeds link is mobile-only (AC1.3). No CSS
  change is needed — `.active` styling and mobile menu colors already apply to
  all links in the menu.

---

<!-- START_TASK_1 -->
### Task 1: Add the "Feeds" link to the mobile menu

**Verifies:** 027-mobile-feeds-route.AC1.1, AC1.2, AC1.3.

**Files:**
- Modify: `src/client/components/header.ts` (inside the `<nav>` in
  `.mobile-nav-menu`, after the About link — between current lines 121 and 122)

**Implementation:**

Insert a Feeds link immediately after the About `</a>` (line 121) and before
the closing `</nav>` (line 122), mirroring the About link's active-class
pattern exactly:

```ts
            <nav>
                <a
                    href="/about"
                    class="header-link${
                        route.value === '/about' ?
                            ' active' :
                            ''
                    }"
                >
                    About
                </a>
                <a
                    href="/feeds"
                    class="header-link${
                        route.value === '/feeds' ?
                            ' active' :
                            ''
                    }"
                >
                    Feeds
                </a>
            </nav>
```

Do not add any `onClick`, effect, or CSS. Keep lines within 80 columns.

**Testing:** Covered by Task 2 (static assertion the mobile menu links to
`/feeds`).

**Verification:**
Run: `npm run build && npm run lint`
Expected: Build and lint pass.

Manual smoke test: with the dev server running, narrow the viewport below
680px, open the hamburger menu, confirm a "Feeds" item appears alongside
"About" and the Logout control; tapping it navigates to `/feeds` and the menu
closes.

**Commit:** `feat: add Feeds link to the mobile hamburger menu`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Static wiring test for the mobile Feeds link

**Verifies:** 027-mobile-feeds-route.AC1.1, AC1.3.

**Files:**
- Create: `test/header-feeds-link-static.mjs`
- Modify: `test/run-all-tests.mjs` (register the new test)

**Background:** The existing `test/header-component.ts` is a heavier behavioral
test (renders the component). For this wiring check, follow the lighter static
source-wiring precedent (`test/sidebar-static.mjs`,
`test/routes-oauth-callback-static.mjs`): read `header.ts` as text, isolate the
`.mobile-nav-menu` block, and assert on attribute wiring (not rendered text
content — per the project rule against brittle HTML-text assertions).

**Implementation:**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const header = readFileSync(
    new URL('../src/client/components/header.ts', import.meta.url),
    'utf8'
)

// Isolate the mobile-nav-menu container so assertions are scoped to it.
// NB: the container's closing </div> in header.ts is indented 8 spaces.
const menuBlock = header.match(
    /class="mobile-nav-menu[\s\S]*?\n {8}<\/div>/
)?.[0] ?? header

test('mobile-nav-menu block is isolated (regex guard)', () => {
    // Guard: if the isolation regex ever stops matching and falls back to
    // the whole file, the AC1.3 co-location check below becomes meaningless.
    assert.notEqual(menuBlock, header, 'isolated the mobile menu container')
})

test('mobile menu links to /feeds (AC1.1)', () => {
    assert.match(menuBlock, /href="\/feeds"/)
})

test('Feeds link sits with About and Logout in the mobile menu (AC1.3)',
    () => {
        assert.match(menuBlock, /href="\/about"/)
        assert.match(menuBlock, /href="\/feeds"/)
        assert.match(menuBlock, /handleLogout/)
    }
)
```

Notes:
- The `.mobile-nav-menu` container's closing `</div>` in `header.ts` is
  indented 8 spaces, so the isolation regex terminator is `\n {8}<\/div>`
  (a 4-space terminator never matches and silently falls back to the whole
  file). The explicit `assert.notEqual(menuBlock, header, ...)` guard catches
  any future fallback, so the AC1.3 co-location of `/about`, `/feeds`, and
  `handleLogout` is only asserted when they genuinely share the isolated menu
  block.
- Asserting `handleLogout` (the onClick handler reference) rather than the word
  "Logout" keeps this a source-wiring check, not an HTML-text-content check.
- The `?? header` fallback remains only so the file parses if the markup is
  later restructured; the guard test above fails loudly in that case rather
  than passing on a false positive.

Register it in `test/run-all-tests.mjs` next to the other static `.mjs`
entries (e.g. after `'node test/sidebar-static.mjs',`):
```js
'node test/header-feeds-link-static.mjs',
```

**Testing:** This task IS the test.

**Verification:**
Run: `node test/header-feeds-link-static.mjs`
Expected: All three tests pass (the regex guard, AC1.1, and AC1.3).

Run: `npm test && npm run lint`
Expected: Full suite and lint pass.

**Commit:** `test: static wiring test for mobile Feeds link`
<!-- END_TASK_2 -->

---

## Phase 3 Done When

- `src/client/components/header.ts`'s `.mobile-nav-menu` `<nav>` contains an
  `<a href="/feeds">Feeds</a>` link with the About-style active class.
- `test/header-feeds-link-static.mjs` exists, is registered in
  `run-all-tests.mjs`, and passes.
- `npm run build`, `npm run lint`, and `npm test` all pass.
- No CSS changes; no changes to the close-on-route-change effect or
  breakpoints.
